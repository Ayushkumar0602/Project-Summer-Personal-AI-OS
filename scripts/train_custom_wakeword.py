import os
import glob
import numpy as np
import onnxruntime as ort
import librosa
import torch
import torch.nn as nn

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POS_DIR = os.path.join(BASE_DIR, 'src', 'wake-word', 'dataset', 'positive')
NEG_DIR = os.path.join(BASE_DIR, 'src', 'wake-word', 'dataset', 'negative')
MODELS_DIR = os.path.join(BASE_DIR, 'src', 'models')

MEL_MODEL = os.path.join(MODELS_DIR, 'melspectrogram.onnx')
EMB_MODEL = os.path.join(MODELS_DIR, 'embedding_model.onnx')

print("Loading ONNX models for feature extraction...")
mel_session = ort.InferenceSession(MEL_MODEL)
emb_session = ort.InferenceSession(EMB_MODEL)

def extract_features(audio_data, is_audio=False):
    if not is_audio:
        # Load 16kHz audio from path
        y, sr = librosa.load(audio_data, sr=16000)
    else:
        y = audio_data
    
    # OpenWakeWord processes 1280 samples (80ms) per frame, with 160 samples (10ms) step.
    # The mel.onnx expects shape [1, 160] (Wait, let's just use the JS logic we know works)
    # Actually, the OpenWakeWord pre-trained mel model expects raw audio chunks of varying sizes, but typically [1, chunk_size].
    # Let's see the ONNX input shape
    mel_input_name = mel_session.get_inputs()[0].name
    emb_input_name = emb_session.get_inputs()[0].name
    
    # Run mel over the whole audio? OpenWakeWord's melspectrogram.onnx can take variable length!
    # Let's pass the whole audio buffer if dynamic, otherwise chunk it.
    try:
        # Pad or trim to exactly 2 seconds to be safe (16000 * 2 = 32000 samples)
        if len(y) > 32000: y = y[:32000]
        else: y = np.pad(y, (0, 32000 - len(y)))
        
        # Reshape to [1, 32000]
        y_input = y.astype(np.float32).reshape(1, -1)
        
        # Run Mel Spectrogram
        mel_out = mel_session.run(None, {mel_input_name: y_input})[0]
        # mel_out shape typically: [1, 1, frames, 32]
        
        # Run Embedding Model
        # Embed model expects [1, 76, 32, 1] for 1 frame of embedding, but can take variable frames if dynamic
        # Let's reshape mel_out to [1, frames, 32, 1]
        mel_out = np.squeeze(mel_out) # [frames, 32]
        frames = mel_out.shape[0]
        
        embeddings = []
        # OpenWakeWord embedding model takes a context window of 76 frames.
        for i in range(0, frames - 76, 5): # Stride of 5 frames (40ms) approx
            context = mel_out[i:i+76, :] # [76, 32]
            context = context.reshape(1, 76, 32, 1)
            emb = emb_session.run(None, {emb_input_name: context})[0] # [1, 1, 1, 96]
            embeddings.append(np.squeeze(emb)) # [96]
            
        return np.array(embeddings) # [num_embeddings, 96]
    except Exception as e:
        print(f"Error processing {audio_path}: {e}")
        return None

print("Extracting features for POSITIVE samples...")
pos_files = glob.glob(os.path.join(POS_DIR, '*.wav'))
pos_embeddings = []
for f in pos_files:
    emb = extract_features(f)
    if emb is not None and len(emb) > 0:
        pos_embeddings.extend(emb) # Add all embedding frames

print("Extracting features for NEGATIVE samples...")
neg_files = glob.glob(os.path.join(NEG_DIR, '*.wav'))
neg_embeddings = []
for f in neg_files:
    emb = extract_features(f)
    if emb is not None and len(emb) > 0:
        neg_embeddings.extend(emb)

# Convert to Numpy
X_pos = np.array(pos_embeddings)
X_neg = np.array(neg_embeddings)

# Labels
y_pos = np.ones((X_pos.shape[0], 1), dtype=np.float32)
y_neg = np.zeros((X_neg.shape[0], 1), dtype=np.float32)

X = np.vstack((X_pos, X_neg)).astype(np.float32)
Y = np.vstack((y_pos, y_neg))

print(f"Total Positive Embedding Frames: {X_pos.shape[0]}")
print(f"Total Negative Embedding Frames: {X_neg.shape[0]}")

# -------------------------
# Train PyTorch Classifier
# -------------------------
print("\nTraining Neural Network Classifier...")

class WakeWordModel(nn.Module):
    def __init__(self):
        super().__init__()
        # Input: [batch, 16, 96]
        # OpenWakeWord passes the last 16 embedding frames flattened -> 16 * 96 = 1536
        self.fc = nn.Linear(1536, 1)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        # x is [batch, 16, 96]
        x = x.view(x.size(0), -1) # Flatten to [batch, 1536]
        x = self.fc(x)
        return self.sigmoid(x)

# Since we extracted individual frames of [96], we need to create windows of 16 frames.
# Actually, the user spoke the wake word across the 2-second audio.
# The true wake word feature is probably the sequence of 16 frames.
def create_windows(X, window_size=16):
    windows = []
    if len(X) < window_size: return np.array(windows)
    for i in range(len(X) - window_size + 1):
        windows.append(X[i:i+window_size, :])
    return np.array(windows)

# Create windows for each file individually instead of globally to avoid mixing files.
pos_windows = []
for f in pos_files:
    emb = extract_features(f)
    if emb is not None:
        w = create_windows(emb)
        if len(w) > 0: pos_windows.extend(w)

neg_windows = []
for f in neg_files:
    emb = extract_features(f)
    if emb is not None:
        w = create_windows(emb)
        if len(w) > 0: neg_windows.extend(w)

X_pos_win = np.array(pos_windows)
X_neg_win = np.array(neg_windows)

# -------------------------
# Synthetic Audio Noise Generation
# -------------------------
print("Generating synthetic audio noise to prevent false positives on silence...")
def generate_audio_noise_embeddings():
    noise_embs = []
    # 1. Complete silence
    silence = np.zeros(32000, dtype=np.float32)
    silence_emb = extract_features(silence, is_audio=True)
    if silence_emb is not None: noise_embs.extend(silence_emb)
    
    # 2. White noise (various volumes)
    for vol in [0.001, 0.01, 0.05, 0.1]:
        wn = np.random.randn(32000).astype(np.float32) * vol
        emb = extract_features(wn, is_audio=True)
        if emb is not None: noise_embs.extend(emb)
    
    # 3. Sine waves (various frequencies to simulate hums/beeps)
    t = np.linspace(0, 2, 32000, False)
    for freq in [50, 60, 120, 400, 1000]:
        sine = (np.sin(freq * 2 * np.pi * t) * 0.05).astype(np.float32)
        emb = extract_features(sine, is_audio=True)
        if emb is not None: noise_embs.extend(emb)
        
    return np.array(noise_embs)

noise_embeddings = generate_audio_noise_embeddings()
if len(noise_embeddings) > 0:
    w = create_windows(noise_embeddings)
    if len(w) > 0:
        X_neg_win = np.vstack((X_neg_win, w))

Y_pos_win = np.ones((X_pos_win.shape[0], 1), dtype=np.float32)
Y_neg_win = np.zeros((X_neg_win.shape[0], 1), dtype=np.float32)

if len(X_pos_win) == 0 or len(X_neg_win) == 0:
    print("Not enough data to create 16-frame windows. Recording too short?")
    exit(1)

X_train = np.vstack((X_pos_win, X_neg_win))
Y_train = np.vstack((Y_pos_win, Y_neg_win))

# Convert to tensors
x_tensor = torch.tensor(X_train)
y_tensor = torch.tensor(Y_train)

# Calculate class weights
pos_weight_val = len(Y_neg_win) / len(Y_pos_win) * 0.5 
pos_weight = torch.tensor([pos_weight_val])

model = WakeWordModel()
criterion = nn.BCELoss()
optimizer = torch.optim.Adam(model.parameters(), lr=0.0005, weight_decay=1e-3) # Stronger L2 regularization

epochs = 60
batch_size = 32

for epoch in range(epochs):
    permutation = torch.randperm(x_tensor.size()[0])
    epoch_loss = 0
    for i in range(0, x_tensor.size()[0], batch_size):
        indices = permutation[i:i+batch_size]
        batch_x, batch_y = x_tensor[indices], y_tensor[indices]
        
        optimizer.zero_grad()
        outputs = model(batch_x)
        
        loss = criterion(outputs, batch_y)
        loss.backward()
        optimizer.step()
        epoch_loss += loss.item()
    if epoch % 10 == 0:
        print(f"Epoch {epoch} - Loss: {epoch_loss:.4f}")

# Export to ONNX
output_path = os.path.join(MODELS_DIR, 'summer_custom_v1.onnx')
print(f"\nExporting to {output_path}...")

dummy_input = torch.randn(1, 16, 96)
torch.onnx.export(
    model, 
    dummy_input, 
    output_path, 
    export_params=True, 
    opset_version=13, 
    do_constant_folding=True, 
    input_names=['input'], 
    output_names=['output'], 
    dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
)

print("\n✅ Custom wake word model trained and saved!")
print(f"Model Path: {output_path}")

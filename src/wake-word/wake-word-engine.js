/**
 * wake-word-engine.js — OpenWakeWord 3-Stage ONNX Pipeline
 * 
 * Implements the full OpenWakeWord detection pipeline in Node.js:
 *   Stage 1: melspectrogram.onnx — 1280 PCM samples → [1,1,5,32] mel features
 *   Stage 2: embedding_model.onnx — [1,76,32,1] stacked mel rows → [1,1,1,96] embedding
 *   Stage 3: hey_jarvis_v0.1.onnx — [1,16,96] stacked embeddings → [1,1] confidence
 * 
 * Uses onnxruntime-node for inference.
 */

const ort = require('onnxruntime-node');
const path = require('path');
const EventEmitter = require('events');
const { MicListener } = require('./mic-listener');

// ── OpenWakeWord Constants ──
const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 1280;           // 80ms at 16kHz — input size for mel model
const BYTES_PER_SAMPLE = 2;           // 16-bit audio
const CHUNK_BYTES = CHUNK_SAMPLES * BYTES_PER_SAMPLE;

// Mel output is [1,1,5,32] = 5 rows of 32 mel bins per chunk
const MEL_COLS = 32;
const MEL_ROWS_PER_CHUNK = 5;

// Embedding model wants [1, 76, 32, 1] = 76 rows of 32 mel bins
const EMB_WINDOW_ROWS = 76;

// Wake word model wants [1, 16, 96] = 16 embeddings of 96 dims
const EMBEDDING_DIM = 96;
const WW_WINDOW_SIZE = 16;

class WakeWordEngine extends EventEmitter {
  constructor(options = {}) {
    super();

    this.modelDir = options.modelDir || path.join(__dirname, '..', 'models');
    this.threshold = options.threshold || 0.5;
    this.cooldownMs = options.cooldownMs || 2000;
    this.debounceMs = options.debounceMs || 3000;

    // State
    this._isRunning = false;
    this._isPaused = false;
    this._lastDetectionTime = 0;

    // ONNX sessions
    this._melSession = null;
    this._embeddingSession = null;
    this._wakeWordSession = null;

    // Buffers
    this._audioBuffer = Buffer.alloc(0);
    this._melRows = [];             // Buffer of 32-dim mel rows
    this._embeddings = [];          // Buffer of 96-dim embedding vectors
    this._scoreHistory = [];        // Buffer for temporal smoothing of scores

    // Pipeline scheduling — process one chunk at a time but don't skip mel
    this._processingQueue = [];
    this._isProcessing = false;

    // Debug
    this._chunkCount = 0;
    this._lastLogTime = 0;
    this._gatePass = 0;
    this._gateReject = 0;

    // Sub-components
    this._micListener = new MicListener({ sampleRate: SAMPLE_RATE });

    // System audio detection
    this._systemAudioPlaying = false;
    this._systemAudioPollTimer = null;
  }

  async _loadModels() {
    console.log('[WakeWord] Loading ONNX models...');
    const opts = { executionProviders: ['cpu'], graphOptimizationLevel: 'all' };

    // Load models ONE AT A TIME with a tick between each.
    // onnxruntime-node in Electron has a race condition where
    // creating multiple sessions synchronously can cause the GC
    // to dispose a session that's still being initialized.

    this._melSession = await this._loadOneModel(
      path.join(this.modelDir, 'melspectrogram.onnx'), opts, 'melspectrogram'
    );

    // Yield to the event loop between session creations
    await new Promise(r => setImmediate(r));

    this._embeddingSession = await this._loadOneModel(
      path.join(this.modelDir, 'embedding_model.onnx'), opts, 'embedding_model'
    );

    await new Promise(r => setImmediate(r));

    this._wakeWordSession = await this._loadOneModel(
      path.join(this.modelDir, 'summer_custom_v1.onnx'), opts, 'summer_custom_v1'
    );

    console.log('[WakeWord] All 3 ONNX models loaded successfully.');
  }

  /**
   * Load a single ONNX model with retry logic.
   * Retries once after 500ms if the session is immediately disposed.
   */
  async _loadOneModel(modelPath, opts, label) {
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const session = await ort.InferenceSession.create(modelPath, opts);
        // Verify the session is usable by reading its input names
        const inputs = session.inputNames;
        console.log(`[WakeWord] ✅ Loaded ${label}.onnx (in: ${inputs}, out: ${session.outputNames})`);
        return session;
      } catch (err) {
        console.warn(`[WakeWord] ⚠️ ${label}.onnx load attempt ${attempt}/${maxRetries} failed: ${err.message}`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 500));
        } else {
          throw err;
        }
      }
    }
  }

  /**
   * Stage 1: Mel spectrogram — fast, always runs for every chunk.
   */
  async _runMelSpectrogram(float32Samples) {
    const tensor = new ort.Tensor('float32', float32Samples, [1, float32Samples.length]);
    const results = await this._melSession.run({ 'input': tensor });
    const output = results['output'].data; // [1,1,5,32] = 160 values

    // Apply OpenWakeWord transform + reshape into 5 rows of 32
    const rows = [];
    for (let r = 0; r < MEL_ROWS_PER_CHUNK; r++) {
      const row = new Float32Array(MEL_COLS);
      for (let c = 0; c < MEL_COLS; c++) {
        row[c] = (output[r * MEL_COLS + c] / 10.0) + 2.0;
      }
      rows.push(row);
    }
    return rows;
  }

  /**
   * Stage 2: Embedding — runs when we have enough mel rows.
   */
  async _runEmbedding() {
    const window = this._melRows.slice(-EMB_WINDOW_ROWS);
    const flatData = new Float32Array(EMB_WINDOW_ROWS * MEL_COLS);
    for (let i = 0; i < EMB_WINDOW_ROWS; i++) {
      flatData.set(window[i], i * MEL_COLS);
    }
    const tensor = new ort.Tensor('float32', flatData, [1, EMB_WINDOW_ROWS, MEL_COLS, 1]);
    const results = await this._embeddingSession.run({ 'input_1': tensor });
    return new Float32Array(results['conv2d_19'].data);
  }

  /**
   * Stage 3: Wake word classification — runs when we have enough embeddings.
   */
  async _runClassifier() {
    const window = this._embeddings.slice(-WW_WINDOW_SIZE);
    const flatData = new Float32Array(WW_WINDOW_SIZE * EMBEDDING_DIM);
    for (let i = 0; i < WW_WINDOW_SIZE; i++) {
      flatData.set(window[i], i * EMBEDDING_DIM);
    }
    const tensor = new ort.Tensor('float32', flatData, [1, WW_WINDOW_SIZE, EMBEDDING_DIM]);
    const inputName = this._wakeWordSession.inputNames[0];
    const outputName = this._wakeWordSession.outputNames[0];
    const feeds = {};
    feeds[inputName] = tensor;
    const results = await this._wakeWordSession.run(feeds);
    return results[outputName].data[0];
  }

  /**
   * Process audio through the full pipeline.
   * Stage 1 (mel) runs for EVERY chunk to maintain a continuous feature stream.
   * Stages 2-3 only run when sufficient data has accumulated.
   */
  async _processChunk(float32Samples) {
    if (this._isPaused) return;

    try {
      this._chunkCount++;

      // ── Stage 1: Mel — always runs ──
      const melRows = await this._runMelSpectrogram(float32Samples);
      this._melRows.push(...melRows);

      // Bound mel buffer
      if (this._melRows.length > EMB_WINDOW_ROWS + 100) {
        this._melRows = this._melRows.slice(-(EMB_WINDOW_ROWS + 20));
      }

      // ── Stage 2: Embedding — need 76 mel rows ──
      if (this._melRows.length < EMB_WINDOW_ROWS) return;

      const embedding = await this._runEmbedding();
      this._embeddings.push(embedding);

      // Bound embedding buffer
      if (this._embeddings.length > WW_WINDOW_SIZE + 20) {
        this._embeddings = this._embeddings.slice(-(WW_WINDOW_SIZE + 5));
      }

      // ── Stage 3: Classification — need 16 embeddings ──
      if (this._embeddings.length < WW_WINDOW_SIZE) return;

      const score = await this._runClassifier();

      // ── Logging ──
      const now = Date.now();
      if (score > 0.05 || now - this._lastLogTime > 8000) {
        console.log(`[WakeWord] Score: ${score.toFixed(4)} | threshold: ${this.threshold} | melRows: ${this._melRows.length} | embeddings: ${this._embeddings.length} | chunks: ${this._chunkCount}`);
        this._lastLogTime = now;
      }

      // ── Detection ──
      this._scoreHistory.push(score);
      if (this._scoreHistory.length > 3) this._scoreHistory.shift();
      const averageScore = this._scoreHistory.reduce((a, b) => a + b, 0) / this._scoreHistory.length;

      const effectiveThreshold = this._systemAudioPlaying
        ? Math.min(this.threshold + 0.1, 0.95)
        : this.threshold;

      if (averageScore >= effectiveThreshold) {
        if (now - this._lastDetectionTime < this.debounceMs) return;

        this._lastDetectionTime = now;
        console.log(`[WakeWord] 🎤 DETECTED! Avg Score: ${averageScore.toFixed(4)} (threshold: ${effectiveThreshold.toFixed(2)})`);
        this.emit('detected', averageScore);

        // Clear buffers to prevent re-detection
        this._melRows = [];
        this._embeddings = [];
        this._scoreHistory = [];
      }
    } catch (err) {
      console.error('[WakeWord] Pipeline error:', err.message);
    }
  }

  /**
   * Queue-based processing — ensures chunks are processed in order
   * without dropping any (unlike the mutex approach).
   */
  _enqueueChunk(float32Samples) {
    this._processingQueue.push(float32Samples);
    this._drainQueue();
  }

  async _drainQueue() {
    if (this._isProcessing) return;
    this._isProcessing = true;

    while (this._processingQueue.length > 0) {
      // If queue gets too long, drop oldest to stay real-time
      if (this._processingQueue.length > 10) {
        const dropped = this._processingQueue.length - 3;
        this._processingQueue.splice(0, dropped);
      }

      const chunk = this._processingQueue.shift();
      await this._processChunk(chunk);
    }

    this._isProcessing = false;
  }

  /**
   * Handle raw PCM Buffer from mic listener.
   */
  _onAudioData(pcmBuffer) {
    this._audioBuffer = Buffer.concat([this._audioBuffer, pcmBuffer]);

    while (this._audioBuffer.length >= CHUNK_BYTES) {
      const chunkBuf = this._audioBuffer.subarray(0, CHUNK_BYTES);
      this._audioBuffer = this._audioBuffer.subarray(CHUNK_BYTES);

      // Copy the buffer to avoid shared-memory issues with Int16Array
      const copied = Buffer.from(chunkBuf);
      const int16 = new Int16Array(copied.buffer, copied.byteOffset, CHUNK_SAMPLES);
      const float32 = new Float32Array(CHUNK_SAMPLES);
      for (let i = 0; i < CHUNK_SAMPLES; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      this._enqueueChunk(float32);
    }
  }

  _startSystemAudioPoll() {
    const { execSync } = require('child_process');
    this._systemAudioPollTimer = setInterval(() => {
      try {
        const result = execSync(
          'pmset -g assertions 2>/dev/null | grep -ci "audio"',
          { stdio: 'pipe', timeout: 2000 }
        ).toString().trim();
        this._systemAudioPlaying = parseInt(result) > 0;
      } catch {
        this._systemAudioPlaying = false;
      }
    }, 5000);
  }

  async start() {
    if (this._isRunning) return;

    if (!MicListener.isAvailable()) {
      console.error('[WakeWord] ❌ No recording tool (sox/rec) found. Install: brew install sox');
      this.emit('unavailable', 'sox not found');
      return;
    }

    try {
      await this._loadModels();

      this._micListener.on('audio', (chunk) => this._onAudioData(chunk));
      this._micListener.on('error', (err) => {
        console.error('[WakeWord] Mic error:', err.message);
        this.emit('error', err);
      });
      this._micListener.on('close', (code) => {
        if (this._isRunning && !this._isPaused) {
          console.warn('[WakeWord] Mic died. Restarting in 2s...');
          setTimeout(() => {
            if (this._isRunning && !this._isPaused) this._micListener.start();
          }, 2000);
        }
      });

      this._micListener.start();
      this._startSystemAudioPoll();

      this._isRunning = true;
      this._isPaused = false;
      console.log('[WakeWord] ✅ Engine started. Listening for "Hey Jarvis"...');
      this.emit('started');
    } catch (err) {
      console.error('[WakeWord] ❌ Failed to start:', err.message);
      this.emit('error', err);
    }
  }

  pause() {
    this._isPaused = true;
    this._micListener.pause();
    this._melRows = [];
    this._embeddings = [];
    this._audioBuffer = Buffer.alloc(0);
    this._processingQueue = [];
    console.log('[WakeWord] ⏸️  Paused.');
  }

  resume() {
    this._isPaused = false;
    this._micListener.resume();
    console.log('[WakeWord] ▶️  Resumed.');
    this.emit('resumed');
  }

  stop() {
    this._isRunning = false;
    this._isPaused = false;
    this._micListener.stop();
    if (this._systemAudioPollTimer) {
      clearInterval(this._systemAudioPollTimer);
      this._systemAudioPollTimer = null;
    }
    this._melRows = [];
    this._embeddings = [];
    this._audioBuffer = Buffer.alloc(0);
    this._processingQueue = [];

    // Release ONNX sessions to free memory
    this._releaseSession('_melSession');
    this._releaseSession('_embeddingSession');
    this._releaseSession('_wakeWordSession');

    console.log('[WakeWord] ⏹️  Stopped.');
    this.emit('stopped');
  }

  _releaseSession(name) {
    try {
      if (this[name]) {
        this[name].release?.();
        this[name] = null;
      }
    } catch {}
  }

  setThreshold(value) {
    this.threshold = Math.max(0.1, Math.min(0.95, value));
    console.log(`[WakeWord] Threshold set to ${this.threshold.toFixed(2)}`);
  }

  getStatus() {
    return {
      isRunning: this._isRunning,
      isPaused: this._isPaused,
      threshold: this.threshold,
      systemAudioPlaying: this._systemAudioPlaying,
      melRowsBuffered: this._melRows.length,
      embeddingsBuffered: this._embeddings.length,
      chunksProcessed: this._chunkCount,
      queueDepth: this._processingQueue.length
    };
  }
}

module.exports = { WakeWordEngine };

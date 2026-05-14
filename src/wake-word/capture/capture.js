const positives = ["Hey Summer", "Summer", "Sama", "Wake up Sama", "Wake up Summer", "Hey Sama"];
const negatives = ["Summary", "Sommer", "Hammer", "Hummer", "Simmer", "[Random Talking]", "[Silence]"];

const counts = {};

function initCounts() {
    [...positives, ...negatives].forEach(w => counts[w] = 0);
}

function renderLists() {
    const posContainer = document.getElementById('positiveList');
    const negContainer = document.getElementById('negativeList');

    posContainer.innerHTML = positives.map(w => createRow(w, 'positive')).join('');
    negContainer.innerHTML = negatives.map(w => createRow(w, 'negative')).join('');
}

function createRow(word, type) {
    return `
        <div class="word-item">
            <div>
                <span class="word-text">${word}</span>
                <span class="word-count" id="count-${word.replace(/[^a-z0-9]/gi, '')}">(${counts[word]} recorded)</span>
            </div>
            <button id="btn-${word.replace(/[^a-z0-9]/gi, '')}" onclick="startRecording('${word}', '${type}')">
                ⏺️ Record
            </button>
        </div>
    `;
}

function showStatus(msg, isError = false) {
    const el = document.getElementById('globalStatus');
    el.textContent = msg;
    el.className = isError ? 'error' : 'success';
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3000);
}

let audioCtx = null;

async function startRecording(word, type) {
    const safeId = word.replace(/[^a-z0-9]/gi, '');
    const btn = document.getElementById(`btn-${safeId}`);
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }

        btn.classList.add('recording');
        btn.textContent = '⏹️ Recording...';

        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);

        let audioData = [];

        processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            audioData.push(new Float32Array(inputData));
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);

        // Record for 2 seconds exactly
        setTimeout(() => {
            source.disconnect();
            processor.disconnect();
            stream.getTracks().forEach(t => t.stop());

            btn.classList.remove('recording');
            btn.textContent = '⏺️ Record';

            processAudioAndUpload(audioData, word, type, safeId);
        }, 2000);

    } catch (err) {
        console.error(err);
        showStatus('Microphone access denied or failed.', true);
    }
}

function processAudioAndUpload(audioData, word, type, safeId) {
    // Flatten array
    let totalLength = audioData.reduce((acc, val) => acc + val.length, 0);
    let flattened = new Float32Array(totalLength);
    let offset = 0;
    for (let chunk of audioData) {
        flattened.set(chunk, offset);
        offset += chunk.length;
    }

    // Convert Float32 to Int16
    const int16Data = new Int16Array(flattened.length);
    for (let i = 0; i < flattened.length; i++) {
        let s = Math.max(-1, Math.min(1, flattened[i]));
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Create WAV Header
    const wavBuffer = createWavFile(int16Data, 16000);
    const base64 = bufferToBase64(wavBuffer);

    fetch('http://localhost:3005/save-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, word, audioBase64: base64 })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            counts[word]++;
            document.getElementById(`count-${safeId}`).textContent = `(${counts[word]} recorded)`;
            showStatus(`Saved: ${word}`);
        } else {
            showStatus(data.error, true);
        }
    })
    .catch(err => {
        console.error(err);
        showStatus('Network error saving file.', true);
    });
}

function createWavFile(int16Data, sampleRate) {
    const buffer = new ArrayBuffer(44 + int16Data.length * 2);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + int16Data.length * 2, true);
    writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true);  // AudioFormat (PCM)
    view.setUint16(22, 1, true);  // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * 2, true); // ByteRate
    view.setUint16(32, 2, true);  // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample

    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, int16Data.length * 2, true);

    // Write PCM data
    let offset = 44;
    for (let i = 0; i < int16Data.length; i++, offset += 2) {
        view.setInt16(offset, int16Data[i], true);
    }

    return buffer;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

initCounts();
renderLists();

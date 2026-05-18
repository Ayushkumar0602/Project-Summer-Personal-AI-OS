__cjsRegister('renderer/audio/audio-queue.js', function (module, exports, require) {
// --- 1. Audio Queue Manager (for playing Gemini's voice) ---
let _deps = {};

function initAudioQueueDeps(deps) {
    _deps = deps;
}

class AudioQueue {
    constructor() {
        this.queue = [];
        this.isPlaying = false;
        // Gemini returns 24kHz PCM audio
        this.sampleRate = 24000;
        this.audioCtx = null;
        this.nextStartTime = 0;
        this.activeSources = [];
    }

    init() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.sampleRate });
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.connect(this.audioCtx.destination);
            
            // Loop to send data to visualizer
            const updateVisuals = () => {
                requestAnimationFrame(updateVisuals);
                if (this.isPlaying && window.visualizer) {
                    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                    this.analyser.getByteFrequencyData(dataArray);
                    window.visualizer.updateAudioData(dataArray);
                }
            };
            updateVisuals();
        }
    }

    addAudioData(base64String) {
        this.init();
        try {
            // Decode base64 to Int16Array
            const binaryString = window.atob(base64String);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const int16Array = new Int16Array(bytes.buffer);
            
            // Convert Int16Array to Float32Array for AudioBuffer
            const float32Array = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                float32Array[i] = int16Array[i] / 32768.0;
            }

            const audioBuffer = this.audioCtx.createBuffer(1, float32Array.length, this.sampleRate);
            audioBuffer.getChannelData(0).set(float32Array);
            
            this.queue.push(audioBuffer);
            this.playNext();
        } catch (e) {
            console.error("Audio decode error:", e);
        }
    }

    playNext() {
        if (this.queue.length === 0) return;

        if (!this.isPlaying) {
            this.isPlaying = true;
            _deps.setOrbState('speaking', 'Agent is Speaking...');
            this.nextStartTime = this.audioCtx.currentTime; // Start scheduling from now
        }

        // Dequeue and schedule all available buffers
        while (this.queue.length > 0) {
            const audioBuffer = this.queue.shift();
            const source = this.audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.analyser);
            
            // If nextStartTime fell behind due to lag, reset it to now
            if (this.nextStartTime < this.audioCtx.currentTime) {
                this.nextStartTime = this.audioCtx.currentTime;
            }

            source.start(this.nextStartTime);
            this.nextStartTime += audioBuffer.duration;
            this.activeSources.push(source);

            // Only hook up onended for the LAST chunk currently scheduled to know when we are done
            source.onended = () => {
                const idx = this.activeSources.indexOf(source);
                if (idx > -1) this.activeSources.splice(idx, 1);

                // If this source ended and it was the last one (time passed nextStartTime), we are done speaking
                if (this.audioCtx.currentTime >= this.nextStartTime - 0.05) {
                    this.isPlaying = false;
                    if (_deps.getIsConnected()) _deps.setOrbState('listening', 'Listening...');
                }
            };
        }
    }

    clear() {
        this.queue = [];
        this.isPlaying = false;
        this.nextStartTime = 0;
        
        // Correctly stop all currently scheduled audio sources
        for (const source of this.activeSources) {
            try { source.stop(); } catch (e) {}
        }
        this.activeSources = [];
    }
}
const audioQueue = new AudioQueue();

module.exports = { AudioQueue, audioQueue, initAudioQueueDeps };
});

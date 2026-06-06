__cjsRegister('renderer/audio/vad-recorder.js', function (module, exports, require) {
// --- 3. Microphone Recording & VAD ---
let stream = null;
let inputAudioCtx = null;
let processor = null;

let silenceTimer = null;
let isSpeakingToAgent = false;
let consecutiveVoiceBuffers = 0;

// ── Enhanced VAD: Adaptive noise floor & ZCR for music rejection ──
let vadNoiseFloor = 0.01;
const VAD_ALPHA = 0.02; // Slow noise floor adaptation

let _deps = {};

function initVadRecorder(deps) {
    _deps = deps;
}

function updateVadNoiseFloor(rms) {
    if (rms < vadNoiseFloor * 3 && rms > 0.0001) {
        vadNoiseFloor = VAD_ALPHA * rms + (1 - VAD_ALPHA) * vadNoiseFloor;
    }
    vadNoiseFloor = Math.max(0.002, Math.min(0.05, vadNoiseFloor));
}

function zeroCrossingRate(samples) {
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
        if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings++;
    }
    return crossings / samples.length;
}

async function startRecording() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
            } 
        });
        
        // Gemini expects 16kHz audio
        inputAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const source = inputAudioCtx.createMediaStreamSource(stream);
        
        processor = inputAudioCtx.createScriptProcessor(4096, 1, 1);
        
        processor.onaudioprocess = (e) => {
            if (!_deps.getIsConnected()) return;
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Convert Float32 to Int16 and calculate RMS
            const pcm16 = new Int16Array(inputData.length);
            let sumSquares = 0;
            
            for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                sumSquares += s * s;
            }
            
            const rms = Math.sqrt(sumSquares / inputData.length);
            updateVadNoiseFloor(rms);

            // ── Enhanced VAD: Energy + ZCR check ──
            // Energy must be well above adaptive noise floor
            const energyOk = rms > vadNoiseFloor * 4;
            // ZCR must be in speech range (0.02–0.18) to reject music/pure tones
            const zcr = zeroCrossingRate(inputData);
            const zcrOk = zcr > 0.02 && zcr < 0.18;
            // Combined: only treat as voice if both energy AND ZCR indicate speech
            const hasVoice = energyOk && zcrOk;
            
            // Feed mic data to visualizer if listening
            if (window.visualizer && !_deps.audioQueue.isPlaying) {
                // Map the float array to 0-255 uint8 format for visualizer
                const dataArray = new Uint8Array(inputData.length / 32); // Sample down
                for(let i=0; i<dataArray.length; i++) {
                    dataArray[i] = Math.abs(inputData[i*32]) * 255 * 5; // boost slightly
                }
                window.visualizer.updateAudioData(dataArray);
            }
            
            // --- Voice Activity Detection (VAD) Logic ---
            if (hasVoice) {
                consecutiveVoiceBuffers++;
                isSpeakingToAgent = true;
                if (silenceTimer) clearTimeout(silenceTimer);
                
                // Barge-in: if they speak while agent is playing, stop agent
                // Only interrupt if they've spoken for at least 2 consecutive buffers (~500ms at 16kHz)
                // or if it's exceptionally loud (RMS > 0.15)
                if (_deps.audioQueue.isPlaying && (consecutiveVoiceBuffers > 1 || rms > 0.15)) {
                    _deps.audioQueue.clear();
                    _deps.clearPendingTimeouts();
                    _deps.setOrbState('listening', 'Listening...');
                }
            } else {
                consecutiveVoiceBuffers = 0;
                if (isSpeakingToAgent) {
                    // If they were speaking but now silent, start 1s timer to send turnComplete
                    if (!silenceTimer) {
                        silenceTimer = setTimeout(() => {
                            isSpeakingToAgent = false;
                            _deps.sendTurnComplete();
                            _deps.setOrbState('thinking', 'Thinking...');
                            silenceTimer = null;
                        }, 1000); // 1 second of silence triggers generation
                    }
                }
            }

            // Convert Int16Array to Base64 efficiently
            const uint8Array = new Uint8Array(pcm16.buffer);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < uint8Array.length; i += chunkSize) {
                binary += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize));
            }
            const base64Audio = window.btoa(binary);
            
            _deps.sendAudioChunk(base64Audio);
        };

        source.connect(processor);
        processor.connect(inputAudioCtx.destination);
    } catch (err) {
        console.error("Mic error:", err);
        _deps.setOrbState('idle', 'Microphone Error');
        _deps.setIsConnected(false);
    }
}

function stopRecording() {
    if (processor) processor.disconnect();
    if (inputAudioCtx && inputAudioCtx.state !== 'closed') inputAudioCtx.close();
    if (stream) stream.getTracks().forEach(t => t.stop());
}

module.exports = { initVadRecorder, startRecording, stopRecording };
});

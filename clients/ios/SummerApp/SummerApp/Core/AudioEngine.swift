/**
 * AudioEngine.swift — Mic Recording + VAD + Gapless Audio Playback
 *
 * This is the most critical file. It is a 1:1 Swift mirror of two Mac JS files:
 *
 * ── Recording half ───────────────────────────────────────────────────────────
 * Mirrors: src/renderer/audio/vad-recorder.js
 *   - AudioContext(sampleRate: 16000)    → AVAudioEngine + 16kHz conversion
 *   - createScriptProcessor(4096, 1, 1) → installTap(bufferSize: 4096)
 *   - processor.onaudioprocess          → processAudioBuffer()
 *   - VAD: energyOk && zcrOk            → same constants, same formula
 *   - 1s silence timer → sendTurnComplete → same as setTimeout(1000)
 *   - Barge-in: consecutiveVoiceBuffers > 1 && isPlaying → clearPlayback()
 *   - Float32 → Int16 → base64         → samplesToBase64()
 *
 * ── Playback half ────────────────────────────────────────────────────────────
 * Mirrors: src/renderer/audio/audio-queue.js
 *   - AudioContext(sampleRate: 24000)   → AVAudioPlayerNode at 24kHz
 *   - addAudioData(base64)              → playAudio(base64:)
 *   - Int16Array → Float32Array / 32768 → same conversion
 *   - nextStartTime trick (gapless)     → scheduleBuffer (auto-queued)
 *   - audioQueue.clear()                → clearPlayback()
 */

import AVFoundation

class AudioEngine {

    // ── Callbacks → SummerClient ──────────────────────────────────────────────
    var onAudioChunk:      ((String) -> Void)?   // → send_audio message
    var onTurnComplete:    (() -> Void)?          // → send_turn_complete message
    var onBargeIn:         (() -> Void)?          // → clear playback + set listening
    var onPlaybackFinished:(() -> Void)?          // → set state back to listening

    // ── Recording engine ──────────────────────────────────────────────────────
    private let recordEngine  = AVAudioEngine()
    private var inputConverter: AVAudioConverter?

    // ── VAD state ─────────────────────────────────────────────────────────────
    private var vadNoiseFloor:           Float = 0.01
    private let VAD_ALPHA:               Float = 0.02
    private var isSpeakingToAgent              = false
    private var consecutiveVoiceBuffers        = 0
    private var silenceWorkItem: DispatchWorkItem?

    // ── Playback engine ───────────────────────────────────────────────────────
    private let playEngine   = AVAudioEngine()
    private let playerNode   = AVAudioPlayerNode()

    private(set) var isPlaybackActive = false

    // Dedicated queue for audio processing — keeps main thread free (fixes lag)
    private let audioProcessingQueue = DispatchQueue(label: "com.summer.audio", qos: .userInteractive)

    // Track scheduled buffers so we know when playback truly finishes
    private var scheduledBufferCount = 0

    private let playbackFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate:   24000,
        channels:     1,
        interleaved:  false
    )!

    init() {
        setupPlaybackEngine()
        setupInterruptionHandling()
    }

    // MARK: - Recording Setup
    // Mirrors: async function startRecording() in vad-recorder.js
    func startRecording() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playAndRecord,
                mode:    .voiceChat,
                options: [.defaultToSpeaker, .allowBluetooth]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("[AudioEngine] Session setup error: \(error.localizedDescription)")
            return
        }

        let inputNode   = recordEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)

        guard let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate:   16000,
            channels:     1,
            interleaved:  true
        ) else {
            print("[AudioEngine] Failed to create 16kHz format")
            return
        }

        guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            print("[AudioEngine] Cannot create audio converter")
            return
        }
        inputConverter = converter

        // Process audio on dedicated queue — NOT the main thread (fixes lag)
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            self?.audioProcessingQueue.async {
                self?.processAudioBuffer(buffer, converter: converter, targetFormat: targetFormat)
            }
        }

        do {
            try recordEngine.start()
            print("[AudioEngine] Recording started — streaming PCM 16kHz to daemon")
        } catch {
            print("[AudioEngine] Engine start error: \(error.localizedDescription)")
        }
    }

    // MARK: - Audio Processing + VAD
    // Mirrors: processor.onaudioprocess = (e) => { ... } in vad-recorder.js
    private func processAudioBuffer(
        _ buffer: AVAudioPCMBuffer,
        converter: AVAudioConverter,
        targetFormat: AVAudioFormat
    ) {
        // Convert native sampleRate → 16kHz
        let ratio = 16000.0 / buffer.format.sampleRate
        let outFrames = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
        guard let outBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outFrames) else { return }

        var inputConsumed = false
        var convError: NSError?
        converter.convert(to: outBuffer, error: &convError) { _, outStatus in
            if inputConsumed { outStatus.pointee = .noDataNow; return nil }
            outStatus.pointee = .haveData
            inputConsumed = true
            return buffer
        }

        guard convError == nil, outBuffer.frameLength > 0,
              let int16Ptr = outBuffer.int16ChannelData else { return }

        let frameCount = Int(outBuffer.frameLength)
        let samples = Array(UnsafeBufferPointer(start: int16Ptr[0], count: frameCount))

        // ── VAD: Exact mirror of vad-recorder.js ─────────────────────────────

        // Mirrors: const rms = Math.sqrt(sumSquares / inputData.length)
        let rms = calculateRMS(samples)
        updateNoiseFloor(rms)

        // Mirrors: const energyOk = rms > vadNoiseFloor * 4
        let energyOk = rms > vadNoiseFloor * 4

        // Mirrors: const zcr = zeroCrossingRate(inputData)
        //          const zcrOk = zcr > 0.02 && zcr < 0.18
        let zcr    = zeroCrossingRate(samples)
        let zcrOk  = zcr > 0.02 && zcr < 0.18

        // Mirrors: const hasVoice = energyOk && zcrOk
        let hasVoice = energyOk && zcrOk

        if hasVoice {
            consecutiveVoiceBuffers += 1
            isSpeakingToAgent = true
            silenceWorkItem?.cancel()
            silenceWorkItem = nil

            // Mirrors: if (audioQueue.isPlaying && (consecutiveVoiceBuffers > 1 || rms > 0.15))
            //            → barge-in: audioQueue.clear()
            if isPlaybackActive && (consecutiveVoiceBuffers > 1 || rms > 0.15) {
                onBargeIn?()
            }

        } else {
            consecutiveVoiceBuffers = 0

            if isSpeakingToAgent {
                // Mirrors: silenceTimer = setTimeout(() => { sendTurnComplete(); }, 1000)
                let workItem = DispatchWorkItem { [weak self] in
                    guard let self else { return }
                    self.isSpeakingToAgent = false
                    self.onTurnComplete?()
                }
                silenceWorkItem = workItem
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: workItem)
            }
        }

        // Mirrors: _deps.sendAudioChunk(base64Audio) — called every buffer regardless of VAD
        // (daemon-side Gemini handles silence, we always stream)
        let base64 = samplesToBase64(samples)
        onAudioChunk?(base64)
    }

    func stopRecording() {
        guard recordEngine.isRunning else { return }
        recordEngine.inputNode.removeTap(onBus: 0)
        recordEngine.stop()
        silenceWorkItem?.cancel()
        silenceWorkItem = nil
        isSpeakingToAgent       = false
        consecutiveVoiceBuffers = 0
        // Deactivate audio session so iOS doesn't kill us for holding it
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        print("[AudioEngine] Recording stopped")
    }

    // MARK: - Playback Setup
    // Mirrors: AudioQueue.init() + this.audioCtx = new AudioContext({ sampleRate: 24000 })
    private func setupPlaybackEngine() {
        playEngine.attach(playerNode)
        playEngine.connect(playerNode, to: playEngine.mainMixerNode, format: playbackFormat)
        do {
            try playEngine.start()
        } catch {
            print("[AudioEngine] Playback engine error: \(error.localizedDescription)")
        }
    }

    // MARK: - Play Audio
    // Mirrors: AudioQueue.addAudioData(base64String) in audio-queue.js
    func playAudio(base64: String) {
        // Decode on background queue to reduce main thread pressure
        audioProcessingQueue.async { [weak self] in
            guard let self else { return }
            guard let data = Data(base64Encoded: base64) else { return }

            let samples = data.withUnsafeBytes { Array($0.bindMemory(to: Int16.self)) }
            let floatSamples = samples.map { Float($0) / 32768.0 }

            guard let buffer = AVAudioPCMBuffer(
                pcmFormat:     self.playbackFormat,
                frameCapacity: AVAudioFrameCount(floatSamples.count)
            ) else { return }
            buffer.frameLength = buffer.frameCapacity
            floatSamples.withUnsafeBufferPointer {
                buffer.floatChannelData![0].update(from: $0.baseAddress!, count: floatSamples.count)
            }

            DispatchQueue.main.async {
                self.isPlaybackActive = true
                self.scheduledBufferCount += 1
            }

            // Schedule on player — completion fires when THIS buffer finishes
            self.playerNode.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.scheduledBufferCount -= 1
                    // Only fire playbackFinished when ALL queued buffers are done
                    if self.scheduledBufferCount <= 0 && !self.playerNode.isPlaying {
                        self.scheduledBufferCount = 0
                        self.isPlaybackActive = false
                        self.onPlaybackFinished?()
                    }
                }
            }

            if !self.playerNode.isPlaying { self.playerNode.play() }
        }
    }

    func clearPlayback() {
        playerNode.stop()
        isPlaybackActive = false
        scheduledBufferCount = 0
        // Re-prepare player for next playback
        if !playEngine.isRunning { try? playEngine.start() }
        playerNode.play()
    }

    // MARK: - VAD Helpers (exact mirrors of vad-recorder.js functions)

    // Mirrors: function updateVadNoiseFloor(rms) { ... }
    private func updateNoiseFloor(_ rms: Float) {
        if rms < vadNoiseFloor * 3 && rms > 0.0001 {
            vadNoiseFloor = VAD_ALPHA * rms + (1 - VAD_ALPHA) * vadNoiseFloor
        }
        vadNoiseFloor = max(0.002, min(0.05, vadNoiseFloor))
    }

    // Mirrors: function zeroCrossingRate(samples) { ... }
    private func zeroCrossingRate(_ samples: [Int16]) -> Float {
        guard samples.count > 1 else { return 0 }
        var crossings = 0
        for i in 1..<samples.count {
            if (samples[i] >= 0) != (samples[i - 1] >= 0) { crossings += 1 }
        }
        return Float(crossings) / Float(samples.count)
    }

    // Mirrors: rms = Math.sqrt(sumSquares / inputData.length) where input is Float32 [-1, 1]
    private func calculateRMS(_ samples: [Int16]) -> Float {
        guard !samples.isEmpty else { return 0 }
        let sumSquares = samples.reduce(Float(0)) { acc, s in
            let f = Float(s) / 32768.0
            return acc + f * f
        }
        return sqrt(sumSquares / Float(samples.count))
    }

    // Mirrors: const uint8Array = new Uint8Array(pcm16.buffer); btoa(binary)
    private func samplesToBase64(_ samples: [Int16]) -> String {
        samples.withUnsafeBytes { Data($0) }.base64EncodedString()
    }

    // MARK: - Audio Interruption Handling
    // Prevents crash when a phone call, Siri, or another app takes audio focus
    private func setupInterruptionHandling() {
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object:  nil,
            queue:   .main
        ) { [weak self] notification in
            guard let self,
                  let info = notification.userInfo,
                  let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeValue)
            else { return }

            switch type {
            case .began:
                // Phone call / Siri started — pause gracefully
                print("[AudioEngine] Audio interrupted — pausing")
                if self.recordEngine.isRunning {
                    self.recordEngine.pause()
                }
                self.playerNode.pause()

            case .ended:
                // Interruption over — resume
                print("[AudioEngine] Audio interruption ended — resuming")
                let options = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                if AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) {
                    try? AVAudioSession.sharedInstance().setActive(true)
                    try? self.recordEngine.start()
                    if !self.playEngine.isRunning { try? self.playEngine.start() }
                    self.playerNode.play()
                }

            @unknown default:
                break
            }
        }
    }
}

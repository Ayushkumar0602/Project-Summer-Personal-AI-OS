@preconcurrency import AVFoundation
import Combine
import Foundation

// MARK: - AudioEngine
/// Lightweight, crash-proof audio engine for Summer iOS.
/// - Mic capture: 16kHz mono Int16 PCM → base64 chunks
/// - Speaker playback: 24kHz mono Int16 PCM from base64
/// - VAD: silence detection triggers turn_complete
///
/// Design: All audio processing stays on the audio thread.
/// Only base64 strings and scalar values cross to MainActor.
@MainActor
final class AudioEngine: ObservableObject {

    // MARK: - Published State
    @Published var isRecording = false
    @Published var isPlaying = false
    @Published var micLevel: Float = 0.0

    // MARK: - Callbacks
    var onAudioChunk: ((String) -> Void)?
    var onSilenceDetected: (() -> Void)?

    // MARK: - Configuration
    private let targetSampleRate: Double = 16000
    private let silenceThreshold: Float = 0.02
    private let silenceDurationForVAD: TimeInterval = 1.5

    // MARK: - Recording State
    private var audioEngine: AVAudioEngine?
    private var lastVoiceTime: Date = Date()
    private var vadTimer: Timer?
    private var hasSentTurnComplete = false

    // MARK: - Playback State
    private var playbackEngine: AVAudioEngine?
    private var playerNode: AVAudioPlayerNode?
    private var playbackQueue: [AVAudioPCMBuffer] = []
    private var isPlayingBuffer = false

    // MARK: - Audio Session

    private func _configureSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothA2DP])
            try session.setActive(true, options: [])
            print("[Audio] Session active")
        } catch {
            print("[Audio] Session error: \(error.localizedDescription)")
        }
    }

    // MARK: - Mic Recording

    func startRecording() {
        guard !isRecording else { return }

        _configureSession()

        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let hwFormat = inputNode.outputFormat(forBus: 0)

        guard hwFormat.sampleRate > 0, hwFormat.channelCount > 0 else {
            dbg("Audio", "❌ Invalid hardware format — mic unavailable")
            return
        }

        dbg("Audio", "HW: \(hwFormat.sampleRate)Hz, \(hwFormat.channelCount)ch")

        // Install tap — process entirely on the audio callback thread
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: hwFormat) { [weak self] buffer, _ in
            self?._processOnAudioThread(buffer: buffer, hwRate: hwFormat.sampleRate)
        }

        do {
            try engine.start()
            audioEngine = engine
            isRecording = true
            hasSentTurnComplete = false
            lastVoiceTime = Date()
            _startVADTimer()
            dbg("Audio", "🎙 Recording started")
        } catch {
            dbg("Audio", "❌ Engine start failed: \(error.localizedDescription)")
        }
    }

    func stopRecording() {
        guard isRecording else { return }
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        isRecording = false
        vadTimer?.invalidate()
        vadTimer = nil
        micLevel = 0
        dbg("Audio", "🎙 Recording stopped")
    }

    // MARK: - Audio Thread Processing (NO actor isolation)

    /// Runs on the audio render thread — must NOT touch @Published or MainActor things.
    /// Converts float PCM to 16kHz Int16 mono, encodes to base64, then dispatches to main.
    private nonisolated func _processOnAudioThread(buffer: AVAudioPCMBuffer, hwRate: Double) {
        guard buffer.frameLength > 0 else { return }

        // 1. Calculate RMS level from float data
        var rms: Float = 0
        if let floatData = buffer.floatChannelData?[0] {
            let count = Int(buffer.frameLength)
            var sumSq: Float = 0
            for i in 0..<count {
                sumSq += floatData[i] * floatData[i]
            }
            rms = sqrtf(sumSq / Float(count))
        }

        // 2. Downsample to 16kHz mono Int16
        let ratio = targetSampleRate / hwRate
        let outFrames = Int(Double(buffer.frameLength) * ratio)
        guard outFrames > 0 else { return }

        var int16Samples = [Int16](repeating: 0, count: outFrames)

        if let floatData = buffer.floatChannelData?[0] {
            let inCount = Int(buffer.frameLength)
            for i in 0..<outFrames {
                let srcIdx = min(Int(Double(i) / ratio), inCount - 1)
                let sample = max(-1.0, min(1.0, floatData[srcIdx]))
                int16Samples[i] = Int16(sample * 32767.0)
            }
        }

        // 3. Encode to base64
        let data = int16Samples.withUnsafeBufferPointer { ptr in
            Data(buffer: ptr)
        }
        let base64 = data.base64EncodedString()

        // 4. Dispatch results to MainActor (only scalars + String cross the boundary)
        let level = min(rms * 5.0, 1.0)
        let isVoice = rms > silenceThreshold

        Task { @MainActor [weak self] in
            guard let self = self, self.isRecording else { return }
            self.micLevel = level
            if isVoice {
                self.lastVoiceTime = Date()
                self.hasSentTurnComplete = false
            }
            self.onAudioChunk?(base64)
        }
    }

    // MARK: - VAD Timer

    private func _startVADTimer() {
        vadTimer?.invalidate()
        vadTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self = self, self.isRecording else { return }
                let silence = Date().timeIntervalSince(self.lastVoiceTime)
                if silence >= self.silenceDurationForVAD && !self.hasSentTurnComplete {
                    self.hasSentTurnComplete = true
                    self.onSilenceDetected?()
                    print("[Audio] 🤫 Silence → turn complete")
                }
            }
        }
    }

    // MARK: - Speaker Playback

    func playAudio(base64Data: String, sampleRate: Double = 24000) {
        guard let rawData = Data(base64Encoded: base64Data), rawData.count >= 2 else { return }

        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        ) else { return }

        // Convert Int16 data to Float32 for AVAudioPlayerNode
        let sampleCount = rawData.count / MemoryLayout<Int16>.size
        guard sampleCount > 0 else { return }

        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(sampleCount)) else { return }
        pcmBuffer.frameLength = AVAudioFrameCount(sampleCount)

        rawData.withUnsafeBytes { rawPtr in
            guard let src = rawPtr.bindMemory(to: Int16.self).baseAddress,
                  let dst = pcmBuffer.floatChannelData?[0] else { return }
            for i in 0..<sampleCount {
                dst[i] = Float(src[i]) / 32768.0
            }
        }

        playbackQueue.append(pcmBuffer)
        _ensurePlaybackEngine(format: format)
        _playNext()
    }

    private func _ensurePlaybackEngine(format: AVAudioFormat) {
        guard playbackEngine == nil else { return }

        let engine = AVAudioEngine()
        let node = AVAudioPlayerNode()
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)

        do {
            try engine.start()
            playbackEngine = engine
            playerNode = node
            node.play()
            print("[Audio] 🔊 Playback engine started")
        } catch {
            print("[Audio] Playback engine failed: \(error.localizedDescription)")
        }
    }

    private func _playNext() {
        guard !isPlayingBuffer, !playbackQueue.isEmpty, let node = playerNode else { return }
        isPlayingBuffer = true
        isPlaying = true

        let buffer = playbackQueue.removeFirst()
        node.scheduleBuffer(buffer) { [weak self] in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                self.isPlayingBuffer = false
                if self.playbackQueue.isEmpty {
                    self.isPlaying = false
                } else {
                    self._playNext()
                }
            }
        }
    }

    func stopPlayback() {
        playerNode?.stop()
        playbackQueue.removeAll()
        isPlaying = false
        isPlayingBuffer = false
    }

    func cleanup() {
        stopRecording()
        stopPlayback()
        playbackEngine?.stop()
        playbackEngine = nil
        playerNode = nil
    }
}

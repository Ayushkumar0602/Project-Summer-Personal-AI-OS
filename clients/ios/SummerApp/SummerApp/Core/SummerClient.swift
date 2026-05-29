/**
 * SummerClient.swift — WebSocket Engine + Message Routing
 *
 * iOS-only thin client. Connects to the Summer daemon on Render/local,
 * streams audio in, plays audio back. That's it.
 *
 * FIX LOG v2 (2026-05-29 — "thinking freeze" patch):
 *
 *   ROOT CAUSE OF THINKING FREEZE:
 *   ─────────────────────────────────────────────────────────────────────
 *   1. Context sent at wrong nesting level.
 *      The server (ws-server.js L270) reads msg.context, but we were
 *      spreading keys at the top level of start_session. So the server
 *      always got context={} → Gemini had no system prompt → erratic behaviour.
 *      FIX: wrap all context keys inside a "context" sub-object.
 *
 *   2. Mic stayed active during .thinking state.
 *      After the user spoke and VAD triggered turn_complete, recording kept
 *      running. The server received MORE audio while Gemini was processing,
 *      which reset the turn timer and caused infinite thinking loops.
 *      FIX: call audioEngine.stopRecording() when entering .thinking.
 *           Restart recording when server confirms listening (session_started
 *           or after turn_complete → listening transition).
 *
 *   3. State machine was too aggressive about blocking audio_response.
 *      Already fixed in v1 (listening → speaking). Kept.
 *
 *   4. isConnectedToDaemon set before daemon_hello. Already fixed in v1. Kept.
 *
 *   5. No timeout on thinking state — app could hang forever.
 *      FIX: 15s watchdog in transitionTo(.thinking). If no response from
 *           server within 15s, recover to listening state automatically.
 *
 *   6. Reconnect on iOS wired audio callbacks twice (wireAudioCallbacks called
 *      on every connect()). FIX: guard with a flag.
 */

import Foundation
import SwiftUI

// MARK: - SessionState
enum SessionState: Equatable {
    case idle
    case connecting
    case listening
    case thinking
    case speaking
    case error(String)

    var label: String {
        switch self {
        case .idle:           return "Tap to Activate"
        case .connecting:     return "Connecting to Summer..."
        case .listening:      return "Listening..."
        case .thinking:       return "Thinking..."
        case .speaking:       return "Speaking..."
        case .error(let msg): return msg
        }
    }

    var orbColor: Color {
        switch self {
        case .idle:       return Color(hex: "#4A4A6A")
        case .connecting: return Color(hex: "#3B82F6")
        case .listening:  return Color(hex: "#8B5CF6")
        case .thinking:   return Color(hex: "#F59E0B")
        case .speaking:   return Color(hex: "#10B981")
        case .error:      return Color(hex: "#EF4444")
        }
    }

    var isPulsing: Bool {
        self == .listening || self == .speaking
    }
}

// MARK: - SummerClient
@MainActor
class SummerClient: ObservableObject {

    // ── Published state ──────────────────────────────────────────────────────
    @Published var sessionState: SessionState = .idle
    @Published var agentText:    String       = ""
    @Published var userText:     String       = ""
    @Published var toolName:     String?      = nil
    @Published private(set) var isConnectedToDaemon = false

    // ── Internal ─────────────────────────────────────────────────────────────
    private var webSocketTask:   URLSessionWebSocketTask?
    private var urlSession:      URLSession?
    private var pingTimer:       Timer?

    // BUG 4 FIX (v1): Serialized send queue — webSocketTask.send() is not thread-safe
    private let sendQueue = DispatchQueue(label: "com.summer.wssend", qos: .userInteractive)

    private var reconnectAttempts = 0
    private var userDisconnected  = false
    private var lastContextPayload: [String: Any] = [:]
    private var daemonURL:    String = ""
    private var pairingToken: String = ""

    // FIX v2: Prevent double-wiring of audio callbacks on reconnect
    private var audioCallbacksWired = false

    // FIX v2: Thinking watchdog — auto-recover if stuck in thinking > 15s
    private var thinkingWatchdog: DispatchWorkItem?

    // BUG 1 FIX (v1): Non-lazy init — lazy is not @MainActor-safe
    let audioEngine: AudioEngine

    // MARK: - Init
    init() {
        self.audioEngine = AudioEngine()
    }

    // Wire audio callbacks exactly once
    private func wireAudioCallbacks() {
        guard !audioCallbacksWired else { return }
        audioCallbacksWired = true

        audioEngine.onAudioChunk = { [weak self] base64 in
            // Only send audio when the session is actively listening
            // FIX v2: Do NOT stream audio while in .thinking state —
            // it resets Gemini's turn timer and causes infinite thinking loops.
            guard let self, self.sessionState == .listening else { return }
            self.sendJSONQueued([
                "type":       "send_audio",
                "data":       base64,
                "sampleRate": 16000
            ])
        }

        audioEngine.onTurnComplete = { [weak self] in
            self?.sendJSONQueued(["type": "send_turn_complete"])
            Task { @MainActor [weak self] in
                guard let self else { return }
                // FIX v2: Stop the mic immediately when we think we're done speaking.
                // Server is now processing — no more audio should flow until it responds.
                self.audioEngine.stopRecording()
                self.transitionTo(.thinking)
                self.startThinkingWatchdog()
            }
        }

        audioEngine.onBargeIn = { [weak self] in
            self?.audioEngine.clearPlayback()
            Task { @MainActor [weak self] in
                self?.transitionTo(.listening)
            }
        }

        audioEngine.onPlaybackFinished = { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if self.sessionState == .speaking {
                    self.transitionTo(.listening)
                    // Resume recording so the user can speak again
                    if !self.audioEngine.isRecording {
                        self.audioEngine.startRecording()
                    }
                }
            }
        }
    }

    // MARK: - Thinking Watchdog
    // FIX v2: If we're stuck in .thinking for > 15s with no server response,
    // recover to .listening and restart the mic. Prevents the app appearing frozen.
    private func startThinkingWatchdog() {
        cancelThinkingWatchdog()
        let item = DispatchWorkItem { [weak self] in
            guard let self, self.sessionState == .thinking else { return }
            print("[SummerClient] ⚠️ Thinking watchdog fired — no response in 15s. Recovering...")
            self.audioEngine.startRecording()
            self.transitionTo(.listening)
        }
        thinkingWatchdog = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 15.0, execute: item)
    }

    private func cancelThinkingWatchdog() {
        thinkingWatchdog?.cancel()
        thinkingWatchdog = nil
    }

    // MARK: - State Machine
    private func transitionTo(_ newState: SessionState) {
        let validTransitions: [String: Set<String>] = [
            "idle":       ["connecting", "error"],
            "connecting": ["listening", "error", "idle"],
            "listening":  ["thinking", "speaking", "idle", "error"],  // speaking: barge-in
            "thinking":   ["speaking", "listening", "idle", "error"],
            "speaking":   ["listening", "thinking", "idle", "error"],
            "error":      ["connecting", "idle"],
        ]

        let currentKey = stateKey(sessionState)
        let newKey     = stateKey(newState)

        guard let allowed = validTransitions[currentKey], allowed.contains(newKey) else {
            print("[SummerClient] ⚠️ Blocked transition: \(currentKey) → \(newKey)")
            return
        }

        // Cancel watchdog if leaving .thinking state
        if currentKey == "thinking" {
            cancelThinkingWatchdog()
        }

        sessionState = newState
    }

    private func stateKey(_ state: SessionState) -> String {
        switch state {
        case .idle:       return "idle"
        case .connecting: return "connecting"
        case .listening:  return "listening"
        case .thinking:   return "thinking"
        case .speaking:   return "speaking"
        case .error:      return "error"
        }
    }

    // MARK: - Connect
    func connect(url: String, token: String, contextPayload: [String: Any]) {
        cleanup()

        daemonURL    = url
        pairingToken = token
        lastContextPayload = contextPayload
        userDisconnected   = false
        reconnectAttempts  = 0

        transitionTo(.connecting)

        guard let wsUrl = URL(string: url) else {
            transitionTo(.error("Invalid URL"))
            return
        }

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest  = 30
        config.timeoutIntervalForResource = 300  // 5min — long enough for a conversation
        urlSession    = URLSession(configuration: config)
        webSocketTask = urlSession?.webSocketTask(with: wsUrl)
        webSocketTask?.resume()

        // Wire audio callbacks once
        wireAudioCallbacks()

        // client_hello — authenticate with daemon
        let hello: [String: Any] = [
            "type":             "client_hello",
            "platform":         "ios",
            "deviceName":       UIDevice.current.name,
            "hasMic":           true,
            "hasScreen":        false,
            "token":            token,
            "supportedActions": ["speak", "showNotification", "openUrl"],
            "_ts":              Date().timeIntervalSince1970 * 1000
        ]
        sendJSONQueued(hello)

        startPingTimer()
        receiveLoop()
    }

    // MARK: - Start Session
    // FIX v2: The server (ws-server.js L270) reads `msg.context` — a nested object.
    // Previously we spread context keys at the top level, so the server always
    // got context={} and Gemini had no system prompt. Now we nest correctly.
    func startSession() {
        let msg: [String: Any] = [
            "type":    "start_session",
            "context": lastContextPayload    // ← nested, matches server expectation
        ]
        sendJSONQueued(msg)
    }

    // MARK: - Disconnect
    func disconnect() {
        userDisconnected = true
        sendJSONQueued(["type": "stop_session"])
        cleanup()
        transitionTo(.idle)
        agentText = ""
        userText  = ""
        toolName  = nil
    }

    // MARK: - Receive Loop
    private func receiveLoop() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch result {
                case .success(let message):
                    if case .string(let text) = message {
                        self.handleMessage(text)
                    }
                    if self.webSocketTask != nil {
                        self.receiveLoop()
                    }
                case .failure(let error):
                    print("[SummerClient] Receive error: \(error.localizedDescription)")
                    self.handleUnexpectedDisconnect()
                }
            }
        }
    }

    // MARK: - Handle Messages
    private func handleMessage(_ raw: String) {
        guard
            let data = raw.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = json["type"] as? String
        else { return }

        switch type {

        case "daemon_hello":
            // BUG 6 FIX (v1): set connected only after server confirms auth
            isConnectedToDaemon = true
            print("[SummerClient] ✅ Authenticated. Starting session...")
            startSession()

        case "session_started":
            reconnectAttempts = 0
            transitionTo(.listening)
            // FIX v2: Start recording fresh for each new session
            audioEngine.startRecording()
            print("[SummerClient] 🎙️ Session started — mic active")

        case "session_ended":
            audioEngine.stopRecording()
            audioEngine.clearPlaybackForShutdown()
            cancelThinkingWatchdog()
            if userDisconnected {
                transitionTo(.idle)
            } else {
                scheduleAutoReconnect()
            }

        case "audio_response":
            if let base64 = json["data"] as? String {
                // FIX v2: Cancel watchdog — server responded, we're not frozen
                cancelThinkingWatchdog()
                transitionTo(.speaking)
                // FIX v2: Stop recording while Summer is speaking (barge-in is handled by VAD)
                audioEngine.stopRecording()
                audioEngine.playAudio(base64: base64)
            }

        case "text_response":
            if let text = json["text"] as? String {
                agentText = text
            }

        case "user_transcript":
            if let text = json["text"] as? String {
                userText = text
                // Don't set .thinking here — we set it when VAD fires turn_complete.
                // Setting it on user_transcript is premature and causes double-stops.
            }

        case "turn_complete":
            // Server confirmed the agent finished its turn
            cancelThinkingWatchdog()
            if sessionState != .idle {
                transitionTo(.listening)
                // FIX v2: Resume mic after turn completes so user can respond
                if !audioEngine.isRecording {
                    audioEngine.startRecording()
                }
            }

        case "agent_interrupted":
            audioEngine.clearPlayback()
            cancelThinkingWatchdog()
            transitionTo(.listening)
            if !audioEngine.isRecording {
                audioEngine.startRecording()
            }

        case "tool_call":
            toolName = json["name"] as? String

        case "tool_complete":
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.toolName = nil
            }

        case "error":
            let msg = json["message"] as? String ?? "An error occurred"
            cancelThinkingWatchdog()
            transitionTo(.error(msg))
            userDisconnected = true
            cleanup()
            print("[SummerClient] ❌ Daemon error: \(msg)")

        case "pong":
            break

        default:
            print("[SummerClient] Unhandled: \(type)")
        }
    }

    // MARK: - Auto-Reconnect
    private func scheduleAutoReconnect() {
        reconnectAttempts += 1
        guard reconnectAttempts <= 3 else {
            transitionTo(.error("Connection lost. Tap to retry."))
            return
        }

        transitionTo(.connecting)
        print("[SummerClient] Reconnecting in 1.5s (attempt \(reconnectAttempts)/3)...")

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self, !self.userDisconnected else { return }
            self.lastContextPayload["isAutoReconnect"] = true
            self.connect(url: self.daemonURL, token: self.pairingToken, contextPayload: self.lastContextPayload)
        }
    }

    private func handleUnexpectedDisconnect() {
        guard isConnectedToDaemon else { return }
        isConnectedToDaemon = false
        cancelThinkingWatchdog()
        if !userDisconnected {
            scheduleAutoReconnect()
        }
    }

    // MARK: - Send (serialized through sendQueue)
    func sendJSONQueued(_ dict: [String: Any]) {
        guard
            let data   = try? JSONSerialization.data(withJSONObject: dict),
            let string = String(data: data, encoding: .utf8)
        else { return }

        let task = webSocketTask
        sendQueue.async {
            task?.send(.string(string)) { error in
                if let error { print("[SummerClient] Send error: \(error.localizedDescription)") }
            }
        }
    }

    func sendJSON(_ dict: [String: Any]) { sendJSONQueued(dict) }

    // MARK: - Ping Timer
    private func startPingTimer() {
        pingTimer?.invalidate()
        let timer = Timer(timeInterval: 20, repeats: true) { [weak self] _ in
            self?.sendJSONQueued(["type": "ping"])
        }
        RunLoop.main.add(timer, forMode: .common)
        pingTimer = timer
    }

    // MARK: - Cleanup
    private func cleanup() {
        cancelThinkingWatchdog()
        pingTimer?.invalidate()
        pingTimer = nil
        audioEngine.stopRecording()
        audioEngine.clearPlaybackForShutdown()
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask       = nil
        urlSession?.invalidateAndCancel()
        urlSession          = nil
        isConnectedToDaemon = false
    }
}

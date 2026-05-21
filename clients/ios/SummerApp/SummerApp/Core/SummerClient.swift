/**
 * SummerClient.swift — WebSocket Engine + Message Routing
 *
 * iOS mirror of the Mac client's communication layer.
 *
 * Mirrors (Mac files → this file):
 *   ws-server.js (client side) → connect(), sendJSON(), receiveLoop()
 *   session-events.js          → handleMessage() switch statement
 *   orb-state.js               → SessionState enum + @Published vars
 *   renderer.js (orb click)    → connect() / disconnect() / startSession()
 *
 * Protocol reference: src/clients/ios/SummerProtocol.js
 */

import Foundation
import SwiftUI

// MARK: - SessionState
// Mirrors: orb-state.js setOrbState(state, subtitle)
// States: 'idle' | 'thinking' | 'listening' | 'speaking'
enum SessionState: Equatable {
    case idle
    case connecting
    case listening
    case thinking
    case speaking
    case error(String)

    // Mirrors: the subtitle string in setOrbState()
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

    // Orb color per state — matches Mac's CSS orb colors
    var orbColor: Color {
        switch self {
        case .idle:       return Color(hex: "#4A4A6A")  // muted purple-grey
        case .connecting: return Color(hex: "#3B82F6")  // blue
        case .listening:  return Color(hex: "#8B5CF6")  // purple (matches Mac)
        case .thinking:   return Color(hex: "#F59E0B")  // amber
        case .speaking:   return Color(hex: "#10B981")  // emerald green
        case .error:      return Color(hex: "#EF4444")  // red
        }
    }

    var isPulsing: Bool {
        self == .listening || self == .speaking
    }
}

// MARK: - SummerClient
@MainActor
class SummerClient: ObservableObject {

    // ── Published state (SwiftUI observes these) ──────────────────────────────
    @Published var sessionState: SessionState = .idle
    @Published var agentText:    String       = ""   // text_response
    @Published var userText:     String       = ""   // user_transcript
    @Published var toolName:     String?      = nil  // tool_call name
    @Published private(set) var isConnectedToDaemon = false

    // ── Internal ──────────────────────────────────────────────────────────────
    private var webSocketTask:   URLSessionWebSocketTask?
    private var urlSession:      URLSession?
    private var pingTimer:       Timer?

    // Mirrors: recentReconnectCount in session-events.js
    private var reconnectAttempts = 0

    // Mirrors: getUserDisconnected() / setUserDisconnected() in session-events.js
    private var userDisconnected  = false

    // Mirrors: lastContextPayload in session-events.js
    private var lastContextPayload: [String: Any] = [:]

    // Stored credentials
    private var daemonURL:    String = ""
    private var pairingToken: String = ""

    // Audio engine — mirrors vad-recorder.js + audio-queue.js
    lazy var audioEngine: AudioEngine = {
        let engine = AudioEngine()

        // Mirrors: sendAudioChunk(base64) call in processor.onaudioprocess
        engine.onAudioChunk = { [weak self] base64 in
            self?.sendJSON([
                "type":       "send_audio",
                "data":       base64,
                "sampleRate": 16000
            ])
        }

        // Mirrors: sendTurnComplete() after 1s silence timer
        engine.onTurnComplete = { [weak self] in
            self?.sendJSON(["type": "send_turn_complete"])
            DispatchQueue.main.async { self?.sessionState = .thinking }
        }

        // Mirrors: audioQueue.clear() + setOrbState('listening') on barge-in
        engine.onBargeIn = { [weak self] in
            self?.audioEngine.clearPlayback()
            DispatchQueue.main.async { self?.sessionState = .listening }
        }

        // Mirrors: isPlaying → false → setOrbState('listening') in audio-queue.js
        engine.onPlaybackFinished = { [weak self] in
            DispatchQueue.main.async {
                if self?.sessionState == .speaking {
                    self?.sessionState = .listening
                }
            }
        }

        return engine
    }()

    // MARK: - State Machine Guard
    private func transitionTo(_ newState: SessionState) {
        let validTransitions: [String: Set<String>] = [
            "idle":       ["connecting", "error"],
            "connecting": ["listening", "error", "idle"],
            "listening":  ["thinking", "speaking", "idle", "error"],
            "thinking":   ["speaking", "listening", "idle", "error"],
            "speaking":   ["listening", "thinking", "idle", "error"],
            "error":      ["connecting", "idle"],
        ]
        
        let currentKey = stateKey(sessionState)
        let newKey = stateKey(newState)
        
        guard let allowed = validTransitions[currentKey], allowed.contains(newKey) else {
            print("[SummerClient] ⚠️ Blocked invalid transition: \(currentKey) → \(newKey)")
            return
        }
        
        sessionState = newState
    }

    private func stateKey(_ state: SessionState) -> String {
        switch state {
        case .idle: return "idle"
        case .connecting: return "connecting"
        case .listening: return "listening"
        case .thinking: return "thinking"
        case .speaking: return "speaking"
        case .error: return "error"
        }
    }

    // MARK: - Connect
    // Mirrors: renderer.js orb click (not connected branch)
    //   → buildContextPayload() → liveAPI.startSession(contextPayload)
    //   We split that into connect() + startSession() to mirror the two-step Mac flow.
    func connect(url: String, token: String, contextPayload: [String: Any]) {
        cleanup()

        daemonURL    = url
        pairingToken = token
        lastContextPayload = contextPayload
        userDisconnected   = false
        reconnectAttempts  = 0

        transitionTo(.connecting)

        guard let wsUrl = URL(string: url) else {
            transitionTo(.error("Invalid URL: \\(url)"))
            return
        }

        let config       = URLSessionConfiguration.default
        config.timeoutIntervalForRequest  = 15
        config.timeoutIntervalForResource = 60
        urlSession    = URLSession(configuration: config)
        webSocketTask = urlSession?.webSocketTask(with: wsUrl)
        webSocketTask?.resume()

        // Send client_hello immediately after connection
        // Mirrors: ws-server.js _onClientHello() handler
        let hello: [String: Any] = [
            "type":             "client_hello",
            "platform":         "ios",
            "deviceName":       UIDevice.current.name,   // e.g. "Ayush's iPhone"
            "hasMic":           true,
            "hasScreen":        false,
            "token":            token,
            "supportedActions": ["speak", "showNotification", "openUrl"],
            "_ts":              Date().timeIntervalSince1970 * 1000
        ]
        sendJSON(hello)
        isConnectedToDaemon = true

        // Start ping timer (20s) — mirrors PING_INTERVAL_MS = 20_000
        startPingTimer()

        // Begin async receive loop
        receiveLoop()
    }

    // MARK: - Start Session
    // Mirrors: window.liveAPI.startSession(contextPayload) in renderer.js
    // Called after daemon_hello is received
    func startSession() {
        var msg: [String: Any] = ["type": "start_session"]
        for (key, value) in lastContextPayload { msg[key] = value }
        sendJSON(msg)
    }

    // MARK: - Disconnect (user-initiated)
    // Mirrors: renderer.js orb click when isConnected === true
    //   → liveAPI.stopSession() → stopRecording() → setOrbState('idle')
    func disconnect() {
        userDisconnected = true
        sendJSON(["type": "stop_session"])
        cleanup()
        transitionTo(.idle)
        agentText    = ""
        userText     = ""
        toolName     = nil
    }

    // MARK: - Message Receive Loop
    // Mirrors: ws.on('message', (raw) => { ... }) in ws-server.js (client side)
    private func receiveLoop() {
        webSocketTask?.receive { [weak self] result in
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                switch result {
                case .success(let message):
                    if case .string(let text) = message {
                        self.handleMessage(text)
                    }
                    self.receiveLoop()

                case .failure(let error):
                    print("[SummerClient] WebSocket receive error: \(error.localizedDescription)")
                    self.handleUnexpectedDisconnect()
                }
            }
        }
    }

    // MARK: - Handle Daemon → Client Messages
    // Mirrors: session-events.js — all the liveAPI.onXxx() handlers
    // Every case here has a 1:1 comment mapping to the Mac handler
    private func handleMessage(_ raw: String) {
        guard
            let data = raw.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = json["type"] as? String
        else { return }

        switch type {

        case "daemon_hello":
            print("[SummerClient] Authenticated. Starting session...")
            self.startSession()

        case "session_started":
            self.reconnectAttempts = 0
            self.transitionTo(.listening)
            self.audioEngine.startRecording()
            print("[SummerClient] Session started — mic active")

        case "session_ended":
            self.audioEngine.stopRecording()
            self.audioEngine.clearPlaybackForShutdown()
            if self.userDisconnected {
                self.transitionTo(.idle)
            } else {
                self.scheduleAutoReconnect()
            }

        case "audio_response":
            if let base64 = json["data"] as? String {
                self.transitionTo(.speaking)
                self.audioEngine.playAudio(base64: base64)
            }

        case "text_response":
            if let text = json["text"] as? String {
                self.agentText = text
            }

        case "user_transcript":
            if let text = json["text"] as? String {
                self.userText     = text
                self.transitionTo(.thinking)
            }

        case "turn_complete":
            if self.sessionState != .idle {
                self.transitionTo(.listening)
            }

        case "agent_interrupted":
            self.audioEngine.clearPlayback()
            self.transitionTo(.listening)

        case "tool_call":
            self.toolName = json["name"] as? String

        case "tool_complete":
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.toolName = nil
            }

        case "error":
            let msg = json["message"] as? String ?? "An error occurred"
            self.transitionTo(.error(msg))
            self.userDisconnected = true
            self.cleanup()
            print("[SummerClient] Error from daemon: \(msg)")

        case "pong":
            break

        default:
            print("[SummerClient] Unhandled message type: \(type)")
        }
    }

    // MARK: - Auto-Reconnect
    // Mirrors: session-events.js — recentReconnectCount + setTimeout(reconnect, 1500)
    private func scheduleAutoReconnect() {
        reconnectAttempts += 1

        guard reconnectAttempts <= 3 else {
            transitionTo(.error("Connection lost. Tap to retry."))
            print("[SummerClient] Too many reconnect attempts. Giving up.")
            return
        }

        transitionTo(.connecting)
        print("[SummerClient] Session dropped. Auto-reconnecting in 1.5s (attempt \(reconnectAttempts)/3)...")

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self, !self.userDisconnected else { return }
            self.lastContextPayload["isAutoReconnect"] = true
            self.connect(url: self.daemonURL, token: self.pairingToken, contextPayload: self.lastContextPayload)
        }
    }

    // Called when the WebSocket itself drops (network error)
    private func handleUnexpectedDisconnect() {
        guard isConnectedToDaemon else { return }
        isConnectedToDaemon = false
        if !self.userDisconnected {
            self.scheduleAutoReconnect()
        }
    }

    // MARK: - Send Helpers
    func sendJSON(_ dict: [String: Any]) {
        guard
            let data   = try? JSONSerialization.data(withJSONObject: dict),
            let string = String(data: data, encoding: .utf8)
        else { return }

        webSocketTask?.send(.string(string)) { error in
            if let error { print("[SummerClient] Send error: \(error.localizedDescription)") }
        }
    }

    // MARK: - Keepalive Timer
    // Mirrors: setInterval(() => ws.send(PING), 20_000)
    private func startPingTimer() {
        pingTimer?.invalidate()
        let timer = Timer(timeInterval: 20, repeats: true) { [weak self] _ in
            self?.sendJSON(["type": "ping"])
        }
        RunLoop.main.add(timer, forMode: .common)
        pingTimer = timer
    }

    // MARK: - Cleanup
    private func cleanup() {
        pingTimer?.invalidate()
        pingTimer = nil
        audioEngine.stopRecording()
        audioEngine.clearPlaybackForShutdown()
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask      = nil
        urlSession?.invalidateAndCancel()
        urlSession          = nil
        isConnectedToDaemon = false
    }
}

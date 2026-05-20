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
class SummerClient: ObservableObject {

    // ── Published state (SwiftUI observes these) ──────────────────────────────
    @Published var sessionState: SessionState = .idle
    @Published var agentText:    String       = ""   // text_response
    @Published var userText:     String       = ""   // user_transcript
    @Published var toolName:     String?      = nil  // tool_call name
    private(set) var isConnectedToDaemon = false

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

    // MARK: - Connect
    // Mirrors: renderer.js orb click (not connected branch)
    //   → buildContextPayload() → liveAPI.startSession(contextPayload)
    //   We split that into connect() + startSession() to mirror the two-step Mac flow.
    func connect(url: String, token: String, contextPayload: [String: Any]) {
        daemonURL    = url
        pairingToken = token
        lastContextPayload = contextPayload
        userDisconnected   = false

        DispatchQueue.main.async { self.sessionState = .connecting }

        guard let wsUrl = URL(string: url) else {
            DispatchQueue.main.async { self.sessionState = .error("Invalid URL: \\(url)") }
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
        DispatchQueue.main.async {
            self.sessionState = .idle
            self.agentText    = ""
            self.userText     = ""
            self.toolName     = nil
        }
    }

    // MARK: - Message Receive Loop
    // Mirrors: ws.on('message', (raw) => { ... }) in ws-server.js (client side)
    private func receiveLoop() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                if case .string(let text) = message {
                    self.handleMessage(text)
                }
                // Keep listening — mirror of ws 'message' event persisting
                self.receiveLoop()

            case .failure(let error):
                print("[SummerClient] WebSocket receive error: \(error.localizedDescription)")
                self.handleUnexpectedDisconnect()
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

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            switch type {

            // ── Mirrors: _onClientHello reply in ws-server.js ────────────────
            // daemon_hello means auth passed. Now start the Gemini session.
            case "daemon_hello":
                print("[SummerClient] Authenticated. Starting session...")
                self.startSession()

            // ── Mirrors: window.liveAPI.onSessionStarted() ───────────────────
            //   setIsConnected(true) + setOrbState('listening') + startRecording()
            case "session_started":
                self.reconnectAttempts = 0
                self.sessionState      = .listening
                self.audioEngine.startRecording()
                print("[SummerClient] Session started — mic active")

            // ── Mirrors: window.liveAPI.onSessionEnded() ─────────────────────
            //   if userDisconnected → go idle, else → auto-reconnect (1.5s)
            case "session_ended":
                self.audioEngine.stopRecording()
                self.audioEngine.clearPlayback()
                if self.userDisconnected {
                    self.sessionState = .idle
                } else {
                    self.scheduleAutoReconnect()
                }

            // ── Mirrors: window.liveAPI.onAgentAudio() ───────────────────────
            //   audioQueue.addAudioData(base64Audio)
            case "audio_response":
                if let base64 = json["data"] as? String {
                    self.sessionState = .speaking
                    self.audioEngine.playAudio(base64: base64)
                }

            // ── Mirrors: window.liveAPI.onAgentText() ────────────────────────
            //   updateSubtitle(text)
            case "text_response":
                if let text = json["text"] as? String {
                    self.agentText = text
                }

            // ── Mirrors: window.liveAPI.onUserText() ─────────────────────────
            //   updateUserSubtitle(text) + state → thinking (user done talking)
            case "user_transcript":
                if let text = json["text"] as? String {
                    self.userText     = text
                    self.sessionState = .thinking
                }

            // ── Mirrors: window.liveAPI.onAgentTurnComplete() ────────────────
            //   console.log("Agent finished turn.") → back to listening
            case "turn_complete":
                if self.sessionState != .idle {
                    self.sessionState = .listening
                }

            // ── Mirrors: window.liveAPI.onAgentInterrupted() ─────────────────
            //   audioQueue.clear() + setOrbState('listening')
            case "agent_interrupted":
                self.audioEngine.clearPlayback()
                self.sessionState = .listening

            // ── Mirrors: window.liveAPI.onToolCall({ name, args }) ────────────
            //   floatingTool.textContent = `⚙️ ${name}...`
            case "tool_call":
                self.toolName = json["name"] as? String

            // ── Mirrors: window.liveAPI.onToolComplete({ name }) ──────────────
            //   Start dissolve countdown → hide floatingTool
            case "tool_complete":
                // Brief delay matching Mac's 2s dissolve before hiding
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    self.toolName = nil
                }

            // ── Mirrors: window.liveAPI.onError() ────────────────────────────
            //   setUserDisconnected(true) + setOrbState('idle', 'Error Connecting')
            case "error":
                let msg = json["message"] as? String ?? "An error occurred"
                self.sessionState    = .error(msg)
                self.userDisconnected = true
                self.cleanup()
                print("[SummerClient] Error from daemon: \(msg)")

            case "pong":
                break  // keepalive confirmed — mirrors ws.on('pong') handler

            default:
                print("[SummerClient] Unhandled message type: \(type)")
            }
        }
    }

    // MARK: - Auto-Reconnect
    // Mirrors: session-events.js — recentReconnectCount + setTimeout(reconnect, 1500)
    private func scheduleAutoReconnect() {
        reconnectAttempts += 1

        // Mirrors: if recentReconnectCount > 3 → give up
        guard reconnectAttempts <= 3 else {
            sessionState = .error("Connection lost. Tap to retry.")
            print("[SummerClient] Too many reconnect attempts. Giving up.")
            return
        }

        sessionState = .connecting
        print("[SummerClient] Session dropped. Auto-reconnecting in 1.5s (attempt \(reconnectAttempts)/3)...")

        // Mirrors: setTimeout(() => liveAPI.startSession(reconnectPayload), 1500)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self, !self.userDisconnected else { return }
            var reconnectPayload = self.lastContextPayload
            reconnectPayload["isAutoReconnect"] = true
            self.startSession()
        }
    }

    // Called when the WebSocket itself drops (network error)
    private func handleUnexpectedDisconnect() {
        guard isConnectedToDaemon else { return }
        isConnectedToDaemon = false
        DispatchQueue.main.async {
            if !self.userDisconnected {
                self.scheduleAutoReconnect()
            }
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
        pingTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            self?.sendJSON(["type": "ping"])
        }
    }

    // MARK: - Cleanup
    private func cleanup() {
        pingTimer?.invalidate()
        pingTimer = nil
        audioEngine.stopRecording()
        audioEngine.clearPlayback()
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask      = nil
        isConnectedToDaemon = false
    }
}

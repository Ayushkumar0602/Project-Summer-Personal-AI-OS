import Foundation
import SwiftUI
import Combine

// MARK: - Chat Message Model
struct ChatMessage: Identifiable, Equatable {
    let id = UUID()
    let role: MessageRole
    let text: String
    let timestamp: Date
    var toolName: String?
    var toolArgs: String?
    var isToolCall: Bool { toolName != nil }

    enum MessageRole: String {
        case user = "user"
        case agent = "agent"
        case system = "system"
        case tool = "tool"
    }

    static func == (lhs: ChatMessage, rhs: ChatMessage) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - HUD Widget Model
struct HUDWidgetState: Identifiable {
    let id = UUID()
    let widget: String
    let state: [String: Any]
    let timestamp: Date = Date()

    var title: String {
        (state["title"] as? String) ?? widget.capitalized
    }

    var body: String {
        (state["body"] as? String) ?? (state["text"] as? String) ?? ""
    }
}

// MARK: - Agent Status Model
struct AgentStatus: Identifiable {
    let id: String
    var percent: Double
    var message: String
    var isComplete: Bool = false
    var hasFailed: Bool = false
}

// MARK: - Permission Request Model
struct PermissionRequestModel: Identifiable {
    let id: String
    let toolName: String
    let description: String
}

// MARK: - SummerViewModel
@MainActor
final class SummerViewModel: ObservableObject {

    // MARK: - Published State

    @Published var connectionState: ConnectionState = .disconnected
    @Published var daemonVersion: String = ""
    @Published var sessionState: SessionState = .idle
    @Published var orbState: OrbState = .idle
    @Published var messages: [ChatMessage] = []
    @Published var inputText: String = ""
    @Published var activeWidgets: [HUDWidgetState] = []
    @Published var activeAgents: [AgentStatus] = []
    @Published var pendingPermission: PermissionRequestModel?
    @Published var micLevel: Float = 0.0
    @Published var interactionMode: InteractionMode = .voice
    @Published var voiceMode: VoiceMode = .pushToTalk  // Default to push-to-talk — safer on mobile
    @Published var isGoogleAuthenticated: Bool = false
    @Published var isSessionOwner: Bool = true

    // MARK: - Managers
    let wsManager = WebSocketManager()
    let audioEngine = AudioEngine()

    // MARK: - Private
    private var cancellables = Set<AnyCancellable>()
    private var wantsToListenAfterSessionStart = false
    /// Prevents mic from restarting while Summer is still speaking
    private var lastPlaybackEndTime: Date = .distantPast
    /// Track when recording started to enforce minimum duration
    private var recordingStartTime: Date = .distantPast

    // MARK: - Init
    init() {
        wsManager.delegate = self
        _bindAudioEngine()
        _bindWSState()
        dbg("VM", "ViewModel initialized")
    }

    // MARK: - Connection

    func connect() {
        dbg("VM", "connect() called")
        wsManager.connect()
    }

    func disconnect() {
        dbg("VM", "disconnect() called")
        stopSession()
        wsManager.disconnect()
    }

    // MARK: - Session

    func startSession() {
        guard connectionState == .connected else {
            dbg("VM", "❌ startSession blocked — not connected (\(connectionState.rawValue))")
            return
        }
        guard !sessionState.isActive, sessionState != .starting else {
            dbg("VM", "⏭ startSession skipped — already \(sessionState.rawValue)")
            return
        }
        sessionState = .starting
        dbg("VM", "→ startSession — sending start_session")
        wsManager.sendJSON(MessageBuilder.startSession())
        HapticsEngine.shared.press()
    }

    func stopSession() {
        wantsToListenAfterSessionStart = false
        guard sessionState.isActive || sessionState == .starting else { return }
        dbg("VM", "→ stopSession")
        sessionState = .stopping
        audioEngine.stopRecording()
        audioEngine.stopPlayback()
        orbState = .idle
        wsManager.sendJSON(MessageBuilder.stopSession())
    }

    // MARK: - Voice

    func startListening() {
        dbg("VM", "startListening() — session=\(sessionState.rawValue) orb=\(orbState.rawValue)")

        // If currently speaking, do barge-in: stop playback first
        if orbState == .speaking {
            dbg("VM", "🔇 Barge-in — stopping playback")
            audioEngine.stopPlayback()
        }

        // If session isn't active yet, start it and queue recording
        if !sessionState.isActive {
            dbg("VM", "⏳ Session not active — queuing listen after start")
            wantsToListenAfterSessionStart = true
            startSession()
            return
        }

        _beginRecording()
    }

    func stopListening() {
        guard audioEngine.isRecording else {
            dbg("VM", "stopListening() — not recording, skip")
            return
        }

        let recordingDuration = Date().timeIntervalSince(recordingStartTime)
        audioEngine.stopRecording()

        // If recording was too short (<500ms), discard — no meaningful audio captured
        if recordingDuration < 0.5 {
            dbg("VM", "⏭ Recording too short (\(Int(recordingDuration * 1000))ms) — discarding, no turn_complete")
            orbState = .idle
            return
        }

        dbg("VM", "→ stopListening (\(String(format: "%.1f", recordingDuration))s, \(audioChunkCount) chunks) — sending turn_complete")
        orbState = .thinking
        wsManager.sendJSON(MessageBuilder.sendTurnComplete())
        HapticsEngine.shared.tap()
    }

    private func _beginRecording() {
        // Safety: don't start recording if playback just ended (speaker echo)
        let timeSincePlayback = Date().timeIntervalSince(lastPlaybackEndTime)
        if timeSincePlayback < 0.5 {
            dbg("VM", "⏳ Skipping record — playback ended \(String(format: "%.1f", timeSincePlayback))s ago")
            return
        }

        guard !audioEngine.isRecording else {
            dbg("VM", "⏭ Already recording")
            return
        }

        dbg("VM", "🎙 _beginRecording()")
        audioEngine.stopPlayback()
        orbState = .listening
        recordingStartTime = Date()
        audioChunkCount = 0
        audioEngine.startRecording()
        HapticsEngine.shared.tap()
    }

    // MARK: - Text

    func sendTextMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        if !sessionState.isActive {
            messages.append(ChatMessage(role: .user, text: text, timestamp: Date()))
            startSession()
            inputText = ""
            return
        }

        dbg("VM", "→ sendText: \(text.prefix(50))")
        messages.append(ChatMessage(role: .user, text: text, timestamp: Date()))
        wsManager.sendJSON(MessageBuilder.sendText(text))
        inputText = ""
        orbState = .thinking
        HapticsEngine.shared.tap()
    }

    // MARK: - Cancel

    func cancelAgents() {
        wsManager.sendJSON(MessageBuilder.cancelAgents())
        activeAgents.removeAll()
    }

    // MARK: - Permissions

    func respondToPermission(granted: Bool) {
        guard let request = pendingPermission else { return }
        wsManager.sendJSON(MessageBuilder.permissionResponse(
            requestId: request.id,
            granted: granted,
            alwaysAllow: false
        ))
        pendingPermission = nil
        HapticsEngine.shared.notification(granted ? .success : .warning)
    }

    // MARK: - Google Auth

    func checkGoogleAuth() {
        wsManager.sendJSON(MessageBuilder.googleAuthCheck())
    }

    func requestGoogleAuth() {
        wsManager.sendJSON(MessageBuilder.googleAuthRequest())
    }

    // MARK: - Private Bindings

    private var audioChunkCount = 0

    private func _bindAudioEngine() {
        audioEngine.onAudioChunk = { [weak self] base64Data in
            guard let self = self else { return }
            // CRITICAL: Only send audio when we are actually in listening state
            guard self.sessionState.isActive else {
                dbg("Audio", "⚠️ Chunk dropped — session not active")
                return
            }
            guard self.orbState == .listening else {
                dbg("Audio", "⚠️ Chunk dropped — orb=\(self.orbState.rawValue)")
                return
            }

            self.audioChunkCount += 1
            let chunkSize = base64Data.count
            if self.audioChunkCount == 1 || self.audioChunkCount % 10 == 0 {
                dbg("Audio", "📤 Chunk #\(self.audioChunkCount) (\(chunkSize) bytes b64)")
            }
            self.wsManager.sendJSON(MessageBuilder.sendAudio(base64Data: base64Data))
        }

        audioEngine.onSilenceDetected = { [weak self] in
            guard let self = self else { return }
            guard self.voiceMode == .autoVAD, self.orbState == .listening else { return }
            dbg("VAD", "Silence detected → stopListening (sent \(self.audioChunkCount) chunks)")
            self.stopListening()
        }

        audioEngine.$micLevel
            .receive(on: RunLoop.main)
            .assign(to: &$micLevel)
    }

    private func _bindWSState() {
        wsManager.$connectionState
            .receive(on: RunLoop.main)
            .assign(to: &$connectionState)
    }
}

// MARK: - WebSocketManagerDelegate
@MainActor
extension SummerViewModel: WebSocketManagerDelegate {

    func didConnect(clientId: String) {
        dbg("WS", "✅ Connected, clientId=\(clientId)")
        HapticsEngine.shared.success()
        checkGoogleAuth()
    }

    func didDisconnect() {
        dbg("WS", "❌ Disconnected")
        sessionState = .idle
        orbState = .idle
        wantsToListenAfterSessionStart = false
        audioEngine.stopRecording()
        audioEngine.stopPlayback()
    }

    func didReceiveError(_ error: String) {
        dbg("WS", "⚠️ Error: \(error)")
        messages.append(ChatMessage(role: .system, text: "⚠️ \(error)", timestamp: Date()))
        HapticsEngine.shared.error()
    }

    func didReceiveMessage(_ message: SummerMessage) {
        let t = message.type
        dbg("WS", "← \(t)")

        switch t {

        // ── Session ──────────────────────────────────────────
        case SummerMSG.sessionStarted:
            sessionState = .active
            orbState = .idle
            dbg("Session", "✅ Session started")
            HapticsEngine.shared.success()

            if wantsToListenAfterSessionStart {
                wantsToListenAfterSessionStart = false
                dbg("Session", "Auto-starting recording (queued)")
                // Small delay so the session fully initializes server-side
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                    self?._beginRecording()
                }
            }

        case SummerMSG.sessionEnded:
            dbg("Session", "Session ended")
            sessionState = .idle
            orbState = .idle
            wantsToListenAfterSessionStart = false
            audioEngine.stopRecording()
            audioEngine.stopPlayback()

        // ── Audio ────────────────────────────────────────────
        case SummerMSG.audioResponse:
            if let data = message.data {
                // If mic is still recording, stop it — Summer is responding
                if audioEngine.isRecording {
                    dbg("Audio", "⚠️ Stopping mic — received audio_response while recording")
                    audioEngine.stopRecording()
                }
                orbState = .speaking
                audioEngine.playAudio(
                    base64Data: data,
                    sampleRate: Double(message.sampleRate ?? 24000)
                )
            }

        // ── Text ─────────────────────────────────────────────
        case SummerMSG.textResponse:
            if let text = message.text {
                dbg("Text", "Agent: \(text.prefix(60))…")
                messages.append(ChatMessage(role: .agent, text: text, timestamp: Date()))
            }
            // Only change orb if we're not already speaking (audio takes priority)
            if orbState != .speaking {
                orbState = .speaking
            }

        case SummerMSG.userTranscript:
            if let text = message.text {
                dbg("Text", "User transcript: \(text.prefix(60))…")
                messages.append(ChatMessage(role: .user, text: text, timestamp: Date()))
            }

        // ── Turn ─────────────────────────────────────────────
        case SummerMSG.turnComplete:
            dbg("Turn", "turn_complete — orb was \(orbState.rawValue)")
            audioEngine.stopPlayback()
            lastPlaybackEndTime = Date()
            orbState = .idle
            // Do NOT auto-restart listening — the user must tap the orb again.
            // Auto-listening causes feedback loops (mic picks up speaker audio).

        case SummerMSG.agentInterrupted:
            dbg("Turn", "agent_interrupted")
            audioEngine.stopPlayback()
            lastPlaybackEndTime = Date()
            // Do NOT set orbState to .listening — the user decides when to listen.
            // Just go idle so they can tap the orb.
            orbState = .idle

        // ── Tools ────────────────────────────────────────────
        case SummerMSG.toolCall:
            let name = message.name ?? "tool"
            dbg("Tool", "tool_call: \(name)")
            messages.append(ChatMessage(
                role: .tool,
                text: "Using \(name)…",
                timestamp: Date(),
                toolName: name
            ))

        case SummerMSG.toolComplete:
            dbg("Tool", "tool_complete")

        // ── HUD ──────────────────────────────────────────────
        case SummerMSG.hudUpdate:
            if let widget = message.widget {
                let state = message.state?.mapValues { $0.value } ?? [:]
                let hudState = HUDWidgetState(widget: widget, state: state)
                activeWidgets.removeAll { $0.widget == widget }
                activeWidgets.append(hudState)
            }

        case SummerMSG.hudClear:
            activeWidgets.removeAll()

        // ── Permissions ──────────────────────────────────────
        case SummerMSG.permissionRequest:
            pendingPermission = PermissionRequestModel(
                id: message.requestId ?? UUID().uuidString,
                toolName: message.toolName ?? message.name ?? "Unknown Tool",
                description: message.description ?? "Summer wants to perform an action"
            )
            HapticsEngine.shared.warning()

        // ── Agents ───────────────────────────────────────────
        case SummerMSG.agentProgress:
            if let agentId = message.agentId {
                if let idx = activeAgents.firstIndex(where: { $0.id == agentId }) {
                    activeAgents[idx].percent = message.percent ?? 0
                    activeAgents[idx].message = message.message ?? ""
                } else {
                    activeAgents.append(AgentStatus(
                        id: agentId,
                        percent: message.percent ?? 0,
                        message: message.message ?? "Working…"
                    ))
                }
            }

        case SummerMSG.agentComplete:
            if let agentId = message.agentId {
                activeAgents.removeAll { $0.id == agentId }
            }

        case SummerMSG.agentFail:
            if let agentId = message.agentId {
                if let idx = activeAgents.firstIndex(where: { $0.id == agentId }) {
                    activeAgents[idx].hasFailed = true
                    activeAgents[idx].message = message.error ?? "Failed"
                }
            }
            HapticsEngine.shared.error()

        // ── Google Auth ──────────────────────────────────────
        case SummerMSG.googleAuthStatus:
            isGoogleAuthenticated = message.authenticated ?? false

        case SummerMSG.googleAuthResult:
            if message.success == true {
                isGoogleAuthenticated = true
                HapticsEngine.shared.success()
            }

        // ── Memory ───────────────────────────────────────────
        case SummerMSG.memoryUpdated:
            let count = message.nodeCount ?? 0
            messages.append(ChatMessage(
                role: .system,
                text: "🧠 Memory updated (\(count) nodes)",
                timestamp: Date()
            ))

        // ── Notification ─────────────────────────────────────
        case SummerMSG.notification:
            let title = message.title ?? "Summer"
            let body = message.body ?? ""
            messages.append(ChatMessage(role: .system, text: "🔔 \(title): \(body)", timestamp: Date()))

        // ── Timer ────────────────────────────────────────────
        case SummerMSG.timerFired:
            let label = message.label ?? "Timer"
            messages.append(ChatMessage(role: .system, text: "⏰ \(label)", timestamp: Date()))
            HapticsEngine.shared.notification(.success)

        // ── Session Ownership ────────────────────────────────
        case SummerMSG.sessionOwnership:
            isSessionOwner = message.isOwner ?? false
            if !isSessionOwner, let owner = message.ownerDeviceName {
                messages.append(ChatMessage(
                    role: .system,
                    text: "📱 Session owned by \(owner)",
                    timestamp: Date()
                ))
            }

        // ── Client Action ────────────────────────────────────
        case SummerMSG.clientAction:
            _handleClientAction(message)

        // ── Error ────────────────────────────────────────────
        case SummerMSG.error:
            let errorMsg = message.message ?? message.error ?? "Unknown error"
            dbg("WS", "Error msg: \(errorMsg)")
            messages.append(ChatMessage(role: .system, text: "⚠️ \(errorMsg)", timestamp: Date()))

        default:
            dbg("WS", "Unhandled: \(t)")
        }
    }

    // MARK: - Client Action Handling

    private func _handleClientAction(_ message: SummerMessage) {
        guard let action = message.action,
              let requestId = message.requestId else { return }

        let args = message.args?.mapValues { $0.value } ?? [:]
        dbg("Action", "client_action: \(action)")

        Task {
            let result = await SkillRegistry.shared.execute(action: action, args: args)
            wsManager.sendJSON(MessageBuilder.clientActionResult(
                requestId: requestId,
                action: action,
                result: result
            ))
        }
    }
}

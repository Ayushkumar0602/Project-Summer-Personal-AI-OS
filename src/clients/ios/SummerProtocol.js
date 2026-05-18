/**
 * src/clients/ios/SummerProtocol.js
 *
 * iOS Client Protocol Reference (JavaScript mirror of the Swift implementation).
 *
 * This file is the SPECIFICATION for what the iOS Swift client must implement.
 * It mirrors the Swift structs/enums as JS comments so you can reference both
 * in one place.
 *
 * SWIFT EQUIVALENT:
 * -----------------
 * The actual Swift code lives in:
 *   Xcode → SummerApp/Network/SummerDaemonClient.swift
 *   Xcode → SummerApp/Network/SummerProtocol.swift
 *
 * This file documents the full protocol so the iOS team and daemon stay in sync.
 */

'use strict';

/**
 * iOS CLIENT CHECKLIST
 * ====================
 *
 * 1. WebSocket connection
 *    - URL: ws://{mac_local_ip}:8765
 *    - Find mac_local_ip: Settings → Wi-Fi → (i) → IP Address
 *    - OR: use Bonjour/mDNS to discover "summer._tcp.local" (future)
 *
 * 2. Authentication
 *    - On connect, send CLIENT_HELLO with the pairing token
 *    - Token is in: ~/Library/Application Support/Summer/daemon/.pairing-token
 *    - Display this to the user as a QR code in Mac Settings UI
 *
 * 3. Capabilities to declare (in CLIENT_HELLO):
 *    - platform: "ios"
 *    - deviceName: UIDevice.current.name
 *    - hasMic: true (AVAudioSession)
 *    - hasScreen: false (no screen capture on iOS)
 *    - pushToken: APNs device token (for offline notifications)
 *
 * 4. Audio pipeline (iOS → Daemon → Gemini):
 *    - Format: PCM 16-bit, 16kHz, mono, little-endian
 *    - Encode to base64 before sending
 *    - Send as SEND_AUDIO messages
 *    - For push-to-talk: send SEND_TURN_COMPLETE on button release
 *    - For VAD: implement Apple's SFSpeechRecognizer silenceDetection
 *
 * 5. Audio playback (Daemon → iOS):
 *    - Receive AUDIO_RESPONSE messages (base64 PCM 24kHz)
 *    - Decode base64 → PCM bytes
 *    - Play via AVAudioEngine / AVAudioPlayer
 *    - Configure AVAudioSession category: .playAndRecord
 *
 * 6. Client actions to handle (daemon delegates these to native iOS):
 *    - "setVolume"         → AVAudioSession.setVolume(args.level)
 *    - "speak"             → AVSpeechSynthesizer (fallback TTS)
 *    - "showNotification"  → UNUserNotificationCenter
 *    - "openUrl"           → UIApplication.shared.open(URL)
 *    - "toggleDarkMode"    → UIApplication.shared.setUIStyle
 *    - "readClipboard"     → UIPasteboard.general.string
 *    - "writeClipboard"    → UIPasteboard.general.string = text
 *    - "musicPlayPause"    → MPMusicPlayerController.systemMusicPlayer.pause/play
 *    - "musicNext"         → systemMusicPlayer.skipToNextItem()
 *    - "musicPrevious"     → systemMusicPlayer.skipToPreviousItem()
 *
 * 7. HUD rendering (receive HUD_UPDATE):
 *    - widget: "agent_progress" → show a circular progress overlay
 *    - widget: "image_gallery"  → show a native image carousel
 *    - widget: "wake_word"      → show a pulsing orb animation
 *    - widget: "agent_progress" with done: true → dismiss overlay
 *
 * 8. Keepalive:
 *    - Send PING every 20s
 *    - Expect PONG in response
 *    - Reconnect if no PONG within 5s
 */

// ── Message type constants (mirror of protocol.js MSG) ────────────────────────
const IOS_MSG = {
    // Client → Daemon
    CLIENT_HELLO:       'client_hello',
    START_SESSION:      'start_session',
    STOP_SESSION:       'stop_session',
    SEND_AUDIO:         'send_audio',
    SEND_TURN_COMPLETE: 'send_turn_complete',
    SEND_TEXT:          'send_text',
    CANCEL_AGENTS:      'cancel_agents',
    PERMISSION_RESPONSE:'permission_response',
    PING:               'ping',

    // Daemon → Client
    DAEMON_HELLO:       'daemon_hello',
    SESSION_STARTED:    'session_started',
    SESSION_ENDED:      'session_ended',
    AUDIO_RESPONSE:     'audio_response',
    TEXT_RESPONSE:      'text_response',
    USER_TRANSCRIPT:    'user_transcript',
    TURN_COMPLETE:      'turn_complete',
    AGENT_INTERRUPTED:  'agent_interrupted',
    HUD_UPDATE:         'hud_update',
    NOTIFICATION:       'notification',
    TIMER_FIRED:        'timer_fired',
    AGENT_PROGRESS:     'agent_progress',
    AGENT_COMPLETE:     'agent_complete',
    AGENT_FAIL:         'agent_fail',
    PERMISSION_REQUEST: 'permission_request',
    ERROR:              'error',
    PONG:               'pong',
};

/**
 * Swift structs for reference (what your Swift team implements):
 *
 * ```swift
 * // SummerProtocol.swift
 * struct ClientHello: Codable {
 *     let type: String = "client_hello"
 *     let platform: String = "ios"
 *     let deviceName: String
 *     let hasMic: Bool = true
 *     let hasScreen: Bool = false
 *     let pushToken: String?
 *     let token: String
 *     let _ts: TimeInterval
 * }
 *
 * struct SendAudio: Codable {
 *     let type: String = "send_audio"
 *     let data: String  // base64 PCM 16kHz
 *     let sampleRate: Int = 16000
 *     let _ts: TimeInterval
 * }
 *
 * struct AudioResponse: Codable {
 *     let type: String
 *     let data: String  // base64 PCM 24kHz
 *     let _ts: TimeInterval
 * }
 *
 * struct HudUpdate: Codable {
 *     let type: String
 *     let widget: String
 *     let state: AnyCodable
 *     let _ts: TimeInterval
 * }
 *
 * struct ClientAction: Codable {
 *     let type: String = "client_action"
 *     let action: String
 *     let args: AnyCodable?
 *     let _ts: TimeInterval
 * }
 * ```
 */

/**
 * Swift connection code template:
 *
 * ```swift
 * // SummerDaemonClient.swift
 * import Foundation
 *
 * class SummerDaemonClient: NSObject, URLSessionWebSocketDelegate {
 *     private var webSocketTask: URLSessionWebSocketTask?
 *     private let pairingToken: String
 *     private let daemonURL: URL
 *
 *     init(macIPAddress: String, port: Int = 8765, token: String) {
 *         self.daemonURL = URL(string: "ws://\(macIPAddress):\(port)")!
 *         self.pairingToken = token
 *     }
 *
 *     func connect() {
 *         let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
 *         webSocketTask = session.webSocketTask(with: daemonURL)
 *         webSocketTask?.resume()
 *         sendHello()
 *         receiveMessages()
 *         startPingTimer()
 *     }
 *
 *     private func sendHello() {
 *         let hello = ClientHello(
 *             deviceName: UIDevice.current.name,
 *             pushToken: APNsManager.shared.deviceToken,
 *             token: pairingToken
 *         )
 *         send(hello)
 *     }
 *
 *     func sendAudio(_ pcmData: Data) {
 *         let msg = SendAudio(data: pcmData.base64EncodedString(), _ts: Date().timeIntervalSince1970)
 *         send(msg)
 *     }
 *
 *     func sendTurnComplete() {
 *         sendRaw(["type": "send_turn_complete", "_ts": Date().timeIntervalSince1970])
 *     }
 *
 *     private func receiveMessages() {
 *         webSocketTask?.receive { [weak self] result in
 *             switch result {
 *             case .success(let message):
 *                 self?.handleMessage(message)
 *                 self?.receiveMessages() // keep listening
 *             case .failure(let error):
 *                 self?.handleDisconnect(error)
 *             }
 *         }
 *     }
 *
 *     private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
 *         guard case .string(let text) = message,
 *               let data = text.data(using: .utf8),
 *               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
 *               let type = json["type"] as? String else { return }
 *
 *         switch type {
 *         case "daemon_hello":  handleDaemonHello(json)
 *         case "session_started": onSessionStarted()
 *         case "audio_response":  handleAudio(json)
 *         case "text_response":   handleText(json)
 *         case "hud_update":      handleHUD(json)
 *         case "client_action":   handleClientAction(json)
 *         case "notification":    showNotification(json)
 *         case "timer_fired":     handleTimer(json)
 *         case "agent_progress":  updateProgressHUD(json)
 *         case "turn_complete":   onTurnComplete()
 *         default: break
 *         }
 *     }
 *
 *     private func handleClientAction(_ json: [String: Any]) {
 *         guard let action = json["action"] as? String,
 *               let args = json["args"] as? [String: Any] else { return }
 *         switch action {
 *         case "setVolume":
 *             let level = args["level"] as? Float ?? 0.5
 *             MPVolumeView.setVolume(level)
 *         case "speak":
 *             let text = args["text"] as? String ?? ""
 *             let synth = AVSpeechSynthesizer()
 *             synth.speak(AVSpeechUtterance(string: text))
 *         case "showNotification":
 *             let title = args["title"] as? String ?? "Summer"
 *             let body = args["body"] as? String ?? ""
 *             UNUserNotificationCenter.current().add(UNNotificationRequest(...))
 *         case "openUrl":
 *             if let urlString = args["url"] as? String, let url = URL(string: urlString) {
 *                 UIApplication.shared.open(url)
 *             }
 *         case "musicPlayPause":
 *             MPMusicPlayerController.systemMusicPlayer.togglePlayPause()
 *         default: break
 *         }
 *     }
 * }
 * ```
 */

module.exports = { IOS_MSG };

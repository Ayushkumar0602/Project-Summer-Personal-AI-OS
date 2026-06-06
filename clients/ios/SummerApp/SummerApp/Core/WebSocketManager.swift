import Foundation
import Combine
import UIKit

// MARK: - WebSocketManager
/// Manages the WebSocket connection to the Summer Core Daemon.
/// Handles authentication, reconnection, and message dispatch.
@MainActor
final class WebSocketManager: ObservableObject {

    // MARK: - Published State
    @Published var connectionState: ConnectionState = .disconnected
    @Published var clientId: String?
    @Published var daemonVersion: String?

    // MARK: - Configuration
    var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: "summer_server_url") }
    }
    var pairingToken: String {
        didSet {
            // Store in Keychain in production; UserDefaults for now
            UserDefaults.standard.set(pairingToken, forKey: "summer_pairing_token")
        }
    }

    // MARK: - Delegate
    weak var delegate: WebSocketManagerDelegate?

    // MARK: - Private
    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var reconnectAttempt: Int = 0
    private let maxReconnectDelay: TimeInterval = 30
    private var isIntentionalDisconnect = false
    private var pingTimer: Timer?
    private let deviceName = UIDevice.current.name

    // MARK: - Init
    init() {
        self.serverURL = UserDefaults.standard.string(forKey: "summer_server_url")
            ?? "wss://summer-brain.onrender.com"
        // Default token — change in Settings tab to override
        self.pairingToken = UserDefaults.standard.string(forKey: "summer_pairing_token")
            ?? "Ayush_mac_token_9122"
    }

    // MARK: - Public API

    func connect() {
        guard connectionState != .connected && connectionState != .connecting else { return }
        isIntentionalDisconnect = false
        _connect()
    }

    func disconnect() {
        isIntentionalDisconnect = true
        _cleanup()
        connectionState = .disconnected
    }

    func send(_ data: Data) {
        guard let ws = webSocketTask else { return }
        let message = URLSessionWebSocketTask.Message.data(data)
        ws.send(message) { error in
            if let error = error {
                print("[WS] Send error: \(error.localizedDescription)")
            }
        }
    }

    func sendJSON(_ data: Data?) {
        guard let data = data else { return }
        send(data)
    }

    // MARK: - Connection Lifecycle

    private func _connect() {
        connectionState = .connecting

        guard let url = URL(string: serverURL) else {
            print("[WS] Invalid URL: \(serverURL)")
            connectionState = .disconnected
            return
        }

        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 30

        urlSession = URLSession(configuration: config)
        webSocketTask = urlSession?.webSocketTask(with: url)

        webSocketTask?.resume()
        _receiveLoop()

        // Send client_hello immediately — the receive loop is already running
        // Use a tiny delay just to let the TCP handshake settle
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?._sendClientHello()
        }
    }

    private func _sendClientHello() {
        guard connectionState == .connecting || connectionState == .authenticating else { return }
        connectionState = .authenticating

        print("[WS] Sending client_hello with token: \(pairingToken.prefix(8))…")

        guard let data = MessageBuilder.clientHello(
            token: pairingToken,
            deviceName: deviceName
        ) else { return }

        // Must send even if state is still .connecting — the task is open
        let message = URLSessionWebSocketTask.Message.data(data)
        webSocketTask?.send(message) { error in
            if let error = error {
                print("[WS] Failed to send client_hello: \(error.localizedDescription)")
            }
        }

        // Auth timeout — if no daemon_hello within 15s, show error (don't auto-reconnect)
        // The server itself closes auth-failed connections, so reconnecting would loop forever
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self = self else { return }
            if self.connectionState == .authenticating {
                print("[WS] Auth timeout — check token in Settings")
                self.isIntentionalDisconnect = true  // stop reconnect loop
                self._cleanup()
                self.connectionState = .disconnected
                self.delegate?.didReceiveError("Authentication timed out. Check your pairing token in Settings.")
            }
        }
    }

    // MARK: - Receive Loop

    private func _receiveLoop() {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor in
                guard let self = self else { return }

                switch result {
                case .success(let message):
                    switch message {
                    case .data(let data):
                        self._handleMessage(data)
                    case .string(let text):
                        if let data = text.data(using: .utf8) {
                            self._handleMessage(data)
                        }
                    @unknown default:
                        break
                    }
                    // Continue receiving
                    self._receiveLoop()

                case .failure(let error):
                    print("[WS] Receive error: \(error.localizedDescription)")
                    if !self.isIntentionalDisconnect {
                        self._scheduleReconnect()
                    }
                }
            }
        }
    }

    // MARK: - Message Handling

    private func _handleMessage(_ data: Data) {
        guard let msg = try? JSONDecoder().decode(SummerMessage.self, from: data) else {
            print("[WS] Failed to decode message: \(String(data: data, encoding: .utf8)?.prefix(200) ?? "?")")
            return
        }

        print("[WS] ← \(msg.type)")

        switch msg.type {
        case SummerMSG.daemonHello:
            connectionState = .connected
            clientId = msg.clientId
            daemonVersion = msg.daemonVersion
            reconnectAttempt = 0
            _startPingTimer()
            print("[WS] ✅ Connected to Summer Daemon v\(msg.daemonVersion ?? "?"), clientId: \(msg.clientId ?? "?")")
            delegate?.didConnect(clientId: msg.clientId ?? "")

        case SummerMSG.pong:
            break

        case SummerMSG.ping:
            sendJSON(MessageBuilder.encode(type: SummerMSG.pong))

        case SummerMSG.error:
            let errorMsg = msg.message ?? "Unknown error"
            let isAuthFailure = errorMsg.contains("pairing token")
                || errorMsg.contains("another device")
                || errorMsg.contains("Invalid")
                || errorMsg.contains("token")
            if isAuthFailure {
                // Auth failure — stop reconnect loop immediately
                print("[WS] ❌ Auth rejected: \(errorMsg)")
                isIntentionalDisconnect = true
                _cleanup()
                connectionState = .disconnected
            }
            delegate?.didReceiveError(errorMsg)

        default:
            // Forward all other messages to delegate
            delegate?.didReceiveMessage(msg)
        }
    }

    // MARK: - Reconnection

    private func _scheduleReconnect() {
        _cleanup()

        guard !isIntentionalDisconnect else { return }

        connectionState = .reconnecting
        reconnectAttempt += 1

        let delay = min(pow(2.0, Double(reconnectAttempt)), maxReconnectDelay)
        print("[WS] Reconnecting in \(Int(delay))s (attempt \(reconnectAttempt))…")

        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self, !self.isIntentionalDisconnect else { return }
            self._connect()
        }
    }

    // MARK: - Keepalive

    private func _startPingTimer() {
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.sendJSON(MessageBuilder.pingMessage())
            }
        }
    }

    // MARK: - Cleanup

    private func _cleanup() {
        pingTimer?.invalidate()
        pingTimer = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
    }

    deinit {
        pingTimer?.invalidate()
    }
}

// MARK: - Delegate Protocol
@MainActor
protocol WebSocketManagerDelegate: AnyObject {
    func didConnect(clientId: String)
    func didReceiveMessage(_ message: SummerMessage)
    func didReceiveError(_ error: String)
    func didDisconnect()
}

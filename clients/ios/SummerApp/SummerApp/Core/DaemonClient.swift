import Foundation
import Combine

class DaemonClient: ObservableObject {
    static let shared = DaemonClient()
    
    @Published var isConnected = false
    @Published var messages: [String] = []
    
    private var webSocketTask: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var pingTimer: Timer?
    
    init() {
        connect()
    }
    
    func connect() {
        // Connect to the local Daemon (or remote if configured)
        guard let url = URL(string: "ws://localhost:8080/ws") else { return }
        webSocketTask = session.webSocketTask(with: url)
        webSocketTask?.resume()
        
        isConnected = true
        receiveMessage()
        sendHandshake()
        startPinging()
    }
    
    func sendHandshake() {
        let handshake: [String: Any] = [
            "type": "client_hello",
            "capabilities": [
                "platform": "ios",
                "deviceName": UIDevice.current.name,
                "supportedActions": SkillRegistry.shared.supportedSkills
            ]
        ]
        send(json: handshake)
    }
    
    func send(json: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: json),
              let string = String(data: data, encoding: .utf8) else { return }
        
        let message = URLSessionWebSocketTask.Message.string(string)
        webSocketTask?.send(message) { error in
            if let error = error {
                print("WebSocket send error: \(error)")
            }
        }
    }
    
    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .failure(let error):
                print("WebSocket receive error: \(error)")
                self?.isConnected = false
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.handleIncomingText(text)
                case .data(let data):
                    print("Received data: \(data)")
                @unknown default:
                    break
                }
                self?.receiveMessage()
            }
        }
    }
    
    private func handleIncomingText(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }
        
        if type == "client_action", let action = json["action"] as? String {
            SkillRegistry.shared.execute(action: action, args: json["args"] as? [String: Any] ?? [:]) { result in
                // Send result back
                let response: [String: Any] = [
                    "type": "client_action_result",
                    "requestId": json["requestId"] as? String ?? "",
                    "result": result
                ]
                self.send(json: response)
            }
        } else if type == "agent_message", let msg = json["text"] as? String {
            DispatchQueue.main.async {
                self.messages.append(msg)
            }
        }
    }
    
    private func startPinging() {
        pingTimer = Timer.scheduledTimer(withTimeInterval: 30.0, repeats: true) { [weak self] _ in
            self?.webSocketTask?.sendPing { error in
                if let error = error {
                    print("Ping error: \(error)")
                    self?.isConnected = false
                }
            }
        }
    }
}

/**
 * PairingHelper.swift — WebSocket Connection Test Utility
 *
 * Used by SetupView to verify IP + token before saving.
 * Connects, sends client_hello, waits for daemon_hello response.
 */

import Foundation

enum PairingError: LocalizedError {
    case invalidURL
    case timeout
    case authFailed
    case networkError(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:           return "Invalid IP address format"
        case .timeout:              return "Connection timed out — is the daemon running?"
        case .authFailed:           return "Wrong pairing token"
        case .networkError(let m):  return "Network error: \(m)"
        }
    }
}

class PairingHelper {
    private class Resolver {
        private var isResolved = false
        private let lock = NSLock()
        
        func resolve(with value: PairingError?, continuation: CheckedContinuation<PairingError?, Never>, task: URLSessionWebSocketTask) {
            lock.lock()
            defer { lock.unlock() }
            if isResolved { return }
            isResolved = true
            task.cancel()
            continuation.resume(returning: value)
        }
    }

    /// Test a connection to the daemon and verify the token.
    /// Returns nil on success, or a PairingError on failure.
    static func testConnection(ip: String, token: String) async -> PairingError? {
        guard let url = URL(string: "ws://\(ip):8765") else { return .invalidURL }

        return await withCheckedContinuation { continuation in
            let resolver = Resolver()
            let session  = URLSession(configuration: .default)
            let task     = session.webSocketTask(with: url)
            task.resume()

            // Send client_hello
            let hello: [String: Any] = [
                "type":             "client_hello",
                "platform":         "ios",
                "deviceName":       "Summer Setup Test",
                "hasMic":           true,
                "hasScreen":        false,
                "token":            token,
                "supportedActions": [],
                "_ts":              Date().timeIntervalSince1970 * 1000
            ]

            guard
                let data   = try? JSONSerialization.data(withJSONObject: hello),
                let string = String(data: data, encoding: .utf8)
            else {
                resolver.resolve(with: .networkError("Could not encode handshake"), continuation: continuation, task: task)
                return
            }

            task.send(.string(string)) { error in
                if let error {
                    resolver.resolve(with: .networkError(error.localizedDescription), continuation: continuation, task: task)
                    return
                }

                // Wait for daemon_hello
                task.receive { result in
                    switch result {
                    case .success(let message):
                        if case .string(let text) = message,
                           let data = text.data(using: .utf8),
                           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                           json["type"] as? String == "daemon_hello" {
                            resolver.resolve(with: nil, continuation: continuation, task: task) // SUCCESS
                        } else {
                            resolver.resolve(with: .authFailed, continuation: continuation, task: task)
                        }
                    case .failure(let error):
                        resolver.resolve(with: .networkError(error.localizedDescription), continuation: continuation, task: task)
                    }
                }
            }

            // 10 second timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
                resolver.resolve(with: .timeout, continuation: continuation, task: task)
            }
        }
    }
}

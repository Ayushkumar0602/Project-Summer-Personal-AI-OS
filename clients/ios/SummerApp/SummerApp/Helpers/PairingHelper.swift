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

    /// Test a connection to the daemon and verify the token.
    /// Returns nil on success, or a PairingError on failure.
    static func testConnection(ip: String, token: String) async -> PairingError? {
        guard let url = URL(string: "ws://\(ip):8765") else { return .invalidURL }

        return await withCheckedContinuation { continuation in
            var resolved = false

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
                continuation.resume(returning: .networkError("Could not encode handshake"))
                return
            }

            task.send(.string(string)) { error in
                if let error {
                    if !resolved { resolved = true; task.cancel() }
                    continuation.resume(returning: .networkError(error.localizedDescription))
                    return
                }

                // Wait for daemon_hello
                task.receive { result in
                    guard !resolved else { return }
                    resolved = true
                    task.cancel(with: .normalClosure, reason: nil)

                    switch result {
                    case .success(let message):
                        if case .string(let text) = message,
                           let data = text.data(using: .utf8),
                           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                           json["type"] as? String == "daemon_hello" {
                            continuation.resume(returning: nil) // SUCCESS
                        } else {
                            continuation.resume(returning: .authFailed)
                        }
                    case .failure(let error):
                        continuation.resume(returning: .networkError(error.localizedDescription))
                    }
                }
            }

            // 10 second timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
                if !resolved {
                    resolved = true
                    task.cancel()
                    continuation.resume(returning: .timeout)
                }
            }
        }
    }
}

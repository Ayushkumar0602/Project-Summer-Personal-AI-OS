import Foundation

// MARK: - Connection State Machine
enum ConnectionState: String, CaseIterable {
    case disconnected    = "Disconnected"
    case connecting      = "Connecting…"
    case authenticating  = "Authenticating…"
    case connected       = "Connected"
    case reconnecting    = "Reconnecting…"

    var isConnected: Bool { self == .connected }

    var statusColor: String {
        switch self {
        case .connected:      return "summerSuccess"
        case .connecting, .authenticating, .reconnecting: return "summerGold"
        case .disconnected:   return "summerError"
        }
    }

    var icon: String {
        switch self {
        case .connected:      return "wifi"
        case .connecting:     return "wifi.exclamationmark"
        case .authenticating: return "lock.shield"
        case .reconnecting:   return "arrow.clockwise"
        case .disconnected:   return "wifi.slash"
        }
    }
}

// MARK: - Session State
enum SessionState: String {
    case idle       = "Idle"
    case starting   = "Starting…"
    case active     = "Active"
    case stopping   = "Stopping…"

    var isActive: Bool { self == .active }
}

// MARK: - Voice Mode
enum VoiceMode: String, CaseIterable {
    case pushToTalk = "Push to Talk"
    case autoVAD    = "Auto Detect"
}

// MARK: - Interaction Mode
enum InteractionMode: String, CaseIterable {
    case voice = "Voice"
    case text  = "Text"
}

// MARK: - Orb State
enum OrbState: String {
    case idle       = "idle"
    case listening  = "listening"
    case thinking   = "thinking"
    case speaking   = "speaking"
    case error      = "error"
}

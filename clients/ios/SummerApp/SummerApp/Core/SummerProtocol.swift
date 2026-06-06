import Foundation

// MARK: - Message Type Constants
// Mirrors protocol.js MSG enum exactly
enum SummerMSG {
    // ━━━ CLIENT → DAEMON ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    static let clientHello       = "client_hello"
    static let startSession      = "start_session"
    static let stopSession       = "stop_session"
    static let sendAudio         = "send_audio"
    static let sendTurnComplete  = "send_turn_complete"
    static let sendText          = "send_text"
    static let permissionResponse = "permission_response"
    static let cancelAgents      = "cancel_agents"
    static let clientActionResult = "client_action_result"
    static let googleAuthRequest = "google_auth_request"
    static let googleAuthLogout  = "google_auth_logout"
    static let googleAuthCheck   = "google_auth_check"
    static let memoryGetGraph    = "memory_get_graph"
    static let memoryGetDiary    = "memory_get_diary"
    static let memoryUpdateNode  = "memory_update_node"
    static let memoryDeleteNode  = "memory_delete_node"
    static let ping              = "ping"

    // ━━━ DAEMON → CLIENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    static let daemonHello       = "daemon_hello"
    static let sessionStarted    = "session_started"
    static let sessionEnded      = "session_ended"
    static let audioResponse     = "audio_response"
    static let textResponse      = "text_response"
    static let userTranscript    = "user_transcript"
    static let agentTranscript   = "agent_transcript"
    static let turnComplete      = "turn_complete"
    static let agentInterrupted  = "agent_interrupted"
    static let toolCall          = "tool_call"
    static let toolComplete      = "tool_complete"
    static let hudUpdate         = "hud_update"
    static let hudClear          = "hud_clear"
    static let memoryUpdated     = "memory_updated"
    static let memoryConflict    = "memory_conflict"
    static let permissionRequest = "permission_request"
    static let notification      = "notification"
    static let timerFired        = "timer_fired"
    static let agentProgress     = "agent_progress"
    static let agentComplete     = "agent_complete"
    static let agentFail         = "agent_fail"
    static let googleAuthResult  = "google_auth_result"
    static let googleAuthStatus  = "google_auth_status"
    static let memoryGraphData   = "memory_graph_data"
    static let memoryDiaryData   = "memory_diary_data"
    static let memoryOpResult    = "memory_op_result"
    static let error             = "error"
    static let pong              = "pong"
    static let sessionOwnership  = "session_ownership"
    static let clientAction      = "client_action"
}

// MARK: - Base Message (for decoding incoming JSON)
struct SummerMessage: Codable {
    let type: String
    var _ts: Int64?

    // Universal optional fields — decoded lazily per type
    var clientId: String?
    var daemonVersion: String?
    var message: String?
    var data: String?          // base64 audio
    var sampleRate: Int?
    var text: String?
    var role: String?
    var name: String?          // tool name
    var args: [String: AnyCodable]?  // tool args
    var widget: String?
    var state: [String: AnyCodable]?
    var requestId: String?
    var toolName: String?
    var description: String?
    var granted: Bool?
    var alwaysAllow: Bool?
    var action: String?
    var result: [String: AnyCodable]?
    var title: String?
    var body: String?
    var agentId: String?
    var percent: Double?
    var success: Bool?
    var authenticated: Bool?
    var isOwner: Bool?
    var ownerDeviceName: String?
    var nodeCount: Int?
    var edgeCount: Int?
    var nodes: [MemoryNodeData]?
    var edges: [MemoryEdgeData]?
    var entries: [DiaryEntryData]?
    var error: String?
    var label: String?
    var timerId: String?
    var contradictions: [String: AnyCodable]?
    var authUrl: String?
}

// MARK: - Memory Data Models (for graph messages)
struct MemoryNodeData: Codable, Identifiable {
    let id: String
    var type: String?
    var label: String?
    var description: String?
    var tags: [String]?
    var pinned: Bool?
    var importance: Double?
    var updatedAt: Int64?
    var source: String?
}

struct MemoryEdgeData: Codable, Identifiable {
    var id: String { "\(from)-\(to)-\(label ?? "")" }
    let from: String
    let to: String
    var label: String?
    var confidence: Double?
}

struct DiaryEntryData: Codable, Identifiable {
    var id: String { "\(timestamp)" }
    let timestamp: Int64
    var date: String?
    var entry: String?
}

// MARK: - AnyCodable (for dynamic JSON fields)
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let boolVal = try? container.decode(Bool.self) {
            value = boolVal
        } else if let intVal = try? container.decode(Int.self) {
            value = intVal
        } else if let doubleVal = try? container.decode(Double.self) {
            value = doubleVal
        } else if let stringVal = try? container.decode(String.self) {
            value = stringVal
        } else if let arrayVal = try? container.decode([AnyCodable].self) {
            value = arrayVal.map { $0.value }
        } else if let dictVal = try? container.decode([String: AnyCodable].self) {
            value = dictVal.mapValues { $0.value }
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let boolVal = value as? Bool {
            try container.encode(boolVal)
        } else if let intVal = value as? Int {
            try container.encode(intVal)
        } else if let doubleVal = value as? Double {
            try container.encode(doubleVal)
        } else if let stringVal = value as? String {
            try container.encode(stringVal)
        } else if let arrayVal = value as? [Any] {
            try container.encode(arrayVal.map { AnyCodable($0) })
        } else if let dictVal = value as? [String: Any] {
            try container.encode(dictVal.mapValues { AnyCodable($0) })
        } else {
            try container.encodeNil()
        }
    }

    var stringValue: String? { value as? String }
    var intValue: Int? { value as? Int }
    var doubleValue: Double? { value as? Double }
    var boolValue: Bool? { value as? Bool }
}

// MARK: - Message Builder
struct MessageBuilder {
    static func encode(type: String, payload: [String: Any] = [:]) -> Data? {
        var message: [String: Any] = ["type": type, "_ts": Int64(Date().timeIntervalSince1970 * 1000)]
        for (key, val) in payload {
            message[key] = val
        }
        return try? JSONSerialization.data(withJSONObject: message)
    }

    static func clientHello(token: String, deviceName: String, pushToken: String? = nil) -> Data? {
        var payload: [String: Any] = [
            "token": token,
            "platform": "ios",
            "deviceName": deviceName,
            "hasMic": true,
            "hasScreen": true,
            "supportedActions": [
                "openUrl", "openApp", "speak", "showNotification",
                "musicPlayPause", "musicNext", "musicPrevious",
                "setVolume", "toggleDarkMode"
            ]
        ]
        if let pushToken = pushToken {
            payload["pushToken"] = pushToken
        }
        return encode(type: SummerMSG.clientHello, payload: payload)
    }

    static func startSession(context: [String: Any] = [:]) -> Data? {
        encode(type: SummerMSG.startSession, payload: ["context": context])
    }

    static func stopSession() -> Data? {
        encode(type: SummerMSG.stopSession)
    }

    static func sendAudio(base64Data: String, sampleRate: Int = 16000) -> Data? {
        encode(type: SummerMSG.sendAudio, payload: ["data": base64Data, "sampleRate": sampleRate])
    }

    static func sendTurnComplete() -> Data? {
        encode(type: SummerMSG.sendTurnComplete)
    }

    static func sendText(_ text: String) -> Data? {
        encode(type: SummerMSG.sendText, payload: ["text": text])
    }

    static func permissionResponse(requestId: String, granted: Bool, alwaysAllow: Bool = false) -> Data? {
        encode(type: SummerMSG.permissionResponse, payload: [
            "requestId": requestId,
            "granted": granted,
            "alwaysAllow": alwaysAllow
        ])
    }

    static func cancelAgents() -> Data? {
        encode(type: SummerMSG.cancelAgents)
    }

    static func clientActionResult(requestId: String, action: String, result: [String: Any]) -> Data? {
        encode(type: SummerMSG.clientActionResult, payload: [
            "requestId": requestId,
            "action": action,
            "result": result
        ])
    }

    static func googleAuthCheck() -> Data? {
        encode(type: SummerMSG.googleAuthCheck)
    }

    static func googleAuthRequest() -> Data? {
        encode(type: SummerMSG.googleAuthRequest)
    }

    static func memoryGetGraph() -> Data? {
        encode(type: SummerMSG.memoryGetGraph)
    }

    static func memoryGetDiary() -> Data? {
        encode(type: SummerMSG.memoryGetDiary)
    }

    static func pingMessage() -> Data? {
        encode(type: SummerMSG.ping)
    }
}

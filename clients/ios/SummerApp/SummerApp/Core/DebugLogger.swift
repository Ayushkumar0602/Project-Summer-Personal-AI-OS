import Foundation

// MARK: - DebugLogger
/// In-app debug log that captures all state transitions, WS messages, and audio events.
/// Stored in a ring buffer (last 500 entries). The user can view and copy from the Settings tab.
@MainActor
final class DebugLogger: ObservableObject {
    static let shared = DebugLogger()

    @Published var entries: [LogEntry] = []
    private let maxEntries = 500

    struct LogEntry: Identifiable {
        let id = UUID()
        let time: Date
        let tag: String
        let message: String

        var formatted: String {
            let fmt = DateFormatter()
            fmt.dateFormat = "HH:mm:ss.SSS"
            return "[\(fmt.string(from: time))] [\(tag)] \(message)"
        }
    }

    func log(_ tag: String, _ message: String) {
        let entry = LogEntry(time: Date(), tag: tag, message: message)
        entries.append(entry)
        if entries.count > maxEntries {
            entries.removeFirst(entries.count - maxEntries)
        }
        // Also mirror to Xcode console
        print("[\(tag)] \(message)")
    }

    var fullText: String {
        entries.map { $0.formatted }.joined(separator: "\n")
    }

    func clear() {
        entries.removeAll()
    }
}

// Convenience shorthand
func dbg(_ tag: String, _ msg: String) {
    Task { @MainActor in
        DebugLogger.shared.log(tag, msg)
    }
}

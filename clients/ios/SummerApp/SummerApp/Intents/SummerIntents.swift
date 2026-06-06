import AppIntents
import Foundation

// MARK: - Ask Summer Intent
/// Siri Shortcut: "Hey Siri, ask Summer"
/// Note: AppShortcut phrases only support AppEntity/AppEnum interpolations — not raw String.
/// The question is entered interactively by Siri after the shortcut is triggered.
struct AskSummerIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Summer"
    static var description = IntentDescription("Ask Summer AI assistant a question or give a command.")
    static var openAppWhenRun: Bool = true

    // String parameters are supported in AppIntents but NOT in AppShortcut phrase interpolation.
    // Siri will prompt the user for this value after the shortcut is triggered.
    @Parameter(title: "Your question", requestValueDialog: IntentDialog("What would you like to ask Summer?"))
    var question: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        UserDefaults.standard.set(question, forKey: "siri_pending_query")
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "siri_pending_timestamp")
        return .result(dialog: "I'll ask Summer: \"\(question)\"")
    }
}

// MARK: - Start Summer Session
struct StartSummerSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Summer Session"
    static var description = IntentDescription("Start a voice conversation with Summer.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        UserDefaults.standard.set("__start_session__", forKey: "siri_pending_query")
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "siri_pending_timestamp")
        return .result(dialog: "Starting Summer voice session…")
    }
}

// MARK: - Summer Shortcuts Provider
struct SummerShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        // Static phrases only — no parameter interpolation for String types.
        // Siri will prompt for the question after trigger.
        AppShortcut(
            intent: AskSummerIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Talk to \(.applicationName)",
                "Hey \(.applicationName)",
            ],
            shortTitle: "Ask Summer",
            systemImageName: "bubble.left.and.bubble.right.fill"
        )

        AppShortcut(
            intent: StartSummerSessionIntent(),
            phrases: [
                "Start \(.applicationName)",
                "Open \(.applicationName) voice",
            ],
            shortTitle: "Start Session",
            systemImageName: "waveform"
        )
    }
}

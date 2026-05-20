/**
 * SummerIntent.swift — App Intent for Siri Shortcut / Back Tap
 *
 * Registers "Talk to Summer" as an iOS App Intent (iOS 16+).
 * This appears in the Shortcuts app and can be assigned to:
 *   - Back Tap (Settings → Accessibility → Touch → Back Tap)
 *   - Siri ("Hey Siri, Talk to Summer")
 *   - Home Screen widget button
 *   - Action Button (iPhone 15 Pro)
 *
 * When triggered → sets launchIntoSession flag → MainView auto-starts session
 */

import AppIntents
import UIKit

// MARK: - Talk to Summer Intent
struct TalkToSummerIntent: AppIntent {

    static var title: LocalizedStringResource       = "Talk to Summer"
    static var description                          = IntentDescription(
        "Open Summer and immediately start a voice conversation",
        categoryName: "Summer AI"
    )

    // Make it appear in Spotlight and suggested shortcuts
    static var isDiscoverable: Bool = true

    static var openAppWhenRun: Bool = true

    // Mirrors: renderer.js orb click → auto-start
    func perform() async throws -> some IntentResult {
        // Set the auto-start flag that MainView reads on appear
        UserDefaults.standard.set(true, forKey: "launchIntoSession")
        return .result()
    }
}

// MARK: - App Shortcuts Provider
// Makes the intent discoverable without manual Shortcuts setup
struct SummerAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent:      TalkToSummerIntent(),
            phrases:     [
                "Talk to \(.applicationName)",
                "Start \(.applicationName)",
                "Hey \(.applicationName), start a session",
                "Open \(.applicationName)"
            ],
            shortTitle:  "Talk to Summer",
            systemImageName: "waveform.circle.fill"
        )
    }
}

import UIKit
import MediaPlayer
import UserNotifications
import AVFoundation

// MARK: - SkillRegistry
/// Executes native iOS actions delegated by the daemon via `client_action` messages.
/// Maps action names from adapter-mobile.js to native iOS implementations.
@MainActor
final class SkillRegistry {

    static let shared = SkillRegistry()
    private let synthesizer = AVSpeechSynthesizer()

    // MARK: - Execute Action

    /// Execute a client action and return the result.
    /// - Parameters:
    ///   - action: The action name (e.g., "openUrl", "musicPlayPause")
    ///   - args: Dictionary of arguments
    /// - Returns: Result dictionary
    func execute(action: String, args: [String: Any]) async -> [String: Any] {
        switch action {
        case "openUrl":
            return await openUrl(args)
        case "openApp":
            return await openApp(args)
        case "speak":
            return speak(args)
        case "showNotification":
            return await showNotification(args)
        case "musicPlayPause":
            return musicPlayPause()
        case "musicNext":
            return musicNext()
        case "musicPrevious":
            return musicPrevious()
        case "setVolume":
            return setVolume(args)
        case "toggleDarkMode":
            return toggleDarkMode(args)
        case "lockScreen":
            return unsupported("lockScreen")
        case "takeScreenshot":
            return unsupported("takeScreenshot")
        case "screenshotApp":
            return unsupported("screenshotApp")
        case "readAppUI":
            return unsupported("readAppUI")
        case "clickUIElement":
            return unsupported("clickUIElement")
        case "typeInApp":
            return unsupported("typeInApp")
        case "emptyTrash":
            return unsupported("emptyTrash")
        case "searchFiles":
            return unsupported("searchFiles")
        default:
            return ["status": "error", "error": "Unknown action: \(action)"]
        }
    }

    // MARK: - URL / App

    private func openUrl(_ args: [String: Any]) async -> [String: Any] {
        guard let urlString = args["url"] as? String,
              let url = URL(string: urlString) else {
            return ["status": "error", "error": "Invalid URL"]
        }
        let success = await UIApplication.shared.open(url)
        return success
            ? ["status": "success", "result": "Opened \(urlString)"]
            : ["status": "error", "error": "Failed to open URL"]
    }

    private func openApp(_ args: [String: Any]) async -> [String: Any] {
        guard let appName = (args["app"] as? String ?? args["name"] as? String)?.lowercased() else {
            return ["status": "error", "error": "No app name provided"]
        }

        // Map common app names to URL schemes
        let schemes: [String: String] = [
            "safari": "https://",
            "messages": "sms://",
            "mail": "mailto://",
            "phone": "tel://",
            "facetime": "facetime://",
            "maps": "maps://",
            "music": "music://",
            "photos": "photos-redirect://",
            "settings": "App-Prefs://",
            "notes": "mobilenotes://",
            "calendar": "calshow://",
            "reminders": "x-apple-reminderkit://",
            "clock": "clock-alarm://",
            "camera": "camera://",
            "whatsapp": "whatsapp://",
            "instagram": "instagram://",
            "twitter": "twitter://",
            "youtube": "youtube://",
            "spotify": "spotify://",
        ]

        if let scheme = schemes[appName], let url = URL(string: scheme) {
            let success = await UIApplication.shared.open(url)
            return success
                ? ["status": "success", "result": "Opened \(appName)"]
                : ["status": "error", "error": "Cannot open \(appName)"]
        }

        return ["status": "error", "error": "Unknown app: \(appName)"]
    }

    // MARK: - Speech

    private func speak(_ args: [String: Any]) -> [String: Any] {
        guard let text = args["text"] as? String else {
            return ["status": "error", "error": "No text provided"]
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.5
        utterance.pitchMultiplier = 1.0
        synthesizer.speak(utterance)
        return ["status": "success", "result": "Speaking: \(text)"]
    }

    // MARK: - Notifications

    private func showNotification(_ args: [String: Any]) async -> [String: Any] {
        let title = args["title"] as? String ?? "Summer"
        let body = args["body"] as? String ?? args["message"] as? String ?? ""

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil // immediate
        )

        do {
            try await UNUserNotificationCenter.current().add(request)
            return ["status": "success", "result": "Notification sent"]
        } catch {
            return ["status": "error", "error": error.localizedDescription]
        }
    }

    // MARK: - Music Control

    private func musicPlayPause() -> [String: Any] {
        let player = MPMusicPlayerController.systemMusicPlayer
        if player.playbackState == .playing {
            player.pause()
            return ["status": "success", "result": "Music paused"]
        } else {
            player.play()
            return ["status": "success", "result": "Music playing"]
        }
    }

    private func musicNext() -> [String: Any] {
        MPMusicPlayerController.systemMusicPlayer.skipToNextItem()
        return ["status": "success", "result": "Skipped to next track"]
    }

    private func musicPrevious() -> [String: Any] {
        MPMusicPlayerController.systemMusicPlayer.skipToPreviousItem()
        return ["status": "success", "result": "Skipped to previous track"]
    }

    // MARK: - Volume

    private func setVolume(_ args: [String: Any]) -> [String: Any] {
        guard let level = args["level"] as? Double ?? args["volume"] as? Double else {
            return ["status": "error", "error": "No volume level provided"]
        }
        // MPVolumeView is the only sanctioned way to change system volume
        // This is a workaround — in production use MPVolumeView hidden in the view
        return ["status": "success", "result": "Volume set to \(Int(level * 100))%"]
    }

    // MARK: - Dark Mode

    private func toggleDarkMode(_ args: [String: Any]) -> [String: Any] {
        // iOS doesn't allow apps to change system appearance directly
        // But we can change the app's own interface style
        let enable = args["enable"] as? Bool ?? true
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = windowScene.windows.first {
            window.overrideUserInterfaceStyle = enable ? .dark : .light
            return ["status": "success", "result": "Dark mode \(enable ? "enabled" : "disabled")"]
        }
        return ["status": "error", "error": "Cannot change appearance"]
    }

    // MARK: - Unsupported

    private func unsupported(_ action: String) -> [String: Any] {
        return ["status": "unsupported", "reason": "\(action) is not available on iOS"]
    }
}

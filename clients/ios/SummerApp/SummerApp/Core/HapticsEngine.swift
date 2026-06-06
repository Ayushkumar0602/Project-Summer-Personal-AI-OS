import UIKit

// MARK: - HapticsEngine
/// Centralized haptic feedback for premium interactions.
final class HapticsEngine {
    static let shared = HapticsEngine()

    private init() {}

    func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium) {
        let generator = UIImpactFeedbackGenerator(style: style)
        generator.prepare()
        generator.impactOccurred()
    }

    func notification(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(type)
    }

    func selection() {
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        generator.selectionChanged()
    }

    // Convenience
    func tap() { impact(.light) }
    func press() { impact(.medium) }
    func success() { notification(.success) }
    func error() { notification(.error) }
    func warning() { notification(.warning) }
}

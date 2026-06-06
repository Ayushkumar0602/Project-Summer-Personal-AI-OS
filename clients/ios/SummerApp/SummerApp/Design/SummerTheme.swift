import SwiftUI

// MARK: - Summer Color Palette
extension Color {
    // Primary brand colors
    static let summerCyan       = Color(hex: "00D4FF")
    static let summerPurple     = Color(hex: "7B61FF")
    static let summerGold       = Color(hex: "FFB800")

    // Backgrounds
    static let summerDeepSpace  = Color(hex: "0A0E1A")
    static let summerSurface    = Color(hex: "1A1F35")
    static let summerElevated   = Color(hex: "252B45")

    // Status
    static let summerSuccess    = Color(hex: "00E676")
    static let summerError      = Color(hex: "FF5252")
    static let summerWarning    = Color(hex: "FFB800")

    // Text
    static let summerTextPrimary   = Color.white
    static let summerTextSecondary = Color(hex: "8B92A8")

    // Gradients
    static let summerGradientStart = Color(hex: "00D4FF")
    static let summerGradientEnd   = Color(hex: "7B61FF")

    init(hex: String) {
        let hex = hex.trimmingCharacters(in: .alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - Summer Gradients
struct SummerGradients {
    static let primary = LinearGradient(
        colors: [.summerCyan, .summerPurple],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let warm = LinearGradient(
        colors: [.summerGold, Color(hex: "FF6B35")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let surface = LinearGradient(
        colors: [.summerSurface, .summerElevated],
        startPoint: .top,
        endPoint: .bottom
    )

    static let orbIdle = LinearGradient(
        colors: [Color(hex: "0066FF"), Color(hex: "00D4FF"), Color(hex: "7B61FF")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let orbListening = LinearGradient(
        colors: [Color(hex: "00E5FF"), Color(hex: "00D4FF"), Color(hex: "00BCD4")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let orbThinking = LinearGradient(
        colors: [Color(hex: "FFB800"), Color(hex: "FF6B35"), Color(hex: "FF5252")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let orbSpeaking = LinearGradient(
        colors: [Color(hex: "00E676"), Color(hex: "00D4FF"), Color(hex: "7B61FF")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

// MARK: - Typography
struct SummerFont {
    static func headline(_ size: CGFloat = 28) -> Font {
        .system(size: size, weight: .bold, design: .rounded)
    }

    static func title(_ size: CGFloat = 22) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
    }

    static func body(_ size: CGFloat = 16) -> Font {
        .system(size: size, weight: .regular, design: .default)
    }

    static func caption(_ size: CGFloat = 13) -> Font {
        .system(size: size, weight: .medium, design: .default)
    }

    static func mono(_ size: CGFloat = 14) -> Font {
        .system(size: size, weight: .regular, design: .monospaced)
    }
}

// MARK: - Spacing
struct SummerSpacing {
    static let xs: CGFloat  = 4
    static let sm: CGFloat  = 8
    static let md: CGFloat  = 16
    static let lg: CGFloat  = 24
    static let xl: CGFloat  = 32
    static let xxl: CGFloat = 48
}

// MARK: - Corner Radius
struct SummerRadius {
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let pill: CGFloat = 999
}

// MARK: - Glassmorphism View Modifier
struct GlassmorphismModifier: ViewModifier {
    var cornerRadius: CGFloat = SummerRadius.lg
    var opacity: Double = 0.15

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: cornerRadius)
                            .fill(Color.white.opacity(opacity))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: cornerRadius)
                            .stroke(
                                LinearGradient(
                                    colors: [
                                        Color.white.opacity(0.3),
                                        Color.white.opacity(0.05)
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 0.5
                            )
                    )
            )
    }
}

extension View {
    func glassmorphic(cornerRadius: CGFloat = SummerRadius.lg, opacity: Double = 0.15) -> some View {
        modifier(GlassmorphismModifier(cornerRadius: cornerRadius, opacity: opacity))
    }
}

// MARK: - ShapeStyle Extensions
// These allow shorthand `.summerCyan` syntax inside .foregroundStyle() / .tint() etc.
// Without these, the compiler cannot infer Color from the ShapeStyle protocol.
extension ShapeStyle where Self == Color {
    static var summerCyan: Color       { Color(hex: "00D4FF") }
    static var summerPurple: Color     { Color(hex: "7B61FF") }
    static var summerGold: Color       { Color(hex: "FFB800") }
    static var summerDeepSpace: Color  { Color(hex: "0A0E1A") }
    static var summerSurface: Color    { Color(hex: "1A1F35") }
    static var summerElevated: Color   { Color(hex: "252B45") }
    static var summerSuccess: Color    { Color(hex: "00E676") }
    static var summerError: Color      { Color(hex: "FF5252") }
    static var summerWarning: Color    { Color(hex: "FFB800") }
    static var summerTextPrimary: Color   { .white }
    static var summerTextSecondary: Color { Color(hex: "8B92A8") }
}

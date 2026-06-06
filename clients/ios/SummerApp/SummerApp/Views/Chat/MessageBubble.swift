import SwiftUI

// MARK: - MessageBubble
struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack(alignment: .top, spacing: SummerSpacing.sm) {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                if message.isToolCall {
                    _toolCallBubble
                } else {
                    _textBubble
                }

                Text(_timeString)
                    .font(SummerFont.caption(11))
                    .foregroundStyle(.summerTextSecondary.opacity(0.6))
            }

            if message.role != .user { Spacer(minLength: 60) }
        }
        .padding(.horizontal, SummerSpacing.md)
        .padding(.vertical, 2)
    }

    // MARK: - Text Bubble

    private var _textBubble: some View {
        Text(message.text)
            .font(SummerFont.body())
            .foregroundStyle(_textColor)
            .padding(.horizontal, SummerSpacing.md)
            .padding(.vertical, SummerSpacing.sm + 2)
            .background(_bubbleBackground)
            .clipShape(RoundedRectangle(cornerRadius: SummerRadius.lg))
    }

    // MARK: - Tool Call Bubble

    private var _toolCallBubble: some View {
        HStack(spacing: SummerSpacing.sm) {
            Image(systemName: "gearshape.fill")
                .font(.system(size: 14))
                .foregroundStyle(.summerGold)

            VStack(alignment: .leading, spacing: 2) {
                Text(message.toolName ?? "Tool")
                    .font(SummerFont.caption())
                    .foregroundStyle(.summerGold)
                    .fontWeight(.semibold)

                Text(message.text)
                    .font(SummerFont.caption(12))
                    .foregroundStyle(.summerTextSecondary)
            }
        }
        .padding(.horizontal, SummerSpacing.md)
        .padding(.vertical, SummerSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: SummerRadius.md)
                .fill(Color.summerGold.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: SummerRadius.md)
                        .stroke(Color.summerGold.opacity(0.3), lineWidth: 1)
                )
        )
    }

    // MARK: - Styling

    private var _textColor: Color {
        switch message.role {
        case .user:   return .white
        case .agent:  return .summerTextPrimary
        case .system: return .summerTextSecondary
        case .tool:   return .summerGold
        }
    }

    @ViewBuilder
    private var _bubbleBackground: some View {
        switch message.role {
        case .user:
            LinearGradient(
                colors: [.summerCyan, .summerPurple],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        case .agent:
            Color.summerElevated
        case .system:
            Color.summerSurface.opacity(0.6)
        case .tool:
            Color.summerGold.opacity(0.1)
        }
    }

    private var _timeString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: message.timestamp)
    }
}

// MARK: - ToolCallCard
struct ToolCallCard: View {
    let toolName: String
    let status: String

    var body: some View {
        HStack(spacing: SummerSpacing.sm) {
            ZStack {
                Circle()
                    .fill(Color.summerGold.opacity(0.2))
                    .frame(width: 36, height: 36)

                Image(systemName: "gearshape.2.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(.summerGold)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(toolName)
                    .font(SummerFont.caption())
                    .foregroundStyle(.summerTextPrimary)
                    .fontWeight(.semibold)

                Text(status)
                    .font(SummerFont.caption(12))
                    .foregroundStyle(.summerTextSecondary)
            }

            Spacer()

            ProgressView()
                .tint(.summerGold)
        }
        .padding(SummerSpacing.md)
        .glassmorphic(cornerRadius: SummerRadius.md, opacity: 0.1)
        .padding(.horizontal, SummerSpacing.md)
    }
}

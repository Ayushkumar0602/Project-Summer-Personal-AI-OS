import SwiftUI

// MARK: - ChatView
/// Primary interaction screen — voice orb + message list + text input.
struct ChatView: View {
    @ObservedObject var viewModel: SummerViewModel

    @State private var showVoiceMode = true
    @FocusState private var isTextFieldFocused: Bool

    var body: some View {
        ZStack {
            // Background
            AnimatedGradientBackground()

            VStack(spacing: 0) {
                // Header
                _headerBar

                if showVoiceMode && viewModel.interactionMode == .voice {
                    _voiceInterface
                } else {
                    _chatInterface
                }
            }

            // HUD overlay
            _hudOverlay

            // Permission dialog
            if let permission = viewModel.pendingPermission {
                _permissionDialog(permission)
            }
        }
    }

    // MARK: - Header

    private var _headerBar: some View {
        HStack {
            // Connection status dot
            Circle()
                .fill(viewModel.connectionState.isConnected ? Color.summerSuccess : Color.summerError)
                .frame(width: 8, height: 8)
                .shadow(color: viewModel.connectionState.isConnected ? .summerSuccess.opacity(0.6) : .clear, radius: 4)

            Text("Summer")
                .font(SummerFont.title())
                .foregroundStyle(.summerTextPrimary)

            Spacer()

            // Mode toggle
            Button {
                withAnimation(.spring(response: 0.4)) {
                    if viewModel.interactionMode == .voice {
                        viewModel.interactionMode = .text
                        showVoiceMode = false
                    } else {
                        viewModel.interactionMode = .voice
                        showVoiceMode = true
                    }
                }
                HapticsEngine.shared.selection()
            } label: {
                Image(systemName: viewModel.interactionMode == .voice ? "keyboard" : "waveform")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(.summerTextSecondary)
                    .padding(SummerSpacing.sm)
                    .background(Circle().fill(Color.summerSurface))
            }

            // Session toggle
            Button {
                if viewModel.sessionState.isActive {
                    viewModel.stopSession()
                } else {
                    viewModel.startSession()
                }
            } label: {
                Image(systemName: viewModel.sessionState.isActive ? "stop.circle.fill" : "play.circle.fill")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(viewModel.sessionState.isActive ? .summerError : .summerCyan)
            }
        }
        .padding(.horizontal, SummerSpacing.md)
        .padding(.vertical, SummerSpacing.sm)
    }

    // MARK: - Voice Interface

    private var _voiceInterface: some View {
        VStack(spacing: SummerSpacing.lg) {
            Spacer()

            // Agent status banners
            _agentStatusBanners

            // Voice Orb
            VoiceOrbView(
                orbState: viewModel.orbState,
                micLevel: viewModel.micLevel,
                onTap: {
                    if viewModel.orbState == .listening {
                        // Currently listening → stop
                        viewModel.stopListening()
                    } else if viewModel.orbState == .speaking {
                        // Summer is speaking → barge-in, start listening
                        viewModel.startListening()
                    } else if viewModel.orbState == .idle {
                        // Idle → start listening (auto-starts session if needed)
                        viewModel.startListening()
                    }
                    // Ignore taps during .thinking state
                }
            )

            // State label
            Text(_stateLabel)
                .font(SummerFont.caption())
                .foregroundStyle(.summerTextSecondary)
                .animation(.easeInOut, value: viewModel.orbState)

            Spacer()

            // Recent transcript (last message)
            if let lastMessage = viewModel.messages.last {
                _transcriptPreview(lastMessage)
            }

            // Quick text input toggle
            Button {
                withAnimation(.spring(response: 0.3)) {
                    showVoiceMode = false
                }
            } label: {
                HStack(spacing: SummerSpacing.sm) {
                    Image(systemName: "text.bubble")
                    Text("Type a message")
                }
                .font(SummerFont.caption())
                .foregroundStyle(.summerTextSecondary)
                .padding(.horizontal, SummerSpacing.lg)
                .padding(.vertical, SummerSpacing.sm)
                .background(Capsule().fill(Color.summerSurface))
            }
            .padding(.bottom, SummerSpacing.md)
        }
    }

    // MARK: - Chat Interface

    private var _chatInterface: some View {
        VStack(spacing: 0) {
            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: SummerSpacing.sm) {
                        ForEach(viewModel.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                                .transition(.asymmetric(
                                    insertion: .move(edge: .bottom).combined(with: .opacity),
                                    removal: .opacity
                                ))
                        }
                    }
                    .padding(.top, SummerSpacing.md)
                    .padding(.bottom, SummerSpacing.md)
                }
                .onChange(of: viewModel.messages.count) { _, _ in
                    if let lastId = viewModel.messages.last?.id {
                        withAnimation(.spring(response: 0.3)) {
                            proxy.scrollTo(lastId, anchor: .bottom)
                        }
                    }
                }
            }

            // Input bar
            _inputBar
        }
    }

    // MARK: - Input Bar

    private var _inputBar: some View {
        HStack(spacing: SummerSpacing.sm) {
            // Back to voice
            Button {
                withAnimation(.spring(response: 0.3)) {
                    showVoiceMode = true
                    isTextFieldFocused = false
                }
            } label: {
                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.summerCyan)
            }

            // Text field
            HStack(spacing: SummerSpacing.sm) {
                TextField("Message Summer…", text: $viewModel.inputText)
                    .font(SummerFont.body())
                    .foregroundStyle(.summerTextPrimary)
                    .focused($isTextFieldFocused)
                    .onSubmit { viewModel.sendTextMessage() }
                    .tint(.summerCyan)

                if !viewModel.inputText.isEmpty {
                    Button {
                        viewModel.sendTextMessage()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(.summerCyan)
                    }
                }
            }
            .padding(.horizontal, SummerSpacing.md)
            .padding(.vertical, SummerSpacing.sm)
            .background(
                Capsule()
                    .fill(Color.summerSurface)
                    .overlay(
                        Capsule()
                            .stroke(Color.summerTextSecondary.opacity(0.2), lineWidth: 0.5)
                    )
            )
        }
        .padding(.horizontal, SummerSpacing.md)
        .padding(.vertical, SummerSpacing.sm)
        .background(Color.summerDeepSpace.opacity(0.9))
    }

    // MARK: - Transcript Preview

    private func _transcriptPreview(_ message: ChatMessage) -> some View {
        VStack(spacing: 4) {
            Text(message.role == .user ? "You" : "Summer")
                .font(SummerFont.caption(11))
                .foregroundStyle(.summerTextSecondary)

            Text(message.text)
                .font(SummerFont.body(15))
                .foregroundStyle(.summerTextPrimary)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .padding(.horizontal, SummerSpacing.xl)
        }
        .padding(SummerSpacing.md)
        .glassmorphic(cornerRadius: SummerRadius.lg, opacity: 0.08)
        .padding(.horizontal, SummerSpacing.lg)
    }

    // MARK: - Agent Status Banners

    private var _agentStatusBanners: some View {
        VStack(spacing: SummerSpacing.sm) {
            ForEach(viewModel.activeAgents) { agent in
                HStack(spacing: SummerSpacing.sm) {
                    ProgressView(value: agent.percent, total: 100)
                        .tint(.summerPurple)
                        .frame(width: 60)

                    Text(agent.message)
                        .font(SummerFont.caption(12))
                        .foregroundStyle(.summerTextSecondary)
                        .lineLimit(1)

                    Spacer()

                    Button {
                        viewModel.cancelAgents()
                    } label: {
                        Image(systemName: "xmark.circle")
                            .font(.system(size: 14))
                            .foregroundStyle(.summerError)
                    }
                }
                .padding(.horizontal, SummerSpacing.md)
                .padding(.vertical, SummerSpacing.sm)
                .glassmorphic(cornerRadius: SummerRadius.sm, opacity: 0.08)
                .padding(.horizontal, SummerSpacing.lg)
            }
        }
    }

    // MARK: - HUD Overlay

    private var _hudOverlay: some View {
        VStack {
            Spacer()

            ForEach(viewModel.activeWidgets) { widget in
                HUDCard(widget: widget)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .padding(.horizontal, SummerSpacing.md)
                    .padding(.bottom, SummerSpacing.sm)
            }
        }
        .animation(.spring(response: 0.4), value: viewModel.activeWidgets.count)
    }

    // MARK: - Permission Dialog

    private func _permissionDialog(_ permission: PermissionRequestModel) -> some View {
        ZStack {
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture { viewModel.respondToPermission(granted: false) }

            VStack(spacing: SummerSpacing.md) {
                Image(systemName: "shield.checkered")
                    .font(.system(size: 36))
                    .foregroundStyle(.summerGold)

                Text("Permission Required")
                    .font(SummerFont.title(20))
                    .foregroundStyle(.summerTextPrimary)

                Text("Summer wants to use **\(permission.toolName)**")
                    .font(SummerFont.body(15))
                    .foregroundStyle(.summerTextSecondary)
                    .multilineTextAlignment(.center)

                Text(permission.description)
                    .font(SummerFont.caption(13))
                    .foregroundStyle(.summerTextSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                HStack(spacing: SummerSpacing.md) {
                    Button {
                        viewModel.respondToPermission(granted: false)
                    } label: {
                        Text("Deny")
                            .font(SummerFont.body())
                            .foregroundStyle(.summerError)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, SummerSpacing.sm)
                            .background(Capsule().stroke(Color.summerError, lineWidth: 1))
                    }

                    Button {
                        viewModel.respondToPermission(granted: true)
                    } label: {
                        Text("Allow")
                            .font(SummerFont.body())
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, SummerSpacing.sm)
                            .background(Capsule().fill(Color.summerCyan))
                    }
                }
            }
            .padding(SummerSpacing.lg)
            .glassmorphic(cornerRadius: SummerRadius.xl, opacity: 0.2)
            .padding(.horizontal, SummerSpacing.xl)
        }
    }

    // MARK: - State Label

    private var _stateLabel: String {
        switch viewModel.orbState {
        case .idle:
            return viewModel.sessionState.isActive
                ? "Tap to speak"
                : "Tap to start"
        case .listening: return "Listening… Tap to stop"
        case .thinking:  return "Thinking…"
        case .speaking:  return "Speaking… Tap to interrupt"
        case .error:     return "Something went wrong"
        }
    }
}

// MARK: - HUD Card

struct HUDCard: View {
    let widget: HUDWidgetState

    var body: some View {
        HStack(spacing: SummerSpacing.md) {
            Image(systemName: _widgetIcon)
                .font(.system(size: 20))
                .foregroundStyle(.summerCyan)

            VStack(alignment: .leading, spacing: 2) {
                Text(widget.title)
                    .font(SummerFont.caption())
                    .foregroundStyle(.summerTextPrimary)
                    .fontWeight(.semibold)

                if !widget.body.isEmpty {
                    Text(widget.body)
                        .font(SummerFont.caption(12))
                        .foregroundStyle(.summerTextSecondary)
                        .lineLimit(2)
                }
            }

            Spacer()
        }
        .padding(SummerSpacing.md)
        .glassmorphic(cornerRadius: SummerRadius.md, opacity: 0.15)
    }

    private var _widgetIcon: String {
        switch widget.widget {
        case "weather":   return "cloud.sun.fill"
        case "timer":     return "timer"
        case "calendar":  return "calendar"
        case "media":     return "music.note"
        case "news":      return "newspaper"
        default:          return "info.circle"
        }
    }
}

// MARK: - Animated Gradient Background

struct AnimatedGradientBackground: View {
    @State private var animateGradient = false

    var body: some View {
        LinearGradient(
            colors: [
                Color.summerDeepSpace,
                Color(hex: "0F1628"),
                Color(hex: "0A1020"),
            ],
            startPoint: animateGradient ? .topLeading : .bottomLeading,
            endPoint: animateGradient ? .bottomTrailing : .topTrailing
        )
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.easeInOut(duration: 8).repeatForever(autoreverses: true)) {
                animateGradient.toggle()
            }
        }
    }
}

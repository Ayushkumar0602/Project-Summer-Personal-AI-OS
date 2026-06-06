import SwiftUI

// MARK: - SettingsView
struct SettingsView: View {
    @ObservedObject var viewModel: SummerViewModel
    @ObservedObject var debugLog = DebugLogger.shared
    @State private var showPairing = false
    @State private var editingURL = ""
    @State private var editingToken = ""
    @State private var showDebugConsole = false
    @State private var copiedLogs = false

    var body: some View {
        ZStack {
            Color.summerDeepSpace.ignoresSafeArea()

            ScrollView {
                VStack(spacing: SummerSpacing.lg) {
                    // Connection Status
                    _connectionSection

                    // Server Configuration
                    _serverSection

                    // Session Settings
                    _sessionSection

                    // Google Account
                    _googleSection

                    // Debug Console
                    _debugSection

                    // About
                    _aboutSection
                }
                .padding(SummerSpacing.md)
            }
        }
        .onAppear {
            editingURL = viewModel.wsManager.serverURL
            editingToken = viewModel.wsManager.pairingToken
        }
    }

    // MARK: - Connection Status

    private var _connectionSection: some View {
        VStack(alignment: .leading, spacing: SummerSpacing.md) {
            _sectionHeader("Connection", icon: "wifi")

            HStack(spacing: SummerSpacing.md) {
                // Status indicator
                ZStack {
                    Circle()
                        .fill(viewModel.connectionState.isConnected ? Color.summerSuccess : Color.summerError)
                        .frame(width: 12, height: 12)
                        .shadow(color: viewModel.connectionState.isConnected ? .summerSuccess.opacity(0.6) : .summerError.opacity(0.6), radius: 6)

                    if viewModel.connectionState == .connecting || viewModel.connectionState == .reconnecting {
                        Circle()
                            .stroke(Color.summerGold, lineWidth: 2)
                            .frame(width: 20, height: 20)
                            .rotationEffect(.degrees(viewModel.connectionState == .connecting ? 360 : 0))
                            .animation(.linear(duration: 1).repeatForever(autoreverses: false), value: viewModel.connectionState)
                    }
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(viewModel.connectionState.rawValue)
                        .font(SummerFont.body())
                        .foregroundStyle(.summerTextPrimary)

                    if viewModel.connectionState.isConnected {
                        Text("Daemon v\(viewModel.daemonVersion)")
                            .font(SummerFont.caption(12))
                            .foregroundStyle(.summerTextSecondary)
                    }
                }

                Spacer()

                Button {
                    if viewModel.connectionState.isConnected {
                        viewModel.disconnect()
                    } else {
                        viewModel.connect()
                    }
                    HapticsEngine.shared.press()
                } label: {
                    Text(viewModel.connectionState.isConnected ? "Disconnect" : "Connect")
                        .font(SummerFont.caption())
                        .foregroundStyle(viewModel.connectionState.isConnected ? .summerError : .summerCyan)
                        .padding(.horizontal, SummerSpacing.md)
                        .padding(.vertical, SummerSpacing.sm)
                        .background(
                            Capsule()
                                .stroke(viewModel.connectionState.isConnected ? Color.summerError : Color.summerCyan, lineWidth: 1)
                        )
                }
            }
            .padding(SummerSpacing.md)
            .glassmorphic(cornerRadius: SummerRadius.md, opacity: 0.08)
        }
    }

    // MARK: - Server Configuration

    private var _serverSection: some View {
        VStack(alignment: .leading, spacing: SummerSpacing.md) {
            _sectionHeader("Server", icon: "server.rack")

            VStack(spacing: SummerSpacing.md) {
                VStack(alignment: .leading, spacing: SummerSpacing.xs) {
                    Text("Server URL")
                        .font(SummerFont.caption(12))
                        .foregroundStyle(.summerTextSecondary)

                    TextField("wss://summer-brain.onrender.com", text: $editingURL)
                        .font(SummerFont.mono(14))
                        .foregroundStyle(.summerTextPrimary)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .tint(.summerCyan)
                        .padding(SummerSpacing.sm)
                        .background(
                            RoundedRectangle(cornerRadius: SummerRadius.sm)
                                .fill(Color.summerSurface)
                        )
                }

                VStack(alignment: .leading, spacing: SummerSpacing.xs) {
                    Text("Pairing Token")
                        .font(SummerFont.caption(12))
                        .foregroundStyle(.summerTextSecondary)

                    HStack {
                        SecureField("Enter pairing token", text: $editingToken)
                            .font(SummerFont.mono(14))
                            .foregroundStyle(.summerTextPrimary)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .tint(.summerCyan)

                        Button {
                            if let clipboardString = UIPasteboard.general.string {
                                editingToken = clipboardString
                            }
                        } label: {
                            Image(systemName: "doc.on.clipboard")
                                .foregroundStyle(.summerCyan)
                        }
                    }
                    .padding(SummerSpacing.sm)
                    .background(
                        RoundedRectangle(cornerRadius: SummerRadius.sm)
                            .fill(Color.summerSurface)
                    )
                }

                Button {
                    viewModel.wsManager.serverURL = editingURL
                    viewModel.wsManager.pairingToken = editingToken
                    viewModel.disconnect()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        viewModel.connect()
                    }
                    HapticsEngine.shared.success()
                } label: {
                    Text("Save & Reconnect")
                        .font(SummerFont.body())
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, SummerSpacing.sm + 2)
                        .background(
                            Capsule().fill(
                                LinearGradient(colors: [.summerCyan, .summerPurple], startPoint: .leading, endPoint: .trailing)
                            )
                        )
                }
            }
            .padding(SummerSpacing.md)
            .glassmorphic(cornerRadius: SummerRadius.md, opacity: 0.08)
        }
    }

    // MARK: - Session Settings

    private var _sessionSection: some View {
        VStack(alignment: .leading, spacing: SummerSpacing.md) {
            _sectionHeader("Voice Settings", icon: "waveform")

            VStack(spacing: SummerSpacing.md) {
                // Voice mode picker
                VStack(alignment: .leading, spacing: SummerSpacing.xs) {
                    Text("Voice Activation")
                        .font(SummerFont.caption(12))
                        .foregroundStyle(.summerTextSecondary)

                    Picker("Voice Mode", selection: $viewModel.voiceMode) {
                        ForEach(VoiceMode.allCases, id: \.self) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .tint(.summerCyan)
                }

                // Interaction mode
                VStack(alignment: .leading, spacing: SummerSpacing.xs) {
                    Text("Default Mode")
                        .font(SummerFont.caption(12))
                        .foregroundStyle(.summerTextSecondary)

                    Picker("Mode", selection: $viewModel.interactionMode) {
                        ForEach(InteractionMode.allCases, id: \.self) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .tint(.summerCyan)
                }
            }
            .padding(SummerSpacing.md)
            .glassmorphic(cornerRadius: SummerRadius.md, opacity: 0.08)
        }
    }

    // MARK: - Google Section

    private var _googleSection: some View {
        VStack(alignment: .leading, spacing: SummerSpacing.md) {
            _sectionHeader("Google Account", icon: "person.circle")

            HStack {
                Image(systemName: viewModel.isGoogleAuthenticated ? "checkmark.circle.fill" : "xmark.circle")
                    .foregroundStyle(viewModel.isGoogleAuthenticated ? .summerSuccess : .summerError)

                Text(viewModel.isGoogleAuthenticated ? "Connected" : "Not connected")
                    .font(SummerFont.body())
                    .foregroundStyle(.summerTextPrimary)

                Spacer()

                if !viewModel.isGoogleAuthenticated {
                    Button {
                        viewModel.requestGoogleAuth()
                    } label: {
                        Text("Connect")
                            .font(SummerFont.caption())
                            .foregroundStyle(.summerCyan)
                            .padding(.horizontal, SummerSpacing.md)
                            .padding(.vertical, SummerSpacing.sm)
                            .background(Capsule().stroke(Color.summerCyan, lineWidth: 1))
                    }
                }
            }
            .padding(SummerSpacing.md)
            .glassmorphic(cornerRadius: SummerRadius.md, opacity: 0.08)
        }
    }

    // MARK: - About

    private var _aboutSection: some View {
        VStack(alignment: .leading, spacing: SummerSpacing.md) {
            _sectionHeader("About", icon: "info.circle")

            VStack(spacing: SummerSpacing.sm) {
                _aboutRow("App Version", value: "1.0.0")
                _aboutRow("Platform", value: "iOS \(UIDevice.current.systemVersion)")
                _aboutRow("Device", value: UIDevice.current.name)
                _aboutRow("Daemon", value: viewModel.daemonVersion.isEmpty ? "—" : "v\(viewModel.daemonVersion)")
            }
            .padding(SummerSpacing.md)
            .glassmorphic(cornerRadius: SummerRadius.md, opacity: 0.08)
        }
    }

    // MARK: - Helpers

    private func _sectionHeader(_ title: String, icon: String) -> some View {
        HStack(spacing: SummerSpacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(.summerCyan)
            Text(title)
                .font(SummerFont.caption())
                .foregroundStyle(.summerTextSecondary)
                .textCase(.uppercase)
                .tracking(1)
        }
    }

    private func _aboutRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(SummerFont.caption())
                .foregroundStyle(.summerTextSecondary)
            Spacer()
            Text(value)
                .font(SummerFont.mono(13))
                .foregroundStyle(.summerTextPrimary)
        }
    }

    // MARK: - Debug Console

    private var _debugSection: some View {
        VStack(alignment: .leading, spacing: SummerSpacing.md) {
            _sectionHeader("Debug Console", icon: "ant.circle")

            VStack(spacing: SummerSpacing.sm) {
                // Toggle + buttons row
                HStack {
                    Button {
                        withAnimation { showDebugConsole.toggle() }
                    } label: {
                        HStack(spacing: SummerSpacing.xs) {
                            Image(systemName: showDebugConsole ? "chevron.down" : "chevron.right")
                                .font(.system(size: 12))
                            Text("\(debugLog.entries.count) entries")
                                .font(SummerFont.caption(12))
                        }
                        .foregroundStyle(.summerTextSecondary)
                    }

                    Spacer()

                    // Copy all
                    Button {
                        UIPasteboard.general.string = debugLog.fullText
                        copiedLogs = true
                        HapticsEngine.shared.success()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            copiedLogs = false
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: copiedLogs ? "checkmark" : "doc.on.doc")
                                .font(.system(size: 12))
                            Text(copiedLogs ? "Copied!" : "Copy All")
                                .font(SummerFont.caption(12))
                        }
                        .foregroundStyle(copiedLogs ? .summerSuccess : .summerCyan)
                        .padding(.horizontal, SummerSpacing.sm)
                        .padding(.vertical, 4)
                        .background(Capsule().stroke(copiedLogs ? Color.summerSuccess : Color.summerCyan, lineWidth: 1))
                    }

                    // Clear
                    Button {
                        debugLog.clear()
                        HapticsEngine.shared.tap()
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 12))
                            .foregroundStyle(.summerError)
                            .padding(.horizontal, SummerSpacing.sm)
                            .padding(.vertical, 4)
                            .background(Capsule().stroke(Color.summerError, lineWidth: 1))
                    }
                }

                // Live state display
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: SummerSpacing.sm) {
                        _stateChip("Conn", viewModel.connectionState.rawValue,
                                   color: viewModel.connectionState.isConnected ? .summerSuccess : .summerError)
                        _stateChip("Session", viewModel.sessionState.rawValue,
                                   color: viewModel.sessionState.isActive ? .summerSuccess : .summerGold)
                        _stateChip("Orb", viewModel.orbState.rawValue,
                                   color: _orbColor)
                    }
                    HStack(spacing: SummerSpacing.sm) {
                        _stateChip("Mic", viewModel.audioEngine.isRecording ? "ON" : "OFF",
                                   color: viewModel.audioEngine.isRecording ? .summerSuccess : .summerTextSecondary)
                        _stateChip("Speaker", viewModel.audioEngine.isPlaying ? "ON" : "OFF",
                                   color: viewModel.audioEngine.isPlaying ? .summerPurple : .summerTextSecondary)
                        _stateChip("Mode", viewModel.voiceMode.rawValue, color: .summerCyan)
                    }
                }

                if showDebugConsole {
                    // Log entries
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 2) {
                                ForEach(debugLog.entries) { entry in
                                    Text(entry.formatted)
                                        .font(.system(size: 10, weight: .regular, design: .monospaced))
                                        .foregroundStyle(_logColor(entry.tag))
                                        .textSelection(.enabled)
                                        .id(entry.id)
                                }
                            }
                            .padding(SummerSpacing.sm)
                        }
                        .frame(maxHeight: 300)
                        .background(Color.black.opacity(0.6))
                        .clipShape(RoundedRectangle(cornerRadius: SummerRadius.sm))
                        .onChange(of: debugLog.entries.count) { _, _ in
                            if let last = debugLog.entries.last {
                                proxy.scrollTo(last.id, anchor: .bottom)
                            }
                        }
                    }
                }
            }
            .padding(SummerSpacing.md)
            .glassmorphic(cornerRadius: SummerRadius.md, opacity: 0.08)
        }
    }

    private func _stateChip(_ label: String, _ value: String, color: Color) -> some View {
        VStack(spacing: 1) {
            Text(label)
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .foregroundStyle(.summerTextSecondary)
            Text(value)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(color)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(RoundedRectangle(cornerRadius: 4).fill(color.opacity(0.1)))
    }

    private var _orbColor: Color {
        switch viewModel.orbState {
        case .idle: return .summerTextSecondary
        case .listening: return .summerCyan
        case .thinking: return .summerPurple
        case .speaking: return .summerGold
        case .error: return .summerError
        }
    }

    private func _logColor(_ tag: String) -> Color {
        switch tag {
        case "WS": return Color(hex: "4FC3F7")
        case "VM": return Color(hex: "81C784")
        case "Audio": return Color(hex: "FFB74D")
        case "Session": return Color(hex: "BA68C8")
        case "VAD": return Color(hex: "FF8A65")
        case "Turn": return Color(hex: "4DD0E1")
        case "Tool": return Color(hex: "AED581")
        case "Action": return Color(hex: "F06292")
        default: return Color(hex: "90A4AE")
        }
    }
}

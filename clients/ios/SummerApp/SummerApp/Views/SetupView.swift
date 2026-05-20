/**
 * SetupView.swift — First-Launch Pairing Screen
 *
 * Guides the user through connecting to the Summer daemon.
 * On success, saves IP + token to UserDefaults → navigates to MainView.
 */

import SwiftUI

struct SetupView: View {

    @AppStorage("daemonIP")     private var daemonIP:     String = ""
    @AppStorage("pairingToken") private var pairingToken: String = ""

    @State private var ipInput:      String = ""
    @State private var tokenInput:   String = ""
    @State private var isConnecting: Bool   = false
    @State private var errorMessage: String = ""
    @State private var showSuccess:  Bool   = false
    @State private var showToken:    Bool   = false

    var body: some View {
        ZStack {
            // Background
            LinearGradient(
                colors: [Color(hex: "#0D0D1A"), Color(hex: "#0F0A1E")],
                startPoint: .top, endPoint: .bottom
            ).ignoresSafeArea()

            ScrollView {
                VStack(spacing: 32) {

                    // ── Logo + Title ──────────────────────────────────────────
                    VStack(spacing: 12) {
                        // Orb preview
                        OrbView(state: .idle)
                            .frame(width: 80, height: 80)

                        Text("SUMMER")
                            .font(.system(size: 28, weight: .bold, design: .rounded))
                            .tracking(6)
                            .foregroundColor(.white)

                        Text("Pair with your Mac daemon")
                            .font(.system(size: 14))
                            .foregroundColor(.white.opacity(0.4))
                    }
                    .padding(.top, 60)

                    // ── Step 1: IP ────────────────────────────────────────────
                    stepCard(
                        number: "1",
                        title:  "Mac IP Address",
                        hint:   "Find it: System Settings → Wi-Fi → your network"
                    ) {
                        HStack {
                            Image(systemName: "wifi")
                                .foregroundColor(.white.opacity(0.4))
                                .frame(width: 20)

                            TextField("", text: $ipInput, prompt:
                                Text("192.168.1.5")
                                    .foregroundColor(.white.opacity(0.25))
                            )
                            .keyboardType(.numbersAndPunctuation)
                            .autocorrectionDisabled()
                            .foregroundColor(.white)
                        }
                        .padding(14)
                        .background(Color.white.opacity(0.05))
                        .cornerRadius(10)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Color.white.opacity(0.1), lineWidth: 1)
                        )
                    }

                    // ── Step 2: Token ─────────────────────────────────────────
                    stepCard(
                        number: "2",
                        title:  "Pairing Token",
                        hint:   "Run: node summer-daemon.js — token prints on first start"
                    ) {
                        HStack {
                            Image(systemName: "key.fill")
                                .foregroundColor(.white.opacity(0.4))
                                .frame(width: 20)

                            Group {
                                if showToken {
                                    TextField("", text: $tokenInput, prompt:
                                        Text("Paste token here")
                                            .foregroundColor(.white.opacity(0.25))
                                    )
                                } else {
                                    SecureField("", text: $tokenInput, prompt:
                                        Text("Paste token here")
                                            .foregroundColor(.white.opacity(0.25))
                                    )
                                }
                            }
                            .autocorrectionDisabled()
                            .foregroundColor(.white)

                            Button {
                                showToken.toggle()
                            } label: {
                                Image(systemName: showToken ? "eye.slash" : "eye")
                                    .foregroundColor(.white.opacity(0.3))
                                    .font(.system(size: 14))
                            }
                        }
                        .padding(14)
                        .background(Color.white.opacity(0.05))
                        .cornerRadius(10)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Color.white.opacity(0.1), lineWidth: 1)
                        )
                    }

                    // ── Error ─────────────────────────────────────────────────
                    if !errorMessage.isEmpty {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                            Text(errorMessage)
                        }
                        .font(.system(size: 13))
                        .foregroundColor(Color(hex: "#EF4444"))
                        .padding(12)
                        .background(Color(hex: "#EF4444").opacity(0.08))
                        .cornerRadius(10)
                        .padding(.horizontal, 4)
                    }

                    // ── Connect Button ────────────────────────────────────────
                    Button {
                        Task { await connect() }
                    } label: {
                        HStack(spacing: 10) {
                            if isConnecting {
                                ProgressView()
                                    .tint(.white)
                                    .scaleEffect(0.8)
                                Text("Connecting...")
                            } else if showSuccess {
                                Image(systemName: "checkmark.circle.fill")
                                Text("Connected!")
                            } else {
                                Image(systemName: "wifi")
                                Text("Connect to Summer")
                            }
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(
                            showSuccess
                                ? Color(hex: "#10B981")
                                : Color(hex: "#8B5CF6")
                        )
                        .cornerRadius(14)
                        .animation(.easeInOut(duration: 0.3), value: showSuccess)
                    }
                    .disabled(ipInput.isEmpty || tokenInput.isEmpty || isConnecting)
                    .opacity(ipInput.isEmpty || tokenInput.isEmpty ? 0.4 : 1.0)
                    .padding(.horizontal, 4)

                    // ── Help text ─────────────────────────────────────────────
                    VStack(spacing: 6) {
                        Text("Both Mac and iPhone must be on the same Wi-Fi")
                            .font(.system(size: 12))
                            .foregroundColor(.white.opacity(0.25))
                        Text("The daemon runs: npm run daemon:dev")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.white.opacity(0.2))
                    }
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 40)
                }
                .padding(.horizontal, 24)
            }
        }
    }

    // MARK: - Connect Action
    private func connect() async {
        errorMessage = ""
        isConnecting = true

        let error = await PairingHelper.testConnection(ip: ipInput, token: tokenInput)

        isConnecting = false

        if let error {
            errorMessage = error.localizedDescription
        } else {
            // Save credentials
            showSuccess   = true
            try? await Task.sleep(nanoseconds: 800_000_000) // show success briefly
            daemonIP      = ipInput
            pairingToken  = tokenInput
            // AppStorage change triggers root view to switch to MainView
        }
    }

    // MARK: - Step Card Helper
    @ViewBuilder
    private func stepCard<Content: View>(
        number: String,
        title:  String,
        hint:   String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                // Step number badge
                Text(number)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(Color(hex: "#8B5CF6"))
                    .frame(width: 20, height: 20)
                    .background(Color(hex: "#8B5CF6").opacity(0.15))
                    .clipShape(Circle())

                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white.opacity(0.85))
            }

            content()

            Text(hint)
                .font(.system(size: 11))
                .foregroundColor(.white.opacity(0.3))
        }
        .padding(16)
        .glassCard(cornerRadius: 14)
    }
}

#Preview {
    SetupView()
}

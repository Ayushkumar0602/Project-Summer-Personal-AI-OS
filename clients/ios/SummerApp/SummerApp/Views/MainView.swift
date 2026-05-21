/**
 * MainView.swift — Main Orb Screen
 *
 * Mirrors: src/renderer.js — the orb click handler + subtitle display
 *
 * Mac behavior mirrored:
 *   - Orb click when idle     → buildContextPayload() → startSession()  [renderer.js L90-106]
 *   - Orb click when active   → stopSession() → setOrbState('idle')     [renderer.js L78-88]
 *   - agentText display       → updateSubtitle(text)                    [session-events.js L102-104]
 *   - userText display        → updateUserSubtitle(text)                [session-events.js L106-108]
 *   - toolName display        → floatingToolStatus in Mac               [session-events.js L134-151]
 *   - Auto-start on appear    → for Back Tap / Shortcut launch
 */

import SwiftUI

struct MainView: View {
    var autoStart: Bool = false

    @StateObject private var client = SummerClient()
    private let daemonURL    = "wss://summer-brain.onrender.com"
    private let pairingToken = "Ayush_mac_token_9122"

    @State private var isBuilding = false   // context is being fetched

    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            // ── Background ────────────────────────────────────────────────────
            // Matches Mac app background: deep space dark
            backgroundGradient

            VStack(spacing: 0) {

                // ── Header ────────────────────────────────────────────────────
                headerBar
                    .padding(.top, 16)

                Spacer()

                // ── User transcript ───────────────────────────────────────────
                // Mirrors: updateUserSubtitle(text) in session-events.js
                if !client.userText.isEmpty {
                    Text(client.userText)
                        .font(.system(size: 14, weight: .regular))
                        .foregroundColor(.white.opacity(0.5))
                        .italic()
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 16)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                // ── The Orb ───────────────────────────────────────────────────
                // Mirrors: document.querySelector('.orb-container').addEventListener('click', ...)
                OrbView(state: client.sessionState)
                    .frame(width: 180, height: 180)
                    .onTapGesture {
                        Task { await handleOrbTap() }
                    }
                    .padding(.vertical, 8)

                // ── Status label ──────────────────────────────────────────────
                // Mirrors: setOrbState(state, subtitle)
                Text(client.sessionState.label)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.white.opacity(0.75))
                    .animation(.easeInOut(duration: 0.3), value: client.sessionState.label)

                Spacer()

                // ── Agent response text ───────────────────────────────────────
                // Mirrors: updateSubtitle(text) in session-events.js
                if !client.agentText.isEmpty {
                    agentResponseCard
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                        .padding(.horizontal, 20)
                        .padding(.bottom, 8)
                }

                // ── Tool status bar ───────────────────────────────────────────
                // Mirrors: floatingToolStatus in session-events.js
                if let tool = client.toolName {
                    toolStatusBar(name: tool)
                        .transition(.opacity)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 8)
                }

                // ── Bottom spacer ─────────────────────────────────────────────
                Color.clear.frame(height: 24)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: client.agentText)
        .animation(.easeInOut(duration: 0.2), value: client.toolName)
        .onChange(of: scenePhase) { newPhase in
            if newPhase == .background {
                if client.sessionState != .idle {
                    print("[MainView] Backgrounding: disconnecting session.")
                    client.disconnect()
                }
            }
        }
        .onAppear {
            // Auto-start from Back Tap / Siri Shortcut
            if autoStart {
                Task {
                    try? await Task.sleep(nanoseconds: 500_000_000) // 0.5s settle
                    await handleOrbTap()
                }
            }
        }
    }

    // MARK: - Orb Tap Handler
    // Mirrors: renderer.js orb click handler (lines 77–107)
    private func handleOrbTap() async {
        switch client.sessionState {

        // Not connected → build context → connect → start session
        // Mirrors: buildContextPayload() → liveAPI.startSession(contextPayload)
        case .idle, .error:
            isBuilding = true
            let context = await ContextBuilder().buildContextPayload()
            isBuilding  = false
            client.connect(url: daemonURL, token: pairingToken, contextPayload: context)

        // Active → stop
        // Mirrors: liveAPI.stopSession() + setOrbState('idle')
        case .listening, .thinking, .speaking:
            client.disconnect()

        // Connecting — ignore (mirrors: if (isConnecting) return;)
        case .connecting:
            break
        }
    }

    // MARK: - Sub-Views

    private var backgroundGradient: some View {
        LinearGradient(
            colors: [
                Color(hex: "#0D0D1A"),
                Color(hex: "#0F0A1E"),
                Color(hex: "#0A0D1F")
            ],
            startPoint: .topLeading,
            endPoint:   .bottomTrailing
        )
        .ignoresSafeArea()
    }

    private var headerBar: some View {
        HStack {
            // App name
            Text("SUMMER")
                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                .tracking(4)
                .foregroundColor(.white.opacity(0.4))

            Spacer()

            // Connection indicator
            HStack(spacing: 5) {
                Circle()
                    .fill(connectionDotColor)
                    .frame(width: 6, height: 6)
                Text(connectionLabel)
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.4))
            }
        }
        .padding(.horizontal, 24)
    }

    private var connectionDotColor: Color {
        switch client.sessionState {
        case .idle, .error:     return Color(hex: "#4A4A6A")
        case .connecting:       return Color(hex: "#F59E0B")
        default:                return Color(hex: "#10B981")
        }
    }

    private var connectionLabel: String {
        switch client.sessionState {
        case .idle:       return "OFFLINE"
        case .connecting: return "CONNECTING"
        case .error:      return "ERROR"
        default:          return "LIVE"
        }
    }

    private var agentResponseCard: some View {
        ScrollView {
            Text(client.agentText)
                .font(.system(size: 15, weight: .regular))
                .foregroundColor(.white.opacity(0.9))
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(16)
        }
        .frame(maxHeight: 160)
        .glassCard(cornerRadius: 16)
    }

    private func toolStatusBar(name: String) -> some View {
        HStack(spacing: 8) {
            // Spinning gear
            Image(systemName: "gear")
                .rotationEffect(.degrees(isBuilding ? 360 : 0))
                .animation(.linear(duration: 1.2).repeatForever(autoreverses: false), value: isBuilding)
                .foregroundColor(.orange)
                .font(.system(size: 12))

            Text(name)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundColor(.orange.opacity(0.9))

            Spacer()

            // Pulsing dot
            Circle()
                .fill(Color.orange)
                .frame(width: 5, height: 5)
                .opacity(0.8)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.orange.opacity(0.08))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.orange.opacity(0.2), lineWidth: 1)
        )
        .cornerRadius(10)
    }
}

#Preview {
    MainView()
}

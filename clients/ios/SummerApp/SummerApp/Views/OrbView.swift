/**
 * OrbView.swift — Animated Pulsing Orb
 *
 * Mirrors the Mac Electron app's orb visual.
 * States map 1:1 to setOrbState() colors:
 *   idle      → muted purple-grey
 *   listening → bright purple (the signature Summer purple)
 *   thinking  → amber/orange
 *   speaking  → emerald green
 *   error     → red
 */

import SwiftUI

struct OrbView: View {
    let state: SessionState

    @State private var pulseScale:   CGFloat = 1.0
    @State private var glowOpacity:  Double  = 0.4
    @State private var rotationAngle: Double = 0.0

    var body: some View {
        ZStack {
            // ── Outer glow rings (pulse when listening/speaking) ──────────────
            // Reduced from 3 to 2 rings for iPhone 11 performance
            ForEach(0..<2, id: \.self) { ring in
                Circle()
                    .stroke(
                        state.orbColor.opacity(0.25 - Double(ring) * 0.1),
                        lineWidth: 1.5
                    )
                    .scaleEffect(state.isPulsing ? pulseScale + CGFloat(ring) * 0.2 : 1.0)
                    .opacity(state.isPulsing ? 1.0 : 0.0)
                    .animation(
                        .easeInOut(duration: 1.4)
                            .repeatForever(autoreverses: true)
                            .delay(Double(ring) * 0.25),
                        value: pulseScale
                    )
            }

            // ── Rotating shimmer ring (always present) ────────────────────────
            Circle()
                .trim(from: 0, to: 0.65)
                .stroke(
                    LinearGradient(
                        colors: [state.orbColor.opacity(0.6), .clear],
                        startPoint: .topLeading,
                        endPoint:   .bottomTrailing
                    ),
                    style: StrokeStyle(lineWidth: 1.5, lineCap: .round)
                )
                .rotationEffect(.degrees(rotationAngle))
                .opacity(state == .idle ? 0.2 : 0.7)

            // ── Core orb — radial gradient ────────────────────────────────────
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            state.orbColor,
                            state.orbColor.opacity(0.6),
                            state.orbColor.opacity(0.1)
                        ],
                        center:      .center,
                        startRadius: 0,
                        endRadius:   75
                    )
                )
                // Single shadow instead of dual (saves GPU)
                .shadow(color: state.orbColor.opacity(0.5), radius: 30, x: 0, y: 0)

            // ── Inner highlight (depth illusion) ──────────────────────────────
            Circle()
                .fill(
                    RadialGradient(
                        colors: [Color.white.opacity(0.25), .clear],
                        center:      UnitPoint(x: 0.35, y: 0.3),
                        startRadius: 0,
                        endRadius:   40
                    )
                )

            // ── State icon ────────────────────────────────────────────────────
            stateIcon
                .font(.system(size: 28, weight: .light))
                .foregroundColor(.white.opacity(0.9))
        }
        // Rasterize into single GPU texture — massive perf win on iPhone 11
        .drawingGroup()
        .onAppear {
            startAnimations()
        }
        .onChange(of: state) { _ in
            startAnimations()
        }
        // Smooth color transition between states
        .animation(.easeInOut(duration: 0.5), value: state.orbColor)
    }

    // Symbol per state
    @ViewBuilder
    private var stateIcon: some View {
        switch state {
        case .idle:
            Image(systemName: "waveform")
        case .connecting:
            Image(systemName: "antenna.radiowaves.left.and.right")
        case .listening:
            Image(systemName: "mic.fill")
        case .thinking:
            Image(systemName: "brain")
        case .speaking:
            Image(systemName: "speaker.wave.3.fill")
        case .error:
            Image(systemName: "exclamationmark.triangle")
        }
    }

    private func startAnimations() {
        // Pulse animation — active when listening or speaking
        withAnimation(
            .easeInOut(duration: 1.4)
                .repeatForever(autoreverses: true)
        ) {
            pulseScale   = state.isPulsing ? 1.22 : 1.0
            glowOpacity  = state.isPulsing ? 0.7  : 0.3
        }

        // Continuous rotation for the shimmer ring
        withAnimation(
            .linear(duration: 4.0)
                .repeatForever(autoreverses: false)
        ) {
            rotationAngle = 360
        }
    }
}

#Preview {
    ZStack {
        Color(hex: "#0D0D1A").ignoresSafeArea()
        VStack(spacing: 40) {
            HStack(spacing: 30) {
                OrbView(state: .idle)      .frame(width: 100, height: 100)
                OrbView(state: .listening) .frame(width: 100, height: 100)
                OrbView(state: .thinking)  .frame(width: 100, height: 100)
            }
            HStack(spacing: 30) {
                OrbView(state: .speaking)  .frame(width: 100, height: 100)
                OrbView(state: .connecting).frame(width: 100, height: 100)
                OrbView(state: .error("!")).frame(width: 100, height: 100)
            }
        }
    }
}

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
 *
 * FIX LOG (2026-05-29):
 *   BUG 8 — startAnimations() was called on every state change via
 *            onChange(of: state). This stacked multiple `repeatForever`
 *            animations on top of each other — by the 5th state change,
 *            5 infinite animation loops were running simultaneously.
 *            Symptoms: visual jitter on the orb, GPU drain, battery drain.
 *
 *            Fix: Added `animationsStarted` flag. The rotation animation
 *            (linear, forever) only starts ONCE in onAppear. State changes
 *            only update pulseScale/glowOpacity with a simple withAnimation
 *            block, not a new repeatForever loop.
 */

import SwiftUI

struct OrbView: View {
    let state: SessionState

    @State private var pulseScale:       CGFloat = 1.0
    @State private var glowOpacity:      Double  = 0.4
    @State private var rotationAngle:    Double  = 0.0

    // BUG 8 FIX: Gate flag — ensures the rotation repeatForever animation
    // starts exactly once (on onAppear). Without this, every onChange(of: state)
    // call started a new forever loop, stacking dozens of animations.
    @State private var animationsStarted: Bool   = false

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
            // BUG 8 FIX: Start ALL animations exactly once here.
            // Previously, startAnimations() was called from both onAppear AND
            // onChange(of:state), which stacked infinite repeatForever loops.
            guard !animationsStarted else { return }
            animationsStarted = true
            startRotationAnimation()
            updatePulseAnimation()
        }
        .onChange(of: state) { _ in
            // BUG 8 FIX: On state change, ONLY update the pulse.
            // The rotation animation is already running — don't touch it.
            // Using a simple withAnimation (not repeatForever) so this is a
            // one-shot update, not a new infinite loop.
            updatePulseAnimation()
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

    // BUG 8 FIX: Rotation starts exactly once and runs forever.
    // Separated from pulse so state changes don't restart it.
    private func startRotationAnimation() {
        withAnimation(
            .linear(duration: 4.0)
                .repeatForever(autoreverses: false)
        ) {
            rotationAngle = 360
        }
    }

    // BUG 8 FIX: Pulse is updated via a non-infinite animation on state change.
    // The ForEach rings pick up the new pulseScale value through their own
    // .animation(.repeatForever) modifier — we don't need to create a new
    // forever loop every time the state changes, just change the target value.
    private func updatePulseAnimation() {
        withAnimation(.easeInOut(duration: 0.4)) {
            pulseScale  = state.isPulsing ? 1.22 : 1.0
            glowOpacity = state.isPulsing ? 0.7  : 0.3
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

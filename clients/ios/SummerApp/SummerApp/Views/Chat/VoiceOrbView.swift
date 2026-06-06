import SwiftUI

// MARK: - VoiceOrbView
/// Premium animated orb — the heart of Summer's voice interface.
/// Audio-reactive with state-driven colors and particle effects.
struct VoiceOrbView: View {
    let orbState: OrbState
    let micLevel: Float
    let onTap: () -> Void

    @State private var rotationAngle: Double = 0
    @State private var pulseScale: CGFloat = 1.0
    @State private var innerGlow: Double = 0.5
    @State private var particlePhase: Double = 0

    private var gradient: LinearGradient {
        switch orbState {
        case .idle:      return SummerGradients.orbIdle
        case .listening: return SummerGradients.orbListening
        case .thinking:  return SummerGradients.orbThinking
        case .speaking:  return SummerGradients.orbSpeaking
        case .error:     return LinearGradient(colors: [.summerError, .summerGold], startPoint: .top, endPoint: .bottom)
        }
    }

    private var orbSize: CGFloat {
        let base: CGFloat = 180
        let micBoost = CGFloat(micLevel) * 30
        return base + micBoost
    }

    var body: some View {
        ZStack {
            // Outer glow rings
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(gradient)
                    .frame(width: orbSize + CGFloat(i) * 40, height: orbSize + CGFloat(i) * 40)
                    .opacity(0.08 - Double(i) * 0.02)
                    .scaleEffect(pulseScale + CGFloat(i) * 0.05)
                    .blur(radius: CGFloat(i) * 8 + 4)
            }

            // Particle ring
            _ParticleRingView(
                orbState: orbState,
                phase: particlePhase,
                radius: orbSize / 2 + 30,
                particleCount: 12
            )

            // Main orb
            Circle()
                .fill(gradient)
                .frame(width: orbSize, height: orbSize)
                .shadow(color: _shadowColor.opacity(0.6), radius: 30, x: 0, y: 10)
                .overlay(
                    // Inner highlight
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [.white.opacity(innerGlow), .clear],
                                center: .init(x: 0.35, y: 0.3),
                                startRadius: 0,
                                endRadius: orbSize * 0.6
                            )
                        )
                )
                .overlay(
                    // Shimmer ring
                    Circle()
                        .stroke(
                            AngularGradient(
                                colors: [.white.opacity(0.4), .clear, .white.opacity(0.2), .clear],
                                center: .center,
                                startAngle: .degrees(rotationAngle),
                                endAngle: .degrees(rotationAngle + 360)
                            ),
                            lineWidth: 2
                        )
                        .frame(width: orbSize - 4, height: orbSize - 4)
                )
                .scaleEffect(pulseScale)

            // State icon
            _stateIcon
        }
        .onTapGesture {
            onTap()
        }
        .onAppear { _startAnimations() }
        .onChange(of: orbState) { _, _ in _updateAnimations() }
    }

    // MARK: - State Icon

    @ViewBuilder
    private var _stateIcon: some View {
        Group {
            switch orbState {
            case .idle:
                Image(systemName: "waveform")
                    .font(.system(size: 36, weight: .light))
            case .listening:
                Image(systemName: "mic.fill")
                    .font(.system(size: 32, weight: .medium))
                    .symbolEffect(.pulse)
            case .thinking:
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(.white)
                    .scaleEffect(1.5)
            case .speaking:
                Image(systemName: "speaker.wave.3.fill")
                    .font(.system(size: 32, weight: .medium))
                    .symbolEffect(.variableColor.iterative)
            case .error:
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 32, weight: .medium))
            }
        }
        .foregroundStyle(.white)
    }

    // MARK: - Animations

    private var _shadowColor: Color {
        switch orbState {
        case .idle:      return .summerCyan
        case .listening: return Color(hex: "00E5FF")
        case .thinking:  return .summerGold
        case .speaking:  return .summerSuccess
        case .error:     return .summerError
        }
    }

    private func _startAnimations() {
        // Rotation
        withAnimation(.linear(duration: 8).repeatForever(autoreverses: false)) {
            rotationAngle = 360
        }

        // Pulse
        _updateAnimations()

        // Particles
        withAnimation(.linear(duration: 12).repeatForever(autoreverses: false)) {
            particlePhase = .pi * 2
        }
    }

    private func _updateAnimations() {
        switch orbState {
        case .idle:
            withAnimation(.easeInOut(duration: 2.5).repeatForever(autoreverses: true)) {
                pulseScale = 1.05
                innerGlow = 0.3
            }
        case .listening:
            withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                pulseScale = 1.08
                innerGlow = 0.6
            }
        case .thinking:
            withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
                pulseScale = 0.95
                innerGlow = 0.5
            }
        case .speaking:
            withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                pulseScale = 1.1
                innerGlow = 0.7
            }
        case .error:
            withAnimation(.easeInOut(duration: 0.3).repeatCount(3, autoreverses: true)) {
                pulseScale = 0.9
                innerGlow = 0.8
            }
        }
    }
}

// MARK: - Particle Ring
struct _ParticleRingView: View {
    let orbState: OrbState
    let phase: Double
    let radius: CGFloat
    let particleCount: Int

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                let time = timeline.date.timeIntervalSinceReferenceDate

                for i in 0..<particleCount {
                    let angle = (Double(i) / Double(particleCount)) * .pi * 2 + time * 0.5
                    let wobble = sin(time * 2 + Double(i)) * 8
                    let r = radius + CGFloat(wobble)

                    let x = center.x + cos(angle) * r
                    let y = center.y + sin(angle) * r

                    let particleSize = CGFloat(3 + sin(time * 3 + Double(i)) * 2)
                    let opacity = 0.3 + sin(time * 2 + Double(i) * 0.5) * 0.3

                    let rect = CGRect(x: x - particleSize/2, y: y - particleSize/2, width: particleSize, height: particleSize)
                    context.opacity = opacity
                    context.fill(Circle().path(in: rect), with: .color(_particleColor))
                }
            }
        }
        .frame(width: radius * 2 + 40, height: radius * 2 + 40)
        .allowsHitTesting(false)
    }

    private var _particleColor: Color {
        switch orbState {
        case .idle:      return .summerCyan
        case .listening: return Color(hex: "00E5FF")
        case .thinking:  return .summerGold
        case .speaking:  return .summerSuccess
        case .error:     return .summerError
        }
    }
}

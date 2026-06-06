import SwiftUI

// MARK: - ContentView
/// Root tab view — Summer's iOS main navigation.
struct ContentView: View {
    @StateObject private var viewModel = SummerViewModel()
    @StateObject private var memoryViewModel = MemoryViewModel()
    @State private var selectedTab: Tab = .chat

    enum Tab: String, CaseIterable {
        case chat     = "Chat"
        case memory   = "Memory"
        case diary    = "Diary"
        case settings = "Settings"

        var icon: String {
            switch self {
            case .chat:     return "bubble.left.and.bubble.right.fill"
            case .memory:   return "brain.head.profile"
            case .diary:    return "book.fill"
            case .settings: return "gearshape.fill"
            }
        }
    }

    var body: some View {
        ZStack {
            Color.summerDeepSpace.ignoresSafeArea()

            VStack(spacing: 0) {
                // Content
                Group {
                    switch selectedTab {
                    case .chat:
                        ChatView(viewModel: viewModel)
                    case .memory:
                        MemoryGraphView(viewModel: memoryViewModel)
                    case .diary:
                        DiaryView(viewModel: memoryViewModel)
                    case .settings:
                        SettingsView(viewModel: viewModel)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                // Tab Bar
                _tabBar
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            memoryViewModel.wsManager = viewModel.wsManager
            _autoConnect()
        }
    }

    // MARK: - Custom Tab Bar

    private var _tabBar: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.self) { tab in
                Button {
                    withAnimation(.spring(response: 0.3)) {
                        selectedTab = tab
                    }
                    HapticsEngine.shared.selection()
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 20, weight: selectedTab == tab ? .semibold : .regular))
                            .foregroundStyle(selectedTab == tab ? .summerCyan : .summerTextSecondary)
                            .scaleEffect(selectedTab == tab ? 1.1 : 1.0)

                        Text(tab.rawValue)
                            .font(SummerFont.caption(10))
                            .foregroundStyle(selectedTab == tab ? .summerCyan : .summerTextSecondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, SummerSpacing.sm)
                }
            }
        }
        .padding(.horizontal, SummerSpacing.sm)
        .padding(.bottom, SummerSpacing.xs)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(
                    Rectangle()
                        .fill(Color.summerDeepSpace.opacity(0.6))
                )
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(Color.summerSurface.opacity(0.3))
                        .frame(height: 0.5)
                }
                .ignoresSafeArea(edges: .bottom)
        )
    }

    // MARK: - Auto Connect

    private func _autoConnect() {
        let token = viewModel.wsManager.pairingToken
        if !token.isEmpty {
            viewModel.connect()
        }
    }
}

#Preview {
    ContentView()
}

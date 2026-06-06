import SwiftUI

// MARK: - MemoryGraphView
/// Interactive knowledge graph visualization with force-directed layout.
struct MemoryGraphView: View {
    @ObservedObject var viewModel: MemoryViewModel

    var body: some View {
        ZStack {
            Color.summerDeepSpace.ignoresSafeArea()

            VStack(spacing: 0) {
                // Search bar
                _searchBar

                if viewModel.isLoading {
                    _loadingView
                } else if viewModel.nodes.isEmpty {
                    _emptyView
                } else {
                    _nodeListView
                }
            }
        }
        .onAppear {
            viewModel.requestGraph()
        }
        .sheet(item: $viewModel.selectedNode) { node in
            MemoryNodeDetail(node: node, viewModel: viewModel)
        }
    }

    // MARK: - Search Bar

    private var _searchBar: some View {
        HStack(spacing: SummerSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.summerTextSecondary)

            TextField("Search memories…", text: $viewModel.searchQuery)
                .font(SummerFont.body())
                .foregroundStyle(.summerTextPrimary)
                .tint(.summerCyan)
        }
        .padding(.horizontal, SummerSpacing.md)
        .padding(.vertical, SummerSpacing.sm + 2)
        .background(
            RoundedRectangle(cornerRadius: SummerRadius.md)
                .fill(Color.summerSurface)
        )
        .padding(.horizontal, SummerSpacing.md)
        .padding(.top, SummerSpacing.md)
    }

    // MARK: - Node List

    private var _nodeListView: some View {
        ScrollView {
            LazyVStack(spacing: SummerSpacing.sm) {
                // Stats header
                _statsHeader

                ForEach(viewModel.filteredNodes) { node in
                    _nodeCard(node)
                        .onTapGesture {
                            viewModel.selectedNode = node
                            HapticsEngine.shared.selection()
                        }
                }
            }
            .padding(.horizontal, SummerSpacing.md)
            .padding(.vertical, SummerSpacing.md)
        }
    }

    // MARK: - Stats Header

    private var _statsHeader: some View {
        HStack(spacing: SummerSpacing.lg) {
            _statPill(
                icon: "circle.hexagongrid.fill",
                label: "Nodes",
                value: "\(viewModel.nodes.count)",
                color: .summerCyan
            )

            _statPill(
                icon: "arrow.triangle.branch",
                label: "Connections",
                value: "\(viewModel.edges.count)",
                color: .summerPurple
            )

            let pinnedCount = viewModel.nodes.filter { $0.pinned == true }.count
            _statPill(
                icon: "pin.fill",
                label: "Pinned",
                value: "\(pinnedCount)",
                color: .summerGold
            )
        }
        .padding(.vertical, SummerSpacing.sm)
    }

    private func _statPill(icon: String, label: String, value: String, color: Color) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                Text(value)
                    .font(SummerFont.title(18))
                    .fontWeight(.bold)
            }
            .foregroundStyle(color)

            Text(label)
                .font(SummerFont.caption(11))
                .foregroundStyle(.summerTextSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SummerSpacing.sm)
        .glassmorphic(cornerRadius: SummerRadius.md, opacity: 0.08)
    }

    // MARK: - Node Card

    private func _nodeCard(_ node: MemoryNodeData) -> some View {
        HStack(spacing: SummerSpacing.md) {
            // Type indicator
            Circle()
                .fill(viewModel.colorForType(node.type))
                .frame(width: 10, height: 10)
                .shadow(color: viewModel.colorForType(node.type).opacity(0.5), radius: 4)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(node.label ?? "Unknown")
                        .font(SummerFont.body())
                        .foregroundStyle(.summerTextPrimary)
                        .fontWeight(.medium)

                    if node.pinned == true {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(.summerGold)
                    }
                }

                if let desc = node.description, !desc.isEmpty {
                    Text(desc)
                        .font(SummerFont.caption(12))
                        .foregroundStyle(.summerTextSecondary)
                        .lineLimit(2)
                }

                if let tags = node.tags, !tags.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(tags.prefix(3), id: \.self) { tag in
                            Text(tag)
                                .font(SummerFont.caption(10))
                                .foregroundStyle(.summerCyan)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(
                                    Capsule().fill(Color.summerCyan.opacity(0.15))
                                )
                        }
                    }
                }
            }

            Spacer()

            // Importance indicator
            if let importance = node.importance {
                VStack(spacing: 2) {
                    Text(String(format: "%.0f%%", importance * 100))
                        .font(SummerFont.mono(11))
                        .foregroundStyle(.summerTextSecondary)
                    Text("IMP")
                        .font(SummerFont.caption(9))
                        .foregroundStyle(.summerTextSecondary.opacity(0.6))
                }
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 12))
                .foregroundStyle(.summerTextSecondary.opacity(0.5))
        }
        .padding(SummerSpacing.md)
        .glassmorphic(cornerRadius: SummerRadius.md, opacity: 0.08)
    }

    // MARK: - States

    private var _loadingView: some View {
        VStack(spacing: SummerSpacing.md) {
            Spacer()
            ProgressView()
                .tint(.summerCyan)
                .scaleEffect(1.5)
            Text("Loading memories…")
                .font(SummerFont.caption())
                .foregroundStyle(.summerTextSecondary)
            Spacer()
        }
    }

    private var _emptyView: some View {
        VStack(spacing: SummerSpacing.md) {
            Spacer()
            Image(systemName: "brain.head.profile")
                .font(.system(size: 48))
                .foregroundStyle(.summerTextSecondary.opacity(0.4))
            Text("No memories yet")
                .font(SummerFont.body())
                .foregroundStyle(.summerTextSecondary)
            Text("Start a conversation with Summer to build your knowledge graph.")
                .font(SummerFont.caption())
                .foregroundStyle(.summerTextSecondary.opacity(0.6))
                .multilineTextAlignment(.center)
                .padding(.horizontal, SummerSpacing.xl)
            Spacer()
        }
    }
}

// MARK: - Memory Node Detail
struct MemoryNodeDetail: View {
    let node: MemoryNodeData
    @ObservedObject var viewModel: MemoryViewModel
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.summerDeepSpace.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: SummerSpacing.md) {
                        // Header
                        HStack(spacing: SummerSpacing.md) {
                            Circle()
                                .fill(viewModel.colorForType(node.type))
                                .frame(width: 16, height: 16)

                            Text(node.type?.capitalized ?? "Unknown Type")
                                .font(SummerFont.caption())
                                .foregroundStyle(viewModel.colorForType(node.type))
                                .padding(.horizontal, SummerSpacing.sm)
                                .padding(.vertical, 4)
                                .background(
                                    Capsule()
                                        .fill(viewModel.colorForType(node.type).opacity(0.15))
                                )
                        }

                        Text(node.label ?? "Untitled")
                            .font(SummerFont.headline(24))
                            .foregroundStyle(.summerTextPrimary)

                        if let desc = node.description, !desc.isEmpty {
                            Text(desc)
                                .font(SummerFont.body())
                                .foregroundStyle(.summerTextSecondary)
                        }

                        Divider().background(Color.summerSurface)

                        // Details
                        _detailRow("Importance", value: String(format: "%.0f%%", (node.importance ?? 0.5) * 100))
                        _detailRow("Source", value: node.source ?? "Unknown")
                        _detailRow("Pinned", value: (node.pinned ?? false) ? "Yes" : "No")

                        if let tags = node.tags, !tags.isEmpty {
                            VStack(alignment: .leading, spacing: SummerSpacing.sm) {
                                Text("Tags")
                                    .font(SummerFont.caption())
                                    .foregroundStyle(.summerTextSecondary)

                                FlowLayout(spacing: SummerSpacing.sm) {
                                    ForEach(tags, id: \.self) { tag in
                                        Text(tag)
                                            .font(SummerFont.caption(12))
                                            .foregroundStyle(.summerCyan)
                                            .padding(.horizontal, SummerSpacing.sm)
                                            .padding(.vertical, 4)
                                            .background(
                                                Capsule().fill(Color.summerCyan.opacity(0.15))
                                            )
                                    }
                                }
                            }
                        }

                        // Connected nodes
                        let connections = viewModel.edges.filter { $0.from == node.id || $0.to == node.id }
                        if !connections.isEmpty {
                            Divider().background(Color.summerSurface)

                            VStack(alignment: .leading, spacing: SummerSpacing.sm) {
                                Text("Connections (\(connections.count))")
                                    .font(SummerFont.caption())
                                    .foregroundStyle(.summerTextSecondary)

                                ForEach(connections) { edge in
                                    let targetId = edge.from == node.id ? edge.to : edge.from
                                    let targetNode = viewModel.nodes.first { $0.id == targetId }

                                    HStack(spacing: SummerSpacing.sm) {
                                        Image(systemName: "arrow.right")
                                            .font(.system(size: 10))
                                            .foregroundStyle(.summerPurple)

                                        Text(edge.label ?? "connected to")
                                            .font(SummerFont.caption(12))
                                            .foregroundStyle(.summerPurple)

                                        Text(targetNode?.label ?? targetId)
                                            .font(SummerFont.caption(12))
                                            .foregroundStyle(.summerTextPrimary)
                                    }
                                }
                            }
                        }
                    }
                    .padding(SummerSpacing.lg)
                }
            }
            .navigationTitle("Memory Detail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(.summerCyan)
                }
            }
            .toolbarBackground(Color.summerDeepSpace, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private func _detailRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(SummerFont.caption())
                .foregroundStyle(.summerTextSecondary)
            Spacer()
            Text(value)
                .font(SummerFont.body(14))
                .foregroundStyle(.summerTextPrimary)
        }
    }
}

// MARK: - FlowLayout
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = _computeLayout(subviews: subviews, proposal: proposal)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = _computeLayout(subviews: subviews, proposal: proposal)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func _computeLayout(subviews: Subviews, proposal: ProposedViewSize) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
    }
}

// MARK: - Diary View
struct DiaryView: View {
    @ObservedObject var viewModel: MemoryViewModel

    var body: some View {
        ZStack {
            Color.summerDeepSpace.ignoresSafeArea()

            if viewModel.diaryEntries.isEmpty {
                VStack(spacing: SummerSpacing.md) {
                    Image(systemName: "book.closed.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(.summerTextSecondary.opacity(0.4))
                    Text("No diary entries yet")
                        .font(SummerFont.body())
                        .foregroundStyle(.summerTextSecondary)
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: SummerSpacing.md) {
                        ForEach(viewModel.diaryEntries) { entry in
                            _diaryCard(entry)
                        }
                    }
                    .padding(SummerSpacing.md)
                }
            }
        }
        .onAppear {
            viewModel.requestDiary()
        }
    }

    private func _diaryCard(_ entry: DiaryEntryData) -> some View {
        VStack(alignment: .leading, spacing: SummerSpacing.sm) {
            HStack {
                Image(systemName: "calendar")
                    .font(.system(size: 14))
                    .foregroundStyle(.summerCyan)

                Text(entry.date ?? _formatTimestamp(entry.timestamp))
                    .font(SummerFont.caption())
                    .foregroundStyle(.summerCyan)

                Spacer()
            }

            Text(entry.entry ?? "")
                .font(SummerFont.body(14))
                .foregroundStyle(.summerTextPrimary)
                .lineLimit(nil)
        }
        .padding(SummerSpacing.md)
        .glassmorphic(cornerRadius: SummerRadius.md, opacity: 0.08)
    }

    private func _formatTimestamp(_ ts: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(ts) / 1000)
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

import SwiftUI

// MARK: - MemoryViewModel
@MainActor
final class MemoryViewModel: ObservableObject {
    @Published var nodes: [MemoryNodeData] = []
    @Published var edges: [MemoryEdgeData] = []
    @Published var diaryEntries: [DiaryEntryData] = []
    @Published var isLoading = false
    @Published var selectedNode: MemoryNodeData?
    @Published var searchQuery = ""

    weak var wsManager: WebSocketManager?

    var filteredNodes: [MemoryNodeData] {
        if searchQuery.isEmpty { return nodes }
        return nodes.filter { node in
            (node.label?.localizedCaseInsensitiveContains(searchQuery) ?? false) ||
            (node.description?.localizedCaseInsensitiveContains(searchQuery) ?? false) ||
            (node.tags?.contains { $0.localizedCaseInsensitiveContains(searchQuery) } ?? false)
        }
    }

    func requestGraph() {
        isLoading = true
        wsManager?.sendJSON(MessageBuilder.memoryGetGraph())
    }

    func requestDiary() {
        wsManager?.sendJSON(MessageBuilder.memoryGetDiary())
    }

    func handleGraphData(_ msg: SummerMessage) {
        nodes = msg.nodes ?? []
        edges = msg.edges ?? []
        isLoading = false
    }

    func handleDiaryData(_ msg: SummerMessage) {
        diaryEntries = msg.entries ?? []
    }

    // Node type color
    func colorForType(_ type: String?) -> Color {
        switch type {
        case "user_self":   return .summerGold
        case "identity":    return .summerGold
        case "episodic":    return .summerCyan
        case "semantic":    return .summerPurple
        case "procedural":  return .summerSuccess
        case "preference":  return Color(hex: "FF6B9D")
        case "person":      return Color(hex: "4FC3F7")
        case "project":     return Color(hex: "FFB74D")
        default:            return .summerTextSecondary
        }
    }
}

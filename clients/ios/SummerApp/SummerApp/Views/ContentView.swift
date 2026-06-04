import SwiftUI

struct RichMessageView: View {
    let message: String
    
    var body: some View {
        // A simple Markdown renderer placeholder for rich media
        VStack(alignment: .leading, spacing: 8) {
            Text(message)
                .padding()
                .background(Color.blue.opacity(0.1))
                .cornerRadius(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            
            // In a full implementation, parse Markdown here to detect image links,
            // and use AsyncImage to load them, e.g.:
            // if let imageUrl = extractImageUrl(from: message) {
            //     AsyncImage(url: imageUrl) { image in
            //         image.resizable().scaledToFit()
            //     } placeholder: {
            //         ProgressView()
            //     }
            // }
        }
    }
}

struct ContentView: View {
    @StateObject private var daemonClient = DaemonClient.shared
    @State private var inputText: String = ""
    
    var body: some View {
        VStack {
            // Header
            HStack {
                Text("Summer Brain")
                    .font(.headline)
                Spacer()
                Circle()
                    .fill(daemonClient.isConnected ? Color.green : Color.red)
                    .frame(width: 10, height: 10)
            }
            .padding()
            
            // Chat List
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(daemonClient.messages, id: \.self) { msg in
                        RichMessageView(message: msg)
                    }
                }
                .padding()
            }
            
            // Input Area
            HStack {
                TextField("Ask Summer...", text: $inputText)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                
                Button(action: sendMessage) {
                    Image(systemName: "paperplane.fill")
                        .foregroundColor(.blue)
                }
            }
            .padding()
        }
        .onAppear {
            requestPermissions()
        }
    }
    
    private func sendMessage() {
        guard !inputText.isEmpty else { return }
        // Emulate sending a chat message to the daemon
        let payload: [String: Any] = [
            "type": "user_message",
            "text": inputText
        ]
        daemonClient.send(json: payload)
        inputText = ""
    }
    
    private func requestPermissions() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            print("Notifications permission granted: \(granted)")
        }
    }
}

@main
struct SummerAppApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

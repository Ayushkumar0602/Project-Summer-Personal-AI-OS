import SwiftUI

@main
struct SummerApp: App {
    init() {
        // Request notification permissions on launch
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if granted {
                print("[App] Notification permission granted")
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

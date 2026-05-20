/**
 * SummerApp.swift — App Entry Point
 *
 * Mirrors: renderer.js initialization sequence
 * - If no daemon IP/token stored → show SetupView (first launch)
 * - If credentials exist → show MainView
 * - If launched via Back Tap shortcut → auto-start session on appear
 */

import SwiftUI

@main
struct SummerApp: App {

    // Written by SummerIntent when Back Tap / Shortcut fires
    @AppStorage("launchIntoSession") private var launchIntoSession: Bool = false

    var body: some Scene {
        WindowGroup {
            MainView(autoStart: launchIntoSession)
                .onAppear {
                    // Reset flag after consuming it
                    if launchIntoSession { launchIntoSession = false }
                }
        }
    }
}

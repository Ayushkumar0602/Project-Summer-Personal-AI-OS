import Foundation
import UIKit
import UserNotifications

class SkillRegistry {
    static let shared = SkillRegistry()
    
    // Explicitly declare what this iOS client can handle natively
    let supportedSkills = [
        "ios_open_url",
        "ios_set_brightness",
        "ios_show_notification",
        "ios_read_clipboard"
    ]
    
    func execute(action: String, args: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        switch action {
        case "ios_open_url":
            if let urlStr = args["url"] as? String, let url = URL(string: urlStr) {
                DispatchQueue.main.async {
                    UIApplication.shared.open(url)
                    completion(["status": "success", "message": "Opened URL"])
                }
            } else {
                completion(["error": "Invalid URL"])
            }
            
        case "ios_set_brightness":
            if let level = args["level"] as? Double {
                DispatchQueue.main.async {
                    UIScreen.main.brightness = CGFloat(max(0, min(100, level)) / 100.0)
                    completion(["status": "success", "message": "Brightness updated"])
                }
            } else {
                completion(["error": "Invalid brightness level"])
            }
            
        case "ios_show_notification":
            let title = args["title"] as? String ?? "Summer"
            let body = args["body"] as? String ?? ""
            
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            
            let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request) { error in
                if let error = error {
                    completion(["error": error.localizedDescription])
                } else {
                    completion(["status": "success", "message": "Notification shown"])
                }
            }
            
        case "ios_read_clipboard":
            DispatchQueue.main.async {
                if let text = UIPasteboard.general.string {
                    completion(["status": "success", "text": text])
                } else {
                    completion(["status": "success", "text": ""])
                }
            }
            
        default:
            completion(["error": "Unsupported skill: \(action)"])
        }
    }
}

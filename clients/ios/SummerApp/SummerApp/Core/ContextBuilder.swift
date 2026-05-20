/**
 * ContextBuilder.swift — Build Session Context Payload
 *
 * Mirrors: src/renderer/session/context-builder.js :: buildContextPayload()
 *
 * Mac flow:
 *   1. fetch('http://ip-api.com/json/')              → lat, lon, city
 *   2. fetch(Google Weather API, lat, lon)           → temp, condition
 *   3. window.liveAPI.getGoogleContext()             → calendar events
 *   4. return { weatherContext, googleContext? }
 *
 * iOS flow:
 *   1. CLLocationManager.requestLocation()           → lat, lon, city (GPS, more accurate)
 *   2. fetch(Google Weather API, lat, lon)           → temp, condition (same API)
 *   3. (skip googleContext for MVP — daemon has it from Mac auth)
 *   4. return { weatherContext }
 */

import Foundation

class ContextBuilder {

    // Same Google Weather API key as context-builder.js
    private let weatherAPIKey = "AIzaSyCfF0iZYvUiF_rB6DSKHAKwW0XYF5D3umQ"

    // MARK: - Build Context Payload
    // Mirrors: async function buildContextPayload() in context-builder.js
    func buildContextPayload() async -> [String: Any] {
        var payload: [String: Any] = [:]

        // Step 1: Get location
        // Mirrors: const ipRes = await fetch('http://ip-api.com/json/')
        //          const { lat, lon, city } = ipData
        guard let location = await LocationHelper.shared.getCurrentLocation() else {
            print("[ContextBuilder] Could not get location — no weather context")
            return payload
        }

        // Step 2: Fetch weather
        // Mirrors: fetch(`https://weather.googleapis.com/v1/currentConditions:lookup?
        //                 location.latitude=${lat}&location.longitude=${lon}&key=...`)
        if let weather = await fetchWeather(lat: location.latitude, lon: location.longitude) {
            let time = Date().formatted(date: .abbreviated, time: .shortened)

            // Mirrors: the exact weatherContext string format from context-builder.js
            payload["weatherContext"] = """
            User Location: \(location.city) (\(location.latitude), \(location.longitude))
            Current Local Time: \(time)
            Current Weather: \(weather.tempC)°C, \(weather.condition)
            """
            print("[ContextBuilder] Weather context built: \(location.city), \(weather.tempC)°C")
        }

        return payload
    }

    // MARK: - Google Weather API
    // Mirrors: the weather fetch in context-builder.js
    private struct WeatherResult { let tempC: String; let condition: String }

    private func fetchWeather(lat: Double, lon: Double) async -> WeatherResult? {
        let urlStr = "https://weather.googleapis.com/v1/currentConditions:lookup"
            + "?location.latitude=\(lat)&location.longitude=\(lon)&key=\(weatherAPIKey)"
        guard let url = URL(string: urlStr) else { return nil }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard
                let json      = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let tempDict  = json["temperature"] as? [String: Any],
                let degrees   = tempDict["degrees"] as? Double,
                let condition = (json["weatherCondition"] as? [String: Any])?["description"] as? [String: Any],
                let condText  = condition["text"] as? String
            else { return nil }

            return WeatherResult(
                tempC:     String(format: "%.0f", degrees),
                condition: condText
            )
        } catch {
            print("[ContextBuilder] Weather fetch error: \(error.localizedDescription)")
            return nil
        }
    }
}

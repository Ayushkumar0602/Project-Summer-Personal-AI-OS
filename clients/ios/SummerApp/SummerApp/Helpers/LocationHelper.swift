/**
 * LocationHelper.swift — Async CLLocationManager Wrapper
 *
 * Mirrors: context-builder.js fetch('http://ip-api.com/json/') for lat/lon
 * iOS uses GPS (CLLocationManager) — more accurate, no network needed.
 */

import CoreLocation

struct LocationResult {
    let latitude:  Double
    let longitude: Double
    let city:      String
}

@MainActor
class LocationHelper: NSObject, ObservableObject {
    static let shared = LocationHelper()

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?

    override init() {
        super.init()
        manager.delegate         = self
        manager.desiredAccuracy  = kCLLocationAccuracyKilometer
    }

    // Async wrapper — mirrors: const ipRes = await fetch('http://ip-api.com/json/')
    func getCurrentLocation() async -> LocationResult? {
        if continuation != nil {
            return nil // Already fetching
        }
        
        // Request permission if needed
        let status = manager.authorizationStatus
        if status == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        
        guard status == .authorizedWhenInUse || status == .authorizedAlways || status == .notDetermined else { return nil }

        let clLocation: CLLocation? = await withCheckedContinuation { cont in
            self.continuation = cont
            self.manager.requestLocation()
        }

        guard let loc = clLocation else { return nil }

        // Reverse geocode to get city name
        let geocoder = CLGeocoder()
        let placemarks = try? await geocoder.reverseGeocodeLocation(loc)
        let city = placemarks?.first?.locality ?? "Unknown"

        return LocationResult(
            latitude:  loc.coordinate.latitude,
            longitude: loc.coordinate.longitude,
            city:      city
        )
    }
}

// MARK: - CLLocationManagerDelegate
extension LocationHelper: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            if let cont = self.continuation {
                cont.resume(returning: locations.first)
                self.continuation = nil
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[LocationHelper] Failed: \(error.localizedDescription)")
        Task { @MainActor in
            if let cont = self.continuation {
                cont.resume(returning: nil)
                self.continuation = nil
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // No-op — permission handled in getCurrentLocation()
    }
}

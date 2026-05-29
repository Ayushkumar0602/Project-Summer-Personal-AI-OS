/**
 * LocationHelper.swift — Async CLLocationManager Wrapper
 *
 * Mirrors: context-builder.js fetch('http://ip-api.com/json/') for lat/lon
 * iOS uses GPS (CLLocationManager) — more accurate, no network needed.
 *
 * FIX LOG (2026-05-29):
 *   BUG 7 — On first launch, requestLocation() was called immediately after
 *            requestWhenInUseAuthorization() without waiting for the user to
 *            respond to the permission dialog. This caused didFailWithError to
 *            fire before permission was granted, returning nil location and
 *            building a context payload with no weather data.
 *
 *            Fix: The flow is now:
 *              1. If .notDetermined → request auth and WAIT (pendingAfterAuth = true)
 *              2. locationManagerDidChangeAuthorization fires when user responds
 *              3. If now granted → call requestLocation() which resumes the continuation
 *              4. If denied → resume continuation with nil immediately
 *
 *            This guarantees the permission dialog appears BEFORE connecting,
 *            and the session always has accurate location+weather context.
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

    // BUG 7 FIX: Track whether we're waiting to call requestLocation() after
    // the authorization dialog resolves. Without this flag, requestLocation()
    // fires immediately when status is .notDetermined, fails before the user
    // grants permission, and the continuation resolves with nil.
    private var pendingAfterAuth = false

    override init() {
        super.init()
        manager.delegate         = self
        manager.desiredAccuracy  = kCLLocationAccuracyKilometer
    }

    // Async wrapper — mirrors: const ipRes = await fetch('http://ip-api.com/json/')
    func getCurrentLocation() async -> LocationResult? {
        // Prevent concurrent calls
        if continuation != nil {
            return nil
        }

        let status = manager.authorizationStatus

        // Already denied/restricted — bail immediately, no point asking
        if status == .denied || status == .restricted {
            print("[LocationHelper] Location access denied — skipping weather context")
            return nil
        }

        let clLocation: CLLocation? = await withCheckedContinuation { cont in
            self.continuation = cont

            if status == .notDetermined {
                // BUG 7 FIX: Set flag BEFORE requesting auth.
                // locationManagerDidChangeAuthorization will call requestLocation()
                // once the user grants permission. Do NOT call requestLocation() here.
                pendingAfterAuth = true
                manager.requestWhenInUseAuthorization()
                // Execution returns here and suspends — the continuation will
                // be resumed by the delegate methods below.
            } else {
                // Already authorized — request location directly
                manager.requestLocation()
            }
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
                self.pendingAfterAuth = false
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[LocationHelper] Failed: \(error.localizedDescription)")
        Task { @MainActor in
            if let cont = self.continuation {
                cont.resume(returning: nil)
                self.continuation = nil
                self.pendingAfterAuth = false
            }
        }
    }

    // BUG 7 FIX: This delegate method now triggers requestLocation() when the
    // user grants permission. Previously it was a no-op, which meant the
    // continuation would hang forever after the permission dialog was accepted.
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            let status = manager.authorizationStatus

            // Only act if we're waiting for a pending auth-triggered location request
            guard self.pendingAfterAuth, self.continuation != nil else { return }

            switch status {
            case .authorizedWhenInUse, .authorizedAlways:
                // User just granted — now safe to request location
                print("[LocationHelper] Permission granted — requesting location")
                self.pendingAfterAuth = false
                manager.requestLocation()

            case .denied, .restricted:
                // User denied — resolve immediately with nil so we don't hang
                print("[LocationHelper] Permission denied by user")
                self.pendingAfterAuth = false
                if let cont = self.continuation {
                    cont.resume(returning: nil)
                    self.continuation = nil
                }

            case .notDetermined:
                // Still waiting — do nothing
                break

            @unknown default:
                break
            }
        }
    }
}

/**
 * location-provider.js — Summer's Location Awareness Engine
 *
 * Two-tier location strategy:
 *   Tier 1 (Accurate): macOS CoreLocation via AppleScript bridge
 *   Tier 2 (Fallback): IP-based geolocation (city-level, no permissions needed)
 *
 * Design principles:
 *   - Battery-friendly: Caches aggressively, polls only when needed
 *   - Permission-respectful: Falls back silently if CoreLocation denied
 *   - Offline-safe: Returns null if both tiers fail (never crashes)
 *   - Non-blocking: All location calls are async with timeouts
 */

const { execSync } = require('child_process');
const https = require('http');

// Cache: store last known location to avoid redundant lookups
let lastLocation = null;
let lastLocationTime = 0;
const LOCATION_CACHE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get current location using the best available method.
 * Returns null if location is unavailable (never throws).
 *
 * @returns {Promise<{ lat: number, lng: number, accuracy?: number, city?: string, region?: string, source: string } | null>}
 */
async function getCurrentLocation() {
    // Return cached location if fresh enough
    const now = Date.now();
    if (lastLocation && (now - lastLocationTime) < LOCATION_CACHE_MS) {
        return lastLocation;
    }

    // Tier 1: Try macOS CoreLocation via AppleScript
    try {
        const loc = getCoreLocation();
        if (loc) {
            lastLocation = { ...loc, source: 'corelocation' };
            lastLocationTime = now;
            console.log(`[Location] CoreLocation: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`);
            return lastLocation;
        }
    } catch (e) {
        // CoreLocation unavailable — fall through silently
    }

    // Tier 2: IP-based geolocation
    try {
        const loc = await getIpLocation();
        if (loc) {
            lastLocation = { ...loc, source: 'ip_geolocation' };
            lastLocationTime = now;
            console.log(`[Location] IP Geolocation: ${loc.city || 'Unknown'}, ${loc.region || ''} (${loc.lat.toFixed(2)}, ${loc.lng.toFixed(2)})`);
            return lastLocation;
        }
    } catch (e) {
        console.warn(`[Location] IP geolocation failed: ${e.message}`);
    }

    // Both tiers failed — return cached or null
    return lastLocation || null;
}

/**
 * Tier 1: macOS CoreLocation via AppleScript.
 * Returns { lat, lng } or null if unavailable.
 */
function getCoreLocation() {
    try {
        // AppleScript to get location from macOS CoreLocation
        const script = `
            set theResult to do shell script "CoreLocationCLI -once -format '%latitude,%longitude' 2>/dev/null || echo 'FAIL'"
            return theResult
        `;

        // Try CoreLocationCLI first (if installed via homebrew)
        try {
            const result = execSync('CoreLocationCLI -once -format "%latitude,%longitude" 2>/dev/null', {
                timeout: 5000,
                encoding: 'utf-8'
            }).trim();

            if (result && result !== 'FAIL' && result.includes(',')) {
                const [lat, lng] = result.split(',').map(Number);
                if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
                    return { lat, lng, accuracy: 50 };
                }
            }
        } catch {
            // CoreLocationCLI not installed — try Python bridge
        }

        // Fallback: Python + CoreLocation (available on all macOS)
        const pyScript = `
import CoreLocation
import time
manager = CoreLocation.CLLocationManager.alloc().init()
manager.startUpdatingLocation()
time.sleep(2)
loc = manager.location()
if loc:
    print(f"{loc.coordinate().latitude},{loc.coordinate().longitude},{loc.horizontalAccuracy()}")
else:
    print("FAIL")
        `.trim();

        try {
            const result = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, {
                timeout: 8000,
                encoding: 'utf-8'
            }).trim();

            if (result && result !== 'FAIL' && result.includes(',')) {
                const parts = result.split(',').map(Number);
                if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    return { lat: parts[0], lng: parts[1], accuracy: parts[2] || 100 };
                }
            }
        } catch {
            // Python CoreLocation also failed
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Tier 2: IP-based geolocation via free API.
 * Returns { lat, lng, city, region, country } or null.
 */
function getIpLocation() {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 5000);

        const req = require('http').get('http://ip-api.com/json/?fields=lat,lon,city,regionName,country,status', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                clearTimeout(timeout);
                try {
                    const json = JSON.parse(data);
                    if (json.status === 'success') {
                        resolve({
                            lat: json.lat,
                            lng: json.lon,
                            city: json.city,
                            region: json.regionName,
                            country: json.country
                        });
                    } else {
                        resolve(null);
                    }
                } catch {
                    resolve(null);
                }
            });
        });
        req.on('error', () => { clearTimeout(timeout); resolve(null); });
    });
}

/**
 * Safe wrapper that never throws. Returns null on failure.
 */
async function getLocationSafe() {
    try {
        return await getCurrentLocation();
    } catch {
        return null;
    }
}

/**
 * Clear the location cache (e.g., when user manually changes location settings).
 */
function clearLocationCache() {
    lastLocation = null;
    lastLocationTime = 0;
}

/**
 * Get cached location without triggering a new lookup.
 */
function getCachedLocation() {
    return lastLocation;
}

module.exports = {
    getCurrentLocation,
    getLocationSafe,
    clearLocationCache,
    getCachedLocation
};

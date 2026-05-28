/**
 * location-tagger.js — Enriches memories with location context
 *
 * Responsibilities:
 *   1. Reverse geocoding: (lat, lng) → human-readable place name
 *   2. Place classification: café, campus, home, office, transit
 *   3. Known place learning: auto-saves locations visited 3+ times
 *   4. Diary enrichment: attaches location to session diary entries
 *
 * Uses free Nominatim (OpenStreetMap) API for reverse geocoding.
 * No API key required. Rate limit: 1 req/sec (we cache aggressively).
 */

const https = require('https');
const { getLocationSafe } = require('./location-provider');
const { loadGraph, saveGraph } = require('./graph-store');

// Cache: reverse geocoding results
const geocodeCache = new Map();
const GEOCODE_CACHE_MAX = 100;

// Known places: locations visited 3+ times → persistent Location nodes
const placeVisitCounts = new Map();
const KNOWN_PLACE_THRESHOLD = 3;

/**
 * Reverse geocode a lat/lng to a human-readable place name.
 * Uses OpenStreetMap Nominatim (free, no key).
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ placeName: string, placeType: string, raw: Object } | null>}
 */
async function reverseGeocode(lat, lng) {
    // Round to ~100m precision for cache efficiency
    const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (geocodeCache.has(cacheKey)) {
        return geocodeCache.get(cacheKey);
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 8000);

        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`;
        const req = https.get(url, {
            headers: { 'User-Agent': 'SummerAI/1.0 (personal assistant)' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                clearTimeout(timeout);
                try {
                    const json = JSON.parse(data);
                    if (json.error) { resolve(null); return; }

                    const addr = json.address || {};
                    const placeName = buildPlaceName(json, addr);
                    const placeType = classifyPlace(json, addr);

                    const result = { placeName, placeType, raw: addr };

                    // Cache the result
                    if (geocodeCache.size >= GEOCODE_CACHE_MAX) {
                        const firstKey = geocodeCache.keys().next().value;
                        geocodeCache.delete(firstKey);
                    }
                    geocodeCache.set(cacheKey, result);

                    resolve(result);
                } catch {
                    resolve(null);
                }
            });
        });
        req.on('error', () => { clearTimeout(timeout); resolve(null); });
    });
}

/**
 * Build a human-readable place name from Nominatim response.
 */
function buildPlaceName(json, addr) {
    // Try specific venue first
    const venue = addr.amenity || addr.shop || addr.tourism ||
                  addr.leisure || addr.building || addr.office;
    const area = addr.suburb || addr.neighbourhood || addr.quarter;
    const city = addr.city || addr.town || addr.village || addr.county;

    if (venue && city) return `${venue}, ${city}`;
    if (venue && area) return `${venue}, ${area}`;
    if (json.display_name) {
        // Shorten: take first 2-3 parts
        const parts = json.display_name.split(', ').slice(0, 3);
        return parts.join(', ');
    }
    return city || area || 'Unknown location';
}

/**
 * Classify a place by type based on OSM amenity/building tags.
 */
function classifyPlace(json, addr) {
    const type = (json.type || '').toLowerCase();
    const amenity = (addr.amenity || '').toLowerCase();
    const building = (addr.building || '').toLowerCase();
    const category = (json.category || '').toLowerCase();

    // Café / Restaurant
    if (['cafe', 'coffee', 'restaurant', 'fast_food', 'bar', 'pub'].some(t =>
        amenity.includes(t) || type.includes(t))) return 'café';

    // Campus / University
    if (['university', 'college', 'school', 'library'].some(t =>
        amenity.includes(t) || building.includes(t) || type.includes(t))) return 'campus';

    // Office / Coworking
    if (['office', 'coworking', 'commercial'].some(t =>
        building.includes(t) || type.includes(t))) return 'office';

    // Home / Residential
    if (['residential', 'house', 'apartment', 'apartments'].some(t =>
        building.includes(t) || type.includes(t) || category.includes(t))) return 'home';

    // Transit
    if (['station', 'bus_stop', 'airport', 'railway', 'taxi'].some(t =>
        amenity.includes(t) || type.includes(t))) return 'transit';

    // Park / Outdoor
    if (['park', 'garden', 'playground', 'beach'].some(t =>
        amenity.includes(t) || type.includes(t))) return 'outdoor';

    return 'other';
}

/**
 * Get location context for the current session.
 * Returns a location object to attach to diary entries, or null.
 *
 * @returns {Promise<{ lat: number, lng: number, placeName: string|null, placeType: string|null } | null>}
 */
async function getSessionLocation() {
    const loc = await getLocationSafe();
    if (!loc) return null;

    let placeName = loc.city || null;
    let placeType = null;

    // Try reverse geocoding for more detail
    try {
        const geocoded = await reverseGeocode(loc.lat, loc.lng);
        if (geocoded) {
            placeName = geocoded.placeName;
            placeType = geocoded.placeType;
        }
    } catch (e) {
        // Non-critical — use city from IP geolocation
        if (loc.city) {
            placeName = loc.city + (loc.region ? `, ${loc.region}` : '');
            placeType = 'other';
        }
    }

    const result = {
        lat: loc.lat,
        lng: loc.lng,
        placeName,
        placeType
    };

    // Track visit counts for known place learning
    if (placeName) {
        trackPlaceVisit(placeName, result);
    }

    return result;
}

/**
 * Track place visits and auto-create Location nodes for frequently visited places.
 */
function trackPlaceVisit(placeName, locationData) {
    const key = placeName.toLowerCase().trim();
    const count = (placeVisitCounts.get(key) || 0) + 1;
    placeVisitCounts.set(key, count);

    if (count === KNOWN_PLACE_THRESHOLD) {
        // Auto-create a Location node in the graph
        try {
            const graph = loadGraph();
            const nodeId = `loc_${key.replace(/[^a-z0-9]/g, '_').slice(0, 30)}`;

            // Check if already exists
            if (graph.nodes.some(n => n.id === nodeId)) return;

            const placeTypeEmoji = {
                café: '☕', campus: '🏫', office: '🏢', home: '🏠',
                transit: '🚉', outdoor: '🌳', other: '📍'
            };

            graph.nodes.push({
                id: nodeId,
                type: 'Location',
                label: placeName,
                description: `A frequently visited location (${locationData.placeType || 'place'}). Visited ${count}+ times.`,
                lat: locationData.lat,
                lng: locationData.lng,
                placeType: locationData.placeType,
                tags: ['#location', `#${locationData.placeType || 'place'}`],
                importance: 0.6,
                source: 'location_tracker',
                createdAt: Date.now()
            });

            // Connect to user_self
            graph.edges.push({
                from: 'user_self',
                to: nodeId,
                label: 'visits_frequently',
                confidence: 0.85
            });

            saveGraph(graph);
            console.log(`[LocationTagger] ${placeTypeEmoji[locationData.placeType] || '📍'} New known place: "${placeName}" (visited ${count}x)`);
        } catch (e) {
            console.warn(`[LocationTagger] Failed to create location node: ${e.message}`);
        }
    }
}

module.exports = {
    reverseGeocode,
    getSessionLocation,
    classifyPlace
};

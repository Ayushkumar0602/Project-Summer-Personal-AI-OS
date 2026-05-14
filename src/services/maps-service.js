/**
 * Generates a free Google Maps embed URL for a query without requiring API Keys or Billing.
 */
async function findPlace(query) {
    // We use the standard Google Maps URL since we are opening it in the browser panel
    const mapUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    
    return {
        textSummary: `I have pulled up the map for "${query}" on your screen.`,
        mapUrl: mapUrl
    };
}

module.exports = { findPlace };

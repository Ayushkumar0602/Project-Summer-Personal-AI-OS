/**
 * Spotify integration pack (stub — invoke via integration_gateway).
 * Add SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET to .env when implementing OAuth.
 */

function createPack(manifest) {
    const hasCredentials = !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

    return {
        id: manifest.id || 'spotify',
        displayName: manifest.display_name,
        description: manifest.description,
        alwaysOn: false,
        available: hasCredentials,
        declarations: [],
        handlers: {},
        gatewayHandler: async (action, params) => {
            if (!hasCredentials) {
                return {
                    error: 'Spotify is not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env.',
                    status: 'not_configured',
                };
            }
            return {
                error: `Spotify action "${action}" is not implemented yet.`,
                status: 'not_implemented',
                params,
            };
        },
    };
}

module.exports = { createPack };

const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');
const Paths = require('../core/utils/paths');

// safeStorage is Electron-only — loaded lazily so daemon can run without it
function getSafeStorage() {
    try { return require('electron').safeStorage; } catch { return null; }
}
function getShell() {
    try { return require('electron').shell; } catch { return null; }
}

const TOKEN_PATH = path.join(Paths.userData(), 'google-token.enc');

// Scopes required for Calendar, Tasks, Gmail, Drive, Sheets, and YouTube
const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/youtube.force-ssl'
];

let oauth2Client = null;

/** Build OAuth2 client with the given callback port. */
function getClient(port) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
    }

    const callbackPort = port || parseInt(process.env.OAUTH_PORT || '3000');

    // Re-create if port changes (rare — only first call matters for stored token)
    if (!oauth2Client) {
        oauth2Client = new OAuth2Client(
            clientId,
            clientSecret,
            `http://localhost:${callbackPort}/oauth2callback`
        );
    }
    return oauth2Client;
}

/**
 * Checks if the user is authenticated.
 */
async function isAuthenticated() {
    try {
        if (!fs.existsSync(TOKEN_PATH)) return false;
        const encryptedToken = fs.readFileSync(TOKEN_PATH);
        const safeStorage = getSafeStorage();
        const decryptedStr = safeStorage
            ? safeStorage.decryptString(encryptedToken)
            : encryptedToken.toString('utf-8');
        const token = JSON.parse(decryptedStr);
        getClient().setCredentials(token);
        return true;
    } catch (e) {
        console.error('[GoogleAuth] Auth check failed:', e.message);
        return false;
    }
}

/**
 * Authenticates the user by opening a browser and spinning up a local OAuth callback server.
 * Automatically finds a free port so it never conflicts with other services.
 */
async function authenticate() {
    // Find a free port — prefer OAUTH_PORT env var, auto-increment if taken
    const preferredPort = parseInt(process.env.OAUTH_PORT || '3000');
    const port = await _findFreePort(preferredPort);

    // Reset so the new port gets baked into the redirect URI
    oauth2Client = null;
    const client = getClient(port);

    return new Promise((resolve, reject) => {
        // 1. Generate Auth URL
        const authorizeUrl = client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent',
        });

        // 2. Start a temporary local server to catch the OAuth redirect
        const server = http.createServer(async (req, res) => {
            try {
                if (req.url.startsWith('/oauth2callback')) {
                    const qs = new url.URL(req.url, `http://localhost:${port}`).searchParams;
                    const code = qs.get('code');
                    res.end('Authentication successful! You can close this tab and return to Summer.');
                    server.close();

                    // 3. Exchange code for tokens
                    const { tokens } = await client.getToken(code);
                    client.setCredentials(tokens);

                    // 4. Securely store the token using OS Keychain (safeStorage) or plaintext fallback
                    const safeStorage = getSafeStorage();
                    if (safeStorage && safeStorage.isEncryptionAvailable()) {
                        const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
                        fs.writeFileSync(TOKEN_PATH, encrypted);
                        console.log('[GoogleAuth] Token encrypted and saved successfully.');
                    } else {
                        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                        console.log('[GoogleAuth] Token saved as plaintext (safeStorage unavailable).');
                    }
                    resolve({ success: true });
                }
            } catch (err) {
                res.end('Authentication failed. Check console.');
                server.close();
                reject(err);
            }
        });

        server.on('error', (err) => reject(err));

        server.listen(port, () => {
            console.log(`[GoogleAuth] OAuth callback server on port ${port}`);
            // 5. Open the browser — Electron shell or macOS `open` command
            const shell = getShell();
            if (shell) {
                shell.openExternal(authorizeUrl);
            } else {
                require('child_process').exec(`open "${authorizeUrl}"`);
            }
        });
    });
}

/** Find a free TCP port starting from `preferred`. */
function _findFreePort(preferred) {
    return new Promise((resolve) => {
        const net = require('net');
        const tryPort = (p) => {
            const s = net.createServer();
            s.listen(p, () => { s.close(); resolve(p); });
            s.on('error', () => tryPort(p >= 65535 ? 3001 : p + 1));
        };
        tryPort(preferred);
    });
}

function logout() {
    if (fs.existsSync(TOKEN_PATH)) {
        fs.unlinkSync(TOKEN_PATH);
    }
    oauth2Client = null;
    return { success: true };
}

module.exports = {
    getClient,
    isAuthenticated,
    authenticate,
    logout,
};

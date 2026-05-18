const { OAuth2Client } = require('google-auth-library');
const { app, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

const TOKEN_PATH = path.join(app.getPath('userData'), 'google-token.enc');

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

function getClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
        throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env");
    }

    const port = process.env.OAUTH_PORT || 3000;

    if (!oauth2Client) {
        oauth2Client = new OAuth2Client(
            clientId,
            clientSecret,
            `http://localhost:${port}/oauth2callback`
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
        const decryptedStr = safeStorage.decryptString(encryptedToken);
        const token = JSON.parse(decryptedStr);
        
        getClient().setCredentials(token);
        
        // Check if token is expired, if so let the library auto-refresh it
        // Or we can proactively verify it. The library handles refresh automatically if refresh_token is present.
        return true;
    } catch (e) {
        console.error("[GoogleAuth] Auth check failed:", e.message);
        return false;
    }
}

/**
 * Authenticates the user by opening a browser window and spinning up a local server.
 */
async function authenticate() {
    return new Promise((resolve, reject) => {
        const client = getClient();
        const port = process.env.OAUTH_PORT || 3000;
        
        // 1. Generate Auth URL
        const authorizeUrl = client.generateAuthUrl({
            access_type: 'offline', // Required to get a refresh token
            scope: SCOPES,
            prompt: 'consent' // Forces consent to ensure we get a refresh token
        });

        // 2. Start a temporary local server to catch the redirect
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
                    
                    // 4. Securely store the token using OS Keychain (safeStorage)
                    if (safeStorage.isEncryptionAvailable()) {
                        const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
                        fs.writeFileSync(TOKEN_PATH, encrypted);
                        console.log("[GoogleAuth] Token encrypted and saved successfully.");
                        resolve({ success: true });
                    } else {
                        // Fallback if encryption unavailable (e.g. some Linux setups)
                        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                        console.log("[GoogleAuth] Token saved as plaintext (safeStorage unavailable).");
                        resolve({ success: true });
                    }
                }
            } catch (err) {
                res.end('Authentication failed. Check console.');
                server.close();
                reject(err);
            }
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`[GoogleAuth] Port ${port} is already in use. OAuth callback server could not start.`);
                reject(new Error(`Port ${port} is already in use. Please stop the conflicting service or configure OAUTH_PORT in .env.`));
            } else {
                reject(err);
            }
        });

        server.listen(port, () => {
            // 5. Open the browser
            shell.openExternal(authorizeUrl);
        });
    });
}

function logout() {
    if (fs.existsSync(TOKEN_PATH)) {
        fs.unlinkSync(TOKEN_PATH);
    }
    if (oauth2Client) {
        oauth2Client.setCredentials(null);
    }
    return { success: true };
}

module.exports = {
    getClient,
    isAuthenticated,
    authenticate,
    logout
};

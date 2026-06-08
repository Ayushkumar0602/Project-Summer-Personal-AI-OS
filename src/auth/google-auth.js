const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');
const Paths = require('../core/utils/paths');
const { supabase } = require('../services/supabase-client');

// safeStorage is Electron-only — loaded lazily so daemon can run without it
function getSafeStorage() {
    try { return require('electron').safeStorage; } catch { return null; }
}
function getShell() {
    try { return require('electron').shell; } catch { return null; }
}

const LEGACY_TOKEN_PATH = path.join(Paths.userData(), 'google-token.enc');
const ACCOUNTS_PATH = path.join(Paths.userData(), 'google-accounts.json');

// Scopes required for Calendar, Tasks, Gmail, Drive, Sheets, and YouTube
const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];

// Cache of OAuth2Client instances keyed by account ID
const clientCache = {};

// In-memory accounts list (loaded from disk)
let accounts = null;

// ── Account Storage ──────────────────────────────────────────────────────────

function _loadAccounts() {
    if (accounts !== null) return accounts;

    try {
        if (fs.existsSync(ACCOUNTS_PATH)) {
            accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
            return accounts;
        }
    } catch (e) {
        console.error('[GoogleAuth] Failed to load accounts file:', e.message);
    }

    // Attempt migration from legacy single-token file
    accounts = _migrateLegacyToken();
    return accounts;
}

function _saveAccounts() {
    try {
        fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
    } catch (e) {
        console.error('[GoogleAuth] Failed to save accounts:', e.message);
    }
    // Always sync all accounts to Supabase so any device can access them
    _syncAllAccountsToSupabase();
}

/**
 * Migrate old single-token format (google-token.enc) to the new multi-account format.
 */
function _migrateLegacyToken() {
    let token = null;

    try {
        if (fs.existsSync(LEGACY_TOKEN_PATH)) {
            const rawBuffer = fs.readFileSync(LEGACY_TOKEN_PATH);

            // Try safeStorage decryption (Electron context)
            const safeStorage = getSafeStorage();
            if (safeStorage && safeStorage.isEncryptionAvailable()) {
                try {
                    const decrypted = safeStorage.decryptString(rawBuffer);
                    token = JSON.parse(decrypted);
                } catch { /* safeStorage failed — try plaintext below */ }
            }

            // Try plaintext JSON (daemon context)
            if (!token) {
                try {
                    token = JSON.parse(rawBuffer.toString('utf-8'));
                } catch {
                    console.error('[GoogleAuth] Legacy token unreadable. Skipping migration.');
                }
            }
        }
    } catch (e) {
        console.error('[GoogleAuth] Legacy migration error:', e.message);
    }

    if (token) {
        // Create a migrated account entry
        const migratedAccount = {
            id: _generateAccountId(),
            email: 'Primary Account (migrated)',
            tokens: token,
            isPrimary: true,
            addedAt: new Date().toISOString(),
        };

        const accts = [migratedAccount];

        // Try to fetch the real email for the migrated account
        _resolveAccountEmail(migratedAccount).catch(() => {});

        // Clean up legacy file
        try { fs.unlinkSync(LEGACY_TOKEN_PATH); } catch {}

        // Save new format
        accounts = accts;
        _saveAccounts();
        console.log('[GoogleAuth] ✅ Migrated legacy token to multi-account format.');
        return accts;
    }

    return [];
}

function _generateAccountId() {
    return 'acct_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * Resolves the email for an account by calling the Google userinfo endpoint.
 */
async function _resolveAccountEmail(account) {
    try {
        const client = _getClientForAccount(account);
        client.setCredentials(account.tokens);

        const { google } = require('googleapis');
        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const { data } = await oauth2.userinfo.get();

        if (data.email) {
            account.email = data.email;
            _saveAccounts();
            console.log(`[GoogleAuth] Resolved email for account: ${data.email}`);
        }
    } catch (e) {
        console.warn('[GoogleAuth] Could not resolve email:', e.message);
    }
}

// ── OAuth2 Client Management ─────────────────────────────────────────────────

function _getClientForAccount(account, port) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
    }

    const callbackPort = port || parseInt(process.env.OAUTH_PORT || '3000');

    if (!clientCache[account.id]) {
        clientCache[account.id] = new OAuth2Client(
            clientId,
            clientSecret,
            `http://localhost:${callbackPort}/oauth2callback`
        );
    }

    return clientCache[account.id];
}

/**
 * Get the OAuth2 client for a specific account or the primary account.
 * @param {string} [accountId] - specific account ID, or null for primary
 */
function getClient(accountId) {
    const accts = _loadAccounts();
    let account;

    if (accountId) {
        account = accts.find(a => a.id === accountId);
    } else {
        account = accts.find(a => a.isPrimary) || accts[0];
    }

    if (!account) {
        throw new Error('No Google account connected. Please connect one in Settings → Integrations.');
    }

    const client = _getClientForAccount(account);
    client.setCredentials(account.tokens);
    return client;
}

/**
 * Returns a client for a specific account by ID.
 * Throws if account not found.
 */
function getClientForAccount(accountId) {
    return getClient(accountId);
}

// ── Authentication Checks ────────────────────────────────────────────────────

/**
 * Checks if any account (or a specific account) is authenticated.
 * @param {string} [accountId] - Check specific account, or primary if omitted
 */
async function isAuthenticated(accountId) {
    try {
        const accts = _loadAccounts();
        if (accts.length === 0) {
            // Fallback: try Supabase
            return await _checkSupabaseAuth();
        }

        let account;
        if (accountId) {
            account = accts.find(a => a.id === accountId);
        } else {
            account = accts.find(a => a.isPrimary) || accts[0];
        }

        if (!account || !account.tokens) return false;

        const client = _getClientForAccount(account);
        client.setCredentials(account.tokens);
        return true;
    } catch (e) {
        console.error('[GoogleAuth] Auth check failed:', e.message);
        return false;
    }
}

async function _checkSupabaseAuth() {
    if (!supabase) return false;
    try {
        // Strategy 1: Try loading all accounts from Supabase (new format)
        const { data: allData } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'google_accounts')
            .single();
        if (allData?.value) {
            const cloudAccounts = typeof allData.value === 'string' ? JSON.parse(allData.value) : allData.value;
            if (Array.isArray(cloudAccounts) && cloudAccounts.length > 0) {
                accounts = cloudAccounts;
                // Save locally (but skip Supabase sync since we just loaded from there)
                try { fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2)); } catch {}
                console.log(`[GoogleAuth] ✅ Loaded ${cloudAccounts.length} account(s) from Supabase cloud store.`);
                return true;
            }
        }

        // Strategy 2: Fallback to legacy single-token format in Supabase
        const { data: legacyData } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'google_oauth_token')
            .single();
        if (legacyData?.value) {
            const token = typeof legacyData.value === 'string' ? JSON.parse(legacyData.value) : legacyData.value;
            const migratedAccount = {
                id: _generateAccountId(),
                email: 'Cloud Account (migrated)',
                tokens: token,
                isPrimary: true,
                addedAt: new Date().toISOString(),
            };
            accounts = [migratedAccount];
            _saveAccounts(); // This will also sync to Supabase in new format
            _resolveAccountEmail(migratedAccount).catch(() => {});
            // Clean up legacy key
            supabase.from('app_settings').delete().eq('key', 'google_oauth_token').catch(() => {});
            console.log('[GoogleAuth] ✅ Migrated legacy Supabase token to multi-account format.');
            return true;
        }
    } catch (e) {
        console.debug('[GoogleAuth] Supabase token fetch skipped:', e.message);
    }
    return false;
}

// ── Account Management ───────────────────────────────────────────────────────

/**
 * Returns all connected Google accounts.
 */
function getAccounts() {
    const accts = _loadAccounts();
    return accts.map(a => ({
        id: a.id,
        email: a.email,
        isPrimary: a.isPrimary,
        addedAt: a.addedAt,
    }));
}

/**
 * Sets a specific account as the primary account.
 */
function setPrimaryAccount(accountId) {
    const accts = _loadAccounts();
    const target = accts.find(a => a.id === accountId);
    if (!target) throw new Error('Account not found.');

    accts.forEach(a => { a.isPrimary = false; });
    target.isPrimary = true;
    _saveAccounts();

    return { success: true, email: target.email };
}

/**
 * Authenticates a new Google account via OAuth browser flow.
 * If the same email is already connected, it updates the tokens instead.
 */
async function authenticate() {
    const preferredPort = parseInt(process.env.OAUTH_PORT || '3000');
    const port = await _findFreePort(preferredPort);

    return new Promise((resolve, reject) => {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            return reject(new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env'));
        }

        const tempClient = new OAuth2Client(
            clientId,
            clientSecret,
            `http://localhost:${port}/oauth2callback`
        );

        const authorizeUrl = tempClient.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent',
        });

        const server = http.createServer(async (req, res) => {
            try {
                if (req.url.startsWith('/oauth2callback')) {
                    const qs = new url.URL(req.url, `http://localhost:${port}`).searchParams;
                    const code = qs.get('code');
                    res.end('Authentication successful! You can close this tab and return to Summer.');
                    server.close();

                    // Exchange code for tokens
                    const { tokens } = await tempClient.getToken(code);
                    tempClient.setCredentials(tokens);

                    // Fetch the user's email
                    let email = 'Unknown Account';
                    try {
                        const { google } = require('googleapis');
                        const oauth2 = google.oauth2({ version: 'v2', auth: tempClient });
                        const { data } = await oauth2.userinfo.get();
                        if (data.email) email = data.email;
                    } catch (e) {
                        console.warn('[GoogleAuth] Could not fetch userinfo:', e.message);
                    }

                    // Load existing accounts
                    const accts = _loadAccounts();

                    // Check if this email is already connected
                    const existing = accts.find(a => a.email === email);

                    if (existing) {
                        // Update tokens for existing account
                        existing.tokens = tokens;
                        // Re-create cached client with new port
                        delete clientCache[existing.id];
                        console.log(`[GoogleAuth] ✅ Updated tokens for existing account: ${email}`);
                    } else {
                        // Add as new account
                        const isFirst = accts.length === 0;
                        const newAccount = {
                            id: _generateAccountId(),
                            email,
                            tokens,
                            isPrimary: isFirst, // First account is automatically primary
                            addedAt: new Date().toISOString(),
                        };
                        accts.push(newAccount);
                        console.log(`[GoogleAuth] ✅ Added new account: ${email} (primary: ${isFirst})`);
                    }

                    accounts = accts;
                    _saveAccounts(); // Also syncs all accounts to Supabase

                    resolve({ success: true, email });
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

/** Sync ALL accounts to Supabase so any device can access them. */
async function _syncAllAccountsToSupabase() {
    if (!supabase) return;
    try {
        const accts = accounts || [];
        const { error } = await supabase
            .from('app_settings')
            .upsert({
                key: 'google_accounts',
                value: JSON.stringify(accts),
                updated_at: new Date().toISOString(),
            }, { onConflict: 'key' });
        if (error) throw error;
        console.log(`[GoogleAuth] ✅ All ${accts.length} account(s) synced to Supabase.`);
    } catch (e) {
        console.warn('[GoogleAuth] ⚠️  Failed to sync accounts to Supabase:', e.message);
    }
}

/**
 * Logout a specific account, or all accounts if no ID given.
 */
function logout(accountId) {
    const accts = _loadAccounts();

    if (accountId) {
        // Remove specific account
        const idx = accts.findIndex(a => a.id === accountId);
        if (idx !== -1) {
            const removed = accts.splice(idx, 1)[0];
            delete clientCache[removed.id];

            // If the removed account was primary and others remain, promote the first one
            if (removed.isPrimary && accts.length > 0) {
                accts[0].isPrimary = true;
            }

            accounts = accts;
            _saveAccounts();
            console.log(`[GoogleAuth] Removed account: ${removed.email}`);
        }
    } else {
        // Remove all accounts (legacy behavior)
        accounts = [];
        Object.keys(clientCache).forEach(k => delete clientCache[k]);
        _saveAccounts();

        // Also clean up legacy file if it somehow exists
        if (fs.existsSync(LEGACY_TOKEN_PATH)) {
            try { fs.unlinkSync(LEGACY_TOKEN_PATH); } catch {}
        }
    }

    // _saveAccounts() already synced the updated list to Supabase
    return { success: true };
}

/**
 * Returns all account IDs (useful for iterating across all accounts).
 */
function getAllAccountIds() {
    const accts = _loadAccounts();
    return accts.map(a => a.id);
}

/**
 * Returns the primary account's ID, or null if none.
 */
function getPrimaryAccountId() {
    const accts = _loadAccounts();
    const primary = accts.find(a => a.isPrimary) || accts[0];
    return primary ? primary.id : null;
}

/**
 * Returns account info by ID.
 */
function getAccountInfo(accountId) {
    const accts = _loadAccounts();
    const account = accts.find(a => a.id === accountId);
    if (!account) return null;
    return { id: account.id, email: account.email, isPrimary: account.isPrimary, addedAt: account.addedAt };
}

module.exports = {
    getClient,
    getClientForAccount,
    isAuthenticated,
    authenticate,
    logout,
    getAccounts,
    setPrimaryAccount,
    getAllAccountIds,
    getPrimaryAccountId,
    getAccountInfo,
};

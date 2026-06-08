/**
 * Google Workspace authentication IPC handlers.
 * Supports multi-account management.
 */

const googleAuth = require('../../auth/google-auth');
const googleService = require('../../services/google-service');

function registerGoogleIpc(ipcMain) {
    // Authenticate (add) a new Google account
    ipcMain.handle('authenticate-google', async () => {
        try {
            const result = await googleAuth.authenticate();
            return { success: true, email: result.email };
        } catch (e) {
            return { success: false, message: e.message };
        }
    });

    // Logout a specific account by ID, or all accounts if no ID
    ipcMain.handle('logout-google', (event, accountId) => googleAuth.logout(accountId || null));

    // Logout a specific account (explicit)
    ipcMain.handle('logout-google-account', (event, accountId) => {
        if (!accountId) return { success: false, message: 'No accountId provided.' };
        return googleAuth.logout(accountId);
    });

    // Check if any account (or a specific account) is authenticated
    ipcMain.handle('check-google-auth', async () => googleAuth.isAuthenticated());

    // Get daily briefing context from primary account
    ipcMain.handle('get-google-context', async () => googleService.getDailyBriefingContext());

    // List all connected Google accounts
    ipcMain.handle('get-google-accounts', () => googleAuth.getAccounts());

    // Set primary account
    ipcMain.handle('set-primary-google-account', (event, accountId) => {
        try {
            return googleAuth.setPrimaryAccount(accountId);
        } catch (e) {
            return { success: false, message: e.message };
        }
    });
}

module.exports = { registerGoogleIpc };

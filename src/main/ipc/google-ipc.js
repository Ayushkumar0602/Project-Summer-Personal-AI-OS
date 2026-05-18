/**
 * Google Workspace authentication IPC handlers.
 */

const googleAuth = require('../../auth/google-auth');
const googleService = require('../../services/google-service');

function registerGoogleIpc(ipcMain) {
    ipcMain.handle('authenticate-google', async () => {
        try {
            await googleAuth.authenticate();
            return { success: true };
        } catch (e) {
            return { success: false, message: e.message };
        }
    });

    ipcMain.handle('logout-google', () => googleAuth.logout());

    ipcMain.handle('check-google-auth', async () => googleAuth.isAuthenticated());

    ipcMain.handle('get-google-context', async () => googleService.getDailyBriefingContext());
}

module.exports = { registerGoogleIpc };

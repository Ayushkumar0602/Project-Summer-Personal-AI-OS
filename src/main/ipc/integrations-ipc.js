/**
 * IPC for integration / tool-router preferences.
 */

const { loadConfig, saveConfig, invalidateConfigCache: invalidateUserConfigCache } = require('../../tools/user-integrations-config');
const { invalidateDeclarationCache, getRouterStats, buildToolContext } = require('../../tools/tool-registry');
const loader = require('../../tools/integration-loader');
const googleAuth = require('../../auth/google-auth');

function registerIntegrationsIpc(ipcMain) {
    ipcMain.handle('get-integrations-config', () => loadConfig());

    ipcMain.handle('set-integrations-config', (event, updates) => {
        const next = saveConfig(updates);
        invalidateUserConfigCache();
        invalidateDeclarationCache();
        return next;
    });

    ipcMain.handle('get-integrations-catalog', () => loader.listPackCatalog());

    ipcMain.handle('get-tool-router-stats', async (event, contextPayload) => {
        let googleAuthenticated = false;
        try {
            googleAuthenticated = await googleAuth.isAuthenticated();
        } catch (e) { /* ignore */ }
        const toolContext = buildToolContext({ contextPayload, googleAuthenticated });
        return getRouterStats(toolContext);
    });
}

module.exports = { registerIntegrationsIpc };

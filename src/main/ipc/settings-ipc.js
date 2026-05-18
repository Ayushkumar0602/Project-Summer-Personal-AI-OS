/**
 * Settings and permissions IPC handlers.
 */

const { shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const Paths = require('../../core/utils/paths');
const { loadPermissions, revokePermission, revokeAllPermissions } = require('../../settings/permissions-store');

// We read the pairing token to show in the Devices tab
let _daemonStatusCallback = null;

function setDaemonStatusCallback(cb) { _daemonStatusCallback = cb; }

function registerSettingsIpc(ipcMain) {
    ipcMain.handle('get-permissions', () => loadPermissions());

    ipcMain.handle('revoke-permission', (event, toolName) => {
        if (toolName === '__open_system_prefs__') {
            shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy');
            return { success: true };
        }
        revokePermission(toolName);
        return { success: true };
    });

    ipcMain.handle('revoke-all-permissions', () => {
        revokeAllPermissions();
        return { success: true };
    });

    ipcMain.handle('get-audit-logs', () => {
        const LOG_DIR = Paths.auditLogs();
        try {
            if (!fs.existsSync(LOG_DIR)) return [];
            const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
            if (files.length === 0) return [];
            const latestFile = path.join(LOG_DIR, files[0]);
            const content = fs.readFileSync(latestFile, 'utf-8');
            return content.trim().split('\n').filter(Boolean).map(line => {
                try { return JSON.parse(line); } catch { return null; }
            }).filter(Boolean);
        } catch (e) {
            console.error('[Settings] Failed to read audit logs:', e.message);
            return [];
        }
    });

    // ── Daemon / Devices tab ──────────────────────────────────────────────────
    ipcMain.handle('get-daemon-status', () => {
        if (_daemonStatusCallback) return _daemonStatusCallback();
        return { status: 'unknown', clients: [] };
    });

    ipcMain.handle('get-pairing-token', () => {
        try {
            const tokenPath = Paths.pairingToken();
            if (fs.existsSync(tokenPath)) {
                return { token: fs.readFileSync(tokenPath, 'utf8').trim() };
            }
        } catch (e) { /* ignore */ }
        return { token: null };
    });
}

module.exports = { registerSettingsIpc, setDaemonStatusCallback };

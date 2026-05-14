/**
 * permissions-store.js — Persistent storage for user-approved OS permissions.
 * 
 * When a dangerous action is confirmed once via dialog, the permission is
 * saved here. Next time, the action executes immediately without asking.
 * Permissions can be revoked from the Settings window.
 */

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PERMISSIONS_FILE = path.join(app.getPath('userData'), 'os-permissions.json');

/**
 * Load all saved permissions. Returns an object like:
 * { "os_quit_app": { granted: true, grantedAt: "...", label: "Quit Applications" }, ... }
 */
function loadPermissions() {
    try {
        if (fs.existsSync(PERMISSIONS_FILE)) {
            return JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('[Permissions] Failed to load:', e.message);
    }
    return {};
}

/**
 * Save the entire permissions object to disk.
 */
function savePermissions(perms) {
    try {
        fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(perms, null, 2));
    } catch (e) {
        console.error('[Permissions] Failed to save:', e.message);
    }
}

/**
 * Grant a permanent permission for a specific tool action.
 */
function grantPermission(toolName, label) {
    const perms = loadPermissions();
    perms[toolName] = {
        granted: true,
        grantedAt: new Date().toISOString(),
        label: label || toolName
    };
    savePermissions(perms);
    console.log(`[Permissions] ✅ Permanently granted: ${toolName}`);
}

/**
 * Revoke a specific tool permission.
 */
function revokePermission(toolName) {
    const perms = loadPermissions();
    delete perms[toolName];
    savePermissions(perms);
    console.log(`[Permissions] 🚫 Revoked: ${toolName}`);
}

/**
 * Revoke ALL permissions (reset).
 */
function revokeAllPermissions() {
    savePermissions({});
    console.log('[Permissions] 🚫 All permissions revoked.');
}

/**
 * Check if a tool has been permanently approved.
 */
function isPermissionGranted(toolName) {
    const perms = loadPermissions();
    return perms[toolName]?.granted === true;
}

module.exports = {
    loadPermissions,
    grantPermission,
    revokePermission,
    revokeAllPermissions,
    isPermissionGranted,
    PERMISSIONS_FILE
};

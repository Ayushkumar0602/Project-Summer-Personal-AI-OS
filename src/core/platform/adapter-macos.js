/**
 * core/platform/adapter-macos.js
 *
 * macOS Platform Adapter — wraps every macOS-specific implementation.
 *
 * This adapter forwards calls to the EXISTING os-tools.js and app-control-tools.js
 * WITHOUT modifying them. We treat those files as the macOS implementation library.
 *
 * IMPORTANT: This adapter is the ONLY file in src/core/ allowed to import
 *            macOS-specific code. Everything else calls this adapter.
 */

'use strict';

const { PlatformAdapterBase } = require('./adapter-base');
const { createLogger }        = require('../utils/logger');
const bus                     = require('../event-bus');

const log = createLogger('MacOSAdapter');

class MacOSAdapter extends PlatformAdapterBase {
    constructor() {
        super('macos');

        // Lazy-load the existing tool implementations (they may import Electron APIs)
        // We wrap them so the brain never calls them directly
        this._osTools  = null;
        this._appTools = null;
    }

    _getOsTools() {
        if (!this._osTools) {
            try {
                this._osTools = require('../../tools/os-tools');
            } catch (e) {
                log.warn('os-tools.js unavailable (running outside Electron context)', { err: e.message });
            }
        }
        return this._osTools;
    }

    _getAppTools() {
        if (!this._appTools) {
            try {
                this._appTools = require('../../tools/app-control-tools');
            } catch (e) {
                log.warn('app-control-tools.js unavailable (running outside Electron context)', { err: e.message });
            }
        }
        return this._appTools;
    }

    // ── Delegate to existing os-tools.js implementations ─────────────────────

    async _executeOsTool(name, args = {}) {
        const tools = this._getOsTools();
        if (!tools) return this._unsupported(name);
        try {
            const result = await tools.executeOsTool(name, args);
            if (result === null) return this._unsupported(name);
            return result;
        } catch (err) {
            log.error(`OS tool "${name}" failed`, { err: err.message });
            return { status: 'error', error: err.message };
        }
    }

    async _executeAppTool(name, args = {}) {
        const tools = this._getAppTools();
        if (!tools) return this._unsupported(name);
        try {
            const result = await tools.executeAppControlTool(name, args);
            if (result === null) return this._unsupported(name);
            return result;
        } catch (err) {
            log.error(`App control tool "${name}" failed`, { err: err.message });
            return { status: 'error', error: err.message };
        }
    }

    // ── App Control ───────────────────────────────────────────────────────────
    async openApp(args)       { return this._executeOsTool('os_open_app', args); }
    async quitApp(args)       { return this._executeOsTool('os_quit_app', args); }
    async focusApp(args)      { return this._executeOsTool('os_focus_app', args); }
    async listRunningApps()   { return this._executeOsTool('os_list_running_apps', {}); }

    // ── Volume ────────────────────────────────────────────────────────────────
    async setVolume(args)     { return this._executeOsTool('os_set_volume', args); }
    async getVolume()         { return this._executeOsTool('os_get_volume', {}); }
    async toggleMute(args)    { return this._executeOsTool('os_toggle_mute', args); }

    // ── Brightness ────────────────────────────────────────────────────────────
    async setBrightness(args) { return this._executeOsTool('os_set_brightness', args); }

    // ── System Info ───────────────────────────────────────────────────────────
    async getSystemInfo()     { return this._executeOsTool('os_get_system_info', {}); }
    async getTopProcesses()   { return this._executeOsTool('os_get_top_processes', {}); }

    // ── Power ─────────────────────────────────────────────────────────────────
    async systemSleep()       { return this._executeOsTool('os_system_sleep', {}); }
    async lockScreen()        { return this._executeOsTool('os_lock_screen', {}); }

    // ── Clipboard — macOS uses Electron clipboard API (still inside Electron context) ──
    // Falls back to base class _requiresClient so the Electron client handles it.
    // (The electron main process will intercept the requires_client event)

    // ── Screenshot ────────────────────────────────────────────────────────────
    async takeScreenshot()    { return this._executeOsTool('os_take_screenshot', {}); }
    async screenshotApp(args) { return this._executeAppTool('app_screenshot', args); }

    // ── File System ───────────────────────────────────────────────────────────
    async openFileOrFolder(args) { return this._executeOsTool('os_open_file', args); }
    async openUrl(args)       { return this._executeOsTool('os_open_url', args); }
    async searchFiles(args)   { return this._executeAppTool('app_finder_search', args); }

    // ── System Settings ───────────────────────────────────────────────────────
    async toggleDarkMode(args)    { return this._executeOsTool('os_toggle_dark_mode', args); }
    async toggleDoNotDisturb(args){ return this._executeOsTool('os_toggle_dnd', args); }

    // ── Wifi ─────────────────────────────────────────────────────────────────
    async getWifiStatus()     { return this._executeOsTool('os_get_wifi_status', {}); }

    // ── Trash ─────────────────────────────────────────────────────────────────
    async emptyTrash()        { return this._executeOsTool('os_empty_trash', {}); }

    // ── TTS — macOS has `say` command ─────────────────────────────────────────
    async speak(text) {
        const { exec } = require('child_process');
        const safe = String(text).replace(/[^a-zA-Z0-9 .,!?'-]/g, ' ').substring(0, 500);
        return new Promise((resolve) => {
            exec(`say "${safe}"`, (err) => {
                if (err) resolve({ status: 'error', error: err.message });
                else resolve({ status: 'success' });
            });
        });
    }

    // ── Music (macOS AppleScript) ─────────────────────────────────────────────
    async musicPlayPause()  { return this._executeAppTool('app_music_play_pause', {}); }
    async musicNext()       { return this._executeAppTool('app_music_next', {}); }
    async musicPrevious()   { return this._executeAppTool('app_music_previous', {}); }
    async musicNowPlaying() { return this._executeAppTool('app_music_now_playing', {}); }

    // ── UI Interaction ────────────────────────────────────────────────────────
    async readAppUI(args)       { return this._executeAppTool('app_read_ui', args); }
    async clickUIElement(args)  { return this._executeAppTool('app_click_ui', args); }
    async typeInApp(args)       { return this._executeAppTool('app_type', args); }
    async selectMenu(args)      { return this._executeAppTool('app_select_menu', args); }
    async sendKeystroke(args)   { return this._executeAppTool('app_keystroke', args); }
}

module.exports = { MacOSAdapter };

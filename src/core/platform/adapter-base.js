/**
 * core/platform/adapter-base.js
 *
 * Platform Adapter Interface — the contract every platform MUST implement.
 *
 * Design principle: Program to an interface, not an implementation.
 * The Brain (Gemini session, orchestrator) calls these methods without
 * caring if it's macOS, Windows, iOS, or a cloud server underneath.
 *
 * All methods return a standard result object:
 *   { status: 'success', ...data }   on success
 *   { status: 'unsupported', reason: 'string' }  if the platform can't do it
 *   { status: 'error', error: 'string' }          on failure
 *   { status: 'requires_client', action, args }   when the daemon needs the
 *                                                  CLIENT to execute (e.g. mobile)
 */

'use strict';

class PlatformAdapterBase {
    /**
     * @param {string} platformId  e.g. 'macos', 'windows', 'linux', 'mobile', 'headless'
     */
    constructor(platformId) {
        this.platformId = platformId;
    }

    // ── App Control ───────────────────────────────────────────────────────────
    async openApp(args)          { return this._requiresClient('openApp', args); }
    async quitApp(args)          { return this._requiresClient('quitApp', args); }
    async focusApp(args)         { return this._requiresClient('focusApp', args); }
    async listRunningApps()      { return this._requiresClient('listRunningApps', {}); }

    // ── Volume ────────────────────────────────────────────────────────────────
    async setVolume(args)        { return this._requiresClient('setVolume', args); }
    async getVolume()            { return this._requiresClient('getVolume', {}); }
    async toggleMute(args)       { return this._requiresClient('toggleMute', args); }

    // ── Brightness ────────────────────────────────────────────────────────────
    async setBrightness(args)    { return this._requiresClient('setBrightness', args); }

    // ── System Info ───────────────────────────────────────────────────────────
    async getSystemInfo()        { return this._requiresClient('getSystemInfo', {}); }
    async getTopProcesses()      { return this._requiresClient('getTopProcesses', {}); }

    // ── Power ─────────────────────────────────────────────────────────────────
    async systemSleep()          { return this._requiresClient('systemSleep', {}); }
    async lockScreen()           { return this._requiresClient('lockScreen', {}); }

    // ── Clipboard ─────────────────────────────────────────────────────────────
    async readClipboard()        { return this._requiresClient('readClipboard', {}); }
    async writeClipboard(args)   { return this._requiresClient('writeClipboard', args); }

    // ── Screenshot / Vision ───────────────────────────────────────────────────
    async takeScreenshot()       { return this._requiresClient('takeScreenshot', {}); }
    async screenshotApp(args)    { return this._requiresClient('screenshotApp', args); }

    // ── File System ───────────────────────────────────────────────────────────
    async readFile(args)         { return this._requiresClient('readFile', args); }
    async openFileOrFolder(args) { return this._requiresClient('openFileOrFolder', args); }
    async openUrl(args)          { return this._requiresClient('openUrl', args); }
    async searchFiles(args)      { return this._requiresClient('searchFiles', args); }

    // ── System Settings ───────────────────────────────────────────────────────
    async toggleDarkMode(args)   { return this._requiresClient('toggleDarkMode', args); }
    async toggleDoNotDisturb(args){ return this._requiresClient('toggleDoNotDisturb', args); }

    // ── Notification ──────────────────────────────────────────────────────────
    async showNotification(args) { return this._requiresClient('showNotification', args); }

    // ── TTS (Text-to-Speech) ──────────────────────────────────────────────────
    async speak(text)            { return this._requiresClient('speak', { text }); }

    // ── Trash ─────────────────────────────────────────────────────────────────
    async emptyTrash()           { return this._requiresClient('emptyTrash', {}); }

    // ── Wifi ─────────────────────────────────────────────────────────────────
    async getWifiStatus()        { return this._requiresClient('getWifiStatus', {}); }

    // ── App-specific ─────────────────────────────────────────────────────────
    async musicPlayPause()       { return this._requiresClient('musicPlayPause', {}); }
    async musicNext()            { return this._requiresClient('musicNext', {}); }
    async musicPrevious()        { return this._requiresClient('musicPrevious', {}); }
    async musicNowPlaying()      { return this._requiresClient('musicNowPlaying', {}); }

    // ── UI interaction ────────────────────────────────────────────────────────
    async readAppUI(args)        { return this._requiresClient('readAppUI', args); }
    async clickUIElement(args)   { return this._requiresClient('clickUIElement', args); }
    async typeInApp(args)        { return this._requiresClient('typeInApp', args); }
    async selectMenu(args)       { return this._requiresClient('selectMenu', args); }
    async sendKeystroke(args)    { return this._requiresClient('sendKeystroke', args); }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * The capability isn't available on this platform at all.
     */
    _unsupported(capability) {
        return {
            status:  'unsupported',
            reason:  `"${capability}" is not supported on platform "${this.platformId}".`,
        };
    }

    /**
     * The daemon can't do this — send the action back to the client to execute natively.
     * The transport layer listens for these and forwards via CLIENT_SEND.
     */
    _requiresClient(action, args = {}) {
        return {
            status: 'requires_client',
            action,
            args,
        };
    }
}

module.exports = { PlatformAdapterBase };

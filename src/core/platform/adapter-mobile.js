/**
 * core/platform/adapter-mobile.js
 *
 * Mobile Platform Adapter (iOS + Android).
 *
 * On mobile, the daemon CAN'T execute OS commands — the phone's OS is sandboxed.
 * Instead, every capability is delegated back to the mobile client via
 * { status: 'requires_client', action, args }.
 *
 * The mobile client (iOS Swift / Android Kotlin) receives these and executes
 * natively: AVAudioSession.setVolume(), UIImpactFeedbackGenerator(), etc.
 *
 * This adapter is intentionally thin — its job is to be explicit about
 * what a mobile client must implement.
 */

'use strict';

const { PlatformAdapterBase } = require('./adapter-base');

class MobileAdapter extends PlatformAdapterBase {
    constructor(platform = 'mobile') {
        super(platform); // 'ios' or 'android'
    }

    // ── All capabilities delegate to client ───────────────────────────────────
    // The base class already returns _requiresClient() for most methods.
    // We only need to override the ones the base class marks as _unsupported()
    // but that mobile CAN do via client delegation.

    async openApp(args)       { return this._requiresClient('openApp', args); }
    async openUrl(args)       { return this._requiresClient('openUrl', args); }
    async toggleDarkMode(args){ return this._requiresClient('toggleDarkMode', args); }
    async lockScreen()        { return this._requiresClient('lockScreen', {}); }
    async speak(text)         { return this._requiresClient('speak', { text }); }
    async showNotification(args){ return this._requiresClient('showNotification', args); }
    async musicPlayPause()    { return this._requiresClient('musicPlayPause', {}); }
    async musicNext()         { return this._requiresClient('musicNext', {}); }
    async musicPrevious()     { return this._requiresClient('musicPrevious', {}); }

    // ── These are genuinely impossible on mobile ──────────────────────────────
    async takeScreenshot()    { return this._unsupported('takeScreenshot'); }
    async screenshotApp()     { return this._unsupported('screenshotApp'); }
    async readAppUI()         { return this._unsupported('readAppUI'); }
    async clickUIElement()    { return this._unsupported('clickUIElement'); }
    async typeInApp()         { return this._unsupported('typeInApp'); }
    async emptyTrash()        { return this._unsupported('emptyTrash'); }
    async searchFiles()       { return this._unsupported('searchFiles'); }
}

module.exports = { MobileAdapter };

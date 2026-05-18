/**
 * src/core/utils/renderer-bridge.js
 *
 * THE single point of contact between the daemon's tool layer and the UI.
 *
 * When tools need to send something to the Electron renderer (HUD updates,
 * browser navigation, layout changes), they call sendToRenderer().
 *
 * In daemon mode → broadcasts via WebSocket to connected Electron client.
 * In Electron mode (legacy) → uses BrowserWindow.webContents.send() directly.
 *
 * This makes ALL tool files completely Electron-free.
 */

'use strict';

const { encode, MSG } = require('../transport/protocol');

let _registry   = null; // injected by daemon on startup
let _mainWindow = null; // injected by Electron on startup (legacy path)

/**
 * Called once by summer-daemon.js to inject the ClientRegistry.
 * @param {object} registry - the client-registry singleton
 */
function injectRegistry(registry) {
    _registry = registry;
}

/**
 * Called once by src/index.js to inject a getMainWindow() fn (legacy Electron path).
 * @param {Function} getMainWindowFn
 */
function injectMainWindow(getMainWindowFn) {
    _mainWindow = getMainWindowFn;
}

/**
 * Send a message to the renderer (HUD, browser, layout, etc.).
 *
 * @param {string} channel - IPC channel name (e.g. 'show-hud-widget')
 * @param {any}    payload - data to send
 */
function sendToRenderer(channel, payload) {
    // ── Daemon path: broadcast via WebSocket ──────────────────────────────────
    if (_registry) {
        // Map the IPC channel to a protocol message type
        const type = _channelToMsgType(channel);
        _registry.broadcast(encode(type, _wrapPayload(channel, payload)));
        return;
    }

    // ── Electron legacy path: use BrowserWindow directly ──────────────────────
    try {
        const win = _mainWindow?.();
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    } catch (_) {}
}

/**
 * Execute JavaScript in the renderer (for browser nav, layout changes).
 * In daemon mode: sends as a special 'execute_script' client action.
 */
function executeInRenderer(script) {
    if (_registry) {
        _registry.broadcast(encode('client_action', { action: 'executeScript', args: { script } }));
        return;
    }
    try {
        const win = _mainWindow?.();
        if (win && !win.isDestroyed()) {
            win.webContents.executeJavaScript(script).catch(() => {});
        }
    } catch (_) {}
}

// ── Map IPC channel → WebSocket protocol message type ─────────────────────────

function _channelToMsgType(channel) {
    switch (channel) {
        case 'show-hud-widget':  return MSG.HUD_UPDATE;
        case 'hide-hud-widget':  return MSG.HUD_CLEAR;
        case 'browser-control':  return 'browser_control';
        case 'agent-text':       return MSG.TEXT_RESPONSE;
        default:                 return channel;
    }
}

function _wrapPayload(channel, payload) {
    if (channel === 'show-hud-widget') {
        // DaemonClient reconstructs: fwd('show-hud-widget', { type: msg.widget, ...msg.state })
        // So state must be everything EXCEPT type (data, append, width, height, etc.)
        const { type, ...state } = payload || {};
        return { widget: type, state };
    }
    if (channel === 'hide-hud-widget') {
        return {};
    }
    return payload || {};
}

module.exports = { sendToRenderer, executeInRenderer, injectRegistry, injectMainWindow };

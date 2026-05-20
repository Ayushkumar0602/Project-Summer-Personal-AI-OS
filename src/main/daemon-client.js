/**
 * src/main/daemon-client.js
 *
 * The Electron → Daemon WebSocket client.
 *
 * This is the "Mac body's" connection to the headless brain.
 * It handles:
 *   1. Connecting (with auto-reconnect)
 *   2. Authentication (pairing token)
 *   3. Routing daemon messages → Electron renderer
 *   4. Routing renderer IPC → daemon
 *   5. Handling "client_action" — things the daemon needs macOS to do natively
 *
 * Design: All AI logic runs in the daemon. Electron only renders and provides
 * macOS-native APIs (clipboard, notifications, file dialogs, system audio).
 */

'use strict';

const WebSocket  = require('ws');
const fs         = require('fs');
const os         = require('os');
const path       = require('path');
const { createLogger } = require('../core/utils/logger');
const { MSG, encode, decode } = require('../core/transport/protocol');
const Paths      = require('../core/utils/paths');
const { getPlatformAdapter } = require('../core/platform/adapter-factory');

const log = createLogger('DaemonClient');

const RECONNECT_DELAY_MS = 1500;
const MAX_RECONNECT_DELAY_MS = 30_000;

class DaemonClient {
    /**
     * @param {object} opts
     * @param {number}  opts.port
     * @param {Function} opts.getMainWindow    - () => BrowserWindow | null
     * @param {Function} opts.getMemoryWindow  - () => BrowserWindow | null
     */
    constructor(opts = {}) {
        this._port           = opts.port || 8765;
        this._url            = opts.url || null;
        this._getMainWindow  = opts.getMainWindow  || (() => null);
        this._getMemoryWindow= opts.getMemoryWindow || (() => null);
        this._ws             = null;
        this._reconnectDelay = RECONNECT_DELAY_MS;
        this._stopping       = false;
        this._connecting     = false;     // Guard: prevent concurrent connect() calls
        this._reconnectTimer = null;      // Track pending reconnect to cancel it
        this._pingInterval   = null;      // Client-side keepalive timer
        this._readyCallbacks = [];
    }

    // ── Connection lifecycle ──────────────────────────────────────────────────

    connect() {
        if (this._stopping) return;
        if (this._connecting) {
            log.warn('connect() called while already connecting — skipping.');
            return;
        }
        this._connecting = true;

        // ── CRITICAL: close any existing WebSocket first (Bug #1 fix) ────────
        this._destroyCurrentWs();

        const url = this._url || `ws://localhost:${this._port}`;
        log.info(`Connecting to daemon → ${url}`);

        const ws = new WebSocket(url);
        this._ws = ws;

        ws.on('open', () => {
            this._connecting = false;
            this._reconnectDelay = RECONNECT_DELAY_MS;
            log.info('Connected to Summer Core Daemon ✅');

            const tk = this._getPairingToken();
            log.info('Sending pairing token length: ' + tk.length);
            // Identify ourselves as the Mac Electron body
            ws.send(encode(MSG.CLIENT_HELLO, {
                platform:   'electron',
                deviceName: `Mac (${os.hostname()})`,
                hasMic:     true,
                hasScreen:  true,
                token:      tk,
            }));

            // ── Start client-side PING keepalive (Bug #2 fix) ────────────────
            this._startPing();

            // Flush any queued callbacks
            this._readyCallbacks.forEach(cb => cb(ws));
            this._readyCallbacks = [];
        });

        ws.on('message', (raw) => {
            const msg = decode(raw);
            if (msg) this._routeMessage(msg);
        });

        ws.on('close', (code) => {
            this._connecting = false;
            this._stopPing();

            if (this._stopping) return;

            log.warn(`Daemon connection closed (${code}). Reconnecting in ${this._reconnectDelay}ms...`);
            this._scheduleReconnect();
        });

        ws.on('error', (err) => {
            this._connecting = false;
            log.warn(`Daemon connection error: ${err.message}`);
            // 'close' event will trigger reconnect
        });
    }

    stop() {
        this._stopping = true;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this._stopPing();
        this._destroyCurrentWs();
    }

    /** Send an encoded protocol message to the daemon. */
    send(encoded) {
        if (this.isReady()) {
            this._ws.send(encoded);
        }
    }

    /** Check if the WebSocket is open and ready to send. */
    isReady() {
        return this._ws && this._ws.readyState === WebSocket.OPEN;
    }

    /** Get the live WebSocket (for session-ipc.js). */
    getWs() {
        return this._ws;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    /** Safely close and null-out the current WebSocket. */
    _destroyCurrentWs() {
        if (this._ws) {
            const old = this._ws;
            this._ws = null;
            // Remove all listeners to prevent ghost callbacks
            old.removeAllListeners();
            try {
                if (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING) {
                    old.close(1000, 'Client reconnecting');
                }
            } catch (_) {}
        }
    }

    /** Schedule a reconnect with exponential backoff. */
    _scheduleReconnect() {
        if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this.connect();
        }, this._reconnectDelay);
        this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
    }

    /** Start client-side PING keepalive (prevents Render idle timeout). */
    _startPing() {
        this._stopPing();
        this._pingInterval = setInterval(() => {
            if (this.isReady()) {
                this._ws.send(encode(MSG.PING));
            }
        }, 20_000);
    }

    /** Stop the PING interval. */
    _stopPing() {
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
    }

    // ── Message routing: Daemon → Electron renderer ───────────────────────────

    _routeMessage(msg) {
        const win    = this._getMainWindow();
        const memWin = this._getMemoryWindow();

        const fwd = (channel, payload) => {
            if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
        };

        switch (msg.type) {

            // ── Handshake ──────────────────────────────────────────────────────
            case MSG.DAEMON_HELLO:
                log.info(`Daemon says hello: ${msg.message}`);
                break;

            // ── Session ────────────────────────────────────────────────────────
            case MSG.SESSION_STARTED:    fwd('session-started');                        break;
            case MSG.SESSION_ENDED:      fwd('session-ended');                          break;

            // ── Audio / text ───────────────────────────────────────────────────
            case MSG.AUDIO_RESPONSE:     fwd('agent-audio', msg.data);                  break;
            case MSG.TEXT_RESPONSE:      fwd('agent-text', msg.text);                   break;
            case MSG.USER_TRANSCRIPT:    fwd('user-text', msg.text);                    break;
            case MSG.AGENT_TRANSCRIPT:   fwd('agent-transcript', msg.text);             break;

            // ── Turn state ─────────────────────────────────────────────────────
            case MSG.TURN_COMPLETE:      fwd('agent-turn-complete');                    break;
            case MSG.AGENT_INTERRUPTED:  fwd('agent-interrupted');                      break;

            // ── Tools ──────────────────────────────────────────────────────────
            case MSG.TOOL_CALL:          fwd('agent-tool-call', { name: msg.name, args: msg.args }); break;
            case MSG.TOOL_COMPLETE:      fwd('agent-tool-complete', { name: msg.name }); break;

            // ── HUD ────────────────────────────────────────────────────────────
            case MSG.HUD_UPDATE:
                if (msg.widget === 'wake_word' && msg.state?.detected) {
                    // wake-word-ui.js listens on 'wake-word-detected' — NOT show-hud-widget
                    fwd('wake-word-detected', { score: msg.state.score || 0 });
                } else {
                    fwd('show-hud-widget', { type: msg.widget, ...(msg.state || {}) });
                }
                break;
            case MSG.HUD_CLEAR:
                fwd('show-hud-widget', { type: 'clear' });
                break;

            // ── Memory ────────────────────────────────────────────────────────
            case MSG.MEMORY_UPDATED:
                fwd('memory-updated', msg);
                if (memWin && !memWin.isDestroyed()) {
                    memWin.webContents.send('extraction-done');
                }
                break;
            case MSG.MEMORY_CONFLICT:    fwd('memory-conflict', msg.contradictions);    break;

            // ── Agents ────────────────────────────────────────────────────────
            case MSG.AGENT_PROGRESS:     fwd('agent-progress', msg);                    break;
            case MSG.AGENT_COMPLETE:     fwd('agent-complete', msg);                    break;
            case MSG.AGENT_FAIL:         fwd('agent-fail', msg);                        break;

            // ── Permission request ─────────────────────────────────────────────
            case MSG.PERMISSION_REQUEST:
                this._handlePermissionRequest(msg);
                break;

            // ── Native client action (daemon cannot run these, Mac must) ───────
            case 'client_action':
                this._handleClientAction(msg);
                break;

            // ── Browser control (daemon routes browser tools to renderer) ──────
            case 'browser_control':
                this._handleBrowserControl(msg);
                break;

            // ── Execute script in renderer (for layout/navigation) ────────────
            case 'execute_script':
                if (win && !win.isDestroyed() && msg.args?.script) {
                    win.webContents.executeJavaScript(msg.args.script).catch(() => {});
                }
                break;

            // ── Notification ──────────────────────────────────────────────────
            case MSG.NOTIFICATION:
                this._showNotification(msg.title, msg.body);
                break;

            // ── Timer ─────────────────────────────────────────────────────────
            case MSG.TIMER_FIRED:
                fwd('timer-fired', { label: msg.label, timerId: msg.timerId });
                this._showNotification('⏰ Timer', msg.label || 'Timer is up!');
                break;

            // ── Errors ────────────────────────────────────────────────────────
            case MSG.ERROR:
                fwd('agent-error', msg.message);
                log.error(`Daemon error: ${msg.message}`);
                break;

            default:
                // Forward unknown messages as-is for backwards compat
                if (msg.type) fwd(msg.type, msg);
                break;
        }
    }

    // ── Browser control (daemon-originated browser tool requests) ─────────────

    _handleBrowserControl(msg) {
        const win = this._getMainWindow();
        if (!win || win.isDestroyed()) {
            // No window: send empty reply so daemon doesn't time out
            this.send(encode('browser_reply', { id: msg.id, error: 'No window' }));
            return;
        }
        // Forward to renderer — it handles the actual browser automation
        win.webContents.send('browser-control', { id: msg.id, action: msg.action, args: msg.args });
    }

    // ── Client actions (requires_client results from platform adapter) ────────

    _handleClientAction(msg) {
        const { action, args, requestId } = msg;
        const { clipboard, Notification, shell } = this._safeElectron();
        const win = this._getMainWindow();

        const sendResult = (result) => {
            this.send(encode('client_action_result', {
                requestId: requestId || null,
                action,
                result,
            }));
        };

        switch (action) {
            case 'readClipboard': {
                const text = clipboard ? clipboard.readText() : '';
                sendResult({ status: 'success', text });
                break;
            }
            case 'writeClipboard':
                if (clipboard) clipboard.writeText(args?.text || '');
                sendResult({ status: 'success' });
                break;

            case 'showNotification':
                this._showNotification(args?.title || 'Summer', args?.body || '');
                sendResult({ status: 'success' });
                break;

            case 'openUrl':
                if (shell && args?.url) {
                    shell.openExternal(args.url);
                    sendResult({ status: 'success' });
                } else {
                    sendResult({ status: 'error', error: 'No shell or URL' });
                }
                break;

            case 'openFileOrFolder':
                if (shell && args?.path) {
                    shell.openPath(args.path);
                    sendResult({ status: 'success' });
                } else {
                    sendResult({ status: 'error', error: 'No shell or path' });
                }
                break;

            // ── Shell/AppleScript delegation from cloud Brain ────────────────
            case 'runShell': {
                const { exec } = require('child_process');
                const cmd = args?.command || '';
                if (!cmd) {
                    sendResult({ status: 'error', error: 'Empty command' });
                    break;
                }
                exec(cmd, { timeout: 15000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
                    if (err) {
                        sendResult({ status: 'error', error: stderr || err.message });
                    } else {
                        sendResult({ status: 'success', output: stdout.trim() });
                    }
                });
                break;
            }

            case 'runAppleScript': {
                const { exec: execAS } = require('child_process');
                const script = args?.script || '';
                if (!script) {
                    sendResult({ status: 'error', error: 'Empty script' });
                    break;
                }
                const safeScript = script.replace(/'/g, "'\\''");
                execAS(`osascript -e '${safeScript}'`, { timeout: 15000 }, (err, stdout, stderr) => {
                    if (err) {
                        sendResult({ status: 'error', error: stderr || err.message });
                    } else {
                        sendResult({ status: 'success', output: stdout.trim() });
                    }
                });
                break;
            }

            default: {
                // Try executing it via the local platform adapter (e.g. MacOSAdapter)
                const adapter = getPlatformAdapter();
                if (typeof adapter[action] === 'function') {
                    adapter[action](args).then(result => {
                        sendResult(result);
                    }).catch(err => {
                        log.error(`Local adapter failed to execute ${action}`, { err: err.message });
                        sendResult({ status: 'error', error: err.message });
                    });
                } else {
                    // Forward to renderer for UI-level handling
                    if (win && !win.isDestroyed()) win.webContents.send('client-action', msg);
                }
                break;
            }
        }
    }

    // ── Permission request (daemon needs approval) ────────────────────────────

    async _handlePermissionRequest(msg) {
        const { requestId, toolName, description, actionLabel } = msg;
        const { dialog, BrowserWindow } = this._safeElectron();
        
        // 1. Check local pre-approved permissions first (so it works with cloud brain)
        let isGrantedLocally = false;
        try {
            const { isPermissionGranted } = require('../settings/permissions-store');
            isGrantedLocally = isPermissionGranted(toolName);
        } catch (_) {}

        if (isGrantedLocally) {
            log.info(`[Permissions] ✅ ${toolName} locally pre-approved. Skipping dialog.`);
            this.send(encode(MSG.PERMISSION_RESPONSE, { requestId, granted: true, alwaysAllow: true }));
            return;
        }

        if (!dialog || !BrowserWindow) {
            // Auto-approve in daemon-only mode
            this.send(encode(MSG.PERMISSION_RESPONSE, { requestId, granted: true }));
            return;
        }

        const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        if (!win) {
            this.send(encode(MSG.PERMISSION_RESPONSE, { requestId, granted: true }));
            return;
        }

        const { response } = await dialog.showMessageBox(win, {
            type:    'warning',
            buttons: ['Deny', 'Allow Once', 'Always Allow'],
            defaultId: 0, cancelId: 0,
            title:  '🔒 Summer — Permission Request',
            message: `Summer wants to: ${toolName}`,
            detail:  description || '',
        });

        const granted = response > 0;
        const alwaysAllow = response === 2;

        // 2. Save locally if user selected "Always Allow"
        if (alwaysAllow) {
            try {
                const { grantPermission } = require('../settings/permissions-store');
                grantPermission(toolName, actionLabel || description);
            } catch (e) {
                log.error(`[Permissions] Failed to save locally: ${e.message}`);
            }
        }

        this.send(encode(MSG.PERMISSION_RESPONSE, { requestId, granted, alwaysAllow }));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _showNotification(title, body) {
        try {
            const { Notification } = this._safeElectron();
            if (Notification) new Notification({ title, body }).show();
        } catch (_) {}
    }

    _safeElectron() {
        try { return require('electron'); } catch { return {}; }
    }

    _getPairingToken() {
        if (process.env.REMOTE_DAEMON_TOKEN) return process.env.REMOTE_DAEMON_TOKEN.replace(/^["']|["']$/g, '');
        try {
            const tokenPath = Paths.pairingToken();
            if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
        } catch (_) {}
        return '';
    }
}

module.exports = { DaemonClient };

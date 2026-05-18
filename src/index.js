/**
 * Summer — Main Electron process bootstrap (v2 — Daemon Architecture).
 *
 * This file now has ONE job: spawn the Core Daemon, create the window,
 * and bridge Electron IPC ↔ WebSocket daemon.
 *
 * The Brain (Gemini, memory, tools, orchestrator) all live in summer-daemon.js.
 * Electron is now purely the "Mac body" — UI shell + mic capture.
 */

const { app, BrowserWindow, ipcMain, systemPreferences, session } = require('electron');
const path   = require('node:path');
const { fork } = require('child_process');
const WebSocket = require('ws');
const dotenv = require('dotenv');
dotenv.config();

const windows = require('./main/windows');
const { createBrowserBridge, registerBrowserIpc } = require('./main/browser/browser-bridge');
const { registerMemoryIpc }     = require('./main/ipc/memory-ipc');
const { registerSettingsIpc }   = require('./main/ipc/settings-ipc');
const { registerGoogleIpc }     = require('./main/ipc/google-ipc');
const { registerWakeWordIpc }   = require('./main/ipc/wake-word-ipc');
const { registerIntegrationsIpc } = require('./main/ipc/integrations-ipc');
const { MSG, encode, decode }   = require('./core/transport/protocol');
const Paths = require('./core/utils/paths');
const fs = require('fs');

const DAEMON_PORT   = parseInt(process.env.DAEMON_PORT || '8765');
const DAEMON_SCRIPT = path.join(__dirname, '..', 'summer-daemon.js');

let daemonProcess = null;
let daemonWs      = null;         // WebSocket connection from Electron → Daemon
let wakeWordEngine = null;        // kept for backwards compat (IPC handlers)

if (require('electron-squirrel-startup')) app.quit();
app.commandLine.appendSwitch('remote-debugging-port', '9222');

// ── 1. Spawn the Core Daemon ──────────────────────────────────────────────────

function spawnDaemon() {
    console.log('[Electron] Spawning Summer Core Daemon...');

    daemonProcess = fork(DAEMON_SCRIPT, ['--skip-auth'], {
        env:   { ...process.env },
        stdio: 'inherit', // daemon logs appear in same terminal
    });

    daemonProcess.on('exit', (code, signal) => {
        console.warn(`[Electron] Daemon exited (code=${code}, signal=${signal}). Restarting in 2s...`);
        setTimeout(spawnDaemon, 2000);
    });

    daemonProcess.on('error', (err) => {
        console.error('[Electron] Failed to spawn daemon:', err.message);
    });

    // Connect to daemon WebSocket after giving it time to start
    setTimeout(connectToDaemon, 1200);
}

// ── 2. Connect Electron → Daemon WebSocket ────────────────────────────────────

function connectToDaemon(attempts = 0) {
    const url = `ws://localhost:${DAEMON_PORT}`;
    console.log(`[Electron] Connecting to daemon at ${url}...`);

    daemonWs = new WebSocket(url);

    daemonWs.on('open', () => {
        console.log('[Electron] Connected to Summer Core Daemon ✅');

        // Send client_hello — Electron identifies itself as the mac body
        daemonWs.send(encode(MSG.CLIENT_HELLO, {
            platform:   'electron',
            deviceName: `Mac (${require('os').hostname()})`,
            hasMic:     true,
            hasScreen:  true,
            token:      _getPairingToken(), // skip-auth in dev, but send token anyway
        }));
    });

    daemonWs.on('message', (raw) => {
        const msg = decode(raw);
        if (!msg) return;
        _routeDaemonMessage(msg);
    });

    daemonWs.on('close', () => {
        console.warn('[Electron] Lost connection to daemon. Reconnecting in 1s...');
        setTimeout(() => connectToDaemon(attempts + 1), 1000);
    });

    daemonWs.on('error', (err) => {
        if (attempts < 5) {
            setTimeout(() => connectToDaemon(attempts + 1), 1000);
        } else {
            console.error('[Electron] Cannot connect to daemon:', err.message);
        }
    });
}

function _getPairingToken() {
    try {
        const tokenPath = Paths.pairingToken();
        if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
    } catch (_) {}
    return '';
}

// ── 3. Route daemon messages → Electron renderer ──────────────────────────────

function _routeDaemonMessage(msg) {
    const win = windows.getMainWindow();
    const memWin = windows.getMemoryWindow();

    const send = (channel, payload) => {
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    };

    switch (msg.type) {
        case MSG.DAEMON_HELLO:
            console.log('[Electron] Daemon says hello:', msg.message);
            break;
        case MSG.SESSION_STARTED:    send('session-started');                      break;
        case MSG.SESSION_ENDED:      send('session-ended');                        break;
        case MSG.AUDIO_RESPONSE:     send('agent-audio', msg.data);                break;
        case MSG.TEXT_RESPONSE:      send('agent-text', msg.text);                 break;
        case MSG.USER_TRANSCRIPT:    send('user-text', msg.text);                  break;
        case MSG.TURN_COMPLETE:      send('agent-turn-complete');                   break;
        case MSG.AGENT_INTERRUPTED:  send('agent-interrupted');                    break;
        case MSG.TOOL_CALL:          send('agent-tool-call', { name: msg.name, args: msg.args }); break;
        case MSG.TOOL_COMPLETE:      send('agent-tool-complete', { name: msg.name }); break;
        case MSG.HUD_UPDATE:         send('show-hud-widget', { type: msg.widget, data: msg.state }); break;
        case MSG.AGENT_PROGRESS:     send('agent-progress', msg);                  break;
        case MSG.AGENT_COMPLETE:     send('agent-complete', msg);                  break;
        case MSG.AGENT_FAIL:         send('agent-fail', msg);                      break;
        case MSG.MEMORY_UPDATED:
            send('memory-updated', msg);
            if (memWin && !memWin.isDestroyed()) memWin.webContents.send('extraction-done');
            break;
        case MSG.MEMORY_CONFLICT:    send('memory-conflict', msg.contradictions);  break;
        case MSG.ERROR:              send('agent-error', msg.message);             break;
        case MSG.NOTIFICATION:       _showElectronNotification(msg);               break;

        // Client action — daemon wants Electron to execute something natively
        case 'client_action':        _handleClientAction(msg);                     break;

        default:
            // Forward any unknown message as-is for backwards compat
            if (msg.type) send(msg.type, msg);
            break;
    }
}

// ── 4. Handle client_action (platform adapter "requires_client") ───────────────

function _handleClientAction(msg) {
    const { action, args } = msg;
    const { clipboard, Notification, shell } = require('electron');

    switch (action) {
        case 'readClipboard': {
            const text = clipboard.readText();
            _sendToDaemon(encode('client_action_result', { action, result: { status: 'success', text } }));
            break;
        }
        case 'writeClipboard':
            clipboard.writeText(args?.text || '');
            break;
        case 'showNotification':
            new Notification({ title: args?.title || 'Summer', body: args?.body || '' }).show();
            break;
        case 'openUrl':
            if (args?.url) shell.openExternal(args.url);
            break;
        case 'openFileOrFolder':
            if (args?.path) shell.openPath(args.path);
            break;
        default:
            // Forward to renderer for further handling (e.g., UI-specific actions)
            const win = windows.getMainWindow();
            if (win && !win.isDestroyed()) win.webContents.send('client-action', msg);
            break;
    }
}

function _showElectronNotification(msg) {
    try {
        const { Notification } = require('electron');
        new Notification({ title: msg.title || 'Summer', body: msg.body || '' }).show();
    } catch (_) {}
}

// ── 5. Helper: send to daemon ─────────────────────────────────────────────────

function _sendToDaemon(encoded) {
    if (daemonWs && daemonWs.readyState === WebSocket.OPEN) {
        daemonWs.send(encoded);
    }
}

// ── 6. Bridge Electron IPC → Daemon WebSocket ─────────────────────────────────
//    The renderer uses the SAME IPC API as before — zero changes to renderer.js

function registerBridgeIpc() {
    ipcMain.on('start-session',    (_, ctx)    => _sendToDaemon(encode(MSG.START_SESSION,      { context: ctx || {} })));
    ipcMain.on('stop-session',     ()          => _sendToDaemon(encode(MSG.STOP_SESSION)));
    ipcMain.on('realtime-audio',   (_, data)   => _sendToDaemon(encode(MSG.SEND_AUDIO,         { data })));
    ipcMain.on('turn-complete',    ()          => _sendToDaemon(encode(MSG.SEND_TURN_COMPLETE)));
    ipcMain.on('send-text-command',(_, text)   => _sendToDaemon(encode(MSG.SEND_TEXT,          { text })));
    ipcMain.on('cancel-agents',    ()          => _sendToDaemon(encode(MSG.CANCEL_AGENTS)));

    // Wake-word detected in renderer → forward to daemon as session start trigger
    ipcMain.on('wake-word-detected', (_, payload) => {
        const win = windows.getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send('wake-word-detected', payload);
    });
}

// ── 7. Electron app lifecycle ─────────────────────────────────────────────────

app.whenReady().then(async () => {
    if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('microphone');
        if (status === 'not-determined') {
            await systemPreferences.askForMediaAccess('microphone');
        }
    }

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const newHeaders = Object.fromEntries(
            Object.entries(details.responseHeaders).filter(([key]) => {
                const lower = key.toLowerCase();
                return lower !== 'x-frame-options' && lower !== 'content-security-policy';
            })
        );
        callback({ cancel: false, responseHeaders: newHeaders });
    });

    // Spawn the daemon FIRST, then create UI
    spawnDaemon();

    // Register the daemon bridge IPC handlers
    registerBridgeIpc();

    // Register existing IPC handlers (memory, settings, Google auth — these are still local)
    const browserBridge = createBrowserBridge(() => windows.getMainWindow());
    registerBrowserIpc(ipcMain, browserBridge);
    registerMemoryIpc(ipcMain, { getMainWindow: () => windows.getMainWindow() });
    registerSettingsIpc(ipcMain);
    registerGoogleIpc(ipcMain);
    registerWakeWordIpc(ipcMain, () => wakeWordEngine);
    registerIntegrationsIpc(ipcMain);

    ipcMain.on('open-memory-window', () => windows.createMemoryWindow());
    ipcMain.on('open-settings-window', () => windows.createSettingsWindow());

    windows.createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) windows.createMainWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    if (daemonProcess) {
        console.log('[Electron] Stopping daemon...');
        daemonProcess.kill('SIGTERM');
    }
});

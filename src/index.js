/**
 * Summer — Main Electron Process (v2 — Daemon Architecture)
 *
 * This file has ONE job:
 *   1. Spawn the Core Daemon (summer-daemon.js)
 *   2. Create the BrowserWindow UI
 *   3. Use DaemonClient to connect Electron ↔ Daemon
 *   4. Register native IPC handlers (memory, settings, Google, wake-word)
 *
 * The Brain (Gemini, memory, tools, orchestrator) runs in summer-daemon.js.
 * Electron is the "Mac Body" — UI shell + native macOS APIs.
 */

'use strict';

const { app, BrowserWindow, ipcMain, systemPreferences, session } = require('electron');
const path   = require('node:path');
const { fork } = require('child_process');
const dotenv = require('dotenv');
dotenv.config();

// ── Core modules (Electron-free) ──────────────────────────────────────────────
const { encode, MSG }            = require('./core/transport/protocol');
const { DaemonClient }           = require('./main/daemon-client');
const { registerSessionIpc }     = require('./main/ipc/session-ipc');
const windows                    = require('./main/windows');

// ── IPC modules (Electron-specific, no AI logic) ─────────────────────────────
const { createBrowserBridge, registerBrowserIpc } = require('./main/browser/browser-bridge');
const { registerMemoryIpc }      = require('./main/ipc/memory-ipc');
const { registerSettingsIpc }    = require('./main/ipc/settings-ipc');
const { registerGoogleIpc }      = require('./main/ipc/google-ipc');
const { registerWakeWordIpc }    = require('./main/ipc/wake-word-ipc');
const { registerIntegrationsIpc } = require('./main/ipc/integrations-ipc');

if (require('electron-squirrel-startup')) app.quit();
app.commandLine.appendSwitch('remote-debugging-port', '9222');

// ── Config ────────────────────────────────────────────────────────────────────
const DAEMON_PORT   = parseInt(process.env.DAEMON_PORT || '8765');
const DAEMON_SCRIPT = path.join(__dirname, '..', 'summer-daemon.js');

// ── State ─────────────────────────────────────────────────────────────────────
let daemonProcess = null;
let daemonClient  = null;  // DaemonClient instance

// ── 1. Spawn the Core Daemon ──────────────────────────────────────────────────

function spawnDaemon() {
    console.log('[Electron] Spawning Summer Core Daemon...');

    daemonProcess = fork(DAEMON_SCRIPT, ['--skip-auth'], {
        env:   { ...process.env },
        stdio: 'inherit',
        detached: false,
    });

    daemonProcess.on('exit', (code, signal) => {
        console.warn(`[Electron] Daemon exited (code=${code}, signal=${signal}).`);
        if (!app.isQuitting) {
            console.warn('[Electron] Restarting daemon in 2s...');
            setTimeout(spawnDaemon, 2000);
        }
    });

    daemonProcess.on('error', (err) => {
        console.error('[Electron] Failed to spawn daemon:', err.message);
    });
}

// ── 2. Connect Electron to daemon via DaemonClient ────────────────────────────

function connectToDaemon() {
    daemonClient = new DaemonClient({
        port:           DAEMON_PORT,
        getMainWindow:  () => windows.getMainWindow(),
        getMemoryWindow:() => windows.getMemoryWindow(),
    });

    // Give the daemon a moment to bind its port before connecting
    setTimeout(() => daemonClient.connect(), 1200);
}

// ── 3. Electron app lifecycle ─────────────────────────────────────────────────

app.whenReady().then(async () => {
    // Request microphone permission on macOS
    if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('microphone');
        if (status === 'not-determined') {
            await systemPreferences.askForMediaAccess('microphone');
        }
    }

    // Allow webviews to load external pages (e.g., Gmail, Calendar)
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const newHeaders = Object.fromEntries(
            Object.entries(details.responseHeaders).filter(([key]) => {
                const lower = key.toLowerCase();
                return lower !== 'x-frame-options' && lower !== 'content-security-policy';
            })
        );
        callback({ cancel: false, responseHeaders: newHeaders });
    });

    // ── Spawn brain daemon first ──────────────────────────────────────────────
    spawnDaemon();
    connectToDaemon();

    // ── Register IPC handlers ─────────────────────────────────────────────────

    // Session: bridges renderer ↔ daemon WebSocket
    registerSessionIpc(
        ipcMain,
        () => daemonClient?.getWs() || null,
        () => windows.getMainWindow()
    );

    // Browser (web scraping / browser automation) — still local
    const browserBridge = createBrowserBridge(() => windows.getMainWindow());
    registerBrowserIpc(ipcMain, browserBridge);

    // Memory graph UI — reads graph data locally (graph files are on this machine)
    registerMemoryIpc(ipcMain, { getMainWindow: () => windows.getMainWindow() });

    // Settings / permissions — local Electron native dialogs
    registerSettingsIpc(ipcMain);

    // Google OAuth — local token management + browser redirect
    registerGoogleIpc(ipcMain);

    // Wake word — local VAD model (desktop-only)
    registerWakeWordIpc(ipcMain, () => null);

    // Integrations — local config reads/writes
    registerIntegrationsIpc(ipcMain);

    // Utility IPC
    ipcMain.on('open-memory-window',   () => windows.createMemoryWindow());
    ipcMain.on('open-settings-window', () => windows.createSettingsWindow());

    // Wake word detected in renderer → forward as visual feedback
    ipcMain.on('wake-word-detected', (_, payload) => {
        const win = windows.getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send('wake-word-detected', payload);
    });

    // ── Create the main UI window ─────────────────────────────────────────────
    windows.createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) windows.createMainWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    app.isQuitting = true;
    if (daemonClient) daemonClient.stop();
    if (daemonProcess) {
        console.log('[Electron] Stopping daemon...');
        daemonProcess.kill('SIGTERM');
    }
});

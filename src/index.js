/**
 * Summer — Main Electron process bootstrap.
 */

const { app, BrowserWindow, ipcMain, systemPreferences, session } = require('electron');
const path = require('node:path');
const dotenv = require('dotenv');
dotenv.config();

const windows = require('./main/windows');
const { createBrowserBridge, registerBrowserIpc } = require('./main/browser/browser-bridge');
const { createEmitAgentEvent } = require('./main/agent-events');
const { LiveSessionManager } = require('./main/gemini/live-session');
const { registerMemoryIpc } = require('./main/ipc/memory-ipc');
const { registerSettingsIpc } = require('./main/ipc/settings-ipc');
const { registerGoogleIpc } = require('./main/ipc/google-ipc');
const { registerWakeWordIpc } = require('./main/ipc/wake-word-ipc');
const { registerIntegrationsIpc } = require('./main/ipc/integrations-ipc');
const { WakeWordEngine } = require('./wake-word/wake-word-engine');

let wakeWordEngine = null;
let liveSessionManager = null;
let emitAgentEvent = null;
let callBrowser = null;

if (require('electron-squirrel-startup')) app.quit();

app.commandLine.appendSwitch('remote-debugging-port', '9222');

function initWakeWordEngine() {
    try {
        wakeWordEngine = new WakeWordEngine({
            modelDir: path.join(__dirname, 'models'),
            threshold: 0.85,
            cooldownMs: 2000,
            debounceMs: 3000
        });

        wakeWordEngine.on('detected', (score) => {
            console.log(`\n🎤 Wake word detected! Score: ${score.toFixed(4)}`);
            wakeWordEngine.pause();
            const mainWindow = windows.getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('wake-word-detected', { score });
            }
        });

        wakeWordEngine.on('error', (err) => {
            console.error('[WakeWord] Engine error:', err.message);
        });

        wakeWordEngine.on('unavailable', (reason) => {
            console.warn(`[WakeWord] Unavailable: ${reason}. Wake word feature disabled.`);
        });

        setTimeout(() => wakeWordEngine.start(), 3000);
    } catch (err) {
        console.error('[WakeWord] Failed to initialize:', err.message);
    }
}

function registerAllIpc() {
    const browserBridge = createBrowserBridge(() => windows.getMainWindow());
    callBrowser = browserBridge.callBrowser;
    registerBrowserIpc(ipcMain, browserBridge);

    emitAgentEvent = createEmitAgentEvent(() => windows.getMainWindow());

    liveSessionManager = new LiveSessionManager({
        getMainWindow: () => windows.getMainWindow(),
        getMemoryWindow: () => windows.getMemoryWindow(),
        getWakeWordEngine: () => wakeWordEngine,
        callBrowser,
        emitAgentEvent,
    });
    liveSessionManager.registerIpc(ipcMain);

    registerMemoryIpc(ipcMain, { getMainWindow: () => windows.getMainWindow() });
    registerSettingsIpc(ipcMain);
    registerGoogleIpc(ipcMain);
    registerWakeWordIpc(ipcMain, () => wakeWordEngine);
    registerIntegrationsIpc(ipcMain);

    ipcMain.on('open-memory-window', () => windows.createMemoryWindow());
    ipcMain.on('open-settings-window', () => windows.createSettingsWindow());
}

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

    registerAllIpc();
    windows.createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) windows.createMainWindow();
    });

    initWakeWordEngine();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

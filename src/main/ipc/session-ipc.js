/**
 * src/main/ipc/session-ipc.js
 *
 * Phase 2: Session IPC Handler — Electron main process.
 *
 * Previously the Electron main process talked directly to LiveSessionManager.
 * Now it just bridges renderer IPC → daemon WebSocket.
 *
 * The actual AI session lives in summer-daemon.js.
 * This file makes the renderer think nothing has changed.
 */

'use strict';

const WebSocket = require('ws');
const { createLogger } = require('../../core/utils/logger');
const { MSG, encode, decode } = require('../../core/transport/protocol');

const log = createLogger('SessionIPC');

/**
 * Register all session-related IPC handlers.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDaemonWs - () => WebSocket | null  (live connection to daemon)
 * @param {Function} getMainWindow - () => BrowserWindow | null
 */
function registerSessionIpc(ipcMain, getDaemonWs, getMainWindow) {

    function sendToDaemon(encoded) {
        const ws = getDaemonWs();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(encoded);
        } else {
            log.warn('Cannot send to daemon — WebSocket not ready');
        }
    }

    // ── Renderer → Daemon ─────────────────────────────────────────────────────
    ipcMain.on('start-session', (_, contextPayload) => {
        log.info('start-session IPC received');
        sendToDaemon(encode(MSG.START_SESSION, { context: contextPayload || {} }));
    });

    ipcMain.on('stop-session', () => {
        log.info('stop-session IPC received');
        sendToDaemon(encode(MSG.STOP_SESSION));
    });

    ipcMain.on('realtime-audio', (_, base64Audio) => {
        sendToDaemon(encode(MSG.SEND_AUDIO, { data: base64Audio }));
    });

    ipcMain.on('turn-complete', () => {
        sendToDaemon(encode(MSG.SEND_TURN_COMPLETE));
    });

    ipcMain.on('send-text-command', (_, text) => {
        log.info(`Text command: "${text.slice(0, 40)}"`);
        sendToDaemon(encode(MSG.SEND_TEXT, { text }));
    });

    ipcMain.on('cancel-agents', () => {
        sendToDaemon(encode(MSG.CANCEL_AGENTS));
    });

    // Renderer → Daemon: forward browser-reply so daemon can resolve browser tool promises
    ipcMain.on('browser-reply', (_, payload) => {
        sendToDaemon(encode('browser_reply', payload));
    });

    log.info('Session IPC handlers registered → bridging to daemon WebSocket');
}

module.exports = { registerSessionIpc };

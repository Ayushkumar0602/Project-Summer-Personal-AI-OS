/**
 * src/hud-panel/panel-preload.js
 *
 * Preload script for HUD Panel windows.
 * Exposes a minimal IPC bridge for receiving widget data and controlling the panel.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hudPanel', {
    // Get initial widget data (set during window creation)
    onContentUpdate: (callback) => {
        ipcRenderer.on('panel-content-update', (_, data) => callback(data));
    },

    // Request to close this panel
    closePanel: () => ipcRenderer.send('close-hud-panel'),

    // Minimize this panel
    minimizePanel: () => ipcRenderer.send('minimize-hud-panel'),

    // Notify main process of live updates (e.g., agent progress ticks)
    onProgressUpdate: (callback) => {
        ipcRenderer.on('panel-progress-update', (_, data) => callback(data));
    },

    // Cancel running agents
    cancelAgents: () => ipcRenderer.invoke('cancel-agents'),
});

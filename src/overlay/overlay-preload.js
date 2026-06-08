'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
    // Add or update a widget
    onWidgetUpdate: (callback) => {
        ipcRenderer.on('overlay-widget-update', (_, data) => callback(data));
    },

    // Remove widgets by type
    onWidgetClear: (callback) => {
        ipcRenderer.on('overlay-widget-clear', (_, data) => callback(data));
    },

    // Agent progress updates
    onProgressUpdate: (callback) => {
        ipcRenderer.on('overlay-progress-update', (_, data) => callback(data));
    },

    // Subtitle specific updates
    onSubtitleUpdate: (callback) => {
        ipcRenderer.on('overlay-subtitle-update', (_, data) => callback(data));
    },

    // Read local files
    readLocalImage: (filename) => ipcRenderer.invoke('read-local-image', filename),
    readLocalAudio: (filename) => ipcRenderer.invoke('read-local-audio', filename),

    // Close specific widget by ID (initiated from UI)
    closeWidget: (widgetId) => ipcRenderer.send('overlay-close-widget', widgetId),
    
    // Toggle pointer events for the overlay
    setIgnoreMouseEvents: (ignore) => ipcRenderer.send('overlay-ignore-mouse', ignore),
});

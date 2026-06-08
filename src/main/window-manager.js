/**
 * src/main/window-manager.js
 *
 * Intelligent multi-window manager for Summer's modular UI.
 * v3 - Migrated to Unified Transparent Overlay Architecture.
 * Delegates widget creation and updates to the central overlay window.
 */

'use strict';

const { ipcMain } = require('electron');
const windows = require('./windows');

class WindowManager {
    constructor() {
        this.activeWidgets = new Set();
        this._counter = 0;
        this._registerIpc();
    }

    _getOverlay() {
        return windows.getOverlayWindow();
    }

    // ── Create a HUD Panel widget ────────────────────────────────────────────

    createHudPanel({ id, type, data, title, width, height }) {
        const overlay = this._getOverlay();
        if (!overlay || overlay.isDestroyed()) return null;

        const widgetId = id || `hud-${++this._counter}-${Date.now()}`;
        
        // Dedup: for agent-gathering and agent-started, close any existing panel
        // of the same type to avoid flooding the screen with duplicates
        const DEDUP_TYPES = new Set(['agent-gathering', 'agent-started']);
        if (DEDUP_TYPES.has(type)) {
            this.closePanelsByType(type);
        }

        // Auto-close: transient widgets disappear after some time
        const AUTO_CLOSE_DELAYS = {
            welcome: 10000,
            weather: 15000,
            'agent-started': 8000,
        };
        const autoClose = AUTO_CLOSE_DELAYS[type] || 0;

        this.activeWidgets.add(widgetId);

        const payload = {
            id: widgetId,
            type,
            data,
            title,
            autoClose,
        };

        // Send to overlay frontend, wait if it's still loading
        if (overlay.webContents.isLoading()) {
            overlay.webContents.once('did-finish-load', () => {
                if (!overlay.isDestroyed()) overlay.webContents.send('overlay-widget-update', payload);
            });
        } else {
            overlay.webContents.send('overlay-widget-update', payload);
        }

        console.log(`[WindowManager] Spawning overlay widget: ${type} (${widgetId})`);
        return { widgetId, panel: null }; // returning panel: null to keep compat
    }

    // ── Create Subtitle Panel ────────────────────────────────────────────────

    createSubtitlePanel() {
        // Subtitle panel is now just a widget
        this.createHudPanel({
            type: 'subtitle',
            data: {},
            title: 'Transcript',
        });
        return { isDestroyed: () => false, focus: () => {} }; // Stub for backward compat
    }

    // ── Send subtitle text to subtitle panel ─────────────────────────────────

    sendSubtitleText(target, text) {
        this._sendSafe('overlay-subtitle-update', {
            id: 'subtitle', // the frontend will find any widget with type='subtitle'
            target,
            text,
        });
    }

    clearSubtitles() {
        this.sendSubtitleText('clear', '');
    }

    // ── Safe IPC Sender ──────────────────────────────────────────────────────
    
    _sendSafe(channel, payload) {
        const overlay = this._getOverlay();
        if (!overlay || overlay.isDestroyed()) return;

        if (overlay.webContents.isLoading()) {
            overlay.webContents.once('did-finish-load', () => {
                if (!overlay.isDestroyed()) overlay.webContents.send(channel, payload);
            });
        } else {
            overlay.webContents.send(channel, payload);
        }
    }

    // ── Update agent progress in existing panel ──────────────────────────────

    updateAgentProgress(sessionId, data) {
        const overlay = this._getOverlay();
        if (!overlay || overlay.isDestroyed()) return false;
        
        if (!this.activeWidgets.has(sessionId)) return false;

        this._sendSafe('overlay-progress-update', {
            id: sessionId,
            data,
        });
        return true;
    }

    // ── Close panels ─────────────────────────────────────────────────────────

    closePanel(widgetId) {
        const overlay = this._getOverlay();
        if (overlay && !overlay.isDestroyed()) {
            this._sendSafe('overlay-close-widget', widgetId);
        }
        this.activeWidgets.delete(widgetId);
    }

    closePanelsByType(type) {
        const overlay = this._getOverlay();
        if (overlay && !overlay.isDestroyed()) {
            this._sendSafe('overlay-widget-clear', { type });
        }
    }

    closeAllPanels() {
        const overlay = this._getOverlay();
        if (overlay && !overlay.isDestroyed()) {
            this._sendSafe('overlay-widget-clear', {});
        }
        this.activeWidgets.clear();
    }

    // ── IPC handlers ─────────────────────────────────────────────────────────

    _registerIpc() {
        ipcMain.on('overlay-close-widget', (event, widgetId) => {
            this.activeWidgets.delete(widgetId);
        });

        ipcMain.on('create-hud-panel', (_, payload) => {
            this.createHudPanel(payload);
        });
    }

    // ── Info ──────────────────────────────────────────────────────────────────

    getActivePanelCount() {
        return this.activeWidgets.size;
    }

    getActivePanelTypes() {
        return Array.from(this.activeWidgets);
    }
}

// Singleton
const windowManager = new WindowManager();
module.exports = windowManager;

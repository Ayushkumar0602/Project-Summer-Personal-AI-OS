/**
 * src/main/window-manager.js
 *
 * Intelligent multi-window manager for Summer's modular UI.
 * Handles:
 *   - Smart cascade positioning for HUD panels
 *   - Z-order management (click to bring to front)
 *   - Selective close (by widgetId, by type, or all)
 *   - Screen-aware placement (never off-screen)
 *   - Size presets per widget type
 */

'use strict';

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('node:path');

// ── Size presets per widget type ─────────────────────────────────────────────
const SIZE_PRESETS = {
    calendar:       { w: 360, h: 380 },
    emails:         { w: 400, h: 480 },
    news:           { w: 420, h: 520 },
    weather:        { w: 300, h: 200 },
    welcome:        { w: 320, h: 180 },
    mermaid:        { w: 600, h: 480 },
    image_gallery:  { w: 500, h: 380 },
    'full-email':   { w: 500, h: 550 },
    audio_player:   { w: 380, h: 200 },
    video_player:   { w: 640, h: 480 },
    file_viewer:    { w: 400, h: 200 },
    custom_html:    { w: 520, h: 600 },
    agent_progress: { w: 420, h: 360 },
    subtitle:       { w: 400, h: 180 },
};

class WindowManager {
    constructor() {
        /** @type {Map<string, { win: BrowserWindow, type: string }>} */
        this.hudPanels = new Map();
        this.subtitlePanel = null;
        this.cascadeOffset = { x: 0, y: 0 };
        this._counter = 0;
        this._registerIpc();
    }

    // ── Create a HUD Panel window ────────────────────────────────────────────

    createHudPanel({ type, data, title, width, height }) {
        const widgetId = `hud-${++this._counter}-${Date.now()}`;
        const preset = SIZE_PRESETS[type] || { w: 420, h: 450 };
        const w = width || preset.w;
        const h = height || preset.h;
        const { x, y } = this._getNextPosition(w, h);

        const panel = new BrowserWindow({
            width: w,
            height: h,
            x, y,
            frame: false,
            transparent: false,
            backgroundColor: '#0a0f1e',
            hasShadow: true,
            resizable: true,
            minimizable: true,
            maximizable: false,
            alwaysOnTop: false,
            skipTaskbar: false,
            roundedCorners: true,
            titleBarStyle: 'hidden',
            webPreferences: {
                preload: path.join(__dirname, '..', 'hud-panel', 'panel-preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });

        panel.webContents.once('did-finish-load', () => {
            panel.webContents.send('panel-content-update', {
                type,
                data,
                title: title || (SIZE_PRESETS[type] ? undefined : type),
            });
        });

        panel.loadFile(path.join(__dirname, '..', 'hud-panel', 'panel.html'));

        // Track in our map
        this.hudPanels.set(widgetId, { win: panel, type });

        panel.on('closed', () => {
            this.hudPanels.delete(widgetId);
        });

        // Smooth fade-in animation
        panel.setOpacity(0);
        let opacity = 0;
        const fadeIn = setInterval(() => {
            opacity += 0.08;
            if (opacity >= 1) {
                panel.setOpacity(1);
                clearInterval(fadeIn);
            } else {
                panel.setOpacity(opacity);
            }
        }, 16);

        console.log(`[WindowManager] Created HUD panel: ${type} (${widgetId}) at ${x},${y} [${w}x${h}]`);
        return { widgetId, panel };
    }

    // ── Create Subtitle Panel ────────────────────────────────────────────────

    createSubtitlePanel() {
        if (this.subtitlePanel && !this.subtitlePanel.isDestroyed()) {
            this.subtitlePanel.focus();
            return this.subtitlePanel;
        }

        // Position below center of screen
        const display = screen.getPrimaryDisplay();
        const { width: sw, height: sh } = display.workAreaSize;
        const w = 400;
        const h = 160;
        const x = Math.round((sw - w) / 2);
        const y = sh - h - 60;

        this.subtitlePanel = new BrowserWindow({
            width: w,
            height: h,
            x, y,
            frame: false,
            transparent: false,
            backgroundColor: '#0a0f1e',
            hasShadow: true,
            resizable: true,
            minimizable: true,
            maximizable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            roundedCorners: true,
            titleBarStyle: 'hidden',
            webPreferences: {
                preload: path.join(__dirname, '..', 'hud-panel', 'panel-preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });

        this.subtitlePanel.loadFile(path.join(__dirname, '..', 'hud-panel', 'panel.html'));

        this.subtitlePanel.webContents.once('did-finish-load', () => {
            this.subtitlePanel.webContents.send('panel-content-update', {
                type: 'subtitle',
                data: {},
                title: 'Transcript',
            });
        });

        this.subtitlePanel.on('closed', () => {
            this.subtitlePanel = null;
        });

        return this.subtitlePanel;
    }

    // ── Send subtitle text to subtitle panel ─────────────────────────────────

    sendSubtitleText(target, text) {
        if (!this.subtitlePanel || this.subtitlePanel.isDestroyed()) {
            this.createSubtitlePanel();
            // Wait for load then send
            this.subtitlePanel.webContents.once('did-finish-load', () => {
                // First send the initial content, then the update
                setTimeout(() => {
                    this.subtitlePanel.webContents.send('panel-content-update', {
                        type: 'subtitle_update',
                        target,
                        text,
                    });
                }, 100);
            });
            return;
        }
        this.subtitlePanel.webContents.send('panel-content-update', {
            type: 'subtitle_update',
            target,
            text,
        });
    }

    clearSubtitles() {
        this.sendSubtitleText('clear', '');
    }

    // ── Update agent progress in existing panel ──────────────────────────────

    updateAgentProgress(sessionId, data) {
        // Find existing agent_progress panel
        for (const [, entry] of this.hudPanels) {
            if (entry.type === 'agent_progress' && !entry.win.isDestroyed()) {
                entry.win.webContents.send('panel-progress-update', data);
                return true;
            }
        }
        return false;
    }

    // ── Close panels ─────────────────────────────────────────────────────────

    closePanel(widgetId) {
        const entry = this.hudPanels.get(widgetId);
        if (entry && !entry.win.isDestroyed()) {
            entry.win.close();
        }
        this.hudPanels.delete(widgetId);
    }

    closePanelsByType(type) {
        for (const [id, entry] of this.hudPanels) {
            if (entry.type === type && !entry.win.isDestroyed()) {
                entry.win.close();
            }
            if (entry.type === type) this.hudPanels.delete(id);
        }
    }

    closeAllPanels() {
        for (const [id, entry] of this.hudPanels) {
            if (!entry.win.isDestroyed()) entry.win.close();
        }
        this.hudPanels.clear();
        this.cascadeOffset = { x: 0, y: 0 };
    }

    // ── Smart Layout Positioning ─────────────────────────────────────────────

    _getNextPosition(width, height) {
        const display = screen.getPrimaryDisplay();
        const { width: sw, height: sh, x: sx, y: sy } = display.workArea;

        // Get bounds of all currently active panels
        const activeRects = [];
        for (const [, entry] of this.hudPanels) {
            if (!entry.win.isDestroyed() && entry.win.isVisible()) {
                activeRects.push(entry.win.getBounds());
            }
        }

        const margin = 20; // Margin between windows
        const startX = sx + sw - width - 30; // Start near top-right
        const startY = sy + 30;

        // Grid search approach
        const stepX = 50;
        const stepY = 50;

        // We scan from top-right towards bottom-left
        let bestX = startX;
        let bestY = startY;
        let foundClearSpot = false;

        // Scan Y first (top to bottom), then X (right to left)
        for (let testX = startX; testX >= sx + 10; testX -= stepX) {
            for (let testY = startY; testY <= sy + sh - height - 10; testY += stepY) {
                const testRect = { x: testX, y: testY, width: width + margin, height: height + margin };
                let collision = false;

                for (const rect of activeRects) {
                    // Check intersection
                    if (
                        testRect.x < rect.x + rect.width &&
                        testRect.x + testRect.width > rect.x &&
                        testRect.y < rect.y + rect.height &&
                        testRect.y + testRect.height > rect.y
                    ) {
                        collision = true;
                        break;
                    }
                }

                if (!collision) {
                    bestX = testX;
                    bestY = testY;
                    foundClearSpot = true;
                    break;
                }
            }
            if (foundClearSpot) break;
        }

        // If no completely clear spot, fallback to cascade
        if (!foundClearSpot) {
            bestX = startX - this.cascadeOffset.x;
            bestY = startY + this.cascadeOffset.y;
            
            this.cascadeOffset.x += 35;
            this.cascadeOffset.y += 35;
            if (bestX < sx || bestY + height > sy + sh) {
                this.cascadeOffset = { x: 35, y: 35 };
                bestX = startX;
                bestY = startY;
            }
        }

        return { x: Math.round(bestX), y: Math.round(bestY) };
    }

    // ── IPC handlers ─────────────────────────────────────────────────────────

    _registerIpc() {
        ipcMain.on('close-hud-panel', (event) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win && !win.isDestroyed()) {
                // Fade out animation
                let opacity = 1;
                const fadeOut = setInterval(() => {
                    opacity -= 0.12;
                    if (opacity <= 0) {
                        clearInterval(fadeOut);
                        if (!win.isDestroyed()) win.close();
                    } else {
                        if (!win.isDestroyed()) win.setOpacity(opacity);
                    }
                }, 16);
            }
        });

        ipcMain.on('minimize-hud-panel', (event) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win && !win.isDestroyed()) win.minimize();
        });

        // Allow orb to trigger HUD panel creation
        ipcMain.on('create-hud-panel', (_, payload) => {
            this.createHudPanel(payload);
        });
    }

    // ── Info ──────────────────────────────────────────────────────────────────

    getActivePanelCount() {
        return this.hudPanels.size;
    }

    getActivePanelTypes() {
        const types = [];
        for (const [, entry] of this.hudPanels) {
            types.push(entry.type);
        }
        return types;
    }
}

// Singleton
const windowManager = new WindowManager();
module.exports = windowManager;

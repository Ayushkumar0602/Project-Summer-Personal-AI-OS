/**
 * src/main/windows.js
 *
 * Electron BrowserWindow factories and accessors.
 *
 * v2 — Modular multi-window architecture:
 *   - Orb Window: small, transparent, always-on-top floating orb
 *   - HUD Panels: managed by window-manager.js
 *   - Memory / Settings: unchanged
 *   - Browser: separate on-demand window
 */

'use strict';

const { BrowserWindow } = require('electron');
const path = require('node:path');

let orbWindow = null;
let memoryWindow = null;
let settingsWindow = null;
let browserWindow = null;
let overlayWindow = null;

// ── Orb Window (Main) ────────────────────────────────────────────────────────

function createOrbWindow() {
    orbWindow = new BrowserWindow({
        width: 300,
        height: 380,
        frame: false,
        transparent: true,
        hasShadow: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: false,
        titleBarStyle: 'hidden',
        vibrancy: undefined,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    orbWindow.loadFile(path.join(__dirname, '..', 'orb', 'orb.html'));
    orbWindow.center();

    orbWindow.on('closed', () => { orbWindow = null; });

    return orbWindow;
}

function getOrbWindow() { return orbWindow; }

// ── Backwards compat: getMainWindow returns orbWindow ────────────────────────
// Many parts of the codebase reference getMainWindow() — this alias keeps them working
function getMainWindow() { return orbWindow; }

// ── Browser Window (On-demand) ───────────────────────────────────────────────

function createBrowserWindow() {
    if (browserWindow && !browserWindow.isDestroyed()) {
        browserWindow.focus();
        return browserWindow;
    }

    const { screen } = require('electron');
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    const browserWidth = Math.floor(width / 2);

    browserWindow = new BrowserWindow({
        x: width - browserWidth,
        y: 0,
        width: browserWidth,
        height: height,
        frame: false,
        transparent: false,
        backgroundColor: '#020c18',
        hasShadow: true,
        resizable: true,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            webviewTag: true,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    browserWindow.loadFile(path.join(__dirname, '..', 'browser', 'browser.html'));
    
    // Move Orb to the left side
    if (orbWindow && !orbWindow.isDestroyed()) {
        const bounds = orbWindow.getBounds();
        orbWindow.setBounds({
            x: Math.floor((browserWidth - bounds.width) / 2),
            y: Math.floor((height - bounds.height) / 2),
            width: bounds.width,
            height: bounds.height
        });
    }

    browserWindow.on('closed', () => { 
        browserWindow = null; 
        // Move Orb back to center
        if (orbWindow && !orbWindow.isDestroyed()) {
            orbWindow.center();
        }
    });

    return browserWindow;
}

function getBrowserWindow() { return browserWindow; }

// ── Memory Window ────────────────────────────────────────────────────────────

function createMemoryWindow() {
    if (memoryWindow && !memoryWindow.isDestroyed()) {
        memoryWindow.focus();
        return memoryWindow;
    }
    memoryWindow = new BrowserWindow({
        width: 1100,
        height: 700,
        title: 'Memory — Knowledge Graph',
        webPreferences: {
            preload: path.join(__dirname, '..', 'memory', 'memory-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    memoryWindow.loadFile(path.join(__dirname, '..', 'memory', 'memory.html'));
    memoryWindow.on('closed', () => { memoryWindow = null; });
    return memoryWindow;
}

// ── Settings Window ──────────────────────────────────────────────────────────

function createSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return settingsWindow;
    }
    settingsWindow = new BrowserWindow({
        width: 860,
        height: 680,
        title: 'Summer — Settings & Permissions',
        webPreferences: {
            preload: path.join(__dirname, '..', 'settings', 'settings-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    settingsWindow.loadFile(path.join(__dirname, '..', 'settings', 'settings.html'));
    settingsWindow.on('closed', () => { settingsWindow = null; });
    return settingsWindow;
}

function getMemoryWindow() { return memoryWindow; }

// ── Overlay Window (Unified HUD Canvas) ───────────────────────────────────────

function createOverlayWindow() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        return overlayWindow;
    }

    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    overlayWindow = new BrowserWindow({
        x: 0,
        y: 0,
        width: width,
        height: height,
        frame: false,
        transparent: true,
        hasShadow: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        focusable: false, // Prevents stealing OS focus
        webPreferences: {
            preload: path.join(__dirname, '..', 'overlay', 'overlay-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // CRITICAL: Allow clicks to pass through transparent areas to OS underneath
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });

    overlayWindow.loadFile(path.join(__dirname, '..', 'overlay', 'overlay.html'));

    overlayWindow.on('closed', () => { overlayWindow = null; });

    return overlayWindow;
}

function getOverlayWindow() { return overlayWindow; }

module.exports = {
    createOrbWindow,
    createMemoryWindow,
    createSettingsWindow,
    createBrowserWindow,
    createOverlayWindow,
    getOrbWindow,
    getMainWindow,
    getMemoryWindow,
    getBrowserWindow,
    getOverlayWindow,
};

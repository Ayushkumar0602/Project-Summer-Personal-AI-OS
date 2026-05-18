/**
 * Electron BrowserWindow factories and accessors.
 */

const { BrowserWindow } = require('electron');
const path = require('node:path');

let mainWindow = null;
let memoryWindow = null;
let settingsWindow = null;

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 900,
        frame: false,
        transparent: true,
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            webviewTag: true,
        },
    });
    mainWindow.maximize();
    mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
    return mainWindow;
}

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

function getMainWindow() { return mainWindow; }
function getMemoryWindow() { return memoryWindow; }

module.exports = {
    createMainWindow,
    createMemoryWindow,
    createSettingsWindow,
    getMainWindow,
    getMemoryWindow,
};

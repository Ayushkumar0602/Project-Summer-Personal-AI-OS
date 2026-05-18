/**
 * Wake word engine IPC handlers.
 */

function registerWakeWordIpc(ipcMain, getWakeWordEngine) {
    ipcMain.handle('get-wake-word-status', () => {
        const wakeWordEngine = getWakeWordEngine();
        if (!wakeWordEngine) return { available: false, reason: 'Engine not initialized' };
        return { available: true, ...wakeWordEngine.getStatus() };
    });

    ipcMain.on('set-wake-word-enabled', (event, enabled) => {
        const wakeWordEngine = getWakeWordEngine();
        if (!wakeWordEngine) return;
        if (enabled) {
            wakeWordEngine.resume();
        } else {
            wakeWordEngine.pause();
        }
    });

    ipcMain.on('set-wake-word-threshold', (event, threshold) => {
        const wakeWordEngine = getWakeWordEngine();
        if (!wakeWordEngine) return;
        wakeWordEngine.setThreshold(threshold);
    });
}

module.exports = { registerWakeWordIpc };

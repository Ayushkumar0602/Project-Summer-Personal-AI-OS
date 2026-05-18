/**
 * IPC bridge between main process tool calls and the renderer mini-browser.
 */

const { createBrowserAutomation, registerBrowserTabIpc, AUTOMATION_ACTIONS } = require('./browser-automation');

function createBrowserBridge(getMainWindow) {
    const pendingBrowserCalls = new Map();
    const automation = createBrowserAutomation(getMainWindow);

    async function callBrowser(action, args) {
        if (AUTOMATION_ACTIONS.has(action)) {
            try {
                const result = await automation.execute(action, args || {});
                return { result };
            } catch (e) {
                return { error: e.message };
            }
        }

        return new Promise((resolve) => {
            const id = Math.random().toString(36).substring(7);
            pendingBrowserCalls.set(id, resolve);
            const mainWindow = getMainWindow();
            if (mainWindow) {
                mainWindow.webContents.send('browser-control', { id, action, args });
            } else {
                resolve({ error: "No window" });
            }

            const timeoutMs = action === 'browser_navigate' ? 20000 : 15000;
            setTimeout(() => {
                if (pendingBrowserCalls.has(id)) {
                    pendingBrowserCalls.get(id)({ error: "Timeout waiting for browser" });
                    pendingBrowserCalls.delete(id);
                }
            }, timeoutMs);
        });
    }

    function handleBrowserReply(payload) {
        const { id } = payload;
        if (pendingBrowserCalls.has(id)) {
            pendingBrowserCalls.get(id)(payload);
            pendingBrowserCalls.delete(id);
        }
    }

    return { callBrowser, handleBrowserReply, automation };
}

function registerBrowserIpc(ipcMain, bridge) {
    registerBrowserTabIpc(ipcMain);

    ipcMain.on('browser-reply', (event, payload) => {
        bridge.handleBrowserReply(payload);
    });
}

module.exports = { createBrowserBridge, registerBrowserIpc };

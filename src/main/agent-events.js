/**
 * Forwards orchestrator agent lifecycle events to the main HUD window.
 */

function createEmitAgentEvent(getMainWindow) {
    return function emitAgentEvent(event, payload) {
        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send(event, payload);
        if (event === 'agent-progress') {
            mainWindow.webContents.send('show-hud-widget', {
                type: 'agent_progress',
                data: payload
            });
        } else if (event === 'agent-complete') {
            const filePath = payload.result?.file_path;
            mainWindow.webContents.send('show-hud-widget', {
                type: 'agent_progress',
                data: {
                    ...payload,
                    percent: 100,
                    message: filePath ? `Saved: ${filePath}` : 'Complete',
                    done: true,
                    file_path: filePath
                }
            });
        } else if (event === 'agent-fail' || event === 'agent-killed') {
            mainWindow.webContents.send('show-hud-widget', {
                type: 'agent_progress',
                data: { ...payload, percent: 0, message: payload.error?.error || payload.reason || 'Stopped', failed: true }
            });
        }
    };
}

module.exports = { createEmitAgentEvent };

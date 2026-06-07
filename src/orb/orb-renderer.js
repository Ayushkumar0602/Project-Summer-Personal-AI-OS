/**
 * src/orb/orb-renderer.js
 *
 * Renderer entry for the floating Orb window.
 * Handles orb interactions, session events, tool status, wake word,
 * command palette, and sessions modal — but NO HUD widgets or browser.
 * HUD widgets spawn as separate BrowserWindows via the main process.
 */

const orbState = require('./renderer/ui/orb-state.js');
const { audioQueue, initAudioQueueDeps } = require('./renderer/audio/audio-queue.js');
const contextBuilder = require('./renderer/session/context-builder.js');
const vadRecorder = require('./renderer/audio/vad-recorder.js');
const wakeWordUi = require('./renderer/ui/wake-word-ui.js');
const sessionEvents = require('./renderer/session/session-events.js');
const commandPalette = require('./renderer/ui/command-palette.js');
const sessionsModal = require('./renderer/ui/sessions-modal.js');

// ── Initialize dependency injection ──────────────────────────────────────────

initAudioQueueDeps({
    setOrbState: orbState.setOrbState,
    getIsConnected: orbState.getIsConnected,
});
orbState.initOrbStateDeps({ audioQueue });
contextBuilder.initContextBuilder({ setOrbState: orbState.setOrbState });

vadRecorder.initVadRecorder({
    setOrbState: orbState.setOrbState,
    getIsConnected: orbState.getIsConnected,
    setIsConnected: orbState.setIsConnected,
    sendAudioChunk: (base64) => window.liveAPI.sendAudioChunk(base64),
    sendTurnComplete: () => window.liveAPI.sendTurnComplete(),
    audioQueue,
    clearPendingTimeouts: orbState.clearPendingTimeouts,
});

// Create a stub hudManager that delegates to main process
// (HUD widgets are now separate windows, not in-DOM elements)
const hudManagerStub = {
    showWidget: (type, data, append, width, height) => {
        // Forward to main process which will create a HUD panel window
        if (window.liveAPI && window.liveAPI.showHudWidget) {
            window.liveAPI.showHudWidget({ type, data, append, width, height });
        }
    },
};

sessionEvents.initSessionEvents({
    setOrbState: orbState.setOrbState,
    getIsConnected: orbState.getIsConnected,
    setIsConnected: orbState.setIsConnected,
    getIsConnecting: orbState.getIsConnecting,
    setIsConnecting: orbState.setIsConnecting,
    getUserDisconnected: orbState.getUserDisconnected,
    setUserDisconnected: orbState.setUserDisconnected,
    getAutoReconnectTimer: orbState.getAutoReconnectTimer,
    setAutoReconnectTimer: orbState.setAutoReconnectTimer,
    clearAllText: orbState.clearAllText,
    updateSubtitle: orbState.updateSubtitle,
    updateUserSubtitle: orbState.updateUserSubtitle,
    audioQueue,
    startRecording: vadRecorder.startRecording,
    stopRecording: vadRecorder.stopRecording,
    hudManager: hudManagerStub,
    setWakeWordIndicator: wakeWordUi.setWakeWordIndicator,
});

wakeWordUi.initWakeWord({
    getIsConnected: orbState.getIsConnected,
    getIsConnecting: orbState.getIsConnecting,
    setIsConnecting: orbState.setIsConnecting,
    setUserDisconnected: orbState.setUserDisconnected,
    setOrbState: orbState.setOrbState,
    clearAllText: orbState.clearAllText,
    buildContextPayload: contextBuilder.buildContextPayload,
    setLastContextPayload: sessionEvents.setLastContextPayload,
});

commandPalette.initCommandPalette({
    setOrbState: orbState.setOrbState,
    getIsConnected: orbState.getIsConnected,
});

sessionsModal.initSessionsModal({
    setOrbState: orbState.setOrbState,
    setSelectedContinueDiary: contextBuilder.setSelectedContinueDiary,
});
window.closeSessionsModal = sessionsModal.closeSessionsModal;
window.continueSession = sessionsModal.continueSession;

// ── Orb Click Handler ────────────────────────────────────────────────────────

document.querySelector('.orb-wrapper').addEventListener('click', async () => {
    if (orbState.getIsConnected()) {
        orbState.setUserDisconnected(true);
        const timer = orbState.getAutoReconnectTimer();
        if (timer) clearTimeout(timer);
        window.liveAPI.stopSession();
        vadRecorder.stopRecording();
        orbState.setIsConnected(false);
        orbState.setOrbState('idle', 'Click Orb to Connect');
        orbState.clearAllText();
        contextBuilder.setSelectedContinueDiary(null);
        wakeWordUi.setWakeWordIndicator('listening');
    } else {
        if (orbState.getIsConnecting()) return;
        orbState.setIsConnecting(true);
        orbState.setUserDisconnected(false);
        orbState.setOrbState('thinking', 'Connecting to Gemini...');
        orbState.clearAllText();

        const contextPayload = await contextBuilder.buildContextPayload();
        orbState.setOrbState('thinking', 'Connecting to Gemini...');
        sessionEvents.setLastContextPayload(contextPayload);
        window.liveAPI.startSession(contextPayload);

        setTimeout(() => { orbState.setIsConnecting(false); }, 5000);
    }
});

orbState.setOrbState('idle', 'Click to Activate');

// ── Button Handlers ──────────────────────────────────────────────────────────

const settingsBtn = document.getElementById('settingsBtn');
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        if (window.liveAPI) window.liveAPI.openSettingsWindow();
    });
}

const memoryBtn = document.getElementById('memoryBtn');
if (memoryBtn) {
    memoryBtn.addEventListener('click', () => {
        if (window.liveAPI) window.liveAPI.openMemoryWindow();
    });
}

const sessionsBtn = document.getElementById('sessionsBtn');
if (sessionsBtn) {
    sessionsBtn.addEventListener('click', () => {
        sessionsModal.openSessionsModal();
    });
}

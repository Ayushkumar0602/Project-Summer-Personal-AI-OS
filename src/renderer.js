const orbState = require('./renderer/ui/orb-state.js');
const { audioQueue, initAudioQueueDeps } = require('./renderer/audio/audio-queue.js');
const contextBuilder = require('./renderer/session/context-builder.js');
const vadRecorder = require('./renderer/audio/vad-recorder.js');
const wakeWordUi = require('./renderer/ui/wake-word-ui.js');
const { hudManager } = require('./renderer/hud/widget-manager.js');
const sessionEvents = require('./renderer/session/session-events.js');
const commandPalette = require('./renderer/ui/command-palette.js');
const sessionsModal = require('./renderer/ui/sessions-modal.js');
const miniBrowser = require('./renderer/browser/mini-browser.js');

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
    hudManager,
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

miniBrowser.initMiniBrowser({
    setOrbState: orbState.setOrbState,
    updateSubtitle: orbState.updateSubtitle,
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

document.querySelector('.orb-container').addEventListener('click', async () => {
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
        wakeWordUi.setWakeWordIndicator('listening');
    } else {
        if (orbState.getIsConnecting()) return; // Prevent multiple clicks
        
        orbState.setIsConnecting(true);
        orbState.setUserDisconnected(false);
        orbState.setOrbState('thinking', 'Connecting to Gemini...');
        orbState.clearAllText();

        const contextPayload = await contextBuilder.buildContextPayload();

        orbState.setOrbState('thinking', 'Connecting to Gemini...');
        sessionEvents.setLastContextPayload(contextPayload);
        window.liveAPI.startSession(contextPayload);
        
        // Reset connecting state after a safe margin if connection fails
        setTimeout(() => { orbState.setIsConnecting(false); }, 5000);
    }
});

orbState.setOrbState('idle', 'Click to Activate');

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

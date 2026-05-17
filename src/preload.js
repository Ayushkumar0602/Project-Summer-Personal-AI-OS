const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liveAPI', {
    sendVoice: (audioBuffer) => ipcRenderer.send('voice-message', audioBuffer),
    onProcessingStart: (callback) => ipcRenderer.on('processing-start', () => callback()),
    onAudioData: (callback) => ipcRenderer.on('tts-audio-data', (event, payload) => callback(payload)),
    onAudioChunkEnd: (callback) => ipcRenderer.on('tts-audio-chunk-end', (event, payload) => callback(payload)),
    onStreamEnd: (callback) => ipcRenderer.on('llm-stream-end', () => callback()),
    
    // Live API methods
    startSession: (contextPayload) => ipcRenderer.send('start-session', contextPayload),
    stopSession: () => ipcRenderer.send('stop-session'),
    sendAudioChunk: (base64String) => ipcRenderer.send('realtime-audio', base64String),
    sendTurnComplete: () => ipcRenderer.send('turn-complete'),
    sendTextCommand: (text) => ipcRenderer.send('send-text-command', text),
    
    onSessionStarted: (callback) => ipcRenderer.on('session-started', () => callback()),
    onSessionEnded: (callback) => ipcRenderer.on('session-ended', () => callback()),
    onAgentAudio: (callback) => ipcRenderer.on('agent-audio', (event, base64Audio) => callback(base64Audio)),
    onAgentText: (callback) => ipcRenderer.on('agent-text', (event, text) => callback(text)),
    onUserText: (callback) => ipcRenderer.on('user-text', (event, text) => callback(text)),
    onAgentTurnComplete: (callback) => ipcRenderer.on('agent-turn-complete', () => callback()),
    onAgentInterrupted: (callback) => ipcRenderer.on('agent-interrupted', () => callback()),
    onError: (callback) => ipcRenderer.on('agent-error', (event, err) => callback(err)),
    onToolCall: (callback) => ipcRenderer.on('agent-tool-call', (event, payload) => callback(payload)),
    onToolComplete: (callback) => ipcRenderer.on('agent-tool-complete', (event, payload) => callback(payload)),
    onBrowserControl: (callback) => ipcRenderer.on('browser-control', (event, payload) => callback(payload)),
    onShowHudWidget: (callback) => ipcRenderer.on('show-hud-widget', (event, payload) => callback(payload)),
    onAgentProgress: (callback) => ipcRenderer.on('agent-progress', (event, payload) => callback(payload)),
    onAgentComplete: (callback) => ipcRenderer.on('agent-complete', (event, payload) => callback(payload)),
    onAgentFail: (callback) => ipcRenderer.on('agent-fail', (event, payload) => callback(payload)),
    onAgentGathering: (callback) => ipcRenderer.on('agent-gathering', (event, payload) => callback(payload)),
    sendBrowserReply: (payload) => ipcRenderer.send('browser-reply', payload),
    openMemoryWindow: () => ipcRenderer.send('open-memory-window'),
    openSettingsWindow: () => ipcRenderer.send('open-settings-window'),
    getDiary: () => ipcRenderer.invoke('get-diary'),
    getGoogleContext: () => ipcRenderer.invoke('get-google-context'),
    authenticateGoogle: () => ipcRenderer.invoke('authenticate-google'),
    logoutGoogle: () => ipcRenderer.invoke('logout-google'),
    checkGoogleAuth: () => ipcRenderer.invoke('check-google-auth'),
    readLocalImage: (filename) => ipcRenderer.invoke('read-local-image', filename),
    cancelAgents: () => ipcRenderer.invoke('cancel-agents'),

    // Wake Word
    onWakeWordDetected: (callback) => ipcRenderer.on('wake-word-detected', (event, payload) => callback(payload)),
    getWakeWordStatus: () => ipcRenderer.invoke('get-wake-word-status'),
    setWakeWordEnabled: (enabled) => ipcRenderer.send('set-wake-word-enabled', enabled),
    setWakeWordThreshold: (threshold) => ipcRenderer.send('set-wake-word-threshold', threshold),
});

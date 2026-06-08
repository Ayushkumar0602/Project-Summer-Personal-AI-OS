const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
    getPermissions: () => ipcRenderer.invoke('get-permissions'),
    revokePermission: (toolName) => ipcRenderer.invoke('revoke-permission', toolName),
    revokeAllPermissions: () => ipcRenderer.invoke('revoke-all-permissions'),
    getAuditLogs: () => ipcRenderer.invoke('get-audit-logs'),

    // Google — Multi-Account
    authenticateGoogle: () => ipcRenderer.invoke('authenticate-google'),
    logoutGoogle: (accountId) => ipcRenderer.invoke('logout-google', accountId),
    logoutGoogleAccount: (accountId) => ipcRenderer.invoke('logout-google-account', accountId),
    checkGoogleAuth: () => ipcRenderer.invoke('check-google-auth'),
    getGoogleAccounts: () => ipcRenderer.invoke('get-google-accounts'),
    setPrimaryGoogleAccount: (accountId) => ipcRenderer.invoke('set-primary-google-account', accountId),

    // Wake Word
    getWakeWordStatus: () => ipcRenderer.invoke('get-wake-word-status'),
    setWakeWordEnabled: (enabled) => ipcRenderer.send('set-wake-word-enabled', enabled),
    setWakeWordThreshold: (threshold) => ipcRenderer.send('set-wake-word-threshold', threshold),

    // Daemon / Devices
    getDaemonStatus: () => ipcRenderer.invoke('get-daemon-status'),
    getPairingToken: () => ipcRenderer.invoke('get-pairing-token'),

    // Voice Config
    getGeminiVoice: () => ipcRenderer.invoke('get-gemini-voice'),
    setGeminiVoice: (voice) => ipcRenderer.invoke('set-gemini-voice', voice),
});

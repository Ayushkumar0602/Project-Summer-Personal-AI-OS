const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
    getPermissions: () => ipcRenderer.invoke('get-permissions'),
    revokePermission: (toolName) => ipcRenderer.invoke('revoke-permission', toolName),
    revokeAllPermissions: () => ipcRenderer.invoke('revoke-all-permissions'),
    getAuditLogs: () => ipcRenderer.invoke('get-audit-logs'),
    authenticateGoogle: () => ipcRenderer.invoke('authenticate-google'),
    logoutGoogle: () => ipcRenderer.invoke('logout-google'),
    checkGoogleAuth: () => ipcRenderer.invoke('check-google-auth'),

    // Wake Word
    getWakeWordStatus: () => ipcRenderer.invoke('get-wake-word-status'),
    setWakeWordEnabled: (enabled) => ipcRenderer.send('set-wake-word-enabled', enabled),
    setWakeWordThreshold: (threshold) => ipcRenderer.send('set-wake-word-threshold', threshold),

    // Daemon / Devices
    getDaemonStatus: () => ipcRenderer.invoke('get-daemon-status'),
    getPairingToken: () => ipcRenderer.invoke('get-pairing-token'),
});

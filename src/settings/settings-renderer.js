// ── Settings Renderer ──────────────────────────────────────────
// Tab switching, permission display/revocation, audit log viewer

// Tool name → human-friendly labels and icons
const TOOL_META = {
    os_quit_app:      { label: 'Quit Applications',    icon: '❌' },
    os_system_sleep:  { label: 'System Sleep',         icon: '😴' },
    os_lock_screen:   { label: 'Lock Screen',          icon: '🔒' },
    os_empty_trash:   { label: 'Empty Trash',          icon: '🗑️' },
};

// ── Tab Switching ──────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
});

// ── Permissions Tab ────────────────────────────────────────────
async function loadPermissions() {
    const perms = await window.settingsAPI.getPermissions();
    const list = document.getElementById('permissionsList');

    const entries = Object.entries(perms).filter(([_, v]) => v.granted);

    if (entries.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🛡️</div>
                <div>No permanent permissions granted yet.</div>
                <div style="margin-top:6px;font-size:12px;color:#4a5a78;">
                    When Summer asks to perform a dangerous action and you approve it,<br>
                    the permission will appear here for future one-click access.
                </div>
            </div>
        `;
        return;
    }

    list.innerHTML = entries.map(([toolName, data]) => {
        const meta = TOOL_META[toolName] || { label: toolName, icon: '⚙️' };
        const date = new Date(data.grantedAt).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        return `
            <div class="permission-item" data-tool="${toolName}">
                <div class="permission-info">
                    <div class="permission-icon">${meta.icon}</div>
                    <div class="permission-details">
                        <h4>${data.label || meta.label}</h4>
                        <span>Granted on ${date}</span>
                    </div>
                </div>
                <button class="btn-revoke" onclick="revokePermission('${toolName}')">Revoke</button>
            </div>
        `;
    }).join('');
}

async function revokePermission(toolName) {
    await window.settingsAPI.revokePermission(toolName);
    loadPermissions(); // Refresh
}

document.getElementById('revokeAllBtn').addEventListener('click', async () => {
    await window.settingsAPI.revokeAllPermissions();
    loadPermissions();
});

// ── System Access Tab ──────────────────────────────────────────
document.getElementById('openSystemPrefsBtn')?.addEventListener('click', () => {
    // This triggers the main process to open System Settings via shell
    // We use a workaround: open via window.open since we can't call shell from renderer
    window.settingsAPI.revokePermission('__open_system_prefs__'); // Trigger IPC, main process handles it
});

// ── Audit Log Tab ──────────────────────────────────────────────
async function loadAuditLogs() {
    const content = document.getElementById('auditLogContent');

    try {
        const logs = await window.settingsAPI.getAuditLogs();
        if (!logs || logs.length === 0) {
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <div>No actions logged yet. Start using Summer's OS tools to see entries here.</div>
                </div>
            `;
            return;
        }

        content.innerHTML = logs.reverse().map(entry => {
            const time = new Date(entry.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const statusIcon = entry.approved ? '✅' : '🚫';
            const args = entry.args ? JSON.stringify(entry.args) : '';

            return `
                <div class="log-entry">
                    <span class="log-time">${time}</span>
                    <span class="log-status">${statusIcon}</span>
                    <span class="log-action">${entry.action}</span>
                    <span class="log-detail">${args}</span>
                </div>
            `;
        }).join('');
    } catch (e) {
        content.innerHTML = `<div class="empty-state">Error loading logs: ${e.message}</div>`;
    }
}

// Initial load
loadPermissions();
loadAuditLogs();

// ── Google Integrations Tab ─────────────────────────────────────
const btnConnectGoogle = document.getElementById('btnConnectGoogle');
const btnDisconnectGoogle = document.getElementById('btnDisconnectGoogle');
const googleAuthStatus = document.getElementById('googleAuthStatus');

async function checkGoogleAuth() {
    try {
        const isAuth = await window.settingsAPI.checkGoogleAuth();
        if (isAuth) {
            googleAuthStatus.innerHTML = '<span style="color:#4ade80; font-size:12px;">Status: Connected ✅</span>';
            btnConnectGoogle.style.display = 'none';
            btnDisconnectGoogle.style.display = 'block';
        } else {
            googleAuthStatus.innerHTML = '<span style="color:#f87171; font-size:12px;">Status: Not Connected ❌</span>';
            btnConnectGoogle.style.display = 'block';
            btnDisconnectGoogle.style.display = 'none';
        }
    } catch (e) {
        googleAuthStatus.innerHTML = `<span style="color:#f87171; font-size:12px;">Status: Error checking auth</span>`;
    }
}

btnConnectGoogle?.addEventListener('click', async () => {
    btnConnectGoogle.disabled = true;
    googleAuthStatus.innerHTML = '<span style="color:#eab308; font-size:12px;">Status: Waiting for browser login...</span>';
    const res = await window.settingsAPI.authenticateGoogle();
    if (res.success) {
        await checkGoogleAuth();
    } else {
        googleAuthStatus.innerHTML = `<span style="color:#f87171; font-size:12px;">Status: Auth Failed (${res.message})</span>`;
        btnConnectGoogle.disabled = false;
    }
});

btnDisconnectGoogle?.addEventListener('click', async () => {
    await window.settingsAPI.logoutGoogle();
    await checkGoogleAuth();
});

// Check on load
checkGoogleAuth();

// ── Wake Word Tab ───────────────────────────────────────────────
const wakeWordToggle = document.getElementById('wakeWordToggle');
const wakeWordStatusLabel = document.getElementById('wakeWordStatusLabel');
const wakeWordThreshold = document.getElementById('wakeWordThreshold');
const thresholdValue = document.getElementById('thresholdValue');
const wakeWordEngineStatus = document.getElementById('wakeWordEngineStatus');
const refreshWakeStatusBtn = document.getElementById('refreshWakeStatusBtn');

// Toggle on/off
wakeWordToggle?.addEventListener('change', () => {
    const enabled = wakeWordToggle.checked;
    window.settingsAPI.setWakeWordEnabled(enabled);
    if (enabled) {
        wakeWordStatusLabel.textContent = 'Active — Listening';
        wakeWordStatusLabel.style.color = '#22c55e';
    } else {
        wakeWordStatusLabel.textContent = 'Disabled';
        wakeWordStatusLabel.style.color = '#64748b';
    }
});

// Sensitivity slider
wakeWordThreshold?.addEventListener('input', () => {
    const val = parseFloat(wakeWordThreshold.value);
    thresholdValue.textContent = val.toFixed(2);
});

wakeWordThreshold?.addEventListener('change', () => {
    const val = parseFloat(wakeWordThreshold.value);
    window.settingsAPI.setWakeWordThreshold(val);
});

// Engine status display
async function loadWakeWordStatus() {
    try {
        const status = await window.settingsAPI.getWakeWordStatus();
        if (!status || !status.available) {
            wakeWordEngineStatus.innerHTML = `<span style="color:#f87171;">⚠️ Engine unavailable: ${status?.reason || 'Unknown'}</span>`;
            wakeWordToggle.checked = false;
            wakeWordToggle.disabled = true;
            wakeWordStatusLabel.textContent = 'Unavailable';
            wakeWordStatusLabel.style.color = '#f87171';
            return;
        }

        const running = status.isRunning ? '🟢 Running' : '🔴 Stopped';
        const paused = status.isPaused ? ' (Paused — session active)' : '';
        const threshold = status.threshold?.toFixed(2) || '0.50';
        const melRows = status.melRowsBuffered || 0;
        const embeddings = status.embeddingsBuffered || 0;
        const chunks = status.chunksProcessed || 0;
        const queue = status.queueDepth || 0;

        wakeWordEngineStatus.innerHTML = `
            <div>Status: <strong>${running}${paused}</strong></div>
            <div>Threshold: <strong>${threshold}</strong></div>
            <div>Chunks processed: <strong>${chunks.toLocaleString()}</strong></div>
            <div>Mel rows buffered: <strong>${melRows}</strong></div>
            <div>Embeddings buffered: <strong>${embeddings}</strong></div>
            <div>Queue depth: <strong>${queue}</strong></div>
        `;

        // Sync toggle state
        wakeWordToggle.checked = status.isRunning && !status.isPaused;
        wakeWordThreshold.value = status.threshold || 0.5;
        thresholdValue.textContent = (status.threshold || 0.5).toFixed(2);

        if (status.isRunning && !status.isPaused) {
            wakeWordStatusLabel.textContent = 'Active — Listening';
            wakeWordStatusLabel.style.color = '#22c55e';
        } else if (status.isPaused) {
            wakeWordStatusLabel.textContent = 'Paused — Session Active';
            wakeWordStatusLabel.style.color = '#eab308';
        } else {
            wakeWordStatusLabel.textContent = 'Disabled';
            wakeWordStatusLabel.style.color = '#64748b';
        }
    } catch (e) {
        wakeWordEngineStatus.innerHTML = `<span style="color:#f87171;">Error: ${e.message}</span>`;
    }
}

refreshWakeStatusBtn?.addEventListener('click', loadWakeWordStatus);

// Load on init
loadWakeWordStatus();

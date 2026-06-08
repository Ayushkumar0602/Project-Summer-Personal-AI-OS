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

// ── Google Multi-Account Integrations ───────────────────────────────────────
const btnAddGoogleAccount = document.getElementById('btnAddGoogleAccount');
const googleAddStatus = document.getElementById('googleAddStatus');
const googleAccountsList = document.getElementById('googleAccountsList');

async function loadGoogleAccounts() {
    try {
        const accounts = await window.settingsAPI.getGoogleAccounts();

        if (!accounts || accounts.length === 0) {
            googleAccountsList.innerHTML = `
                <div style="padding: 14px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
                    <div style="color:#94a3b8; font-size:13px;">No Google accounts connected yet.</div>
                    <div style="color:#475569; font-size:11px; margin-top:4px;">Click "Add Google Account" below to connect your first account.</div>
                </div>
            `;
            return;
        }

        googleAccountsList.innerHTML = accounts.map(account => {
            const primaryBadge = account.isPrimary
                ? '<span style="background:linear-gradient(135deg,#06b6d4,#0ea5e9); color:#fff; padding:2px 8px; border-radius:9px; font-size:10px; font-weight:700; letter-spacing:0.5px; margin-left:8px;">PRIMARY</span>'
                : '';
            const setPrimaryBtn = !account.isPrimary
                ? `<button class="btn-set-primary" onclick="setPrimaryAccount('${account.id}')" style="font-size:11px; padding:4px 10px; background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.3); color:#06b6d4; border-radius:6px; cursor:pointer; transition:all 0.2s;">Set Primary</button>`
                : '';
            const disconnectBtn = `<button class="btn-disconnect-account" onclick="disconnectAccount('${account.id}')" style="font-size:11px; padding:4px 10px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); color:#f87171; border-radius:6px; cursor:pointer; transition:all 0.2s;">Disconnect</button>`;
            const addedDate = account.addedAt ? new Date(account.addedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

            return `
                <div class="google-account-item" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:rgba(255,255,255,0.03); border-radius:8px; border:1px solid rgba(255,255,255,0.06); margin-bottom:8px; transition:all 0.2s;">
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; flex-wrap:wrap;">
                            <span style="font-size:13px; font-weight:600; color:#e2e8f0;">${account.email}</span>
                            ${primaryBadge}
                        </div>
                        <div style="font-size:11px; color:#475569; margin-top:3px;">Added ${addedDate}</div>
                    </div>
                    <div style="display:flex; gap:6px; flex-shrink:0; margin-left:12px;">
                        ${setPrimaryBtn}
                        ${disconnectBtn}
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        googleAccountsList.innerHTML = `<span style="color:#f87171; font-size:12px;">Error loading accounts: ${e.message}</span>`;
    }
}

// Global functions for inline onclick handlers
window.setPrimaryAccount = async function(accountId) {
    try {
        await window.settingsAPI.setPrimaryGoogleAccount(accountId);
        await loadGoogleAccounts();
    } catch (e) {
        console.error('Failed to set primary account:', e);
    }
};

window.disconnectAccount = async function(accountId) {
    try {
        await window.settingsAPI.logoutGoogleAccount(accountId);
        await loadGoogleAccounts();
    } catch (e) {
        console.error('Failed to disconnect account:', e);
    }
};

btnAddGoogleAccount?.addEventListener('click', async () => {
    btnAddGoogleAccount.disabled = true;
    googleAddStatus.textContent = 'Waiting for browser login...';
    googleAddStatus.style.color = '#eab308';

    try {
        const res = await window.settingsAPI.authenticateGoogle();
        if (res.success) {
            googleAddStatus.textContent = `✅ Connected ${res.email || ''}`;
            googleAddStatus.style.color = '#4ade80';
            await loadGoogleAccounts();
            setTimeout(() => { googleAddStatus.textContent = ''; }, 3000);
        } else {
            googleAddStatus.textContent = `❌ Failed: ${res.message}`;
            googleAddStatus.style.color = '#f87171';
        }
    } catch (e) {
        googleAddStatus.textContent = `❌ Error: ${e.message}`;
        googleAddStatus.style.color = '#f87171';
    }

    btnAddGoogleAccount.disabled = false;
});

// Load accounts on init
loadGoogleAccounts();

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

// ── Devices Tab ─────────────────────────────────────────────────
const PLATFORM_ICONS = {
    electron: '🖥️', ios: '📱', android: '📱', web: '🌐', cli: '⌨️', unknown: '❓', 'test-client': '🧪'
};

async function loadDevicesTab() {
    await Promise.all([loadDaemonStatus(), loadConnectedClients(), loadPairingQR()]);
}

async function loadDaemonStatus() {
    const el = document.getElementById('daemonStatus');
    try {
        const s = await window.settingsAPI.getDaemonStatus();
        const dot   = s.status === 'connected' ? '🟢' : '🟡';
        const color = s.status === 'connected' ? '#22c55e' : '#eab308';
        el.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; font-size:13px;">
                <span>${dot}</span>
                <span style="color:${color}; font-weight:600;">${s.status === 'connected' ? 'Running' : 'Connecting…'}</span>
                <span style="color:#475569;">ws://localhost:${s.port}</span>
            </div>
            <div style="font-size:12px; color:#475569; margin-top:6px;">${s.clients?.length || 0} device(s) connected</div>
        `;
    } catch (e) {
        el.innerHTML = `<span style="color:#f87171; font-size:13px;">⚠️ Cannot reach daemon: ${e.message}</span>`;
    }
}

async function loadConnectedClients() {
    const el = document.getElementById('connectedClients');
    try {
        const s = await window.settingsAPI.getDaemonStatus();
        const clients = s.clients || [];
        if (clients.length === 0) {
            el.innerHTML = `<span style="color:#475569; font-size:13px;">No devices connected yet.</span>`;
            return;
        }
        el.innerHTML = clients.map(c => {
            const icon    = PLATFORM_ICONS[c.platform] || '❓';
            const elapsed = Math.round((Date.now() - c.connectedAt) / 1000);
            const time    = elapsed < 60 ? `${elapsed}s ago` : `${Math.round(elapsed/60)}m ago`;
            const badge   = c.isActive ? '<span style="background:#0ea5e9;color:#fff;padding:2px 7px;border-radius:9px;font-size:10px;font-weight:700;">ACTIVE</span>' : '';
            return `
                <div style="display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                    <span style="font-size:20px;">${icon}</span>
                    <div style="flex:1;">
                        <div style="font-size:13px; font-weight:600; color:#e2e8f0;">${c.deviceName} ${badge}</div>
                        <div style="font-size:11px; color:#475569;">${c.platform} · connected ${time}</div>
                    </div>
                    <div style="text-align:right; font-size:11px; color:#334155;">
                        ${c.hasMic ? '🎤' : ''} ${c.hasScreen ? '🖥️' : ''}
                    </div>
                </div>`;
        }).join('');
    } catch (e) {
        el.innerHTML = `<span style="color:#f87171; font-size:12px;">Error: ${e.message}</span>`;
    }
}

async function loadPairingQR() {
    const qrEl      = document.getElementById('qrCodeContainer');
    const detailsEl = document.getElementById('pairingDetails');
    try {
        const { token } = await window.settingsAPI.getPairingToken();
        if (!token) {
            qrEl.innerHTML = `<span style="color:#f87171;font-size:11px;">Token unavailable</span>`;
            return;
        }

        // Get local IP via RTCPeerConnection trick (works in renderer)
        let localIP = '(your Mac IP)';
        try {
            const pc = new RTCPeerConnection({ iceServers: [] });
            pc.createDataChannel('');
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await new Promise(r => setTimeout(r, 500));
            const sdp = pc.localDescription?.sdp || '';
            const ipMatch = sdp.match(/c=IN IP4 (\d+\.\d+\.\d+\.\d+)/);
            if (ipMatch && !ipMatch[1].startsWith('0.')) localIP = ipMatch[1];
            pc.close();
        } catch (_) {}

        const pairingPayload = JSON.stringify({
            host:  localIP,
            port:  8765,
            token: token
        });

        // Generate QR
        qrEl.innerHTML = '';
        const canvas = document.createElement('canvas');
        qrEl.appendChild(canvas);
        if (window.QRCode) {
            QRCode.toCanvas(canvas, pairingPayload, {
                width: 140, margin: 1,
                color: { dark: '#0f172a', light: '#ffffff' }
            });
        } else {
            qrEl.innerHTML = `<span style="font-size:10px;color:#f87171;">QRCode lib not loaded</span>`;
        }

        detailsEl.innerHTML = `
            <div>Host: <strong style="color:#e2e8f0;">${localIP}</strong></div>
            <div>Port: <strong style="color:#e2e8f0;">8765</strong></div>
            <div>Token: <strong style="color:#06b6d4; word-break:break-all;">${token.slice(0,16)}…</strong></div>
        `;

        document.getElementById('copyTokenBtn')?.addEventListener('click', () => {
            navigator.clipboard.writeText(pairingPayload);
            const btn = document.getElementById('copyTokenBtn');
            btn.textContent = '✅ Copied!';
            setTimeout(() => { btn.textContent = '📋 Copy Token'; }, 2000);
        });

    } catch (e) {
        qrEl.innerHTML = `<span style="color:#f87171;font-size:11px;">Error: ${e.message}</span>`;
    }
}

// Activate devices tab on click
document.querySelector('[data-tab="devices"]')?.addEventListener('click', loadDevicesTab);
document.getElementById('refreshDevicesBtn')?.addEventListener('click', () => {
    loadDaemonStatus();
    loadConnectedClients();
});

// ── Voice Settings ───────────────────────────────────────────────
const geminiVoiceSelect = document.getElementById('geminiVoiceSelect');

async function loadVoiceSettings() {
    if (!geminiVoiceSelect) return;
    try {
        const voice = await window.settingsAPI.getGeminiVoice();
        geminiVoiceSelect.value = voice || 'Callirrhoe';
    } catch (e) {
        console.error('Failed to load voice setting', e);
    }
}

geminiVoiceSelect?.addEventListener('change', async () => {
    const voice = geminiVoiceSelect.value;
    await window.settingsAPI.setGeminiVoice(voice);
});

// Load Voice on init
loadVoiceSettings();

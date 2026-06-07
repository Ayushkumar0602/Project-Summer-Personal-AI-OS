/**
 * src/hud-panel/panel-renderer.js
 *
 * Renderer script for HUD Panel windows.
 * Receives widget data from the main process and renders it into the panel body.
 * Handles all widget types: calendar, emails, news, custom_html, mermaid,
 * audio_player, video_player, file_viewer, agent_progress, full-email, subtitle.
 */

'use strict';

// ── Theme colors per widget type ─────────────────────────────────────────────
const THEME_MAP = {
    calendar:       { icon: '📅', color: '#fbbf24', title: "Today's Schedule" },
    emails:         { icon: '📩', color: '#c084fc', title: 'Email Inbox' },
    news:           { icon: '📰', color: '#c084fc', title: 'Top Briefing' },
    weather:        { icon: '🌤️', color: '#00e5ff', title: 'Local Environment' },
    welcome:        { icon: '⚡', color: '#10b981', title: 'System Online' },
    mermaid:        { icon: '📊', color: '#10b981', title: 'Workflow Diagram' },
    image_gallery:  { icon: '📸', color: '#10b981', title: 'Visual' },
    'full-email':   { icon: '✉️', color: '#c084fc', title: 'Email Content' },
    audio_player:   { icon: '🎵', color: '#fbbf24', title: 'Audio Playback' },
    video_player:   { icon: '🎬', color: '#fbbf24', title: 'Video Playback' },
    file_viewer:    { icon: '📄', color: '#06b6d4', title: 'File Presentation' },
    custom_html:    { icon: '✨', color: '#06b6d4', title: 'Custom Interface' },
    agent_progress: { icon: '⚡', color: '#c084fc', title: 'Domain Agent' },
    subtitle:       { icon: '💬', color: '#06b6d4', title: 'Transcript' },
};

const titleEl = document.getElementById('panelTitle');
const iconEl = document.getElementById('panelIcon');
const contentEl = document.getElementById('panelContent');
const titlebar = document.getElementById('panelTitlebar');

// ── Close & Minimize buttons ─────────────────────────────────────────────────
document.getElementById('closeBtn').addEventListener('click', () => {
    window.hudPanel.closePanel();
});
document.getElementById('minimizeBtn').addEventListener('click', () => {
    window.hudPanel.minimizePanel();
});

// ── Apply theme color ────────────────────────────────────────────────────────
function applyTheme(type) {
    const theme = THEME_MAP[type] || THEME_MAP.custom_html;
    iconEl.textContent = theme.icon;
    titleEl.textContent = theme.title;
    document.documentElement.style.setProperty('--panel-accent', theme.color);
    document.documentElement.style.setProperty('--panel-border', `${theme.color}33`);
    document.documentElement.style.setProperty('--panel-glow', `${theme.color}22`);
    titlebar.style.setProperty('--panel-accent', theme.color);
}

// ── Decrypt text animation ───────────────────────────────────────────────────
function decryptText(element, finalString) {
    if (!finalString) return;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*';
    let iter = 0;
    const interval = setInterval(() => {
        element.innerText = finalString.split('').map((ch, idx) => {
            if (ch === ' ') return ' ';
            if (idx < iter) return ch;
            return chars[Math.floor(Math.random() * chars.length)];
        }).join('');
        iter += 1 / 3;
        if (iter >= finalString.length) {
            clearInterval(interval);
            element.innerText = finalString;
        }
    }, 20);
}

// ── Render functions per type ────────────────────────────────────────────────

function renderCalendar(data) {
    if (!data || data.length === 0) {
        return '<div class="hud-item"><div class="hud-item-title">No events scheduled</div></div>';
    }
    return data.map((ev, i) => `
        <div class="hud-item" style="animation-delay: ${i * 0.08}s">
            <div class="hud-item-title">${esc(ev.summary || 'Busy')}</div>
            <div class="hud-item-meta">${esc(ev.timeStr || 'All Day')}</div>
        </div>
    `).join('');
}

function renderEmails(data) {
    if (!data || data.length === 0) {
        return '<div class="hud-item"><div class="hud-item-title">No new emails</div></div>';
    }
    return data.map((email, i) => `
        <div class="hud-item" style="animation-delay: ${i * 0.08}s">
            <div class="hud-item-title">${esc(email.from || 'Unknown Sender')}</div>
            <div class="hud-item-meta">${esc(email.subject || 'No Subject')}</div>
        </div>
    `).join('');
}

function renderNews(data) {
    if (!data || data.length === 0) {
        return '<div class="hud-item"><div class="hud-item-title">No news available</div></div>';
    }
    return data.map((item, i) => `
        <div class="hud-item" style="animation-delay: ${i * 0.08}s">
            <div class="hud-item-title">${esc(item.title || '')}</div>
            <div class="hud-item-meta">${esc(item.source || '')}</div>
        </div>
    `).join('');
}

function renderWeather(data) {
    return `
        <div class="hud-item">
            <div class="hud-item-title">${esc(data.temp || '--')}°C - ${esc(data.condition || '')}</div>
            <div class="hud-item-meta">${esc(data.location || '')}</div>
        </div>
    `;
}

function renderWelcome(data) {
    return `
        <div class="hud-item">
            <div class="hud-item-title">${esc(data.message || 'Good morning, Sir.')}</div>
        </div>
    `;
}

function renderFullEmail(data) {
    if (!data) return '<div class="hud-item"><div class="hud-item-title">Email unavailable</div></div>';
    return `<div class="email-content">${data}</div>`;
}

function renderCustomHtml(data) {
    const html = typeof data === 'string' ? data : (data?.html || '');
    return `<div class="custom-html-wrapper">${html}</div>`;
}

function renderAudioPlayer(data) {
    const src = data.url || `summer-media://${data.path}`;
    return `
        <div class="media-container">
            <div class="media-title">${esc(data.title || 'Audio File')}</div>
            <audio controls autoplay style="width:100%; border-radius:6px; outline:none;">
                <source src="${src}">
            </audio>
        </div>
    `;
}

function renderVideoPlayer(data) {
    const src = data.url || `summer-media://${data.path}`;
    return `
        <div class="media-container">
            <div class="media-title">${esc(data.title || 'Video File')}</div>
            <video controls autoplay style="width:100%; max-height:400px; border-radius:6px;">
                <source src="${src}">
            </video>
        </div>
    `;
}

function renderImageGallery(data) {
    const items = Array.isArray(data) ? data : (data ? [data] : []);
    if (items.length === 0) return '<div class="hud-item"><div class="hud-item-title">No images</div></div>';

    return `
        <div class="gallery-track">
            ${items.map(item => {
                const src = item.url || `summer-media://${item.path}`;
                return `
                <div class="gallery-slide">
                    <img src="${src}" class="gallery-img" />
                    ${item.caption ? `<div class="gallery-credit">${esc(item.caption)}</div>` : ''}
                </div>`;
            }).join('')}
        </div>
        ${items.length > 1 ? `
        <div class="gallery-dots">
            ${items.map((_, i) => `<div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}
        </div>
        ` : ''}
    `;
}

function renderFileViewer(data) {
    return `
        <div class="file-card">
            <div class="file-icon">${data.icon || '📎'}</div>
            <div class="file-info">
                <div class="file-name">${esc(data.filename || 'Unknown File')}</div>
                <div class="file-meta">${esc(data.metadata || '')}</div>
            </div>
        </div>
    `;
}

function renderMermaid(data) {
    const items = Array.isArray(data) ? data : (data ? [data] : []);
    let html = '';
    items.forEach((item, i) => {
        const id = `mermaid-${Date.now()}-${i}`;
        html += `<div class="mermaid-container" id="${id}"></div>`;
    });

    // Render mermaid after DOM insertion
    setTimeout(async () => {
        if (typeof mermaid === 'undefined') return;
        mermaid.initialize({ startOnLoad: false, theme: 'dark' });
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const el = document.querySelectorAll('.mermaid-container')[i];
            let code = typeof item === 'string' ? item : (item.content || item.code || item.mermaid || '');
            if (code.includes('```')) {
                code = code.replace(/```mermaid\n?/gi, '').replace(/```\n?/g, '').trim();
            }
            if (el && code) {
                try {
                    const { svg } = await mermaid.render(`graph-${Date.now()}-${i}`, code);
                    el.innerHTML = svg;
                } catch (e) {
                    el.innerHTML = '<div style="color:#ef4444; font-size:12px;">Failed to render diagram</div>';
                }
            }
        }
    }, 100);

    return html;
}

function renderAgentProgress(data) {
    const pct = data.percent ?? 0;
    const color = data.failed ? '#ef4444' : (data.done ? '#10b981' : '#c084fc');
    const status = data.failed ? 'TASK FAILED' : (data.done ? 'TASK COMPLETED' : 'PROCESSING...');
    const logs = data.logs || [data.message || 'Working...'];

    titleEl.textContent = data.display_name || 'Domain Agent';

    return `
        <div class="progress-card">
            <div class="progress-status" style="color: ${color}; text-shadow: 0 0 8px ${color}44;">${status}</div>
            <div class="progress-logs">
                ${logs.slice(-5).map((l, i, arr) => {
                    const isLast = i === arr.length - 1;
                    return `<div class="progress-log-item" style="opacity: ${isLast ? 1 : 0.5 + (i / arr.length) * 0.3}">
                        <span class="progress-log-bullet" style="color: ${isLast ? color : '#64748b'}">●</span>
                        <span>${esc(l)}</span>
                    </div>`;
                }).join('')}
            </div>
            <div class="progress-pct">${pct}%</div>
            <div class="progress-bar-track">
                <div class="progress-bar-fill" style="width: ${pct}%; background: linear-gradient(90deg, ${color}aa, ${color}); color: ${color};"></div>
            </div>
            ${!data.done && !data.failed ? '<button class="progress-abort-btn" id="abortBtn">✕ Abort</button>' : ''}
        </div>
    `;
}

function renderSubtitle(data) {
    return `
        <div class="subtitle-wrapper">
            <div class="user-text" id="userText"></div>
            <div class="agent-text" id="agentText"></div>
        </div>
    `;
}

// ── Utility ──────────────────────────────────────────────────────────────────
function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Main: listen for content updates ─────────────────────────────────────────
window.hudPanel.onContentUpdate((payload) => {
    const { type, data, title } = payload;

    if (type === 'subtitle_update') return;

    applyTheme(type);
    if (title) titleEl.textContent = title;

    let html = '';
    switch (type) {
        case 'calendar':       html = renderCalendar(data); break;
        case 'emails':         html = renderEmails(data); break;
        case 'news':           html = renderNews(data); break;
        case 'weather':        html = renderWeather(data); break;
        case 'welcome':        html = renderWelcome(data); break;
        case 'full-email':     html = renderFullEmail(data); break;
        case 'custom_html':    html = renderCustomHtml(data); break;
        case 'image_gallery':  html = renderImageGallery(data); break;
        case 'audio_player':   html = renderAudioPlayer(data); break;
        case 'video_player':   html = renderVideoPlayer(data); break;
        case 'file_viewer':    html = renderFileViewer(data); break;
        case 'mermaid':        html = renderMermaid(data); break;
        case 'agent_progress': html = renderAgentProgress(data); break;
        case 'subtitle':       html = renderSubtitle(data); break;
        default: {
            if (data && data.html) {
                html = renderCustomHtml(data);
            } else if (typeof data === 'string' && data.includes('<')) {
                html = renderCustomHtml(data);
            } else {
                html = `<div class="hud-item">
                    <div class="hud-item-title" style="color: #fca5a5;">Unknown Widget: [${esc(type)}]</div>
                    <div class="hud-item-meta custom-html-wrapper" style="font-size: 11px; opacity: 0.8; margin-top: 8px;">
                        <pre style="white-space: pre-wrap; font-family: monospace;">${esc(JSON.stringify(data, null, 2))}</pre>
                    </div>
                </div>`;
            }
            break;
        }
    }

    contentEl.innerHTML = html;

    // Bind abort button if present
    const abortBtn = document.getElementById('abortBtn');
    if (abortBtn) {
        abortBtn.addEventListener('click', async () => {
            abortBtn.textContent = '⏳ Killing...';
            abortBtn.style.opacity = '0.5';
            abortBtn.style.pointerEvents = 'none';
            await window.hudPanel.cancelAgents();
        });
    }
});

// ── Progress live updates (agent_progress type) ──────────────────────────────
window.hudPanel.onProgressUpdate((data) => {
    const pct = data.percent ?? 0;
    const color = data.failed ? '#ef4444' : (data.done ? '#10b981' : '#c084fc');

    const fill = contentEl.querySelector('.progress-bar-fill');
    if (fill) {
        fill.style.width = `${pct}%`;
        fill.style.background = `linear-gradient(90deg, ${color}aa, ${color})`;
        fill.style.color = color;
    }

    const pctEl = contentEl.querySelector('.progress-pct');
    if (pctEl) pctEl.textContent = `${pct}%`;

    const statusEl = contentEl.querySelector('.progress-status');
    if (statusEl) {
        const status = data.failed ? 'TASK FAILED' : (data.done ? 'TASK COMPLETED' : 'PROCESSING...');
        statusEl.textContent = status;
        statusEl.style.color = color;
        statusEl.style.textShadow = `0 0 8px ${color}44`;
    }

    if (data.message) {
        const logsEl = contentEl.querySelector('.progress-logs');
        if (logsEl) {
            const item = document.createElement('div');
            item.className = 'progress-log-item';
            item.innerHTML = `<span class="progress-log-bullet" style="color: ${color}">●</span><span>${esc(data.message)}</span>`;
            logsEl.appendChild(item);
            // Keep only last 5
            while (logsEl.children.length > 5) logsEl.removeChild(logsEl.firstChild);
            // Brighten last, dim others
            Array.from(logsEl.children).forEach((c, i, arr) => {
                c.style.opacity = i === arr.length - 1 ? '1' : `${0.3 + (i / arr.length) * 0.4}`;
            });
        }
    }

    if (data.done || data.failed) {
        const abortBtn = contentEl.querySelector('.progress-abort-btn');
        if (abortBtn) abortBtn.style.display = 'none';
    }
});

// ── Subtitle live updates ────────────────────────────────────────────────────
// These come from the main process when this is a subtitle panel
window.hudPanel.onContentUpdate((payload) => {
    if (payload.type !== 'subtitle_update') return;
    const { target, text } = payload;
    if (target === 'user') {
        const el = document.getElementById('userText');
        if (el) { el.innerText += text; el.scrollTop = el.scrollHeight; }
    } else if (target === 'agent') {
        const el = document.getElementById('agentText');
        if (el) { el.innerText += text; el.scrollTop = el.scrollHeight; }
    } else if (target === 'clear') {
        const u = document.getElementById('userText');
        const a = document.getElementById('agentText');
        if (u) u.innerText = '';
        if (a) a.innerText = '';
    }
});

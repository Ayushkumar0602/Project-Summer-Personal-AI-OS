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
    drive_video:    { icon: '🎥', color: '#f43f5e', title: 'Drive Video' },
    drive_audio:    { icon: '🎧', color: '#f43f5e', title: 'Drive Audio' },
    drive_image:    { icon: '🖼️', color: '#f43f5e', title: 'Drive Image' },
    drive_pdf:      { icon: '📑', color: '#f43f5e', title: 'Drive Document' },
    drive_ppt:      { icon: '📊', color: '#f43f5e', title: 'Drive Presentation' },
    agent_progress: { icon: '⚡', color: '#c084fc', title: 'Domain Agent' },
    'agent-gathering': { icon: '🔎', color: '#fbbf24', title: 'Agent — Gathering Info' },
    'agent-started':   { icon: '🚀', color: '#10b981', title: 'Agent — Running' },
    subtitle:       { icon: '💬', color: '#06b6d4', title: 'Transcript' },
};

const overlayCanvas = document.getElementById('overlay-canvas');
const widgets = new Map(); // id -> HTMLElement

// ── Hover interaction (Mouse Click-through Logic) ──────────────────────────
// CRITICAL: setIgnoreMouseEvents(false) makes the ENTIRE overlay capture clicks.
// If a layout update moves a widget out from under the cursor, mouseout never fires,
// and the overlay stays opaque to clicks → screen appears frozen.
// We use a safety system: after every setIgnoreMouseEvents(false), start a watchdog
// timer that will restore click-through if the cursor isn't over a widget.

let _ignoreState = true;       // Track current state to avoid redundant IPC calls
let _clickThroughWatchdog = null;

function setClickThrough(ignore) {
    if (ignore === _ignoreState) return; // No change
    _ignoreState = ignore;
    if (window.overlayApi) {
        window.overlayApi.setIgnoreMouseEvents(ignore);
    }
    // When we DISABLE click-through (capture mode), start watchdog
    if (!ignore) {
        startClickThroughWatchdog();
    } else {
        stopClickThroughWatchdog();
    }
}

function startClickThroughWatchdog() {
    stopClickThroughWatchdog();
    // Every 500ms, check if cursor is still over a widget.
    // If not, restore click-through immediately.
    _clickThroughWatchdog = setInterval(() => {
        const hovered = document.querySelectorAll('.hud-widget:hover');
        if (hovered.length === 0) {
            setClickThrough(true);
        }
    }, 500);
}

function stopClickThroughWatchdog() {
    if (_clickThroughWatchdog) {
        clearInterval(_clickThroughWatchdog);
        _clickThroughWatchdog = null;
    }
}

document.addEventListener('mouseover', (e) => {
    const isWidget = e.target.closest('.hud-widget');
    if (isWidget) {
        setClickThrough(false); // Capture clicks for widget interaction
    }
});

document.addEventListener('mouseout', (e) => {
    const isWidget = e.target.closest('.hud-widget');
    if (isWidget && !e.relatedTarget?.closest('.hud-widget')) {
        setClickThrough(true); // Restore click-through
    }
});

// ── Render functions per type ────────────────────────────────────────────────
function renderCalendar(data) {
    if (!data || data.length === 0) return '<div class="hud-item"><div class="hud-item-title">No events scheduled</div></div>';
    return data.map((ev, i) => `
        <div class="hud-item" style="animation-delay: ${i * 0.08}s">
            <div class="hud-item-title">${esc(ev.summary || 'Busy')}</div>
            <div class="hud-item-meta">${esc(ev.timeStr || 'All Day')}</div>
        </div>
    `).join('');
}

function renderEmails(data) {
    if (!data) return '<div class="hud-item"><div class="hud-item-title">No new emails</div></div>';
    if (typeof data === 'string') return `<div class="hud-item"><div class="hud-item-title">${esc(data)}</div></div>`;
    let arr = Array.isArray(data) ? data : (data.emails || data.data || [data]);
    if (!arr || arr.length === 0) return '<div class="hud-item"><div class="hud-item-title">No new emails</div></div>';
    return arr.map((email, i) => `
        <div class="hud-item" style="animation-delay: ${i * 0.08}s">
            <div class="hud-item-title">${esc(email.from || email.sender || 'Unknown Sender')}</div>
            <div class="hud-item-meta">${esc(email.subject || 'No Subject')}</div>
        </div>
    `).join('');
}

function renderNews(data) {
    if (!data || data.length === 0) return '<div class="hud-item"><div class="hud-item-title">No news available</div></div>';
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
    const src = data.url || data.publicUrl || (data.path ? `summer-media://${data.path}` : '');
    const title = data.title || data.label || (data.path ? data.path : 'Audio File');
    return `
        <div class="media-container">
            <div class="media-title">${esc(title)}</div>
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
    const items = data?.images ? data.images : (Array.isArray(data) ? data : (data ? [data] : []));
    if (items.length === 0) return '<div class="hud-item"><div class="hud-item-title">No images</div></div>';
    return `
        <div class="gallery-track" style="display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px;">
            ${items.map(item => {
                const src = item.publicUrl || item.url || `summer-media://${item.filename || item.path}`;
                const caption = item.caption || item.label || item.description || '';
                return `
                <div class="gallery-slide" style="min-width: 200px; flex: 1;">
                    <img src="${src}" class="gallery-img" style="width: 100%; border-radius: 8px; object-fit: cover;" onerror="this.style.display='none';" />
                    ${caption ? `<div class="gallery-credit" style="font-size: 11px; margin-top: 4px; color: #cbd5e1;">${esc(caption)}</div>` : ''}
                </div>`;
            }).join('')}
        </div>
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

function renderDriveImage(data) {
    const src = data.path ? `summer-media://${encodeURIComponent(data.path)}` : (data.url || '');
    return `
        <div class="drive-media-container">
            <div class="drive-media-title">${esc(data.title || 'Image')}</div>
            <img class="drive-image-viewer" src="${src}" alt="${esc(data.title)}" onerror="this.alt='Failed to load image'">
        </div>
    `;
}

function renderDriveEmbed(data) {
    // For video/audio/pdf/ppt — show a styled card with info
    // The actual content opens in the browser window
    const typeLabel = data.fileType || 'File';
    const icon = data.fileType === 'Video' ? '🎥' : data.fileType === 'Audio' ? '🎧' : data.fileType === 'PDF' ? '📑' : '📊';
    return `
        <div class="drive-media-container">
            <div class="drive-media-title">${esc(data.title || 'Drive File')}</div>
            <div style="text-align:center; padding: 20px 10px;">
                <div style="font-size: 48px; margin-bottom: 12px;">${icon}</div>
                <div style="font-size: 14px; color: #e2e8f0; font-weight: 500;">${esc(data.title)}</div>
                <div style="font-size: 11px; color: #94a3b8; margin-top: 6px;">${esc(typeLabel)} — opened in browser panel</div>
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
    setTimeout(async () => {
        if (typeof mermaid === 'undefined') return;
        mermaid.initialize({ startOnLoad: false, theme: 'dark' });
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const el = document.querySelectorAll('.mermaid-container')[i];
            let code = typeof item === 'string' ? item : (item.content || item.code || item.mermaid || '');
            if (code.includes('\`\`\`')) code = code.replace(/\`\`\`mermaid\n?/gi, '').replace(/\`\`\`\n?/g, '').trim();
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

function renderAgentProgress(data, type) {
    const isGathering = type === 'agent-gathering';
    const isStarted = type === 'agent-started';
    const agentName = esc(data.display_name || data.agent_id || 'Domain Agent');
    
    if (isGathering) {
        const message = esc(data.message || 'Gathering required information...');
        const missing = data.missing || [];
        let missingHtml = '';
        if (missing.length > 0) {
            missingHtml = `
                <div style="margin-top: 12px;">
                    <div style="font-size: 11px; color: #fbbf24; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Required Info</div>
                    ${missing.map(m => `
                        <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; padding: 6px 8px; background: rgba(251,191,36,0.08); border-radius: 6px; border-left: 2px solid #fbbf24;">
                            <span style="color: #fbbf24; font-size: 12px;">●</span>
                            <div>
                                <div style="color: #e2e8f0; font-size: 13px; font-weight: 500;">${esc(m.key || '')}</div>
                                <div style="color: #94a3b8; font-size: 11px;">${esc(m.description || '')}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>`;
        }
        return `
            <div class="progress-card">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <div style="font-size: 14px; color: #fbbf24; font-weight: 600;">${agentName}</div>
                </div>
                <div style="color: #cbd5e1; font-size: 13px; line-height: 1.5;">${message}</div>
                ${missingHtml}
                <div style="margin-top: 12px; color: #64748b; font-size: 11px; font-style: italic;">💡 Answer the questions above so the agent can proceed.</div>
            </div>
        `;
    }

    if (isStarted) {
        return `
            <div class="progress-card">
                <div class="progress-status" style="color: #10b981; text-shadow: 0 0 8px #10b98144;">AGENT LAUNCHED</div>
                <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
                    <div style="font-size: 14px; color: #e2e8f0; font-weight: 600;">🚀 ${agentName}</div>
                </div>
                <div style="margin-top: 12px; color: #94a3b8; font-size: 12px;">Running in the background. You'll see progress updates as it works.</div>
            </div>
        `;
    }

    const pct = data.percent ?? 0;
    const color = data.failed ? '#ef4444' : (data.done ? '#10b981' : '#c084fc');
    const status = data.failed ? 'TASK FAILED' : (data.done ? 'TASK COMPLETED' : 'PROCESSING...');
    const logs = data.logs || [data.message || 'Working...'];
    return `
        <div class="progress-card">
            <div class="progress-status progress-status-text" style="color: ${color}; text-shadow: 0 0 8px ${color}44;">${status}</div>
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
            ${!data.done && !data.failed ? '<button class="progress-abort-btn abort-btn">✕ Abort</button>' : ''}
        </div>
    `;
}

function renderSubtitle(data) {
    return `
        <div class="subtitle-wrapper">
            <div class="user-text user-text-display"></div>
            <div class="agent-text agent-text-display"></div>
        </div>
    `;
}

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Widget Creation & Lifecycle ──────────────────────────────────────────────
function createWidgetDOM(widgetId, type, titleText, htmlContent) {
    const theme = THEME_MAP[type] || THEME_MAP.custom_html;
    
    const el = document.createElement('div');
    el.className = 'hud-widget';
    el.id = widgetId;
    el.dataset.type = type;
    
    el.style.setProperty('--panel-accent', theme.color);
    el.style.setProperty('--panel-border', `${theme.color}33`);
    el.style.setProperty('--panel-glow', `${theme.color}22`);
    
    el.style.left = '-2000px';
    el.style.top = '-2000px';

    el.innerHTML = `
        <div class="panel-titlebar">
            <div class="panel-title-section">
                <div class="panel-icon">${theme.icon}</div>
                <div class="panel-title">${esc(titleText || theme.title)}</div>
            </div>
            <div class="panel-controls">
                <button class="panel-ctrl-btn panel-close">✕</button>
            </div>
        </div>
        <div class="panel-body">
            <div class="panel-content">${htmlContent}</div>
        </div>
    `;

    el.querySelector('.panel-close').addEventListener('click', () => {
        closeWidget(widgetId);
        if (window.overlayApi) window.overlayApi.closeWidget(widgetId);
    });

    return el;
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYOUT ENGINE — Priority-Based, Content-Aware, 3-Zone Tiling
// ══════════════════════════════════════════════════════════════════════════════

let focusStack = [];   // Widget IDs ordered by priority. [0] = primary.
let _layoutRAF = null; // requestAnimationFrame handle for debounce

function bringToFront(id) {
    if (!widgets.has(id)) return;
    if (focusStack[0] === id) return; // Already primary — skip
    focusStack = focusStack.filter(wId => wId !== id);
    focusStack.unshift(id);
    scheduleLayout();
}

function scheduleLayout() {
    if (_layoutRAF) return; // Already pending
    _layoutRAF = requestAnimationFrame(() => {
        _layoutRAF = null;
        updateAllLayouts();
    });
}

function getSizeConfig(type, isPrimary, screenW, safeH) {
    if (isPrimary) {
        switch (type) {
            case 'mermaid':        return { w: Math.min(750, screenW * 0.52), maxH: safeH * 0.78 };
            case 'full-email':     return { w: Math.min(580, screenW * 0.42), maxH: safeH * 0.78 };
            case 'custom_html':    return { w: Math.min(620, screenW * 0.45), maxH: safeH * 0.78 };
            case 'news':           return { w: Math.min(480, screenW * 0.35), maxH: safeH * 0.72 };
            case 'image_gallery':  return { w: Math.min(500, screenW * 0.38), maxH: safeH * 0.65 };
            case 'video_player':   return { w: Math.min(580, screenW * 0.45), maxH: safeH * 0.68 };
            case 'drive_image':    return { w: Math.min(500, screenW * 0.38), maxH: safeH * 0.65 };
            case 'drive_video':
            case 'drive_audio':
            case 'drive_pdf':
            case 'drive_ppt':      return { w: Math.min(320, screenW * 0.24), maxH: safeH * 0.35 };
            case 'emails':         return { w: Math.min(380, screenW * 0.28), maxH: safeH * 0.65 };
            default:               return { w: Math.min(360, screenW * 0.28), maxH: safeH * 0.55 };
        }
    } else {
        switch (type) {
            case 'mermaid':        return { w: Math.min(300, screenW * 0.22), maxH: safeH * 0.38 };
            case 'full-email':     return { w: Math.min(280, screenW * 0.20), maxH: safeH * 0.38 };
            case 'custom_html':    return { w: Math.min(280, screenW * 0.20), maxH: safeH * 0.38 };
            case 'image_gallery':  return { w: Math.min(260, screenW * 0.18), maxH: safeH * 0.35 };
            case 'emails':         return { w: Math.min(260, screenW * 0.18), maxH: safeH * 0.38 };
            default:               return { w: Math.min(260, screenW * 0.18), maxH: safeH * 0.35 };
        }
    }
}

function updateAllLayouts() {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const DOCK = 80;       // macOS dock safe margin
    const PAD = 14;        // Spacing between widgets
    const safeH = screenH - DOCK;

    focusStack = focusStack.filter(id => widgets.has(id));
    if (focusStack.length === 0) return;

    const primaryId = focusStack[0];
    const primaryEl = widgets.get(primaryId);

    if (primaryEl) {
        const type = primaryEl.dataset.type;
        const { w, maxH } = getSizeConfig(type, true, screenW, safeH);
        const contentEl = primaryEl.querySelector('.panel-content');

        primaryEl.style.width = `${w}px`;
        const naturalH = contentEl.scrollHeight + 46;
        const h = Math.max(120, Math.min(naturalH, maxH));
        primaryEl.style.height = `${h}px`;

        const left = Math.max(PAD, (screenW - w) / 2);
        const top = Math.max(PAD, (safeH - h) / 2);
        primaryEl.style.left = `${left}px`;
        primaryEl.style.top = `${top}px`;

        primaryEl.classList.remove('secondary-widget');
        primaryEl.style.zIndex = 1000;

        if (!primaryEl.classList.contains('visible')) {
            setTimeout(() => primaryEl.classList.add('visible'), 30);
        }
    }

    const secondaryIds = focusStack.slice(1);
    if (secondaryIds.length === 0) return;

    let leftY = PAD;
    let rightY = PAD;
    const MAX_VISIBLE = 8;

    secondaryIds.forEach((id, i) => {
        const el = widgets.get(id);
        if (!el) return;

        if (i >= MAX_VISIBLE) {
            el.style.left = '-2000px';
            el.style.top = '-2000px';
            el.classList.add('secondary-widget');
            return;
        }

        const type = el.dataset.type;
        const { w, maxH } = getSizeConfig(type, false, screenW, safeH);
        const contentEl = el.querySelector('.panel-content');

        el.style.width = `${w}px`;
        const naturalH = contentEl.scrollHeight + 46;
        const h = Math.max(100, Math.min(naturalH, maxH));
        el.style.height = `${h}px`;

        const placeRight = (i % 2 === 0);

        if (placeRight) {
            const x = screenW - w - PAD;
            if (rightY + h > safeH) rightY = PAD;
            el.style.left = `${x}px`;
            el.style.top = `${rightY}px`;
            rightY += h + PAD;
        } else {
            if (leftY + h > safeH) leftY = PAD;
            el.style.left = `${PAD}px`;
            el.style.top = `${leftY}px`;
            leftY += h + PAD;
        }

        el.classList.add('secondary-widget');
        el.style.zIndex = 500 - i;

        if (!el.classList.contains('visible')) {
            setTimeout(() => el.classList.add('visible'), 30);
        }
    });

    setTimeout(() => {
        const hovered = document.querySelectorAll('.hud-widget:hover');
        if (hovered.length === 0 && !_ignoreState) {
            setClickThrough(true);
        }
    }, 600);
}

window.overlayApi?.onWidgetUpdate((payload) => {
    const { id, type, data, title, autoClose } = payload;
    if (type === 'subtitle_update') return;

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
        case 'drive_image':    html = renderDriveImage(data); break;
        case 'drive_video':
        case 'drive_audio':
        case 'drive_pdf':
        case 'drive_ppt':      html = renderDriveEmbed(data); break;
        case 'mermaid':        html = renderMermaid(data); break;
        case 'agent_progress': 
        case 'agent-gathering':
        case 'agent-started':  html = renderAgentProgress(data, type); break;
        case 'subtitle':       html = renderSubtitle(data); break;
        default:               html = renderCustomHtml(data); break;
    }

    if (widgets.has(id)) {
        const el = widgets.get(id);
        const contentEl = el.querySelector('.panel-content');
        contentEl.innerHTML = html;
        if (title) el.querySelector('.panel-title').textContent = title;
        bringToFront(id);
    } else {
        const el = createWidgetDOM(id, type, title, html);
        el.addEventListener('mousedown', (e) => {
            if (e.target.closest('.panel-close')) return;
            bringToFront(id);
        });

        widgets.set(id, el);
        overlayCanvas.appendChild(el);
        focusStack.unshift(id);
        scheduleLayout();

        if (autoClose) {
            setTimeout(() => closeWidget(id), autoClose);
        }
    }
});

function closeWidget(id) {
    const el = widgets.get(id);
    if (el) {
        el.classList.remove('visible');
        focusStack = focusStack.filter(wId => wId !== id);
        setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
            widgets.delete(id);
            scheduleLayout();
        }, 300);
    }
}

window.overlayApi?.onWidgetClear((payload) => {
    if (!payload || !payload.type || payload.type === 'all') {
        for (const id of widgets.keys()) {
            closeWidget(id);
        }
    } else {
        for (const [id, el] of widgets.entries()) {
            if (el.dataset.type === payload.type) {
                closeWidget(id);
            }
        }
    }
});

window.overlayApi?.onProgressUpdate((payload) => {
    const { id, data } = payload;
    const el = widgets.get(id);
    if (!el) return;

    const pct = data.percent ?? 0;
    const color = data.failed ? '#ef4444' : (data.done ? '#10b981' : '#c084fc');

    const fill = el.querySelector('.progress-bar-fill');
    if (fill) {
        fill.style.width = `${pct}%`;
        fill.style.background = `linear-gradient(90deg, ${color}aa, ${color})`;
        fill.style.color = color;
    }

    const pctEl = el.querySelector('.progress-pct');
    if (pctEl) pctEl.textContent = `${pct}%`;

    const statusEl = el.querySelector('.progress-status-text');
    if (statusEl) {
        statusEl.textContent = data.failed ? 'TASK FAILED' : (data.done ? 'TASK COMPLETED' : 'PROCESSING...');
        statusEl.style.color = color;
    }

    if (data.message) {
        const logsEl = el.querySelector('.progress-logs');
        if (logsEl) {
            const item = document.createElement('div');
            item.className = 'progress-log-item';
            item.innerHTML = `<span class="progress-log-bullet" style="color: ${color}">●</span><span>${esc(data.message)}</span>`;
            logsEl.appendChild(item);
            while (logsEl.children.length > 5) logsEl.removeChild(logsEl.firstChild);
            Array.from(logsEl.children).forEach((c, i, arr) => {
                c.style.opacity = i === arr.length - 1 ? '1' : `${0.3 + (i / arr.length) * 0.4}`;
            });
        }
    }
});

window.overlayApi?.onSubtitleUpdate((payload) => {
    const { id, target, text } = payload;
    const el = widgets.get(id);
    if (!el) return;

    if (target === 'user') {
        const t = el.querySelector('.user-text-display');
        if (t) { t.innerText += text; t.scrollTop = t.scrollHeight; }
    } else if (target === 'agent') {
        const t = el.querySelector('.agent-text-display');
        if (t) { t.innerText += text; t.scrollTop = t.scrollHeight; }
    } else if (target === 'clear') {
        const u = el.querySelector('.user-text-display');
        const a = el.querySelector('.agent-text-display');
        if (u) u.innerText = '';
        if (a) a.innerText = '';
    }
});

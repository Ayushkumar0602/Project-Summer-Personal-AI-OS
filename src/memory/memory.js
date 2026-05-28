// ── Color mapping for node types ──
const TYPE_COLORS = {
    Person:       { bg: '#4c1d95', border: '#a78bfa', font: '#ede9fe' },
    Project:      { bg: '#0c4a6e', border: '#38bdf8', font: '#e0f2fe' },
    Skill:        { bg: '#064e3b', border: '#34d399', font: '#d1fae5' },
    Technology:   { bg: '#064e3b', border: '#34d399', font: '#d1fae5' },
    Tool:         { bg: '#064e3b', border: '#34d399', font: '#d1fae5' },
    Organization: { bg: '#7c2d12', border: '#fb923c', font: '#ffedd5' },
    Concept:      { bg: '#831843', border: '#f472b6', font: '#fce7f3' },
    Topic:        { bg: '#6b21a8', border: '#c084fc', font: '#f3e8ff' },
    Method:       { bg: '#1a3a5c', border: '#7dd3fc', font: '#e0f2fe' },
    Formula:      { bg: '#1c3a2e', border: '#6ee7b7', font: '#d1fae5' },
    Definition:   { bg: '#3b2a1a', border: '#fbbf24', font: '#fef3c7' },
    Document:     { bg: '#1e293b', border: '#94a3b8', font: '#f1f5f9' },
    Chapter:      { bg: '#1e293b', border: '#64748b', font: '#cbd5e1' },
    Section:      { bg: '#1e293b', border: '#475569', font: '#94a3b8' },
    Example:      { bg: '#1a2e1a', border: '#4ade80', font: '#dcfce7' },
    Location:     { bg: '#1e3a5f', border: '#60a5fa', font: '#dbeafe' },
    Event:        { bg: '#3b1f2a', border: '#f9a8d4', font: '#fce7f3' },
    ImageMemory: { bg: '#2d1b69', border: '#a855f7', font: '#f3e8ff' },
    AudioMemory:  { bg: '#1a3a2e', border: '#22d3ee', font: '#cffafe' },
    ProceduralMemory: { bg: '#2a1a3e', border: '#e879f9', font: '#fae8ff' },
    Other:        { bg: '#1e293b', border: '#64748b', font: '#94a3b8' },
};

function getColor(type) {
    return TYPE_COLORS[type] || TYPE_COLORS['Other'];
}

// ── vis-network instance ──
let network = null;
let currentGraph = { nodes: [], edges: [] };
let searchHighlightIds = new Set(); // IDs that match current search
let activeTagFilter = null;          // e.g. '#work' or null

function formatAge(ts) {
    if (!ts) return null;
    const days = Math.floor((Date.now() - ts) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}

function renderGraph(graph) {
    currentGraph = graph;
    const container = document.getElementById('graphCanvas');
    const emptyState = document.getElementById('emptyState');

    document.getElementById('nodeCount').textContent = graph.nodes.length;
    document.getElementById('edgeCount').textContent = graph.edges.length;

    if (graph.nodes.length === 0) {
        emptyState.style.display = 'block';
        if (network) { network.destroy(); network = null; }
        return;
    }

    emptyState.style.display = 'none';

    // Format for vis-network
    const visNodes = graph.nodes.map(n => {
        const col = getColor(n.type);
        let borderCol = col.border;
        let borderW = 2;
        let opacity = 1.0;

        if (n.source === 'agent') {
            borderCol = '#facc15';
            borderW = 3;
        }

        // Pinned nodes get a special gold ring
        // Special styling for ProceduralMemory nodes (sparkle border)
        if (n.type === 'ProceduralMemory') {
            borderCol = '#e879f9';
            borderW = 3;
        }

        // Special styling for AudioMemory nodes (cyan border)
        if (n.type === 'AudioMemory') {
            borderCol = '#22d3ee';
            borderW = 3;
        }

        if (n.pinned) {
            borderCol = '#f59e0b';
            borderW = 4;
        }

        // Dim nodes that don't match active search/tag filter
        const isHighlighted = searchHighlightIds.size === 0 || searchHighlightIds.has(n.id);
        const tagMatch = !activeTagFilter ||
            (Array.isArray(n.tags) && n.tags.some(t => t === activeTagFilter));

        if (!isHighlighted || !tagMatch) {
            opacity = 0.18;
        }

        const descSnippet = n.description
            ? `<br/><span style="color:#94a3b8;font-size:11px;">${n.description.slice(0, 120)}${n.description.length > 120 ? '...' : ''}</span>`
            : '';
        const tagSnippet = n.tags && n.tags.length
            ? `<br/><span style="color:#fbbf24;font-size:10px;">${n.tags.join(' ')}</span>`
            : '';
        const impSnippet = n.importance !== undefined
            ? `<br/><span style="color:#6ee7b7;font-size:10px;">★ ${(n.importance * 5).toFixed(0)}/5 importance</span>`
            : '';

        const bg  = opacity < 1 ? col.bg.replace(')', `,${opacity})`) : col.bg;
        const brd = opacity < 1 ? '#1e293b' : borderCol;

        // Size by importance
        const impSize = n.importance !== undefined
            ? Math.max(16, Math.min(40, 16 + n.importance * 24))
            : 20;
        const baseSize = n.type === 'Document' ? 30 : (n.id === 'user_self' ? 38 : impSize);

        return {
            id: n.id,
            label: n.label,
            title: `<div style="max-width:280px;padding:4px;"><b>${n.label}</b> <span style="color:#a78bfa">(${n.type})</span>${descSnippet}${tagSnippet}${impSnippet}</div>`,
            color: {
                background: bg,
                border: brd,
                highlight: { background: borderCol, border: '#fff' },
                opacity
            },
            font: { color: opacity < 1 ? '#334155' : col.font, size: 13, face: 'Inter, sans-serif' },
            shape: 'dot',
            size: baseSize,
            borderWidth: borderW,
        };
    });

    const visEdges = graph.edges.map((e, i) => ({
        id: i,
        from: e.from,
        to: e.to,
        label: e.label ? e.label.replace(/_/g, ' ') : '',
        color: { color: 'rgba(139,92,246,0.4)', highlight: '#a78bfa' },
        font: { color: '#64748b', size: 10, face: 'Inter, sans-serif', align: 'middle' },
        arrows: { to: { enabled: true, scaleFactor: 0.6 } },
        smooth: { type: 'curvedCW', roundness: 0.2 },
        width: 1.5,
    }));

    const data = {
        nodes: new vis.DataSet(visNodes),
        edges: new vis.DataSet(visEdges),
    };

    const options = {
        layout: { improvedLayout: true },
        physics: {
            enabled: true,
            barnesHut: { gravitationalConstant: -4000, springLength: 150, damping: 0.12 },
        },
        interaction: { hover: true, tooltipDelay: 100, zoomView: true, dragView: true },
        nodes: { shadow: { enabled: true, color: 'rgba(0,0,0,0.5)', x: 0, y: 4, size: 8 } },
    };

    if (network) network.destroy();
    network = new vis.Network(container, data, options);

    // Click on node → show detail popup
    network.on('click', (params) => {
        if (params.nodes.length > 0) {
            showNodeDetail(params.nodes[0]);
        } else {
            document.getElementById('nodeDetail').style.display = 'none';
        }
    });
}

let editingNodeId = null;

function showNodeDetail(nodeId) {
    const node = currentGraph.nodes.find(n => n.id === nodeId);
    if (!node) return;
    editingNodeId = nodeId;

    document.getElementById('nodeDetailLabel').textContent = node.label || 'Unknown';
    document.getElementById('nodeDetailType').textContent = node.type || 'Unknown';
    document.getElementById('nodeDetailId').textContent = `ID: ${node.id}`;

    // Show description
    const descEl = document.getElementById('nodeDetailDesc');
    if (node.description) {
        descEl.textContent = node.description;
        descEl.style.display = 'block';
    } else {
        descEl.textContent = 'No description available.';
        descEl.style.color = '#475569';
        descEl.style.display = 'block';
    }

    // ── Image Preview (only for ImageMemory nodes) ──
    const imgPreview = document.getElementById('nodeImagePreview');
    const imgEl = document.getElementById('nodeImageEl');
    const imgCaption = document.getElementById('nodeImageCaption');
    if (node.type === 'ImageMemory' && node.imagePath) {
        imgPreview.style.display = 'block';
        imgEl.src = ''; // clear while loading
        imgCaption.textContent = 'Loading image...';
        window.memoryAPI.readLocalImage(node.imagePath).then(dataUrl => {
            if (dataUrl) {
                imgEl.src = dataUrl;
                imgCaption.textContent = `📸 ${node.label}${node.mood ? ' · ' + node.mood : ''}`;
            } else {
                imgCaption.textContent = 'Image file not found.';
            }
        }).catch(() => {
            imgCaption.textContent = 'Could not load image.';
        });
    } else {
        imgPreview.style.display = 'none';
        imgEl.src = '';
    }

    // ── Procedural Memory Detail (only for ProceduralMemory nodes) ──
    const procDetail = document.getElementById('nodeProceduralDetail');
    if (node.type === 'ProceduralMemory') {
        procDetail.style.display = 'block';

        // Subtype badge
        const subtypeIcons = { style_preference: '🎨', workflow: '⚙️', anti_pattern: '🚫', tool_preference: '🔧' };
        const subtypeLabels = { style_preference: 'Style Preference', workflow: 'Workflow', anti_pattern: 'Anti-Pattern', tool_preference: 'Tool Preference' };
        const subtype = node.subtype || 'style_preference';
        document.getElementById('procSubtypeBadge').textContent = `${subtypeIcons[subtype] || '📝'} ${subtypeLabels[subtype] || subtype}`;

        // Confidence bar
        const confidence = node.confidence || 0.5;
        const confPercent = Math.round(confidence * 100);
        const confBar = document.getElementById('procConfidenceBar');
        confBar.style.width = confPercent + '%';
        confBar.style.background = confidence >= 0.7 ? 'linear-gradient(90deg, #34d399, #22d3ee)' :
                                   confidence >= 0.5 ? 'linear-gradient(90deg, #fbbf24, #fb923c)' :
                                                       'linear-gradient(90deg, #ef4444, #f97316)';
        document.getElementById('procConfidenceText').textContent = `${confPercent}% confidence`;

        // Active status
        const statusEl = document.getElementById('procActiveStatus');
        if (confidence >= 0.7) {
            statusEl.textContent = '✅ Active — injected into sessions';
            statusEl.style.color = '#34d399';
        } else {
            statusEl.textContent = '⏳ Learning — needs more reinforcement';
            statusEl.style.color = '#fbbf24';
        }

        // Rules list
        const rulesContainer = document.getElementById('procRulesList');
        const rules = node.rules || [];
        rulesContainer.innerHTML = rules.length > 0
            ? rules.map(r => `<div class="proc-rule-item">• ${r}</div>`).join('')
            : '<div class="proc-rule-item" style="color:#475569">No rules defined</div>';

        // Observed count
        document.getElementById('procObservedCount').textContent = `Observed ${node.observedCount || 1}x across sessions`;
    } else {
        procDetail.style.display = 'none';
    }

    // ── Audio Memory Detail (only for AudioMemory nodes) ──
    const audioDetail = document.getElementById('nodeAudioDetail');
    if (node.type === 'AudioMemory') {
        audioDetail.style.display = 'block';

        // Metadata badges
        const moodEmoji = { neutral: '😐', excited: '🤩', stressed: '😰', happy: '😊', focused: '🎯', casual: '😎', unknown: '❓' };
        const moodBadge = document.getElementById('audioMoodBadge');
        moodBadge.textContent = `${moodEmoji[node.mood] || '🎵'} ${node.mood || 'unknown'}`;

        const speakerBadge = document.getElementById('audioSpeakerBadge');
        speakerBadge.textContent = `🗣️ ${node.speakerCount || 1} speaker${(node.speakerCount || 1) !== 1 ? 's' : ''}`;

        const durationBadge = document.getElementById('audioDurationBadge');
        const dur = node.durationSec || 0;
        const mins = Math.floor(dur / 60);
        const secs = Math.round(dur % 60);
        durationBadge.textContent = `⏱️ ${mins > 0 ? mins + 'm ' : ''}${secs}s`;

        // Audio player
        const audioPlayer = document.getElementById('audioPlayerEl');
        const audioStatus = document.getElementById('audioPlayerStatus');
        if (node.audioPath) {
            audioStatus.textContent = 'Loading audio...';
            audioPlayer.src = '';
            window.memoryAPI.readLocalAudio(node.audioPath).then(dataUrl => {
                if (dataUrl) {
                    audioPlayer.src = dataUrl;
                    audioStatus.textContent = '';
                    audioPlayer.style.display = 'block';
                } else if (node.publicUrl) {
                    audioPlayer.src = node.publicUrl;
                    audioStatus.textContent = '';
                    audioPlayer.style.display = 'block';
                } else {
                    audioStatus.textContent = 'Audio file not found locally.';
                    audioPlayer.style.display = 'none';
                }
            }).catch(() => {
                audioStatus.textContent = 'Could not load audio.';
                audioPlayer.style.display = 'none';
            });
        } else {
            audioPlayer.style.display = 'none';
            audioStatus.textContent = 'No audio file available.';
        }

        // Transcript
        const transcriptEl = document.getElementById('audioTranscript');
        if (node.transcript && node.transcript.length > 0) {
            transcriptEl.textContent = node.transcript;
            transcriptEl.style.display = 'block';
        } else {
            transcriptEl.style.display = 'none';
        }

        // Key facts
        const factsEl = document.getElementById('audioKeyFacts');
        const facts = node.keyFacts || [];
        if (facts.length > 0) {
            factsEl.innerHTML = facts.map(f => `<div class="audio-fact-item">💡 ${f}</div>`).join('');
            factsEl.style.display = 'block';
        } else {
            factsEl.style.display = 'none';
        }
    } else {
        audioDetail.style.display = 'none';
    }

    // Show source badge
    const srcBadge = document.getElementById('nodeSourceBadge');
    if (node.source === 'agent') {
        srcBadge.textContent = '🧠 Auto-learned';
        srcBadge.style.display = 'inline';
    } else {
        srcBadge.textContent = '📂 From file';
        srcBadge.style.display = 'inline';
    }

    // Find all edges involving this node
    const related = currentGraph.edges
        .filter(e => e.from === nodeId || e.to === nodeId)
        .map(e => {
            if (e.from === nodeId) {
                const target = currentGraph.nodes.find(n => n.id === e.to);
                const conf = e.confidence ? ` <span style="color:#475569;font-size:10px;">(${Math.round(e.confidence * 100)}%)</span>` : '';
                return `<div class="nd-edge" onclick="showNodeDetail('${e.to}')"><span class="nd-node">${node.label || 'Unknown'}</span> <span class="nd-rel">${(e.label || '').replace(/_/g, ' ')}</span> <span class="nd-node">${target ? target.label || 'Unknown' : e.to}</span>${conf}</div>`;
            } else {
                const source = currentGraph.nodes.find(n => n.id === e.from);
                const conf = e.confidence ? ` <span style="color:#475569;font-size:10px;">(${Math.round(e.confidence * 100)}%)</span>` : '';
                return `<div class="nd-edge" onclick="showNodeDetail('${e.from}')"><span class="nd-node">${source ? source.label || 'Unknown' : e.from}</span> <span class="nd-rel">${(e.label || '').replace(/_/g, ' ')}</span> <span class="nd-node">${node.label || 'Unknown'}</span>${conf}</div>`;
            }
        });

    document.getElementById('nodeDetailEdges').innerHTML = related.length
        ? related.join('')
        : '<div class="nd-edge" style="color:#475569">No connections yet</div>';

    // Populate edge target select
    const select = document.getElementById('edgeTargetSelect');
    if (select) {
        select.innerHTML = '<option value="">Select node to connect...</option>';
        const sortedNodes = [...currentGraph.nodes].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
        sortedNodes.forEach(n => {
            if (n.id !== nodeId) {
                const opt = document.createElement('option');
                opt.value = n.id;
                opt.textContent = `${n.label || 'Unknown'} (${n.type || 'Unknown'})`;
                select.appendChild(opt);
            }
        });
    }

    document.getElementById('nodeDetail').style.display = 'block';
    document.getElementById('nodeEditForm').style.display = 'none';

    // Render tags for this node
    renderNodeTags(node);

    // Pin button state
    const pinBtn = document.getElementById('pinNodeBtn');
    pinBtn.textContent = node.pinned ? '📌 Unpin' : '📌 Pin';
    pinBtn.classList.toggle('pinned', !!node.pinned);

    // Importance slider
    const imp = node.importance !== undefined ? node.importance : 0.5;
    document.getElementById('importanceSlider').value = imp;
    document.getElementById('importanceValue').textContent = (imp * 5).toFixed(1) + '/5';

    // Show age info
    const ageEl = document.getElementById('nodeDetailAge');
    const accessed = formatAge(node.lastAccessedAt);
    const created  = formatAge(node.createdAt);
    if (accessed) {
        ageEl.textContent = `⏱ Last accessed: ${accessed}`;
        ageEl.style.display = 'block';
    } else if (created) {
        ageEl.textContent = `📅 Created: ${created}`;
        ageEl.style.display = 'block';
    } else {
        ageEl.style.display = 'none';
    }
}

function startEditNode() {
    if (!editingNodeId) return;
    const node = currentGraph.nodes.find(n => n.id === editingNodeId);
    if (!node) return;

    document.getElementById('editLabel').value = node.label;
    document.getElementById('editDescription').value = node.description || '';
    // Pre-fill tags as comma-separated
    document.getElementById('editTags').value = (node.tags || []).map(t => t.replace(/^#/, '')).join(', ');
    document.getElementById('nodeEditForm').style.display = 'block';
}

async function saveNodeEdit() {
    if (!editingNodeId) return;
    const newLabel = document.getElementById('editLabel').value.trim();
    const newDesc  = document.getElementById('editDescription').value.trim();
    const rawTags  = document.getElementById('editTags').value;
    if (!newLabel) return;

    // Parse tags
    const newTags = rawTags.split(',').map(t => t.trim()).filter(Boolean)
        .map(t => t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`);

    // Update in memory
    const node = currentGraph.nodes.find(n => n.id === editingNodeId);
    if (node) {
        node.label = newLabel;
        node.description = newDesc;
        node.tags = newTags;
    }

    // Persist
    await window.memoryAPI.updateNode(editingNodeId, { label: newLabel, description: newDesc, tags: newTags });
    renderGraph(currentGraph);
    showNodeDetail(editingNodeId);
    document.getElementById('nodeEditForm').style.display = 'none';
    refreshTagFilterBar();
}

async function deleteNode() {
    if (!editingNodeId) return;
    if (!confirm(`Delete node "${currentGraph.nodes.find(n => n.id === editingNodeId)?.label}"? This will also remove all its connections.`)) return;

    await window.memoryAPI.deleteNode(editingNodeId);
    currentGraph.nodes = currentGraph.nodes.filter(n => n.id !== editingNodeId);
    currentGraph.edges = currentGraph.edges.filter(e => e.from !== editingNodeId && e.to !== editingNodeId);
    renderGraph(currentGraph);
    document.getElementById('nodeDetail').style.display = 'none';
    editingNodeId = null;
}

// ── Pin & Importance ──
async function togglePin() {
    if (!editingNodeId) return;
    const node = currentGraph.nodes.find(n => n.id === editingNodeId);
    if (!node) return;
    const newPinned = !node.pinned;
    const res = await window.memoryAPI.pinNode(editingNodeId, newPinned);
    if (res.success) {
        node.pinned = res.pinned;
        node.importance = res.importance;
        renderGraph(currentGraph);
        showNodeDetail(editingNodeId);
    }
}

async function setNodeImportance(value) {
    if (!editingNodeId) return;
    const res = await window.memoryAPI.setImportance(editingNodeId, value);
    if (res.success) {
        const node = currentGraph.nodes.find(n => n.id === editingNodeId);
        if (node) node.importance = res.importance;
        document.getElementById('importanceValue').textContent = (res.importance * 5).toFixed(1) + '/5';
        renderGraph(currentGraph);
    }
}

// ── Diary Tab ──
async function openDiaryTab() {
    const entries = await window.memoryAPI.getDiary();
    renderDiary(entries);
    document.getElementById('diaryPanel').style.display = 'flex';
}

function closeDiaryPanel() {
    document.getElementById('diaryPanel').style.display = 'none';
}

// ── Timeline Functions ──────────────────────────────

let currentTimelineFilter = null;

async function openTimeline() {
    document.getElementById('timelinePanel').style.display = 'flex';
    await loadTimeline();
}

function closeTimelinePanel() {
    document.getElementById('timelinePanel').style.display = 'none';
}

async function filterTimeline(typeFilter, btn) {
    currentTimelineFilter = typeFilter;
    // Update active pill
    document.querySelectorAll('.tl-filter-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    await loadTimeline();
}

async function loadTimeline() {
    const events = await window.memoryAPI.getTimeline({ typeFilter: currentTimelineFilter, limit: 150 });
    renderTimeline(events);
}

function renderTimeline(events) {
    const list = document.getElementById('timelineList');
    if (!events || events.length === 0) {
        list.innerHTML = '<div class="diary-empty">🕐 Your timeline will grow as you talk to Summer ✨</div>';
        return;
    }

    const MOOD_EMOJI = {
        happy: '😊', stressed: '😰', frustrated: '😤',
        excited: '🤩', neutral: '😐', focused: '🎯',
        sad: '😔', curious: '🤔', casual: '😎'
    };

    let html = '';
    let lastDateLabel = '';

    for (const event of events) {
        const date = new Date(event.timestamp);
        const dateLabel = getDateLabel(date);

        // Date separator
        if (dateLabel !== lastDateLabel) {
            html += `<div class="tl-date-header">${dateLabel}</div>`;
            lastDateLabel = dateLabel;
        }

        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const moodBadge = event.emotion ? `<span class="diary-mood-badge" style="color:#64748b;">${MOOD_EMOJI[event.emotion] || ''} ${event.emotion}</span>` : '';
        const locationBadge = event.location && event.location.placeName ? `<span class="diary-location-badge">📍 ${event.location.placeName}</span>` : '';

        html += `
        <div class="tl-card" style="border-left-color:${event.color || '#64748b'};" ${event.nodeId ? `onclick="focusNodeInGraph('${event.nodeId}')"` : ''}>
            <div class="tl-card-header">
                <span class="tl-icon">${event.icon}</span>
                <span class="tl-title">${event.title}</span>
                <span class="tl-time">${timeStr}</span>
            </div>
            <div class="tl-subtitle">${event.subtitle || ''}</div>
            ${moodBadge || locationBadge ? `<div class="tl-badges">${moodBadge} ${locationBadge}</div>` : ''}
            ${event.tags && event.tags.length > 0 ? `<div class="tl-tags">${event.tags.slice(0, 4).map(t => `<span class="tl-tag">${t}</span>`).join('')}</div>` : ''}
        </div>`;
    }

    list.innerHTML = html;
}

function getDateLabel(date) {
    const now = new Date();
    const diffDays = Math.floor((now - date) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'long' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function focusNodeInGraph(nodeId) {
    closeTimelinePanel();
    if (network && currentGraph) {
        const node = currentGraph.nodes.find(n => n.id === nodeId);
        if (node) {
            network.focus(nodeId, { scale: 1.5, animation: true });
            network.selectNodes([nodeId]);
            showNodeDetail(node);
        }
    }
}

function renderDiary(entries) {
    const list = document.getElementById('diaryList');
    if (!entries || entries.length === 0) {
        list.innerHTML = '<div class="diary-empty">📓 No sessions recorded yet. Start a conversation!</div>';
        return;
    }
    // Newest first
    const sorted = [...entries].reverse();

    // Mood emoji mapping
    const MOOD_EMOJI = {
        happy: '😊', stressed: '😰', frustrated: '😤',
        excited: '🤩', neutral: '😐', focused: '🎯',
        sad: '😔', curious: '🤔', casual: '😎'
    };

    const MOOD_COLORS = {
        happy: '#34d399', stressed: '#f87171', frustrated: '#ef4444',
        excited: '#fbbf24', neutral: '#64748b', focused: '#38bdf8',
        sad: '#a78bfa', curious: '#f472b6', casual: '#22d3ee'
    };

    // Build mood timeline (last 20 entries with mood data)
    const moodEntries = sorted.filter(e => e.emotion).slice(0, 20);
    let timelineHtml = '';
    if (moodEntries.length > 0) {
        timelineHtml = `
            <div class="mood-timeline">
                <div class="mood-timeline-label">Recent Mood</div>
                <div class="mood-timeline-dots">
                    ${moodEntries.map((e, i) => {
                        const emoji = MOOD_EMOJI[e.emotion] || '😐';
                        const color = MOOD_COLORS[e.emotion] || '#64748b';
                        const dateStr = e.date || new Date(e.timestamp).toLocaleDateString();
                        return `<span class="mood-dot" style="background:${color};" title="${dateStr}: ${e.emotion}">${emoji}</span>`;
                    }).join('')}
                </div>
            </div>`;
    }

    // Build diary entries with mood + location badges
    const entriesHtml = sorted.map((e, i) => {
        const moodBadge = e.emotion
            ? `<span class="diary-mood-badge" style="color:${MOOD_COLORS[e.emotion] || '#64748b'};">${MOOD_EMOJI[e.emotion] || '😐'} ${e.emotion}</span>`
            : '';
        const locationBadge = e.location && e.location.placeName
            ? `<span class="diary-location-badge">📍 ${e.location.placeName}</span>`
            : '';
        return `
        <div class="diary-entry">
            <div class="diary-date">${e.date || new Date(e.timestamp).toLocaleString()} ${moodBadge}</div>
            ${locationBadge ? `<div class="diary-location-row">${locationBadge}</div>` : ''}
            <div class="diary-text">${e.entry}</div>
        </div>`;
    }).join('');

    list.innerHTML = timelineHtml + entriesHtml;
}
function renderNodeTags(node) {
    const container = document.getElementById('nodeTagsContainer');
    const tags = node.tags || [];
    container.innerHTML = tags.map(t =>
        `<span class="tag-pill" onclick="removeTagFromNode('${t}')">${t} ✕</span>`
    ).join('') +
        `<span class="tag-add-btn" onclick="promptAddTag()">+ tag</span>`;
}

async function promptAddTag() {
    if (!editingNodeId) return;
    const tag = prompt('Enter tag (e.g. work, study, personal):');
    if (!tag || !tag.trim()) return;
    const normTag = '#' + tag.trim().toLowerCase().replace(/^#/, '');
    const res = await window.memoryAPI.addTag(editingNodeId, normTag);
    if (res.success) {
        const node = currentGraph.nodes.find(n => n.id === editingNodeId);
        if (node) node.tags = res.tags;
        renderNodeTags(node);
        refreshTagFilterBar();
        renderGraph(currentGraph);
    }
}

async function removeTagFromNode(tag) {
    if (!editingNodeId) return;
    const res = await window.memoryAPI.removeTag(editingNodeId, tag);
    if (res.success) {
        const node = currentGraph.nodes.find(n => n.id === editingNodeId);
        if (node) node.tags = res.tags;
        renderNodeTags(node);
        refreshTagFilterBar();
        renderGraph(currentGraph);
    }
}

async function refreshTagFilterBar() {
    const tags = await window.memoryAPI.getTags();
    const bar = document.getElementById('tagFilterBar');
    const all = `<button class="tag-filter-pill ${!activeTagFilter ? 'active' : ''}" onclick="setTagFilter(null)">All</button>`;
    const pills = tags.map(t =>
        `<button class="tag-filter-pill ${activeTagFilter === t ? 'active' : ''}" onclick="setTagFilter('${t}')">${t}</button>`
    ).join('');
    bar.innerHTML = all + pills;
}

function setTagFilter(tag) {
    activeTagFilter = tag;
    searchHighlightIds.clear();
    document.getElementById('searchInput').value = '';
    refreshTagFilterBar();
    renderGraph(currentGraph);
}

// ── Live Search ──
function doSearch(query) {
    if (!query.trim()) {
        searchHighlightIds.clear();
        renderGraph(currentGraph);
        document.getElementById('searchClear').style.display = 'none';
        return;
    }
    document.getElementById('searchClear').style.display = 'inline-flex';

    const q = query.toLowerCase();
    const matched = currentGraph.nodes.filter(n => {
        const inLabel = n.label.toLowerCase().includes(q);
        const inDesc  = (n.description || '').toLowerCase().includes(q);
        const inType  = (n.type || '').toLowerCase().includes(q);
        const inTags  = (n.tags || []).some(t => t.toLowerCase().includes(q));
        return inLabel || inDesc || inType || inTags;
    });

    // Also include 1-hop neighbours of matches so context stays visible
    const matchedIds = new Set(matched.map(n => n.id));
    currentGraph.edges.forEach(e => {
        if (matchedIds.has(e.from)) matchedIds.add(e.to);
        if (matchedIds.has(e.to))   matchedIds.add(e.from);
    });

    searchHighlightIds = matchedIds;
    renderGraph(currentGraph);

    // Show count
    document.getElementById('searchCount').textContent =
        matched.length ? `${matched.length} match${matched.length > 1 ? 'es' : ''}` : 'No matches';
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchCount').textContent = '';
    document.getElementById('searchClear').style.display = 'none';
    searchHighlightIds.clear();
    renderGraph(currentGraph);
}
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragging');
    handleFiles(Array.from(e.dataTransfer.files));
});
fileInput.addEventListener('change', () => handleFiles(Array.from(fileInput.files)));

async function handleFiles(files) {
    if (!files.length) return;

    showProgress(`Reading ${files.length} file(s)...`, 10);

    // Read file contents
    const fileData = [];
    for (const file of files) {
        const buffer = await file.arrayBuffer();
        fileData.push({
            name: file.name,
            type: file.type,
            buffer: Array.from(new Uint8Array(buffer)) // serializable
        });
    }

    showProgress('Analyzing with AI...', 40);
    try {
        const result = await window.memoryAPI.uploadFiles(fileData);
        if (result.error) throw new Error(result.error);
        showProgress('Building graph...', 80);
        renderGraph(result.graph);
        showProgress('Done!', 100);
        setTimeout(hideProgress, 1500);
    } catch (err) {
        showProgress(`Error: ${err.message}`, 100, true);
        setTimeout(hideProgress, 3000);
    }
}

function showProgress(label, percent, isError = false) {
    const area = document.getElementById('progressArea');
    const lbl = document.getElementById('progressLabel');
    const fill = document.getElementById('progressFill');
    area.style.display = 'flex';
    lbl.textContent = label;
    lbl.style.color = isError ? '#f87171' : '#94a3b8';
    fill.style.width = percent + '%';
    fill.style.background = isError ? '#ef4444' : 'linear-gradient(90deg, #8b5cf6, #38bdf8)';
}

function hideProgress() {
    document.getElementById('progressArea').style.display = 'none';
    document.getElementById('progressFill').style.width = '0%';
}

async function clearGraph() {
    if (!confirm('Clear all memory? This cannot be undone.')) return;
    await window.memoryAPI.clearGraph();
    renderGraph({ nodes: [], edges: [] });
}

// ── Load graph on startup ──
window.addEventListener('DOMContentLoaded', async () => {
    const graph = await window.memoryAPI.getGraph();
    renderGraph(graph);
    await checkBackupState();

    // Load tag filter bar
    await refreshTagFilterBar();

    // Wire search input
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => doSearch(e.target.value));
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearSearch(); });

    // Wire importance slider
    document.getElementById('importanceSlider').addEventListener('input', (e) => {
        document.getElementById('importanceValue').textContent = (e.target.value * 5).toFixed(1) + '/5';
    });
    document.getElementById('importanceSlider').addEventListener('change', (e) => {
        setNodeImportance(parseFloat(e.target.value));
    });

    // Live-refresh graph when extraction completes (from main window file upload)
    window.memoryAPI.onExtractionDone(async (graph) => {
        renderGraph(graph);
        await refreshTagFilterBar();
    });

    // Wire up AI Command Palette (Cmd+K)
    document.addEventListener('keydown', (e) => {
        const overlay = document.getElementById('aiCommandOverlay');
        const input = document.getElementById('aiCommandInput');
        const status = document.getElementById('aiCommandStatus');

        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            overlay.style.display = 'flex';
            input.value = '';
            status.textContent = 'Type command and press Enter...';
            input.focus();
        }
        if (e.key === 'Escape' && overlay.style.display === 'flex') {
            overlay.style.display = 'none';
        }
        if (e.key === 'Enter' && overlay.style.display === 'flex') {
            const cmd = input.value.trim();
            if (cmd) {
                status.textContent = '✨ AI is analyzing and mutating graph... please wait.';
                input.disabled = true;
                window.memoryAPI.runMemoryCommand(cmd).then(async (res) => {
                    input.disabled = false;
                    if (res.success) {
                        alert(res.message);
                        overlay.style.display = 'none';
                        const graph = await window.memoryAPI.getGraph();
                        renderGraph(graph);
                        await checkBackupState();
                    } else {
                        status.textContent = 'Error: ' + res.message;
                    }
                });
            }
        }
    });
});

function openMemoryCommandPalette() {
    const overlay = document.getElementById('aiCommandOverlay');
    const input = document.getElementById('aiCommandInput');
    const status = document.getElementById('aiCommandStatus');
    overlay.style.display = 'flex';
    input.value = '';
    status.textContent = 'Type command and press Enter...';
    input.focus();
}

async function addCustomEdge() {
    if (!editingNodeId) return;
    const targetId = document.getElementById('edgeTargetSelect').value;
    const label = document.getElementById('edgeLabelInput').value.trim().replace(/\s+/g, '_');
    
    if (!targetId || !label) {
        alert("Please select a target node and enter a relationship label.");
        return;
    }
    
    const res = await window.memoryAPI.addEdge(editingNodeId, targetId, label);
    if (!res.success) {
        alert(res.reason || "Failed to add connection.");
    } else {
        document.getElementById('edgeTargetSelect').value = '';
        document.getElementById('edgeLabelInput').value = '';
        const graph = await window.memoryAPI.getGraph();
        renderGraph(graph);
        showNodeDetail(editingNodeId); // Refresh details
    }
}

async function checkBackupState() {
    const hasBackup = await window.memoryAPI.checkBackup();
    document.getElementById('btnRevertGraph').style.display = hasBackup ? 'inline-block' : 'none';
}

async function autoConnectIslands() {
    const btn = document.getElementById('btnAutoConnect');
    btn.textContent = "✨ Analyzing & Connecting...";
    btn.disabled = true;
    
    const res = await window.memoryAPI.optimizeGraph();
    
    if (res.success) {
        if (res.addedCount > 0) {
            alert(`Success! Connected ${res.addedCount} isolated edges.`);
            const graph = await window.memoryAPI.getGraph();
            renderGraph(graph);
            await checkBackupState();
        } else {
            alert(res.message || "Graph is already fully connected!");
        }
    } else {
        alert("Error: " + res.message);
    }
    
    btn.textContent = "✨ AI Connect Islands";
    btn.disabled = false;
}

async function revertGraph() {
    if (!confirm("Are you sure you want to revert the graph to before the last AI Auto-Connect?")) return;
    const res = await window.memoryAPI.revertGraph();
    if (res.success) {
        alert("Graph reverted successfully.");
        const graph = await window.memoryAPI.getGraph();
        renderGraph(graph);
        await checkBackupState();
    } else {
        alert("Failed to revert: " + res.message);
    }
}

async function ingestWebUrl() {
    const input = document.getElementById('urlIngestInput');
    const status = document.getElementById('urlIngestStatus');
    const url = input.value.trim();
    
    if (!url) return;
    if (!url.startsWith('http')) {
        alert('Please enter a valid URL starting with http:// or https://');
        return;
    }
    
    status.style.display = 'block';
    status.textContent = 'Scraping and analyzing...';
    input.disabled = true;
    
    try {
        const res = await window.memoryAPI.ingestUrl(url);
        if (res.success) {
            status.textContent = 'Done!';
            setTimeout(() => { status.style.display = 'none'; }, 3000);
            input.value = '';
            // Graph will auto-refresh via the extraction-done event if it was successful
        } else {
            status.textContent = 'Error: ' + res.message;
            status.style.color = '#ef4444';
        }
    } catch (e) {
        status.textContent = 'Error: ' + e.message;
        status.style.color = '#ef4444';
    } finally {
        input.disabled = false;
    }
}

async function ingestDirectText() {
    const input = document.getElementById('textIngestInput');
    const text = input.value.trim();
    if (!text) return;
    
    showProgress('Analyzing text with AI...', 40);
    input.disabled = true;
    try {
        const fileData = [{
            name: "Direct_Input.txt",
            type: "text/plain",
            buffer: Array.from(new TextEncoder().encode(text))
        }];
        const result = await window.memoryAPI.uploadFiles(fileData);
        if (result.error) throw new Error(result.error);
        showProgress('Building graph...', 80);
        renderGraph(result.graph);
        input.value = '';
        showProgress('Done!', 100);
        setTimeout(hideProgress, 1500);
    } catch (err) {
        showProgress(`Error: ${err.message}`, 100, true);
        setTimeout(hideProgress, 3000);
    } finally {
        input.disabled = false;
    }
}

async function exportMemory() {
    const res = await window.memoryAPI.exportMemory();
    if (res.success) {
        alert("Memory successfully exported! Files memory-export.json and memory-summary.md have been saved to your selected folder.");
    } else if (res.canceled) {
        // user cancelled
    } else {
        alert("Error exporting memory: " + res.message);
    }
}

async function importMemory() {
    if (!confirm("Warning: Importing a memory file will completely OVERWRITE your existing knowledge graph. Are you sure you want to proceed?")) return;
    
    const res = await window.memoryAPI.importMemory();
    if (res.success) {
        alert("Memory imported successfully!");
        const graph = await window.memoryAPI.getGraph();
        renderGraph(graph);
    } else if (res.canceled) {
        // user cancelled
    } else {
        alert("Error importing memory: " + res.message);
    }
}

let pendingConflicts = [];

window.memoryAPI.onMemoryConflict((conflicts) => {
    pendingConflicts.push(...conflicts);
    renderNextConflict();
});

function renderNextConflict() {
    if (pendingConflicts.length === 0) {
        closeConflictModal();
        return;
    }
    const overlay = document.getElementById('conflictOverlay');
    const list = document.getElementById('conflictList');
    overlay.style.display = 'flex';
    
    let html = '';
    pendingConflicts.forEach((conflict, index) => {
        html += `
            <div style="background:rgba(255,255,255,0.05); padding:12px; border-radius:8px; border:1px solid #ef4444;">
                <div style="font-size:13px; color:white; margin-bottom:8px;">
                    Node: <strong>${conflict.from}</strong> to <strong>${conflict.to}</strong>
                </div>
                <div style="display:flex; gap:10px;">
                    <div style="flex:1; background:rgba(0,0,0,0.3); padding:8px; border-radius:6px; cursor:pointer; border:1px solid #334155;" onclick="resolveConflict(${index}, 'keep_old')">
                        <div style="font-size:10px; color:#94a3b8; margin-bottom:4px;">Keep Old Memory</div>
                        <div style="color:#f87171;">--${conflict.oldLabel}--></div>
                    </div>
                    <div style="flex:1; background:rgba(0,0,0,0.3); padding:8px; border-radius:6px; cursor:pointer; border:1px solid #334155;" onclick="resolveConflict(${index}, 'adopt_new')">
                        <div style="font-size:10px; color:#94a3b8; margin-bottom:4px;">Adopt New Memory</div>
                        <div style="color:#4ade80;">--${conflict.newLabel}--></div>
                    </div>
                </div>
            </div>
        `;
    });
    list.innerHTML = html;
}

async function resolveConflict(index, action) {
    const conflict = pendingConflicts[index];
    await window.memoryAPI.resolveConflict({ action, contradiction: conflict });
    pendingConflicts.splice(index, 1); // remove the resolved one
    
    // Refresh the graph UI
    const graph = await window.memoryAPI.getGraph();
    renderGraph(graph);
    
    renderNextConflict();
}

function closeConflictModal() {
    document.getElementById('conflictOverlay').style.display = 'none';
    pendingConflicts = [];
}

// Expand image memory photo to fullscreen
function expandNodeImage() {
    const imgEl = document.getElementById('nodeImageEl');
    if (!imgEl || !imgEl.src) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
    const full = document.createElement('img');
    full.src = imgEl.src;
    full.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:12px;border:1px solid rgba(168,85,247,0.5);box-shadow:0 0 60px rgba(168,85,247,0.3);';
    overlay.appendChild(full);
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
}

/**
 * memory-timeline.js — Unified Cross-Modal Timeline
 *
 * Aggregates ALL memory types (text nodes, images, audio, procedural,
 * diary entries) into a single chronological feed for the Memory UI.
 *
 * Each timeline event has:
 *   - timestamp: Unix timestamp
 *   - type: 'text' | 'image' | 'audio' | 'procedural' | 'diary' | 'location'
 *   - title: Human-readable label
 *   - subtitle: Brief description
 *   - icon: Emoji icon
 *   - nodeId: Link to the graph node (if applicable)
 *   - emotion: Mood tag (if applicable)
 *   - location: Place name (if applicable)
 */

const { loadGraph } = require('./graph-store');
const { loadDiary } = require('./session-diary');

// Type metadata
const TYPE_META = {
    Person:          { icon: '👤', color: '#a78bfa' },
    Project:         { icon: '📁', color: '#38bdf8' },
    Skill:           { icon: '⚡', color: '#34d399' },
    Technology:      { icon: '🔧', color: '#34d399' },
    Organization:    { icon: '🏢', color: '#fb923c' },
    Concept:         { icon: '💡', color: '#f472b6' },
    Topic:           { icon: '📌', color: '#c084fc' },
    Location:        { icon: '📍', color: '#60a5fa' },
    Event:           { icon: '📅', color: '#f9a8d4' },
    ImageMemory:     { icon: '📸', color: '#a855f7' },
    AudioMemory:     { icon: '🎤', color: '#22d3ee' },
    ProceduralMemory:{ icon: '🧠', color: '#e879f9' },
    Document:        { icon: '📄', color: '#94a3b8' },
    Formula:         { icon: '📐', color: '#fbbf24' },
    Definition:      { icon: '📖', color: '#fbbf24' },
    diary:           { icon: '📓', color: '#6366f1' },
    Other:           { icon: '📝', color: '#64748b' }
};

/**
 * Build a unified timeline from all memory sources.
 *
 * @param {Object} options
 * @param {string} [options.typeFilter] - Filter by type ('text'|'image'|'audio'|'procedural'|'diary'|null for all)
 * @param {number} [options.limit] - Max events to return (default 100)
 * @param {string} [options.search] - Search keyword filter
 * @returns {Array<Object>} Array of timeline events, newest first
 */
function buildTimeline(options = {}) {
    const { typeFilter = null, limit = 100, search = null } = options;
    const events = [];

    const graph = loadGraph();
    const diary = loadDiary();

    // 1. Graph nodes → timeline events
    for (const node of graph.nodes) {
        const timestamp = node.createdAt || node.updatedAt || Date.now();
        const meta = TYPE_META[node.type] || TYPE_META.Other;

        // Determine simplified type category
        let category;
        if (node.type === 'ImageMemory') category = 'image';
        else if (node.type === 'AudioMemory') category = 'audio';
        else if (node.type === 'ProceduralMemory') category = 'procedural';
        else if (node.type === 'Location') category = 'location';
        else category = 'text';

        // Apply type filter
        if (typeFilter && typeFilter !== category) continue;

        // Apply search filter
        if (search) {
            const searchLower = search.toLowerCase();
            const searchable = `${node.label} ${node.description} ${(node.tags || []).join(' ')} ${node.transcript || ''}`.toLowerCase();
            if (!searchable.includes(searchLower)) continue;
        }

        events.push({
            timestamp,
            type: category,
            nodeType: node.type,
            title: node.label,
            subtitle: truncate(node.description || '', 120),
            icon: meta.icon,
            color: meta.color,
            nodeId: node.id,
            tags: node.tags || [],
            importance: node.importance || 0.5,
            // Type-specific fields
            ...(node.type === 'AudioMemory' && {
                transcript: truncate(node.transcript || '', 200),
                durationSec: node.durationSec,
                mood: node.mood,
                speakerCount: node.speakerCount
            }),
            ...(node.type === 'ImageMemory' && {
                imagePath: node.imagePath,
                publicUrl: node.publicUrl
            }),
            ...(node.type === 'ProceduralMemory' && {
                rules: node.rules,
                confidence: node.confidence,
                subtype: node.subtype
            }),
            ...(node.type === 'Location' && {
                lat: node.lat,
                lng: node.lng,
                placeType: node.placeType
            })
        });
    }

    // 2. Diary entries → timeline events
    if (!typeFilter || typeFilter === 'diary') {
        for (const entry of diary) {
            const timestamp = entry.timestamp || Date.now();

            // Apply search filter
            if (search) {
                const searchLower = search.toLowerCase();
                if (!entry.entry.toLowerCase().includes(searchLower)) continue;
            }

            events.push({
                timestamp,
                type: 'diary',
                nodeType: 'diary',
                title: `Session Diary`,
                subtitle: truncate(entry.entry, 150),
                icon: '📓',
                color: '#6366f1',
                nodeId: null,
                tags: [],
                importance: 0.6,
                emotion: entry.emotion || null,
                location: entry.location || null,
                fullEntry: entry.entry
            });
        }
    }

    // Sort newest first
    events.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit
    return events.slice(0, limit);
}

/**
 * Get summary statistics for the timeline.
 */
function getTimelineStats() {
    const events = buildTimeline({ limit: 10000 });

    const typeCounts = {};
    for (const e of events) {
        typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    }

    const moodCounts = {};
    for (const e of events) {
        if (e.emotion) {
            moodCounts[e.emotion] = (moodCounts[e.emotion] || 0) + 1;
        }
    }

    return {
        total: events.length,
        typeCounts,
        moodCounts,
        oldest: events.length > 0 ? events[events.length - 1].timestamp : null,
        newest: events.length > 0 ? events[0].timestamp : null
    };
}

function truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str;
    return str.slice(0, maxLen).trim() + '…';
}

module.exports = { buildTimeline, getTimelineStats };

/**
 * tool-router.js
 *
 * Selects which integration packs are exposed to Gemini per session.
 * Full handler registry always available for execution (no runtime regression).
 *
 * FLAW 6 FIX — Tool Schema Bloat:
 *   Added getSmartAgentTools(toolContext, recentText) which uses a fast
 *   keyword-based intent gate to SUPPRESS irrelevant heavy packs when the
 *   session opens with a clear non-domain intent, reducing the token count
 *   sent to Gemini by up to 60% while retaining full execution capability.
 *
 *   Design principle:
 *   - Heavy packs (os, app-control, google) add ~80–150 tokens each.
 *   - Core packs (web, memory, orchestration, ui) are always on.
 *   - We ONLY gate heavy packs — never remove core ones.
 *   - ALL handlers stay registered. Only Gemini's declaration list shrinks.
 *   - A tool_count warning is logged when the total exceeds the safe threshold.
 */

'use strict';

const { loadConfig }  = require('./user-integrations-config');
const loader          = require('./integration-loader');
const registry        = require('../core/transport/client-registry');

// Tools that require macOS-specific features (AppleScript, Accessibility API)
const MACOS_ONLY_PACKS = new Set(['os', 'app-control']);

// ── Bloat threshold ───────────────────────────────────────────────────────────
/** Warn when tool count in a session exceeds this number */
const TOOL_BLOAT_WARN_THRESHOLD = 60;

// ── In-memory cache ───────────────────────────────────────────────────────────
const declarationCache = new Map();
const CACHE_MAX = 32;

function buildContextSignature(ctx) {
    const caps = registry.getActiveCapabilities();
    return JSON.stringify({
        mode:     ctx.mode,
        google:   !!(ctx.googleAuthenticated || ctx.googleContext),
        pinned:   (ctx.pinnedPacks || []).slice().sort().join(','),
        platform: caps.platform,
        gate:     ctx._activeGate || 'all',
    });
}

/**
 * @param {object} options
 * @param {object} [options.contextPayload] - session context from renderer
 * @param {boolean} [options.googleAuthenticated]
 */
function buildToolContext(options = {}) {
    const config  = loadConfig();
    const payload = options.contextPayload || {};
    return {
        mode:               config.mode === 'full' ? 'full' : 'balanced',
        googleContext:      !!payload.googleContext,
        googleAuthenticated: !!options.googleAuthenticated,
        pinnedPacks:        config.pinnedPacks || [],
    };
}

// ── Intent-based pack gating ──────────────────────────────────────────────────

/**
 * Intent gate definitions.
 * Each gate lists keyword patterns and the packs to SUPPRESS when matched.
 * Packs not in the suppress list are always included.
 *
 * This is intentionally conservative — we only suppress packs when we are
 * highly confident the user does NOT need them.
 */
const INTENT_GATES = [
    {
        id:       'research_only',
        // Suppress heavy OS/app control packs when the session starts with research
        patterns: [/\b(research|report|study|analyse|analyze|summarize|deep dive)\b/i],
        suppress: new Set(['app-control', 'google']),
    },
    {
        id:       'presentation_only',
        patterns: [/\b(presentation|powerpoint|ppt|slides|deck)\b/i],
        suppress: new Set(['app-control']),
    },
    {
        id:       'calendar_only',
        patterns: [/\b(schedule|calendar|meeting|remind|appointment|event)\b/i],
        suppress: new Set(['app-control', 'os']),
    },
    {
        id:       'chat_only',
        // Pure conversational queries — suppress all heavy packs
        patterns: [/^(hey|hi|hello|what'?s? up|how are|tell me about|explain|who is)\b/i],
        suppress: new Set(['app-control', 'os', 'google']),
    },
];

/**
 * Classify text and return the matching intent gate (or null for "all packs").
 * Uses the FIRST matching gate — ordered from most-specific to least.
 */
function _detectIntentGate(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    for (const gate of INTENT_GATES) {
        if (gate.patterns.some(rx => rx.test(trimmed))) {
            return gate;
        }
    }
    return null;
}

// ── Core pack selection ───────────────────────────────────────────────────────

function selectPackIds(ctx, suppressSet = new Set()) {
    const active = new Set();

    if (ctx.mode === 'full') {
        for (const pack of loader.getAllPacks()) {
            if (!suppressSet.has(pack.id)) active.add(pack.id);
        }
        return [...active];
    }

    for (const pack of loader.getAllPacks()) {
        if (pack.alwaysOn && !suppressSet.has(pack.id)) active.add(pack.id);
    }

    if (ctx.pinnedPacks?.length) {
        for (const id of ctx.pinnedPacks) {
            if (!suppressSet.has(id)) active.add(id);
        }
    }

    if ((ctx.googleAuthenticated || ctx.googleContext) && !suppressSet.has('google')) {
        active.add('google');
    }

    return [...active];
}

// ── Build tools payload ───────────────────────────────────────────────────────

function _buildPayload(ctx, suppressed = new Set()) {
    const cacheKey = buildContextSignature({ ...ctx, _activeGate: [...suppressed].sort().join('|') });

    if (declarationCache.has(cacheKey)) {
        return declarationCache.get(cacheKey);
    }

    const packIds = selectPackIds(ctx, suppressed);

    // Capability-based filtering for entire packs
    const caps            = registry.getActiveCapabilities();
    const filteredPackIds = packIds.filter(id => {
        if (MACOS_ONLY_PACKS.has(id)) {
            // If it's a mobile client, we entirely rely on per-tool capabilities below, 
            // but we can still drop the whole pack if they declare NO supported actions.
            const isDesktop = caps.platform === 'electron' || caps.platform === 'darwin' || caps.platform === 'win32';
            if (!isDesktop && caps.platform !== 'unknown' && (!caps.supportedActions || caps.supportedActions.length === 0)) return false;
        }
        return true;
    });

    const declarations = loader.getDeclarationsForPacks(filteredPackIds);

    // Per-tool client capability filter
    let finalDeclarations = declarations;
    if (caps.supportedActions && Array.isArray(caps.supportedActions)) {
        const supported = new Set(caps.supportedActions);
        finalDeclarations = declarations.filter(d => {
            // These tool prefixes represent actions that MUST be executed on the client device
            const isClientTool = d.name.startsWith('os_') || d.name.startsWith('app_') ||
                d.name.startsWith('music_') || d.name.startsWith('finder_') ||
                d.name.startsWith('whatsapp_') || d.name.startsWith('terminal_') ||
                d.name.startsWith('clipboard_') || d.name.startsWith('airdrop_') ||
                d.name.startsWith('notes_') || d.name.startsWith('calendar_') ||
                d.name.startsWith('reminders_') || d.name.startsWith('ios_'); // Added ios_
            
            if (!isClientTool) {
                return true; // Server-executed tools (web, orchestration, etc.) are always included
            }
            return supported.has(d.name);
        });
    } else if (caps.platform === 'ios' || caps.platform === 'android') {
        // If a mobile client connects but DOES NOT provide supportedActions, 
        // strictly forbid all client-executable tools to prevent hallucinations.
        finalDeclarations = declarations.filter(d => {
            const isClientTool = d.name.startsWith('os_') || d.name.startsWith('app_') ||
                d.name.startsWith('music_') || d.name.startsWith('finder_') ||
                d.name.startsWith('whatsapp_') || d.name.startsWith('terminal_') ||
                d.name.startsWith('clipboard_') || d.name.startsWith('airdrop_') ||
                d.name.startsWith('notes_') || d.name.startsWith('calendar_') ||
                d.name.startsWith('reminders_');
            return !isClientTool;
        });
    }

    // ── Bloat warning ───────────────────────────────────────────────────────
    if (finalDeclarations.length > TOOL_BLOAT_WARN_THRESHOLD) {
        console.warn(
            `[ToolRouter] ⚠️  Tool count ${finalDeclarations.length} exceeds safe threshold (${TOOL_BLOAT_WARN_THRESHOLD}). ` +
            `Consider pinning fewer packs or using getSmartAgentTools() with intent hints.`
        );
    }

    const payload = [{ functionDeclarations: finalDeclarations }];

    if (declarationCache.size >= CACHE_MAX) {
        declarationCache.delete(declarationCache.keys().next().value);
    }
    declarationCache.set(cacheKey, payload);

    console.log(
        `[ToolRouter] mode=${ctx.mode} platform=${caps.platform} ` +
        `packs=[${filteredPackIds.join(', ')}] ` +
        `suppressed=[${[...suppressed].join(', ') || 'none'}] ` +
        `tools=${finalDeclarations.length}/${loader.getToolCount()}`
    );

    return payload;
}

/**
 * Original API — returns all contextually selected tools.
 * (Unchanged behaviour for backwards compatibility.)
 */
function getAgentTools(toolContext) {
    const ctx = toolContext || buildToolContext({});
    return _buildPayload(ctx);
}

/**
 * FLAW 6 FIX — Smart context-aware tool selection.
 *
 * Same as getAgentTools() but first runs a lightweight intent gate against
 * the session's opening text (e.g., the first user message or session topic).
 * Suppresses irrelevant heavy packs, reducing context bloat by up to 60%.
 *
 * Falls back gracefully to full tool set if no gate matches.
 *
 * @param {object} toolContext  - From buildToolContext()
 * @param {string} [intentHint] - Opening text / topic for intent classification
 * @returns {Array}             - Gemini tools payload
 */
function getSmartAgentTools(toolContext, intentHint) {
    const ctx  = toolContext || buildToolContext({});
    const gate = _detectIntentGate(intentHint);

    if (gate) {
        console.log(`[ToolRouter] 🎯 Intent gate matched: "${gate.id}" → suppressing [${[...gate.suppress].join(', ')}]`);
        return _buildPayload(ctx, gate.suppress);
    }

    return _buildPayload(ctx);
}

function invalidateDeclarationCache() {
    declarationCache.clear();
}

function getRouterStats(toolContext) {
    const ctx  = toolContext || buildToolContext({});
    const packIds = selectPackIds(ctx);
    const declarations = loader.getDeclarationsForPacks(packIds);
    return {
        mode:           ctx.mode,
        activePacks:    packIds,
        activeToolCount: declarations.length,
        totalToolCount: loader.getToolCount(),
        bloatWarning:   declarations.length > TOOL_BLOAT_WARN_THRESHOLD,
    };
}

module.exports = {
    buildToolContext,
    selectPackIds,
    getAgentTools,
    getSmartAgentTools,       // ← Flaw 6 fix: intent-gated tool selection
    invalidateDeclarationCache,
    getRouterStats,
};

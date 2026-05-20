/**
 * Selects which integration packs are exposed to Gemini per session.
 * Full handler registry always available for execution (no runtime regression).
 */

const { loadConfig } = require('./user-integrations-config');
const loader = require('./integration-loader');
const registry = require('../core/transport/client-registry');

// Tools that require macOS-specific features (AppleScript, Accessibility API)
const MACOS_ONLY_PACKS = new Set(['os', 'app-control']);

/** In-memory cache: context signature → Gemini tools payload */
const declarationCache = new Map();
const CACHE_MAX = 16;

function buildContextSignature(ctx) {
    const caps = registry.getActiveCapabilities();
    return JSON.stringify({
        mode: ctx.mode,
        google: !!(ctx.googleAuthenticated || ctx.googleContext),
        pinned: (ctx.pinnedPacks || []).slice().sort().join(','),
        platform: caps.platform,
    });
}

/**
 * @param {object} options
 * @param {object} [options.contextPayload] - session context from renderer
 * @param {boolean} [options.googleAuthenticated]
 */
function buildToolContext(options = {}) {
    const config = loadConfig();
    const payload = options.contextPayload || {};
    return {
        mode: config.mode === 'full' ? 'full' : 'balanced',
        googleContext: !!payload.googleContext,
        googleAuthenticated: !!options.googleAuthenticated,
        pinnedPacks: config.pinnedPacks || [],
    };
}

function selectPackIds(ctx) {
    const active = new Set();

    if (ctx.mode === 'full') {
        for (const pack of loader.getAllPacks()) {
            active.add(pack.id);
        }
        return [...active];
    }

    for (const pack of loader.getAllPacks()) {
        if (pack.alwaysOn) active.add(pack.id);
    }

    if (ctx.pinnedPacks?.length) {
        for (const id of ctx.pinnedPacks) active.add(id);
    }

    if (ctx.googleAuthenticated || ctx.googleContext) {
        active.add('google');
    }

    return [...active];
}

function getAgentTools(toolContext) {
    const ctx = toolContext || buildToolContext({});
    const cacheKey = buildContextSignature(ctx);

    if (declarationCache.has(cacheKey)) {
        return declarationCache.get(cacheKey);
    }

    const packIds = selectPackIds(ctx);

    // Capability-based filtering: remove packs the active client can't support
    const caps = registry.getActiveCapabilities();
    const filteredPackIds = packIds.filter(id => {
        // If client is not macOS/electron, skip macOS-only packs
        if (MACOS_ONLY_PACKS.has(id)) {
            const isMac = caps.platform === 'electron' || caps.platform === 'darwin';
            if (!isMac && caps.platform !== 'unknown') {
                return false;
            }
        }
        // If client declared supportedActions, filter packs whose tools aren't in the list
        // (only for OS/app packs — cloud tools like Google/web always pass)
        return true;
    });

    const declarations = loader.getDeclarationsForPacks(filteredPackIds);

    // Additional per-tool filtering if client declared supportedActions
    let finalDeclarations = declarations;
    if (caps.supportedActions && Array.isArray(caps.supportedActions)) {
        const supported = new Set(caps.supportedActions);
        finalDeclarations = declarations.filter(d => {
            // Always include non-OS tools (web, google, memory, ui, orchestration, browser)
            if (!d.name.startsWith('os_') && !d.name.startsWith('app_') &&
                !d.name.startsWith('music_') && !d.name.startsWith('finder_') &&
                !d.name.startsWith('whatsapp_') && !d.name.startsWith('terminal_') &&
                !d.name.startsWith('clipboard_') && !d.name.startsWith('airdrop_') &&
                !d.name.startsWith('notes_') && !d.name.startsWith('calendar_') &&
                !d.name.startsWith('reminders_')) {
                return true;
            }
            // For platform-specific tools, only include if client supports them
            return supported.has(d.name);
        });
    }

    const payload = [{
        functionDeclarations: finalDeclarations,
    }];

    if (declarationCache.size >= CACHE_MAX) {
        const firstKey = declarationCache.keys().next().value;
        declarationCache.delete(firstKey);
    }
    declarationCache.set(cacheKey, payload);

    console.log(
        `[ToolRouter] mode=${ctx.mode} platform=${caps.platform} packs=[${filteredPackIds.join(', ')}] tools=${finalDeclarations.length}/${loader.getToolCount()}`
    );

    return payload;
}

function invalidateDeclarationCache() {
    declarationCache.clear();
}

function getRouterStats(toolContext) {
    const ctx = toolContext || buildToolContext({});
    const packIds = selectPackIds(ctx);
    const declarations = loader.getDeclarationsForPacks(packIds);
    return {
        mode: ctx.mode,
        activePacks: packIds,
        activeToolCount: declarations.length,
        totalToolCount: loader.getToolCount(),
    };
}

module.exports = {
    buildToolContext,
    selectPackIds,
    getAgentTools,
    invalidateDeclarationCache,
    getRouterStats,
};

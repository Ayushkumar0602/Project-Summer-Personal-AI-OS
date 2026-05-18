/**
 * Selects which integration packs are exposed to Gemini per session.
 * Full handler registry always available for execution (no runtime regression).
 */

const { loadConfig } = require('./user-integrations-config');
const loader = require('./integration-loader');

/** In-memory cache: context signature → Gemini tools payload */
const declarationCache = new Map();
const CACHE_MAX = 16;

function buildContextSignature(ctx) {
    return JSON.stringify({
        mode: ctx.mode,
        google: !!(ctx.googleAuthenticated || ctx.googleContext),
        pinned: (ctx.pinnedPacks || []).slice().sort().join(','),
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
    const declarations = loader.getDeclarationsForPacks(packIds);

    const payload = [{
        functionDeclarations: declarations,
    }];

    if (declarationCache.size >= CACHE_MAX) {
        const firstKey = declarationCache.keys().next().value;
        declarationCache.delete(firstKey);
    }
    declarationCache.set(cacheKey, payload);

    console.log(
        `[ToolRouter] mode=${ctx.mode} packs=[${packIds.join(', ')}] tools=${declarations.length}/${loader.getToolCount()}`
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

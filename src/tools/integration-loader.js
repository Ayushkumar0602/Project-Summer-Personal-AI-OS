/**
 * Loads integration packs once at startup and provides O(1) tool dispatch.
 */

const fs = require('node:fs');
const path = require('node:path');

const { searchWeb, scrapeWebpage, getNews, searchImages } = require('./web-tools');
const { executeOsTool, isOsTool } = require('./os-tools');
const { osToolDeclarations } = require('./os-tool-declarations');
const { executeAppControlTool, isAppControlTool } = require('./app-control-tools');
const { appControlDeclarations } = require('./app-control-declarations');
const googleTools = require('./google-tools');
const uiTools = require('./ui-tools');
const { webToolDeclarations } = require('./web-tool-declarations');
const { browserToolDeclarations, isBrowserTool } = require('./browser-tool-declarations');
const { memoryToolDeclarations } = require('./memory-tool-declarations');
const { orchestrationToolDeclarations } = require('./orchestration-tool-declarations');
const { gatewayDeclarations, createGatewayHandlers } = require('./integration-gateway');
const { loadGraph } = require('../knowledge/graph-store');
const { searchMemory } = require('../knowledge/graph-search');
const { findMatchingImageNodes, extractKeywordsFromText } = require('../knowledge/image-analyzer');
const orchestrator = require('../orchestration/orchestrator');
const { sendToRenderer } = require('../core/utils/renderer-bridge');

const INTEGRATIONS_DIR = path.join(__dirname, '..', '..', 'integrations');

const handlerRegistry = new Map();
const declarationByName = new Map();
const packsById = new Map();

let initialized = false;

function registerDeclarations(packId, declarations) {
    for (const decl of declarations) {
        const name = decl.name;
        if (!name) continue;
        if (declarationByName.has(name)) {
            throw new Error(`[Integrations] Duplicate tool name "${name}" in pack ${packId}`);
        }
        declarationByName.set(name, { ...decl, _packId: packId });
    }
}

function registerHandlers(packId, handlers) {
    for (const [name, fn] of Object.entries(handlers)) {
        if (typeof fn !== 'function') continue;
        if (handlerRegistry.has(name)) {
            throw new Error(`[Integrations] Duplicate handler "${name}" in pack ${packId}`);
        }
        handlerRegistry.set(name, { packId, handler: fn });
    }
}

function registerPack(pack) {
    packsById.set(pack.id, pack);
    registerDeclarations(pack.id, pack.declarations || []);
    registerHandlers(pack.id, pack.handlers || {});
}

async function executeQueryMemory(args) {
    const searchResult = searchMemory(
        args.query || '',
        Math.min(args.maxResults || 5, 10),
        args.filterTag || null
    );
    return {
        query: args.query,
        filterTag: args.filterTag || null,
        found: searchResult.nodes.length,
        summary: searchResult.summary,
        nodes: searchResult.nodes.map(n => ({
            id: n.id, label: n.label, type: n.type,
            description: n.description,
            tags: n.tags || [],
            lastAccessed: n.lastAccessedAt ? new Date(n.lastAccessedAt).toLocaleDateString() : null,
        })),
    };
}

async function executeShowVisualMemory(args) {
    const graph = loadGraph();
    const searchQ = (args.query || 'photo').toLowerCase();
    const personalKeywords = ['me', 'my', 'mine', 'ayush', 'myself', 'personal', 'i', 'photo', 'profile'];
    const isPersonalQuery = personalKeywords.some(k => searchQ.split(/\s+/).includes(k));
    const keywords = extractKeywordsFromText(searchQ);
    const rawWords = searchQ.split(/\s+/).filter(w => w.length > 1);
    const allKws = [...new Set([...keywords, ...rawWords])];

    let matches = findMatchingImageNodes(allKws, graph, args.count || 4, isPersonalQuery);
    if (matches.length === 0 && isPersonalQuery) {
        const userSelfImageIds = new Set(
            (graph.edges || []).filter(e => e.to === 'user_self').map(e => e.from)
        );
        matches = graph.nodes
            .filter(n => n.type === 'ImageMemory' && userSelfImageIds.has(n.id))
            .slice(0, args.count || 4);
    }

    if (matches.length > 0) {
        sendToRenderer('show-hud-widget', {
            type: 'image_gallery',
            data: {
                title: '📸 Your Photos',
                images: matches.map(n => ({
                    filename: n.imagePath,
                    publicUrl: n.publicUrl,
                    label: n.label,
                    description: n.description,
                    source: 'memory',
                })),
            },
        });
        return { shown: matches.length, labels: matches.map(n => n.label) };
    }

    return {
        shown: 0,
        message: matches.length === 0 && !isPersonalQuery
            ? `No images found matching "${searchQ}". Try a more specific term.`
            : 'No personal photos found in visual memory. Ask the user to upload photos via the Memory window (🧠 button).',
    };
}

async function executeSearchImages(args) {
    const imgResult = await searchImages(args.query, args.count || 4);
    if (imgResult.images?.length > 0) {
        sendToRenderer('show-hud-widget', {
            type: 'image_gallery',
            data: {
                title: `🔍 ${args.query}`,
                images: imgResult.images,
                source: 'internet',
            },
        });
    }
    return imgResult;
}

function buildBuiltinPacks() {
    const webHandlers = {
        search_web: (args) => searchWeb(args.query),
        scrape_webpage: (args) => scrapeWebpage(args.url),
        get_news: (args) => getNews(args.topic || ''),
        search_images: (args) => executeSearchImages(args),
    };

    const memoryHandlers = {
        query_memory: (args) => executeQueryMemory(args),
        show_visual_memory: (args) => executeShowVisualMemory(args),
    };

    const browserHandlers = {};
    for (const decl of browserToolDeclarations) {
        browserHandlers[decl.name] = async (args, ctx) => {
            const res = await ctx.callBrowser(decl.name, args);
            if (res.error) throw new Error(res.error);
            return res.result;
        };
    }

    const osHandlers = {};
    for (const decl of osToolDeclarations) {
        osHandlers[decl.name] = (args) => executeOsTool(decl.name, args);
    }

    const appControlHandlers = {};
    for (const decl of appControlDeclarations) {
        appControlHandlers[decl.name] = (args) => executeAppControlTool(decl.name, args);
    }

    const orchestrationHandlers = {
        delegate_domain_agent: (args, ctx) => {
            const agentEmit = (ev, payload) => ctx.emitAgentEvent(ev, payload);
            return orchestrator.handleDelegateRequest({
                agent_id: args.agent_id,
                user_request: args.user_request || '',
                gathered_attributes: args.gathered_attributes || {},
            }, agentEmit);
        },
    };

    return [
        {
            id: 'web',
            displayName: 'Web',
            description: 'Internet search, news, and images.',
            alwaysOn: true,
            declarations: webToolDeclarations,
            handlers: webHandlers,
        },
        {
            id: 'browser',
            displayName: 'Mini Browser',
            description: 'Visible browser navigation and page interaction.',
            alwaysOn: true,
            declarations: browserToolDeclarations,
            handlers: browserHandlers,
        },
        {
            id: 'memory',
            displayName: 'Memory',
            description: 'Knowledge graph and visual memory.',
            alwaysOn: true,
            declarations: memoryToolDeclarations,
            handlers: memoryHandlers,
        },
        {
            id: 'os',
            displayName: 'macOS System',
            description: 'Volume, apps, clipboard, screenshots, system control.',
            alwaysOn: true,
            declarations: osToolDeclarations,
            handlers: osHandlers,
        },
        {
            id: 'app-control',
            displayName: 'Deep App Control',
            description: 'Vision, UI automation, music, WhatsApp, Finder, and more.',
            alwaysOn: true,
            declarations: appControlDeclarations,
            handlers: appControlHandlers,
        },
        {
            id: 'google',
            displayName: 'Google Workspace',
            description: 'Calendar, Gmail, Drive, Tasks, YouTube, Maps.',
            alwaysOn: false,
            requiresAuth: true,
            declarations: googleTools.declarations,
            handlers: googleTools.handlers,
        },
        {
            id: 'ui',
            displayName: 'HUD & Layout',
            description: 'On-screen widgets and window layout.',
            alwaysOn: true,
            declarations: uiTools.declarations,
            handlers: uiTools.handlers,
        },
        {
            id: 'orchestration',
            displayName: 'Domain Agents',
            description: 'Background PPT and research agents.',
            alwaysOn: true,
            declarations: orchestrationToolDeclarations,
            handlers: orchestrationHandlers,
        },
    ];
}

function loadExternalIntegrations() {
    if (!fs.existsSync(INTEGRATIONS_DIR)) return;

    for (const entry of fs.readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
        const packDir = path.join(INTEGRATIONS_DIR, entry.name);
        const manifestPath = path.join(packDir, 'integration.json');
        const indexPath = path.join(packDir, 'index.js');
        if (!fs.existsSync(manifestPath) || !fs.existsSync(indexPath)) continue;

        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const packModule = require(indexPath);
            const pack = packModule.createPack ? packModule.createPack(manifest) : packModule;
            if (!pack?.id) pack.id = manifest.id || entry.name;
            pack.displayName = pack.displayName || manifest.display_name;
            pack.description = pack.description || manifest.description;
            pack.alwaysOn = pack.alwaysOn === true || manifest.activation?.always_on === true;
            registerPack(pack);
            console.log(`[Integrations] ✅ External pack: ${pack.id}`);
        } catch (e) {
            console.error(`[Integrations] ❌ Failed to load ${entry.name}:`, e.message);
        }
    }
}

function registerGatewayPack() {
    const gatewayHandlers = createGatewayHandlers(
        (id) => packsById.get(id),
        () => listPackCatalog()
    );
    registerPack({
        id: 'gateway',
        displayName: 'Integration Gateway',
        description: 'Discover and invoke optional third-party integrations.',
        alwaysOn: true,
        declarations: gatewayDeclarations,
        handlers: gatewayHandlers,
    });
}

function initialize() {
    if (initialized) return;
    const startMs = Date.now();

    for (const pack of buildBuiltinPacks()) {
        registerPack(pack);
    }
    loadExternalIntegrations();
    registerGatewayPack();

    initialized = true;
    console.log(
        `[Integrations] Loaded ${packsById.size} packs, ${declarationByName.size} tools, ${handlerRegistry.size} handlers (${Date.now() - startMs}ms)`
    );
}

function listPackCatalog() {
    initialize();
    return [...packsById.values()].map(p => ({
        id: p.id,
        displayName: p.displayName,
        description: p.description,
        alwaysOn: p.alwaysOn === true,
        requiresAuth: p.requiresAuth === true,
        available: p.available !== false,
        pinned: p.pinned === true,
        actions: Object.keys(p.handlers || {}).filter(n => !n.startsWith('_')),
    }));
}

function getPack(id) {
    initialize();
    return packsById.get(id) || null;
}

function getAllPacks() {
    initialize();
    return [...packsById.values()];
}

function getDeclarationNamesForPacks(packIds) {
    const ids = new Set(packIds);
    const names = [];
    for (const [name, decl] of declarationByName) {
        if (ids.has(decl._packId)) names.push(name);
    }
    return names;
}

function getDeclarationsForPacks(packIds) {
    const ids = new Set(packIds);
    const decls = [];
    for (const decl of declarationByName.values()) {
        if (ids.has(decl._packId)) {
            const { _packId, ...clean } = decl;
            decls.push(clean);
        }
    }
    return decls;
}

async function executeTool(name, args, ctx) {
    initialize();
    const entry = handlerRegistry.get(name);
    if (!entry) {
        if (isOsTool(name)) return executeOsTool(name, args);
        if (isAppControlTool(name)) return executeAppControlTool(name, args);
        throw new Error(`Unknown tool: ${name}`);
    }
    return entry.handler(args, ctx);
}

function reloadExternalPacks() {
    for (const [name, decl] of declarationByName) {
        if (decl._packId !== 'gateway' && !['web', 'browser', 'memory', 'os', 'app-control', 'google', 'ui', 'orchestration'].includes(decl._packId)) {
            declarationByName.delete(name);
            handlerRegistry.delete(name);
        }
    }
    for (const id of [...packsById.keys()]) {
        if (!['web', 'browser', 'memory', 'os', 'app-control', 'google', 'ui', 'orchestration', 'gateway'].includes(id)) {
            packsById.delete(id);
        }
    }
    loadExternalIntegrations();
}

initialize();

module.exports = {
    initialize,
    executeTool,
    getAllPacks,
    getPack,
    listPackCatalog,
    getDeclarationsForPacks,
    getDeclarationNamesForPacks,
    reloadExternalPacks,
    getToolCount: () => declarationByName.size,
};

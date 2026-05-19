/**
 * summer-daemon.js
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║            S U M M E R   C O R E   D A E M O N             ║
 * ║                                                              ║
 * ║  The headless brain. Zero Electron dependency.               ║
 * ║  Runs on macOS, Windows, Linux, and cloud servers.           ║
 * ║  Clients connect via WebSocket — Mac, iPhone, Android, CLI.  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node summer-daemon.js                   # production (port 8765)
 *   node summer-daemon.js --port 9000       # custom port
 *   node summer-daemon.js --skip-auth       # dev mode (no token check)
 *   node summer-daemon.js --no-wake-word    # disable wake word
 *
 * Started automatically by Electron (src/index.js) OR run standalone.
 */

'use strict';

require('dotenv').config();

const path = require('path');
const { createLogger }          = require('./src/core/utils/logger');
const bus                       = require('./src/core/event-bus');
const { WsTransportServer }     = require('./src/core/transport/ws-server');
const { BrainBridge }           = require('./src/core/brain-bridge');
const { createAgentEventEmitter } = require('./src/core/agent-events-bridge');
const { getPlatformAdapter }    = require('./src/core/platform/adapter-factory');

// These are pure Node.js — no Electron
const { LiveSessionManager }    = require('./src/main/gemini/live-session');
const orchestrator               = require('./src/orchestration/orchestrator');
const rendererBridge             = require('./src/core/utils/renderer-bridge');
const { initGraphStore }         = require('./src/knowledge/graph-store');
const { initDiaryStore }         = require('./src/knowledge/session-diary');

const log = createLogger('SummerDaemon');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const PORT        = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || process.env.PORT || '8765');
const SKIP_AUTH   = args.includes('--skip-auth');
const NO_WAKE     = args.includes('--no-wake-word');

// ── Daemon State ─────────────────────────────────────────────────────────────
let wsServer    = null;
let brainBridge = null;

async function start() {
    log.info('═══════════════════════════════════════════');
    log.info('         SUMMER CORE DAEMON v2.0           ');
    log.info('═══════════════════════════════════════════');
    log.info(`Platform: ${process.platform}`);
    log.info(`Port:     ${PORT}`);
    log.info(`Auth:     ${SKIP_AUTH ? 'DISABLED (dev mode)' : 'ENABLED'}`);

    // 1. Detect platform and log adapter
    const platformAdapter = getPlatformAdapter();
    log.info(`Platform adapter: ${platformAdapter.platformId}`);

    // 2. Initialize Knowledge Bases (Supabase/Local)
    log.info('Initializing Knowledge Bases...');
    await initGraphStore();
    await initDiaryStore();

    // 2. Start the WebSocket transport server
    wsServer = new WsTransportServer({ port: PORT, skipAuth: SKIP_AUTH });
    wsServer.start();

    // 2b. Inject ClientRegistry into renderer-bridge so tools can send HUD updates via WebSocket
    const clientRegistry = require('./src/core/transport/client-registry');
    rendererBridge.injectRegistry(clientRegistry);

    // 3. Create the agent event emitter (platform-agnostic replacement for createEmitAgentEvent)
    const emitAgentEvent = createAgentEventEmitter();

    // 4. Create the LiveSessionManager with a NULL main window (no Electron)
    //    callBrowser now routes through renderer-bridge → WebSocket → client
    const liveSessionManager = new LiveSessionManager({
        getMainWindow:     () => null,
        getMemoryWindow:   () => null,
        getWakeWordEngine: () => null,
        callBrowser:       _daemonCallBrowser,
        emitAgentEvent,
    });

    // 5. Wire the Brain to the event bus via BrainBridge
    brainBridge = new BrainBridge();
    brainBridge.init(liveSessionManager);

    // 6. Wire orchestrator agent events to the event bus
    //    (orchestrator emits events that need to reach clients)
    _wireOrchestratorEvents(emitAgentEvent);

    // 7. Wire client_action responses (requires_client results) back to clients
    _wireClientActionHandling();

    // 8. Optional: Start wake word engine (desktop only, skipped on headless)
    if (!NO_WAKE && process.platform !== 'linux') {
        _initWakeWord();
    } else {
        log.info('Wake word: disabled');
    }

    // 9. Graceful shutdown handlers
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
        log.error('Uncaught exception', { err: err.message, stack: err.stack });
    });
    process.on('unhandledRejection', (reason) => {
        log.error('Unhandled rejection', { reason: String(reason) });
    });

    log.info('═══════════════════════════════════════════');
    log.info('  Summer Daemon is RUNNING. Ready for clients.');
    log.info(`  Local:   ws://localhost:${PORT}`);
    log.info(`  Network: ws://0.0.0.0:${PORT}`);
    log.info('═══════════════════════════════════════════');
}

// ── Orchestrator event wiring ─────────────────────────────────────────────────

function _wireOrchestratorEvents(emitAgentEvent) {
    // The orchestrator uses EventEmitter internally — listen and forward to bus
    if (orchestrator.on) {
        orchestrator.on('agent-progress', (payload) => emitAgentEvent('agent-progress', payload));
        orchestrator.on('agent-complete', (payload) => emitAgentEvent('agent-complete', payload));
        orchestrator.on('agent-fail',     (payload) => emitAgentEvent('agent-fail', payload));
        orchestrator.on('agent-killed',   (payload) => emitAgentEvent('agent-killed', payload));
        log.info('Orchestrator events wired to event bus.');
    }
}

// ── Daemon-side browser callBrowser ───────────────────────────────────────────
// Sends the browser-control request via WebSocket to Electron, waits for reply.

const _pendingBrowserCalls = new Map();

function _daemonCallBrowser(action, args) {
    const { encode } = require('./src/core/transport/protocol');
    const registry = require('./src/core/transport/client-registry');

    // toggle_browser: just run the script in the renderer — no reply needed
    if (action === 'toggle_browser') {
        const show = args?.visible !== false;
        rendererBridge.executeInRenderer(
            show
                ? `document.getElementById('appLayout')?.classList.remove('browser-hidden');`
                : `document.getElementById('appLayout')?.classList.add('browser-hidden');`
        );
        return Promise.resolve({ result: `Browser ${show ? 'shown' : 'hidden'}.` });
    }

    return new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2);
        _pendingBrowserCalls.set(id, resolve);
        registry.sendToActive(encode('browser_control', { id, action, args: args || {} }));
        const timeoutMs = action === 'browser_navigate' ? 20000 : 15000;
        setTimeout(() => {
            if (_pendingBrowserCalls.has(id)) {
                _pendingBrowserCalls.get(id)({ error: 'Browser tool timeout' });
                _pendingBrowserCalls.delete(id);
            }
        }, timeoutMs);
    });
}

// Electron client forwards browser-reply to the daemon via WebSocket message type 'browser_reply'
bus.on('browser_reply', (payload) => {
    const { id } = payload;
    if (_pendingBrowserCalls.has(id)) {
        _pendingBrowserCalls.get(id)(payload);
        _pendingBrowserCalls.delete(id);
    }
});

// ── Client action handling ─────────────────────────────────────────────────────
// When platform adapter returns { status: 'requires_client', action, args },
// we forward to the active client.

function _wireClientActionHandling() {
    const { MSG: M, encode } = require('./src/core/transport/protocol');
    const registry = require('./src/core/transport/client-registry');

    bus.on('client_action', ({ action, args }) => {
        registry.sendToActive(encode('client_action', { action, args }));
        log.debug(`Client action delegated: ${action}`);
    });
}

// ── Wake word (optional) ───────────────────────────────────────────────────────

function _initWakeWord() {
    try {
        const { WakeWordEngine } = require('./src/wake-word/wake-word-engine');
        const wakeWord = new WakeWordEngine({
            modelDir:   path.join(__dirname, 'src/models'),
            threshold:  0.85,
            cooldownMs: 2000,
            debounceMs: 3000,
        });

        wakeWord.on('detected', (score) => {
            log.info(`Wake word detected! Score: ${score.toFixed(4)}`);
            wakeWord.pause();
            bus.broadcast(require('./src/core/transport/protocol').encode(
                require('./src/core/transport/protocol').MSG.HUD_UPDATE, {
                    widget: 'wake_word',
                    state:  { detected: true, score },
                }
            ));
        });

        wakeWord.on('error',       (err)    => log.error('WakeWord error', { err: err.message }));
        wakeWord.on('unavailable', (reason) => log.warn(`WakeWord unavailable: ${reason}`));

        setTimeout(() => wakeWord.start(), 3000);
        log.info('Wake word engine initialized.');
    } catch (err) {
        log.warn(`Wake word engine unavailable: ${err.message}`);
    }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal) {
    log.info(`Received ${signal} — shutting down gracefully...`);
    if (wsServer) wsServer.stop();
    log.info('Summer Daemon stopped. Goodbye.');
    process.exit(0);
}

// ── Run ───────────────────────────────────────────────────────────────────────
start().catch(err => {
    console.error('[SummerDaemon] Fatal startup error:', err);
    process.exit(1);
});

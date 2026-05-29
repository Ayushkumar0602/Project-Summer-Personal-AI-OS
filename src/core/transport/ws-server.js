/**
 * core/transport/ws-server.js
 *
 * The WebSocket Transport Server — Summer's "nervous system".
 *
 * Listens on ws://localhost:{port} and bridges all clients to the Core Daemon event bus.
 * Handles:
 *  - Client authentication (pairing token)
 *  - Routing client messages → event bus
 *  - Routing event bus → client (via CLIENT_SEND events)
 *  - Keepalive ping/pong
 *  - Clean disconnect handling
 *
 * Adding a new client type = connect to ws://localhost:{port} with valid token. Done.
 */

'use strict';

const WebSocket     = require('ws');
const crypto        = require('crypto');
const fs            = require('fs');
const { createLogger } = require('../utils/logger');
const bus           = require('../event-bus');
const registry      = require('./client-registry');
const { MSG, encode, decode } = require('./protocol');
const Paths         = require('../utils/paths');

const log = createLogger('WsServer');
const PING_INTERVAL_MS = 20_000;

// ── Auth token ────────────────────────────────────────────────────────────────

function _loadOrCreateToken() {
    const envToken = process.env.DAEMON_TOKEN || process.env.REMOTE_DAEMON_TOKEN;
    if (envToken) return envToken.replace(/^["']|["']$/g, '');
    const tokenPath = Paths.pairingToken();
    if (fs.existsSync(tokenPath)) {
        const t = fs.readFileSync(tokenPath, 'utf8').trim();
        if (t.length >= 32) return t;
    }
    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(tokenPath, token, { mode: 0o600 });
    log.info(`New pairing token generated → ${tokenPath}`);
    log.info(`Share this token with your iPhone app to pair.`);
    return token;
}

// ── Server ────────────────────────────────────────────────────────────────────

class WsTransportServer {
    /**
     * @param {object} opts
     * @param {number}  opts.port      - default 8765
     * @param {boolean} opts.skipAuth  - set true in dev / for local Electron client
     */
    constructor(opts = {}) {
        this._port     = opts.port     ?? 8765;
        this._skipAuth = opts.skipAuth ?? false;
        this._token    = _loadOrCreateToken();
        this._wss      = null;
        this._pingTimers    = new Map(); // clientId → intervalId
        this._clientSockets = new Map(); // clientId → ws  (for force-close on duplicate device)
    }

    start() {
        this._wss = new WebSocket.Server({ host: '0.0.0.0', port: this._port });

        this._wss.on('listening', () => {
            log.info(`Summer Daemon listening on ws://0.0.0.0:${this._port}`);
            log.info(`Pairing token: ${this._token}`);
        });

        this._wss.on('connection', (ws) => this._onConnection(ws));

        this._wss.on('error', (err) => {
            log.error('WebSocket server error', { err: err.message });
        });

        // ── Bridge event bus → clients ────────────────────────────────
        this._clientSendHandler = ({ clientId, message }) => {
            const encoded = typeof message === 'string' ? message : JSON.stringify(message);
            if (clientId === 'all') {
                registry.broadcast(encoded);
            } else {
                registry.send(clientId, encoded);
            }
        };
        bus.on(bus.EVENTS.CLIENT_SEND, this._clientSendHandler);

        log.info('WsTransportServer started.');
        return this;
    }

    stop() {
        if (this._clientSendHandler) {
            bus.removeListener(bus.EVENTS.CLIENT_SEND, this._clientSendHandler);
            this._clientSendHandler = null;
        }
        for (const [, timer] of this._pingTimers) clearInterval(timer);
        this._pingTimers.clear();
        if (this._wss) this._wss.close(() => log.info('WsTransportServer stopped.'));
    }

    // ── Connection lifecycle ──────────────────────────────────────────────────

    _onConnection(ws) {
        const clientId = crypto.randomUUID();
        let authenticated = this._skipAuth; // local Electron can skip

        log.debug(`Raw WebSocket connection: ${clientId} (auth pending: ${!authenticated})`);

        // Track pong responses for dead-socket detection
        ws._isAlive = true;
        ws.on('pong', () => { ws._isAlive = true; });

        // ── Message handler ───────────────────────────────────────────
        ws.on('message', (raw) => {
            const msg = decode(raw);
            if (!msg) {
                log.warn(`Malformed message from ${clientId}`);
                return;
            }

            // client_hello ALWAYS handled first — registers the client
            if (msg.type === MSG.CLIENT_HELLO) {
                if (this._skipAuth || msg.token === this._token) {
                    authenticated = true;
                    this._onClientHello(ws, clientId, msg);
                } else {
                    const expectedLen = this._token?.length || 0;
                    const gotLen = msg.token?.length || 0;
                    log.warn(`${clientId} failed to authenticate — closing. Expected len: ${expectedLen}, Got len: ${gotLen}`);
                    ws.close(1008, 'Invalid pairing token.');
                }
                return;
            }

            // Ping is always allowed (keepalive check)
            if (msg.type === MSG.PING) {
                ws.send(encode(MSG.PONG));
                return;
            }

            // Auth gate — block everything else until authenticated
            if (!authenticated) {
                log.warn(`Unauthenticated message from ${clientId}: ${msg.type}`);
                return;
            }

            this._routeClientMessage(clientId, msg);
        });

        ws.on('close', (code, reason) => {
            log.info(`Client disconnected: ${clientId} (${code})`);
            // Only stop the session if this client was the active session owner
            if (registry.isClientActive(clientId)) {
                bus.emit(bus.EVENTS.SESSION_END, { clientId, isDisconnect: true });
            }
            this._cleanupClient(clientId);
        });

        ws.on('error', (err) => {
            log.error(`WebSocket error for ${clientId}`, { err: err.message });
        });

        // Disconnect unauthenticated sockets after 10s
        if (!this._skipAuth) {
            setTimeout(() => {
                if (!authenticated) {
                    log.warn(`${clientId} failed to authenticate within 10s — closing.`);
                    ws.close(1008, 'Authentication timeout');
                }
            }, 10_000);
        }
    }

    _onClientHello(ws, clientId, msg) {
        const capabilities = {
            platform:   msg.platform   || 'unknown',
            deviceName: msg.deviceName || 'Unknown Device',
            pushToken:  msg.pushToken  || null,
            hasMic:     msg.hasMic     ?? true,
            hasScreen:  msg.hasScreen  ?? true,
            supportedActions: msg.supportedActions || null, // null = supports everything
        };

        // ── ONE DEVICE = ONE CONNECTION ──────────────────────────────────────
        // If the same platform+deviceName is already connected, close the OLD one.
        // This prevents duplicate ghost connections from reconnect races.
        const existingClients = registry.getAllClients();
        for (const existing of existingClients) {
            if (existing.id !== clientId &&
                existing.platform === capabilities.platform &&
                existing.deviceName === capabilities.deviceName) {
                log.warn(`Duplicate device detected: [${existing.platform}] ${existing.deviceName} (old: ${existing.id}). Closing old connection.`);
                // Close old client's WebSocket
                this._closeAndCleanup(existing.id);
            }
        }

        // Register with a send function that wraps this ws instance
        registry.register(clientId, capabilities, (encoded) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(encoded);
        });

        // Store the ws for force-close capability
        this._clientSockets.set(clientId, ws);

        // Reply with daemon hello
        ws.send(encode(MSG.DAEMON_HELLO, {
            clientId,
            daemonVersion: '2.0.0',
            message: 'Summer Core Daemon — connected.',
        }));

        // ── Start server-side PING keepalive (Bug #3 fix: PING not PONG) ─────
        const pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                if (!ws._isAlive) {
                    // No pong received since last ping — connection is dead
                    log.warn(`Client ${clientId} failed pong check — terminating.`);
                    ws.terminate();
                    return;
                }
                ws._isAlive = false;
                ws.ping(); // WebSocket-level ping (triggers 'pong' event)
                ws.send(encode(MSG.PING)); // Application-level ping for client keepalive
            } else {
                clearInterval(pingTimer);
            }
        }, PING_INTERVAL_MS);
        this._pingTimers.set(clientId, pingTimer);

        log.info(`Client authenticated: [${capabilities.platform}] ${capabilities.deviceName} (${clientId})`);
    }

    /** Clean up a client by ID — timer, registry, socket ref. */
    _cleanupClient(clientId) {
        registry.unregister(clientId);
        this._clientSockets.delete(clientId);
        if (this._pingTimers.has(clientId)) {
            clearInterval(this._pingTimers.get(clientId));
            this._pingTimers.delete(clientId);
        }
    }

    /** Force-close a client's WebSocket and clean up. Used for duplicate device eviction. */
    _closeAndCleanup(clientId) {
        const oldWs = this._clientSockets.get(clientId);
        if (oldWs) {
            try {
                // Send a goodbye before closing
                oldWs.send(encode(MSG.ERROR, { message: 'Another device with the same identity connected. Closing this session.' }));
                oldWs.close(4001, 'Replaced by new connection');
            } catch (_) {
                // If send fails, force terminate
                try { oldWs.terminate(); } catch (_) {}
            }
        }
        this._cleanupClient(clientId);
    }

    // ── Route incoming client messages → event bus ────────────────────────────

    _routeClientMessage(clientId, msg) {
        const E = bus.EVENTS;

        switch (msg.type) {
            case MSG.START_SESSION:
                bus.dispatch(E.SESSION_START, { clientId, context: msg.context || {} });
                break;

            case MSG.STOP_SESSION:
                bus.dispatch(E.SESSION_END, { clientId });
                break;

            case MSG.SEND_AUDIO:
                // FIX: Only forward audio when the client has an active session.
                // Previously, audio was forwarded unconditionally. If iOS was slow to stop
                // recording after sending turn_complete, extra audio chunks arrived while
                // Gemini was already processing — resetting its turn timer and causing
                // the "stuck in thinking" freeze. This is the server-side safety gate.
                if (registry.isClientActive(clientId)) {
                    bus.dispatch(E.AUDIO_CHUNK_IN, { clientId, data: msg.data, sampleRate: msg.sampleRate || 16000 });
                }
                break;

            case MSG.SEND_TURN_COMPLETE:
                if (registry.isClientActive(clientId)) {
                    bus.dispatch(E.TURN_COMPLETE, { clientId });
                }
                break;

            case MSG.SEND_TEXT:
                if (registry.isClientActive(clientId)) {
                    bus.dispatch(E.BRAIN_TEXT_IN, { clientId, text: msg.text });
                }
                break;

            case MSG.PERMISSION_RESPONSE:
                bus.dispatch(E.PERMISSION_RESPONSE, {
                    clientId,
                    requestId: msg.requestId,
                    granted:   msg.granted,
                    alwaysAllow: msg.alwaysAllow,
                });
                break;

            case MSG.CLIENT_ACTION_RESULT:
                bus.dispatch(E.CLIENT_ACTION_RESULT, {
                    clientId,
                    requestId: msg.requestId,
                    action:    msg.action,
                    result:    msg.result,
                });
                break;

            case MSG.CANCEL_AGENTS:
                bus.dispatch(E.AGENT_KILLED, { clientId, reason: 'user_cancel' });
                break;

            // ── Google Auth via WebSocket (Flaw #6 fix) ─────────────────
            case MSG.GOOGLE_AUTH_REQUEST:
                this._handleGoogleAuth(clientId, 'authenticate');
                break;
            case MSG.GOOGLE_AUTH_LOGOUT:
                this._handleGoogleAuth(clientId, 'logout');
                break;
            case MSG.GOOGLE_AUTH_CHECK:
                this._handleGoogleAuth(clientId, 'check');
                break;

            // ── Memory via WebSocket (Flaw #5 fix) ──────────────────────
            case MSG.MEMORY_GET_GRAPH:
                this._handleMemoryOp(clientId, 'getGraph');
                break;
            case MSG.MEMORY_GET_DIARY:
                this._handleMemoryOp(clientId, 'getDiary');
                break;
            case MSG.MEMORY_UPDATE_NODE:
                this._handleMemoryOp(clientId, 'updateNode', msg);
                break;
            case MSG.MEMORY_DELETE_NODE:
                this._handleMemoryOp(clientId, 'deleteNode', msg);
                break;

            case MSG.PING:
                registry.send(clientId, encode(MSG.PONG));
                break;

            default:
                // Forward unknown messages to bus for extensibility
                bus.dispatch(E.CLIENT_MESSAGE, { clientId, message: msg });
                break;
        }
    }

    // ── Google Auth handler ───────────────────────────────────────────────────
    async _handleGoogleAuth(clientId, action) {
        try {
            const googleAuth = require('../../auth/google-auth');
            if (action === 'authenticate') {
                await googleAuth.authenticate();
                registry.send(clientId, encode(MSG.GOOGLE_AUTH_RESULT, { success: true }));
            } else if (action === 'logout') {
                googleAuth.logout();
                registry.send(clientId, encode(MSG.GOOGLE_AUTH_RESULT, { success: true, action: 'logout' }));
            } else if (action === 'check') {
                const authenticated = await googleAuth.isAuthenticated();
                registry.send(clientId, encode(MSG.GOOGLE_AUTH_STATUS, { authenticated }));
            }
        } catch (err) {
            log.error(`Google auth ${action} failed:`, { err: err.message });
            registry.send(clientId, encode(MSG.GOOGLE_AUTH_RESULT, { success: false, error: err.message }));
        }
    }

    // ── Memory handler ────────────────────────────────────────────────────────
    async _handleMemoryOp(clientId, op, msg = {}) {
        try {
            const { loadGraph, saveGraph } = require('../../knowledge/graph-store');
            const { loadDiary } = require('../../knowledge/session-diary');

            switch (op) {
                case 'getGraph': {
                    const graph = loadGraph();
                    registry.send(clientId, encode(MSG.MEMORY_GRAPH_DATA, graph));
                    break;
                }
                case 'getDiary': {
                    const diary = loadDiary();
                    registry.send(clientId, encode(MSG.MEMORY_DIARY_DATA, { entries: diary }));
                    break;
                }
                case 'updateNode': {
                    const graph = loadGraph();
                    const node = graph.nodes.find(n => n.id === msg.nodeId);
                    if (!node) {
                        registry.send(clientId, encode(MSG.MEMORY_OP_RESULT, { success: false, error: 'Node not found' }));
                        break;
                    }
                    if (msg.updates?.label) node.label = msg.updates.label;
                    if (msg.updates?.description !== undefined) node.description = msg.updates.description;
                    if (msg.updates?.tags !== undefined) node.tags = msg.updates.tags;
                    node.updatedAt = Date.now();
                    saveGraph(graph);
                    registry.send(clientId, encode(MSG.MEMORY_OP_RESULT, { success: true, node }));
                    break;
                }
                case 'deleteNode': {
                    const graph = loadGraph();
                    graph.nodes = graph.nodes.filter(n => n.id !== msg.nodeId);
                    graph.edges = graph.edges.filter(e => e.from !== msg.nodeId && e.to !== msg.nodeId);
                    saveGraph(graph);
                    registry.send(clientId, encode(MSG.MEMORY_OP_RESULT, { success: true }));
                    break;
                }
            }
        } catch (err) {
            log.error(`Memory op ${op} failed:`, { err: err.message });
            registry.send(clientId, encode(MSG.MEMORY_OP_RESULT, { success: false, error: err.message }));
        }
    }

    /** Expose the pairing token (printed in console / shown in Mac settings QR). */
    getToken() {
        return this._token;
    }
}

module.exports = { WsTransportServer };

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
        this._pingTimers = new Map(); // clientId → intervalId
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
        bus.on(bus.EVENTS.CLIENT_SEND, ({ clientId, message }) => {
            const encoded = typeof message === 'string' ? message : JSON.stringify(message);
            if (clientId === 'all') {
                registry.broadcast(encoded);
            } else {
                registry.send(clientId, encoded);
            }
        });

        log.info('WsTransportServer started.');
        return this;
    }

    stop() {
        for (const [, timer] of this._pingTimers) clearInterval(timer);
        this._pingTimers.clear();
        if (this._wss) this._wss.close(() => log.info('WsTransportServer stopped.'));
    }

    // ── Connection lifecycle ──────────────────────────────────────────────────

    _onConnection(ws) {
        const clientId = crypto.randomUUID();
        let authenticated = this._skipAuth; // local Electron can skip

        log.debug(`Raw WebSocket connection: ${clientId} (auth pending: ${!authenticated})`);

        // ── Message handler ───────────────────────────────────────────
        ws.on('message', (raw) => {
            const msg = decode(raw);
            if (!msg) {
                log.warn(`Malformed message from ${clientId}`);
                return;
            }

            // client_hello ALWAYS handled first — registers the client regardless of skipAuth
            // client_hello ALWAYS handled first — registers the client regardless of skipAuth
            if (msg.type === MSG.CLIENT_HELLO) {
                if (this._skipAuth || msg.token === this._token) {
                    authenticated = true;
                    this._onClientHello(ws, clientId, msg);
                } else {
                    const expectedLen = this._token?.length || 0;
                    const gotLen = msg.token?.length || 0;
                    log.warn(`${clientId} failed to authenticate — closing. Expected len: ${expectedLen}, Got len: ${gotLen}`);
                    log.warn(`Raw received message: ${JSON.stringify(msg)}`);
                    ws.close();
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
            registry.unregister(clientId);
            if (this._pingTimers.has(clientId)) {
                clearInterval(this._pingTimers.get(clientId));
                this._pingTimers.delete(clientId);
            }
        });

        ws.on('error', (err) => {
            log.error(`WebSocket error for ${clientId}`, { err: err.message });
        });

        // Disconnect unauthenticated sockets after 10s
        if (!this._skipAuth) {
            setTimeout(() => {
                if (!authenticated) {
                    log.warn(`${clientId} failed to authenticate — closing.`);
                    ws.close();
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
        };

        // Register with a send function that wraps this ws instance
        registry.register(clientId, capabilities, (encoded) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(encoded);
        });

        // Reply with daemon hello
        ws.send(encode(MSG.DAEMON_HELLO, {
            clientId,
            daemonVersion: '2.0.0',
            message: 'Summer Core Daemon — connected.',
        }));

        // Start keepalive
        const pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(encode(MSG.PONG));
            } else {
                clearInterval(pingTimer);
            }
        }, PING_INTERVAL_MS);
        this._pingTimers.set(clientId, pingTimer);

        log.info(`Client authenticated: [${capabilities.platform}] ${capabilities.deviceName}`);
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
                // Only active client can send audio
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
                });
                break;

            case MSG.CANCEL_AGENTS:
                bus.dispatch(E.AGENT_KILLED, { clientId, reason: 'user_cancel' });
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

    /** Expose the pairing token (printed in console / shown in Mac settings QR). */
    getToken() {
        return this._token;
    }
}

module.exports = { WsTransportServer };

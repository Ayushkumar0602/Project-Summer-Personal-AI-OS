/**
 * core/brain-bridge.js
 *
 * The Brain Bridge — connects the Core Daemon event bus to the existing
 * Gemini LiveSessionManager WITHOUT rewriting it.
 *
 * Strategy: Adapter pattern over the existing LiveSessionManager.
 * We create a "fake" IPC event object that the LiveSessionManager expects,
 * but instead of routing to Electron IPC, we route to the event bus.
 *
 * This means:
 *  - Zero changes to live-session.js
 *  - The existing Gemini logic works identically
 *  - The Brain is now callable from any transport layer
 */

'use strict';

const { createLogger }   = require('./utils/logger');
const bus                = require('./event-bus');
const registry           = require('./transport/client-registry');
const { MSG, encode }    = require('./transport/protocol');
// Platform adapter not needed here — tool execution is handled by LiveSessionManager

const log = createLogger('BrainBridge');

class BrainBridge {
    constructor(deps = {}) {
        // These are injected by the daemon so we don't hardcode Electron deps here
        this._deps     = deps;
        this._sessions = new Map(); // clientId → { lsm: LiveSessionManager, active: boolean, fakeEvent: object }
        this._sessionFactory = null; // (clientId) => LiveSessionManager
    }

    /**
     * Initialize with the session factory and wire all event bus subscriptions.
     * @param {Function} sessionFactory - (clientId) => LiveSessionManager
     */
    init(sessionFactory) {
        this._sessionFactory = sessionFactory;
        this._wireEventBus();
        log.info('BrainBridge initialized — Gemini sessions wired to event bus.');
    }

    // ── Event bus wiring ──────────────────────────────────────────────────────

    _wireEventBus() {
        const E = bus.EVENTS;

        // Store handler refs for cleanup (Bug #6 fix — listener leak prevention)
        this._handlers = {};

        // Client wants to start a session (with guard against rapid-fire)
        // Client wants to start a session
        this._handlers.sessionStart = ({ clientId, context }) => {
            let sessionObj = this._sessions.get(clientId);

            if (sessionObj && sessionObj.active) {
                log.warn(`Session already active for ${clientId} — stopping old session first.`);
                sessionObj.lsm.stop();
                sessionObj.active = false;
            }

            if (!sessionObj) {
                // Instantiate a new LiveSessionManager for this client
                const lsm = this._sessionFactory(clientId);
                sessionObj = {
                    lsm,
                    active: false,
                    fakeEvent: this._makeFakeIpcEvent(clientId)
                };
                this._sessions.set(clientId, sessionObj);
            }

            sessionObj.active = true;
            log.info(`Session start requested by client: ${clientId}`);
            sessionObj.lsm.start(sessionObj.fakeEvent, context || {});
        };
        bus.on(E.SESSION_START, this._handlers.sessionStart);

        // Client wants to stop a session — only the session owner can stop it
        this._handlers.sessionEnd = ({ clientId, isDisconnect }) => {
            const sessionObj = this._sessions.get(clientId);
            if (!sessionObj || !sessionObj.active) return; // nothing to stop

            log.info(`Session stop requested by client: ${clientId}${isDisconnect ? ' (disconnect cleanup)' : ''}`);
            sessionObj.active = false;
            sessionObj.lsm.stop();
        };
        bus.on(E.SESSION_END, this._handlers.sessionEnd);

        // Audio chunk from active client's mic
        this._handlers.audioIn = ({ clientId, data }) => {
            const sessionObj = this._sessions.get(clientId);
            if (sessionObj && sessionObj.active) sessionObj.lsm.sendAudio(data);
        };
        bus.on(E.AUDIO_CHUNK_IN, this._handlers.audioIn);

        // VAD silence / push-to-talk release
        this._handlers.turnComplete = ({ clientId }) => {
            const sessionObj = this._sessions.get(clientId);
            if (sessionObj && sessionObj.active) sessionObj.lsm.sendTurnComplete();
        };
        bus.on(E.TURN_COMPLETE, this._handlers.turnComplete);

        // Text command from client
        this._handlers.textIn = ({ clientId, text }) => {
            const sessionObj = this._sessions.get(clientId);
            if (sessionObj && sessionObj.active) sessionObj.lsm.sendTextCommand(text);
        };
        bus.on(E.BRAIN_TEXT_IN, this._handlers.textIn);

        // Agent killed (cancel)
        this._handlers.agentKilled = ({ reason }) => {
            log.info(`Agents killed: ${reason}`);
            // LiveSessionManager will handle via orchestrator
        };
        bus.on(E.AGENT_KILLED, this._handlers.agentKilled);

        log.info('Event bus subscriptions registered.');
    }

    /** Clean up event bus listeners to prevent leaks. */
    destroy() {
        const E = bus.EVENTS;
        if (this._handlers) {
            if (this._handlers.sessionStart) bus.removeListener(E.SESSION_START, this._handlers.sessionStart);
            if (this._handlers.sessionEnd)   bus.removeListener(E.SESSION_END, this._handlers.sessionEnd);
            if (this._handlers.audioIn)      bus.removeListener(E.AUDIO_CHUNK_IN, this._handlers.audioIn);
            if (this._handlers.turnComplete) bus.removeListener(E.TURN_COMPLETE, this._handlers.turnComplete);
            if (this._handlers.textIn)       bus.removeListener(E.BRAIN_TEXT_IN, this._handlers.textIn);
            if (this._handlers.agentKilled)  bus.removeListener(E.AGENT_KILLED, this._handlers.agentKilled);
            this._handlers = null;
        }
        for (const sessionObj of this._sessions.values()) {
            if (sessionObj.active) sessionObj.lsm.stop();
        }
        this._sessions.clear();
        log.info('BrainBridge destroyed — event bus listeners removed.');
    }

    /**
     * Create a fake IPC event object that LiveSessionManager.start() expects.
     * Instead of event.reply() going to Electron IPC, it goes to the event bus.
     *
     * @param {string} clientId - which client started the session
     */
    _makeFakeIpcEvent(clientId) {
        const E   = bus.EVENTS;
        const self = this;

        return {
            reply: (channel, ...args) => {
                self._handleSessionReply(clientId, channel, args);
            },
            sender: {
                send: (channel, ...args) => {
                    self._handleSessionReply(clientId, channel, args);
                }
            }
        };
    }

    /**
     * Map LiveSessionManager's event.reply() calls to bus events + WebSocket messages.
     * This is the translation table: old IPC channel name → new protocol message.
     */
    _handleSessionReply(clientId, channel, args) {
        const E   = bus.EVENTS;
        const [payload] = args;

        switch (channel) {

            case 'session-started':
                registry.send(clientId, encode(MSG.SESSION_STARTED));
                log.info(`Gemini session started → sent to client: ${clientId}`);
                break;

            case 'session-ended':
                if (this._sessions.has(clientId)) {
                    this._sessions.get(clientId).active = false;
                }
                registry.send(clientId, encode(MSG.SESSION_ENDED));
                break;

            case 'agent-audio':
                // Send to the session owner
                registry.send(clientId, encode(MSG.AUDIO_RESPONSE, { data: payload }));
                break;

            case 'agent-text':
                bus.dispatch(E.AGENT_TEXT, { text: payload, clientId });
                registry.send(clientId, encode(MSG.TEXT_RESPONSE, { text: payload, role: 'agent' }));
                break;

            case 'user-text':
                bus.dispatch(E.USER_TEXT, { text: payload, clientId });
                registry.send(clientId, encode(MSG.USER_TRANSCRIPT, { text: payload }));
                break;

            case 'agent-turn-complete':
                registry.send(clientId, encode(MSG.TURN_COMPLETE));
                break;

            case 'agent-interrupted':
                registry.send(clientId, encode(MSG.AGENT_INTERRUPTED));
                break;

            case 'agent-error':
                registry.send(clientId, encode(MSG.ERROR, { message: payload }));
                log.error(`Gemini session error for ${clientId}`, { message: payload });
                break;

            case 'agent-tool-call':
                bus.dispatch(E.TOOL_STARTED, { ...payload, clientId });
                registry.send(clientId, encode(MSG.TOOL_CALL, { name: payload?.name, args: payload?.args }));
                break;

            case 'agent-tool-complete':
                bus.dispatch(E.TOOL_COMPLETE, { ...payload, clientId });
                registry.send(clientId, encode(MSG.TOOL_COMPLETE, { name: payload?.name }));
                break;

            case 'show-hud-widget': {
                bus.dispatch(E.HUD_UPDATE, { ...payload, clientId });
                const { type, ...state } = payload || {};
                registry.send(clientId, encode(MSG.HUD_UPDATE, { widget: type, state }));
                break;
            }

            case 'memory-conflict':
                bus.dispatch(E.MEMORY_CONFLICT, { contradictions: payload });
                bus.broadcast(encode(MSG.MEMORY_CONFLICT, { contradictions: payload }));
                break;

            case 'extraction-done':
                bus.dispatch(E.MEMORY_UPDATED, {
                    nodeCount: payload?.nodes?.length || 0,
                    edgeCount: payload?.edges?.length || 0,
                });
                bus.broadcast(encode(MSG.MEMORY_UPDATED, {
                    nodeCount: payload?.nodes?.length || 0,
                    edgeCount: payload?.edges?.length || 0,
                }));
                break;

            default:
                // Forward unknown channels as generic events (backwards compat)
                bus.dispatch(channel, payload);
                break;
        }
    }

    // NOTE: Tool execution is handled SOLELY by LiveSessionManager → executeTool().
    // BrainBridge only translates events to protocol messages — it never executes tools.
    // This prevents the double-execution bug (Flaw #7).
}

module.exports = { BrainBridge };

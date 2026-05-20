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
        this._session  = null; // LiveSessionManager instance
        this._started  = false;
    }

    /**
     * Initialize with the LiveSessionManager and wire all event bus subscriptions.
     * @param {object} liveSessionManager - instance of LiveSessionManager
     */
    init(liveSessionManager) {
        this._session = liveSessionManager;
        this._wireEventBus();
        log.info('BrainBridge initialized — Gemini session wired to event bus.');
    }

    // ── Event bus wiring ──────────────────────────────────────────────────────

    _wireEventBus() {
        const E = bus.EVENTS;

        // Client wants to start a session
        bus.on(E.SESSION_START, ({ clientId, context }) => {
            log.info(`Session start requested by client: ${clientId}`);
            const fakeEvent = this._makeFakeIpcEvent(clientId);
            this._session.start(fakeEvent, context || {});
        });

        // Client wants to stop a session
        bus.on(E.SESSION_END, ({ clientId }) => {
            log.info(`Session stop requested by client: ${clientId}`);
            this._session.stop();
        });

        // Audio chunk from active client's mic
        bus.on(E.AUDIO_CHUNK_IN, ({ data }) => {
            this._session.sendAudio(data);
        });

        // VAD silence / push-to-talk release
        bus.on(E.TURN_COMPLETE, () => {
            this._session.sendTurnComplete();
        });

        // Text command from client
        bus.on(E.BRAIN_TEXT_IN, ({ text }) => {
            this._session.sendTextCommand(text);
        });

        // Agent killed (cancel)
        bus.on(E.AGENT_KILLED, ({ reason }) => {
            log.info(`Agents killed: ${reason}`);
            // LiveSessionManager will handle via orchestrator
        });

        log.info('Event bus subscriptions registered.');
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
                bus.broadcast(encode(MSG.SESSION_STARTED));
                log.info('Gemini session started → broadcast to all clients.');
                break;

            case 'session-ended':
                bus.broadcast(encode(MSG.SESSION_ENDED));
                break;

            case 'agent-audio':
                // Audio response — only send to active client (they play it)
                registry.sendToActive(encode(MSG.AUDIO_RESPONSE, { data: payload }));
                break;

            case 'agent-text':
                bus.dispatch(E.AGENT_TEXT, { text: payload });
                bus.broadcast(encode(MSG.TEXT_RESPONSE, { text: payload, role: 'agent' }));
                break;

            case 'user-text':
                bus.dispatch(E.USER_TEXT, { text: payload });
                bus.broadcast(encode(MSG.USER_TRANSCRIPT, { text: payload }));
                break;

            case 'agent-turn-complete':
                bus.broadcast(encode(MSG.TURN_COMPLETE));
                break;

            case 'agent-interrupted':
                bus.broadcast(encode(MSG.AGENT_INTERRUPTED));
                break;

            case 'agent-error':
                bus.broadcast(encode(MSG.ERROR, { message: payload }));
                log.error('Gemini session error', { message: payload });
                break;

            case 'agent-tool-call':
                bus.dispatch(E.TOOL_STARTED, payload);
                bus.broadcast(encode(MSG.TOOL_CALL, { name: payload?.name, args: payload?.args }));
                break;

            case 'agent-tool-complete':
                bus.dispatch(E.TOOL_COMPLETE, payload);
                bus.broadcast(encode(MSG.TOOL_COMPLETE, { name: payload?.name }));
                break;

            case 'show-hud-widget': {
                bus.dispatch(E.HUD_UPDATE, payload);
                const { type, ...state } = payload || {};
                bus.broadcast(encode(MSG.HUD_UPDATE, { widget: type, state }));
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

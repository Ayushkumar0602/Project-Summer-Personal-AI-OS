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
const { getPlatformAdapter } = require('./platform/adapter-factory');

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
                this._handleToolCall(payload);
                break;

            case 'agent-tool-complete':
                bus.dispatch(E.TOOL_COMPLETE, payload);
                bus.broadcast(encode(MSG.TOOL_COMPLETE, { name: payload?.name }));
                break;

            case 'show-hud-widget':
                bus.dispatch(E.HUD_UPDATE, payload);
                bus.broadcast(encode(MSG.HUD_UPDATE, { widget: payload?.type, state: payload?.data }));
                break;

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

    /**
     * Intercept tool calls that need platform adapter context.
     * OS tools go through getPlatformAdapter() instead of raw os-tools.js.
     */
    _handleToolCall(payload) {
        const { name, args } = payload || {};
        if (!name) return;

        const adapter = getPlatformAdapter();

        // Check if this is a tool that has a platform adapter method
        const adapterMethod = this._resolveAdapterMethod(name);
        if (!adapterMethod) return; // Not an adapter-managed tool — let live-session.js handle it

        // Execute via adapter and check if we need to delegate to client
        adapterMethod.call(adapter, args).then(result => {
            if (result?.status === 'requires_client') {
                // Send to active client for native execution
                const { encode: enc, MSG: M } = require('./transport/protocol');
                registry.sendToActive(enc('client_action', {
                    action: result.action,
                    args:   result.args,
                }));
                log.debug(`Delegated "${name}" to client (requires_client: ${result.action})`);
            }
        }).catch(err => {
            log.error(`Adapter tool execution failed: ${name}`, { err: err.message });
        });
    }

    /**
     * Map a tool name to its platform adapter method.
     * Returns null if not an adapter-managed tool.
     */
    _resolveAdapterMethod(name) {
        const TOOL_MAP = {
            os_open_app:          'openApp',
            os_quit_app:          'quitApp',
            os_focus_app:         'focusApp',
            os_list_running_apps: 'listRunningApps',
            os_set_volume:        'setVolume',
            os_get_volume:        'getVolume',
            os_toggle_mute:       'toggleMute',
            os_set_brightness:    'setBrightness',
            os_get_system_info:   'getSystemInfo',
            os_get_top_processes: 'getTopProcesses',
            os_system_sleep:      'systemSleep',
            os_lock_screen:       'lockScreen',
            os_empty_trash:       'emptyTrash',
            os_take_screenshot:   'takeScreenshot',
            os_open_file:         'openFileOrFolder',
            os_open_url:          'openUrl',
            os_toggle_dark_mode:  'toggleDarkMode',
            os_toggle_dnd:        'toggleDoNotDisturb',
            os_get_wifi_status:   'getWifiStatus',
        };
        const method = TOOL_MAP[name];
        if (!method) return null;
        const adapter = getPlatformAdapter();
        return adapter[method] ? adapter[method] : null;
    }
}

module.exports = { BrainBridge };

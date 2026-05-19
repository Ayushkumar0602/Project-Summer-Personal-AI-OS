/**
 * core/agent-events-bridge.js
 *
 * Replaces the Electron-coupled createEmitAgentEvent() from main/agent-events.js.
 *
 * The orchestrator calls emitAgentEvent(eventName, payload).
 * Instead of calling mainWindow.webContents.send(), we dispatch to the event bus.
 * The event bus broadcasts to all connected clients via WebSocket.
 *
 * This is a drop-in replacement — same function signature, zero Electron dependency.
 */

'use strict';

const { createLogger } = require('./utils/logger');
const bus              = require('./event-bus');
const { MSG, encode }  = require('./transport/protocol');

const log = createLogger('AgentEventsBridge');

/**
 * Creates a platform-agnostic emitAgentEvent function.
 * Returns a function with the same signature as the original.
 *
 * @returns {Function} emitAgentEvent(event, payload)
 */
function createAgentEventEmitter() {
    return function emitAgentEvent(event, payload) {
        const E = bus.EVENTS;

        switch (event) {
            case 'agent-progress':
                bus.dispatch(E.AGENT_PROGRESS, payload);
                bus.broadcast(encode(MSG.AGENT_PROGRESS, payload));
                bus.broadcast(encode(MSG.HUD_UPDATE, {
                    widget: 'agent_progress',
                    state:  { data: payload },
                }));
                break;

            case 'agent-complete': {
                const filePath = payload?.result?.file_path;
                const completionPayload = {
                    ...payload,
                    percent: 100,
                    message: filePath ? `Saved: ${filePath}` : 'Complete',
                    done:    true,
                    file_path: filePath,
                };
                bus.dispatch(E.AGENT_COMPLETE, completionPayload);
                bus.broadcast(encode(MSG.AGENT_COMPLETE, completionPayload));
                bus.broadcast(encode(MSG.HUD_UPDATE, {
                    widget: 'agent_progress',
                    state:  { data: completionPayload },
                }));
                break;
            }

            case 'agent-fail':
            case 'agent-killed': {
                const failPayload = {
                    ...payload,
                    percent: 0,
                    message: payload?.error?.error || payload?.reason || 'Stopped',
                    failed:  true,
                };
                bus.dispatch(E.AGENT_FAIL, failPayload);
                bus.broadcast(encode(MSG.AGENT_FAIL, failPayload));
                bus.broadcast(encode(MSG.HUD_UPDATE, {
                    widget: 'agent_progress',
                    state:  { data: failPayload },
                }));
                break;
            }

            default:
                // Forward all other agent events as HUD updates or generic bus events
                bus.dispatch(event, payload);
                bus.broadcast(encode(MSG.HUD_UPDATE, {
                    widget: event,
                    state:  { data: payload },
                }));
                break;
        }

        log.debug(`Agent event: ${event}`, { agentId: payload?.agentId });
    };
}

module.exports = { createAgentEventEmitter };

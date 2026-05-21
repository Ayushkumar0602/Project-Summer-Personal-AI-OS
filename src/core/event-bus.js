/**
 * core/event-bus.js
 *
 * The internal nervous system of the Core Daemon.
 *
 * ALL inter-module communication goes through here.
 * No module should directly require another module to emit an event —
 * it posts to the bus and whoever is listening handles it.
 *
 * This is the "dependency injection" that keeps the brain modular.
 * Adding a new module = subscribe to relevant events. That's it.
 */

'use strict';

const EventEmitter = require('events');

class SummerEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50); // Many modules subscribe

        // ── Typed event constants ─────────────────────────────────────
        // Use these instead of raw strings to avoid typos.
        this.EVENTS = Object.freeze({
            // ── Session lifecycle ─────────────────────────────
            SESSION_START:       'session:start',
            SESSION_STARTED:     'session:started',
            SESSION_END:         'session:end',
            SESSION_ENDED:       'session:ended',

            // ── Audio pipeline ───────────────────────────────
            AUDIO_CHUNK_IN:      'audio:chunk_in',       // client → daemon (mic data)
            AUDIO_CHUNK_OUT:     'audio:chunk_out',      // daemon → client (TTS/response audio)
            TURN_COMPLETE:       'audio:turn_complete',  // VAD silence detected
            BARGE_IN:            'audio:barge_in',       // user interrupted agent

            // ── Gemini / Brain ────────────────────────────────
            BRAIN_TEXT_IN:       'brain:text_in',        // text sent to Gemini
            BRAIN_TEXT_OUT:      'brain:text_out',       // Gemini text response
            BRAIN_AUDIO_OUT:     'brain:audio_out',      // Gemini audio response
            BRAIN_TOOL_CALL:     'brain:tool_call',      // Gemini requested a tool
            BRAIN_TOOL_RESULT:   'brain:tool_result',    // Tool result to send back
            BRAIN_TURN_COMPLETE: 'brain:turn_complete',  // Gemini finished a turn
            BRAIN_INTERRUPTED:   'brain:interrupted',    // Gemini was interrupted
            BRAIN_ERROR:         'brain:error',

            // ── Memory ───────────────────────────────────────
            MEMORY_UPDATED:      'memory:updated',       // graph was saved
            MEMORY_CONFLICT:     'memory:conflict',      // contradiction found

            // ── HUD / UI state ────────────────────────────────
            HUD_UPDATE:          'hud:update',           // { widget, state } — clients render this
            HUD_CLEAR:           'hud:clear',

            // ── Tool / OS actions ─────────────────────────────
            TOOL_STARTED:        'tool:started',
            TOOL_COMPLETE:       'tool:complete',
            TOOL_ERROR:          'tool:error',

            // ── Orchestrator / Domain agents ──────────────────
            AGENT_PROGRESS:      'agent:progress',
            AGENT_COMPLETE:      'agent:complete',
            AGENT_FAIL:          'agent:fail',
            AGENT_KILLED:        'agent:killed',

            // ── Client transport ─────────────────────────────
            CLIENT_CONNECTED:    'client:connected',     // { clientId, platform, capabilities }
            CLIENT_DISCONNECTED: 'client:disconnected',  // { clientId }
            CLIENT_MESSAGE:      'client:message',       // { clientId, message }
            CLIENT_SEND:         'client:send',          // { clientId | 'all', message } — daemon → client
            CLIENT_ACTION_RESULT:'client:action_result', // { clientId, requestId, action, result }
            OWNERSHIP_CHANGED:   'session:ownership_changed', // { newOwnerId, oldOwnerId, newPlatform, reason }

            // ── Permission system ─────────────────────────────
            PERMISSION_REQUEST:  'permission:request',   // daemon needs client to show dialog
            PERMISSION_RESPONSE: 'permission:response',  // client replied

            // ── Wake word ─────────────────────────────────────
            WAKE_WORD_DETECTED:  'wakeword:detected',
            WAKE_WORD_RESUME:    'wakeword:resume',

            // ── Timer ─────────────────────────────────────────
            TIMER_FIRED:         'timer:fired',
            TIMER_SET:           'timer:set',
            TIMER_CANCEL:        'timer:cancel',

            // ── Notifications ─────────────────────────────────
            NOTIFY:              'notify',              // { title, body, clientId? }

            // ── User transcript ───────────────────────────────
            USER_TEXT:           'transcript:user',
            AGENT_TEXT:          'transcript:agent',
        });
    }

    /**
     * Emit a typed event with a payload object.
     */
    dispatch(event, payload = {}) {
        this.emit(event, payload);
    }

    /**
     * Send a message to a specific client or broadcast to all.
     * @param {string|'all'} clientId
     * @param {object} message  - must follow DaemonMessage protocol
     */
    sendToClient(clientId, message) {
        this.dispatch(this.EVENTS.CLIENT_SEND, { clientId, message });
    }

    /**
     * Broadcast a message to ALL connected clients.
     * @param {object} message
     */
    broadcast(message) {
        this.dispatch(this.EVENTS.CLIENT_SEND, { clientId: 'all', message });
    }
}

// Singleton — one bus per daemon process
const bus = new SummerEventBus();
module.exports = bus;

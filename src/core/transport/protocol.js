/**
 * core/transport/protocol.js
 *
 * The Summer Wire Protocol — the CONTRACT between daemon and any client.
 *
 * Every message crossing the WebSocket boundary MUST be one of these shapes.
 * Adding a new client (iOS, Android, CLI) = implement this protocol. Nothing else.
 *
 * Convention: CLIENT_TO_DAEMON messages start with verbs (start, send, stop, request)
 *             DAEMON_TO_CLIENT messages start with nouns (session, audio, text, hud, permission)
 */

'use strict';

// ── Message type constants ────────────────────────────────────────────────────
const MSG = Object.freeze({

    // ━━━ CLIENT → DAEMON ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    CLIENT_HELLO:        'client_hello',        // Initial handshake + capabilities
    START_SESSION:       'start_session',        // Begin a Gemini live session
    STOP_SESSION:        'stop_session',         // End the session
    SEND_AUDIO:          'send_audio',           // { data: base64PCM, sampleRate: 16000 }
    SEND_TURN_COMPLETE:  'send_turn_complete',   // VAD silence / push-to-talk release
    SEND_TEXT:           'send_text',            // { text: string } — text mode
    PERMISSION_RESPONSE: 'permission_response',  // { requestId, granted: bool }
    CANCEL_AGENTS:       'cancel_agents',        // Abort all running Tier-2 agents
    PING:                'ping',                 // Keepalive

    // ━━━ DAEMON → CLIENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    DAEMON_HELLO:        'daemon_hello',         // Reply to client_hello, confirm auth
    SESSION_STARTED:     'session_started',      // Gemini setup complete
    SESSION_ENDED:       'session_ended',        // Session closed
    AUDIO_RESPONSE:      'audio_response',       // { data: base64PCM, sampleRate: 24000 }
    TEXT_RESPONSE:       'text_response',        // { text: string, role: 'agent' }
    USER_TRANSCRIPT:     'user_transcript',      // { text: string } — what user said
    AGENT_TRANSCRIPT:    'agent_transcript',     // { text: string } — what agent said
    TURN_COMPLETE:       'turn_complete',        // Agent finished speaking
    AGENT_INTERRUPTED:   'agent_interrupted',    // Barge-in happened
    TOOL_CALL:           'tool_call',            // { name, args } — for HUD display
    TOOL_COMPLETE:       'tool_complete',        // { name }
    HUD_UPDATE:          'hud_update',           // { widget, state } — render this natively
    HUD_CLEAR:           'hud_clear',
    MEMORY_UPDATED:      'memory_updated',       // { nodeCount, edgeCount }
    MEMORY_CONFLICT:     'memory_conflict',      // { contradictions }
    PERMISSION_REQUEST:  'permission_request',   // { requestId, toolName, description }
    NOTIFICATION:        'notification',         // { title, body }
    TIMER_FIRED:         'timer_fired',          // { label, timerId }
    AGENT_PROGRESS:      'agent_progress',       // { agentId, percent, message }
    AGENT_COMPLETE:      'agent_complete',       // { agentId, result }
    AGENT_FAIL:          'agent_fail',           // { agentId, error }
    ERROR:               'error',                // { message }
    PONG:                'pong',                 // Keepalive reply
});

/**
 * Build a typed protocol message.
 * @param {string} type  - one of MSG.*
 * @param {object} payload
 * @returns {string} JSON string ready to send over WebSocket
 */
function encode(type, payload = {}) {
    return JSON.stringify({ type, ...payload, _ts: Date.now() });
}

/**
 * Parse an incoming WebSocket message.
 * Returns null if the message is invalid.
 * @param {string|Buffer} raw
 * @returns {{ type: string, [key: string]: any } | null}
 */
function decode(raw) {
    try {
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg.type !== 'string') return null;
        return msg;
    } catch {
        return null;
    }
}

module.exports = { MSG, encode, decode };

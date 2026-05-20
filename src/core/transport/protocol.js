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
    CLIENT_ACTION_RESULT:'client_action_result', // { requestId, action, result } — response to client_action
    GOOGLE_AUTH_REQUEST: 'google_auth_request',  // Client wants to authenticate Google
    GOOGLE_AUTH_LOGOUT:  'google_auth_logout',   // Client wants to logout Google
    GOOGLE_AUTH_CHECK:   'google_auth_check',    // Client checks auth status
    MEMORY_GET_GRAPH:    'memory_get_graph',     // Client requests full graph
    MEMORY_GET_DIARY:    'memory_get_diary',     // Client requests diary
    MEMORY_UPDATE_NODE:  'memory_update_node',   // { nodeId, updates }
    MEMORY_DELETE_NODE:  'memory_delete_node',   // { nodeId }
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
    GOOGLE_AUTH_RESULT:  'google_auth_result',   // { success, authUrl? } — reply to auth request
    GOOGLE_AUTH_STATUS:  'google_auth_status',   // { authenticated: bool }
    MEMORY_GRAPH_DATA:   'memory_graph_data',    // { nodes, edges }
    MEMORY_DIARY_DATA:   'memory_diary_data',    // { entries }
    MEMORY_OP_RESULT:    'memory_op_result',     // { success, ... }
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

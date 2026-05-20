/**
 * src/clients/ios/SummerProtocol.js
 *
 * iOS Client Protocol Reference (JavaScript mirror of the Swift implementation).
 *
 * This file is the SPECIFICATION for what any non-Electron client must implement.
 * It documents the full Summer Wire Protocol so iOS/Android/CLI teams stay in sync.
 *
 * UPDATED: 2026-05-20 — Added capability negotiation, client_action_result,
 *          Google auth, memory management, and permission system.
 */

'use strict';

// ── Message type constants (mirror of protocol.js MSG) ────────────────────────
const IOS_MSG = {
    // ━━━ Client → Daemon ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    CLIENT_HELLO:        'client_hello',
    START_SESSION:       'start_session',
    STOP_SESSION:        'stop_session',
    SEND_AUDIO:          'send_audio',
    SEND_TURN_COMPLETE:  'send_turn_complete',
    SEND_TEXT:           'send_text',
    CANCEL_AGENTS:       'cancel_agents',
    PERMISSION_RESPONSE: 'permission_response',
    CLIENT_ACTION_RESULT:'client_action_result',  // NEW: response to client_action
    GOOGLE_AUTH_REQUEST: 'google_auth_request',   // NEW: trigger Google OAuth
    GOOGLE_AUTH_LOGOUT:  'google_auth_logout',    // NEW: logout Google
    GOOGLE_AUTH_CHECK:   'google_auth_check',     // NEW: check auth status
    MEMORY_GET_GRAPH:    'memory_get_graph',      // NEW: request full graph
    MEMORY_GET_DIARY:    'memory_get_diary',      // NEW: request diary
    MEMORY_UPDATE_NODE:  'memory_update_node',    // NEW: { nodeId, updates }
    MEMORY_DELETE_NODE:  'memory_delete_node',    // NEW: { nodeId }
    PING:                'ping',

    // ━━━ Daemon → Client ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    DAEMON_HELLO:        'daemon_hello',
    SESSION_STARTED:     'session_started',
    SESSION_ENDED:       'session_ended',
    AUDIO_RESPONSE:      'audio_response',
    TEXT_RESPONSE:       'text_response',
    USER_TRANSCRIPT:     'user_transcript',
    TURN_COMPLETE:       'turn_complete',
    AGENT_INTERRUPTED:   'agent_interrupted',
    HUD_UPDATE:          'hud_update',
    HUD_CLEAR:           'hud_clear',
    NOTIFICATION:        'notification',
    TIMER_FIRED:         'timer_fired',
    AGENT_PROGRESS:      'agent_progress',
    AGENT_COMPLETE:      'agent_complete',
    AGENT_FAIL:          'agent_fail',
    PERMISSION_REQUEST:  'permission_request',
    TOOL_CALL:           'tool_call',
    TOOL_COMPLETE:       'tool_complete',
    CLIENT_ACTION:       'client_action',         // Daemon delegates a native action to client
    GOOGLE_AUTH_RESULT:  'google_auth_result',    // NEW: { success, authUrl? }
    GOOGLE_AUTH_STATUS:  'google_auth_status',    // NEW: { authenticated }
    MEMORY_GRAPH_DATA:   'memory_graph_data',     // NEW: full graph response
    MEMORY_DIARY_DATA:   'memory_diary_data',     // NEW: diary entries
    MEMORY_OP_RESULT:    'memory_op_result',      // NEW: { success, node? }
    ERROR:               'error',
    PONG:                'pong',
};

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * iOS CLIENT IMPLEMENTATION CHECKLIST
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 1. WebSocket connection
 *    - URL: ws://{daemon_ip}:8765
 *    - Find IP via Bonjour/mDNS or manual entry
 *
 * 2. Authentication — send CLIENT_HELLO with pairing token
 *    {
 *      type: "client_hello",
 *      platform: "ios",
 *      deviceName: "Ayush's iPhone",
 *      hasMic: true,
 *      hasScreen: false,
 *      pushToken: "<APNs device token>",
 *      token: "<pairing token from daemon>",
 *      supportedActions: [           // ← NEW: declare what you can do
 *        "setVolume", "speak", "showNotification", "openUrl",
 *        "musicPlayPause", "musicNext", "musicPrevious",
 *        "readClipboard", "writeClipboard"
 *      ],
 *      _ts: Date.now()
 *    }
 *
 * 3. Capability negotiation (NEW)
 *    - `supportedActions`: Array of client_action names this client can handle
 *    - If omitted, daemon assumes client supports ALL actions
 *    - The daemon filters Gemini tool declarations based on these capabilities
 *    - An iOS client should NOT declare macOS-specific actions (screenshots, etc.)
 *
 * 4. Audio pipeline
 *    - Send: PCM 16-bit, 16kHz, mono, base64-encoded → SEND_AUDIO
 *    - Receive: AUDIO_RESPONSE (PCM 24kHz base64) → decode + play
 *    - VAD: Send SEND_TURN_COMPLETE on silence or button release
 *
 * 5. Client actions — handle `client_action` messages:
 *    When daemon sends { type: "client_action", action: "...", args: {...}, requestId: "..." }
 *    Execute the action natively, then respond with:
 *    {
 *      type: "client_action_result",
 *      requestId: "<same requestId>",
 *      action: "<same action name>",
 *      result: { status: "success", ... }
 *    }
 *
 *    Supported client actions:
 *    - "setVolume"         → MPVolumeView.setVolume(args.level)
 *    - "speak"             → AVSpeechSynthesizer
 *    - "showNotification"  → UNUserNotificationCenter
 *    - "openUrl"           → UIApplication.shared.open(URL)
 *    - "readClipboard"     → UIPasteboard.general.string
 *    - "writeClipboard"    → UIPasteboard.general.string = text
 *    - "musicPlayPause"    → MPMusicPlayerController.systemMusicPlayer
 *    - "musicNext"         → systemMusicPlayer.skipToNextItem()
 *    - "musicPrevious"     → systemMusicPlayer.skipToPreviousItem()
 *
 * 6. Permission requests
 *    When daemon sends { type: "permission_request", requestId, toolName, actionDescription }
 *    Show a native alert and respond with:
 *    {
 *      type: "permission_response",
 *      requestId: "<same>",
 *      granted: true/false,
 *      alwaysAllow: true/false  // user chose "Always Allow"
 *    }
 *
 * 7. Google Auth (NEW)
 *    - Send: { type: "google_auth_request" }
 *    - Receive: { type: "google_auth_result", success: true/false, authUrl?: "..." }
 *    - If authUrl provided: open in Safari for OAuth, daemon handles callback
 *    - Check status: { type: "google_auth_check" }
 *    - Receive: { type: "google_auth_status", authenticated: true/false }
 *
 * 8. Memory management (NEW)
 *    - Get graph: Send { type: "memory_get_graph" }
 *    - Receive: { type: "memory_graph_data", nodes: [...], edges: [...] }
 *    - Get diary: Send { type: "memory_get_diary" }
 *    - Receive: { type: "memory_diary_data", entries: [...] }
 *    - Update node: Send { type: "memory_update_node", nodeId: "...", updates: { label, description, tags } }
 *    - Delete node: Send { type: "memory_delete_node", nodeId: "..." }
 *    - Receive: { type: "memory_op_result", success: true/false }
 *
 * 9. Timer notifications (NEW)
 *    When daemon sends { type: "timer_fired", timerId: "...", label: "...", message: "..." }
 *    Show a notification with sound via UNUserNotificationCenter.
 *
 * 10. HUD rendering
 *    - "agent_progress" → circular progress overlay
 *    - "image_gallery"  → native image carousel
 *    - "calendar"       → calendar event list
 *    - "emails"         → email summary list
 *    - "agent_progress" with done:true → dismiss
 *
 * 11. Keepalive
 *    - Send PING every 20s
 *    - Expect PONG in response
 *    - Reconnect if no PONG within 5s
 */

module.exports = { IOS_MSG };

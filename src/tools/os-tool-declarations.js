/**
 * os-tool-declarations.js — Gemini Function Declarations for OS Control Tools
 * 
 * These are the tool schemas that get sent to Gemini during session setup,
 * so the AI knows what OS actions it can invoke.
 */

const osToolDeclarations = [
    // ── Application Control ────────────────────────────────────
    {
        name: "os_open_app",
        description: "Open a macOS application by name. Example names: 'Safari', 'Visual Studio Code', 'Spotify', 'Terminal', 'Finder', 'Messages'.",
        parameters: {
            type: "OBJECT",
            properties: { appName: { type: "STRING", description: "The application name to open (e.g. 'Spotify')" } },
            required: ["appName"]
        }
    },
    {
        name: "os_quit_app",
        description: "Quit/close a running macOS application. REQUIRES USER CONFIRMATION. Use only when the user explicitly asks to close an app.",
        parameters: {
            type: "OBJECT",
            properties: { appName: { type: "STRING", description: "The application name to quit" } },
            required: ["appName"]
        }
    },
    {
        name: "os_focus_app",
        description: "Bring a running application to the front/foreground. Use when user says 'switch to...' or 'show me...' an app.",
        parameters: {
            type: "OBJECT",
            properties: { appName: { type: "STRING", description: "The application name to bring to front" } },
            required: ["appName"]
        }
    },
    {
        name: "os_list_running_apps",
        description: "List all currently running foreground applications on the Mac. Useful when user asks 'what apps are open?' or you need to know what's running.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },

    // ── Volume Control ─────────────────────────────────────────
    {
        name: "os_set_volume",
        description: "Set the system output volume. Level 0 = silent, 100 = max. Use when user says 'turn up/down the volume', 'set volume to 50', etc.",
        parameters: {
            type: "OBJECT",
            properties: { level: { type: "NUMBER", description: "Volume level from 0 to 100" } },
            required: ["level"]
        }
    },
    {
        name: "os_get_volume",
        description: "Get the current system volume level (0-100).",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },
    {
        name: "os_toggle_mute",
        description: "Mute or unmute the system audio. Use when user says 'mute' or 'unmute'.",
        parameters: {
            type: "OBJECT",
            properties: { muted: { type: "BOOLEAN", description: "true to mute, false to unmute" } },
            required: ["muted"]
        }
    },

    // ── Brightness ─────────────────────────────────────────────
    {
        name: "os_set_brightness",
        description: "Set the screen brightness. Level 0 = darkest, 100 = brightest. Note: May require the 'brightness' CLI tool installed via Homebrew.",
        parameters: {
            type: "OBJECT",
            properties: { level: { type: "NUMBER", description: "Brightness level from 0 to 100" } },
            required: ["level"]
        }
    },

    // ── System Information ─────────────────────────────────────
    {
        name: "os_get_system_info",
        description: "Get comprehensive system information: CPU model, memory usage, disk space, battery level & state, and uptime. Use when user asks about system health, storage, battery, etc.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },
    {
        name: "os_get_top_processes",
        description: "Get the top 10 processes by CPU usage, showing PID, CPU%, memory%, and process name. Use when user asks what's using resources, why the Mac is slow, etc.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },

    // ── System Power ───────────────────────────────────────────
    {
        name: "os_system_sleep",
        description: "Put the Mac to sleep. REQUIRES USER CONFIRMATION. Use only when explicitly asked.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },
    {
        name: "os_lock_screen",
        description: "Lock the Mac screen immediately. Use when user says 'lock my screen' or 'I'm leaving'.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },
    {
        name: "os_empty_trash",
        description: "Permanently empty the macOS Trash. REQUIRES USER CONFIRMATION. This cannot be undone.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },

    // ── Clipboard ──────────────────────────────────────────────
    {
        name: "os_read_clipboard",
        description: "Read the current text content from the system clipboard. Use when user says 'what did I copy?' or 'read my clipboard'.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },
    {
        name: "os_write_clipboard",
        description: "Write/copy text to the system clipboard. Use when user asks you to copy something for them.",
        parameters: {
            type: "OBJECT",
            properties: { text: { type: "STRING", description: "The text to copy to clipboard" } },
            required: ["text"]
        }
    },

    // ── Notifications ──────────────────────────────────────────
    {
        name: "os_show_notification",
        description: "Show a macOS system notification with a title and body. Use for reminders, alerts, or information that should persist visually.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "Notification title (max 100 chars)" },
                body: { type: "STRING", description: "Notification body text (max 500 chars)" }
            },
            required: ["title", "body"]
        }
    },

    // ── File / URL ─────────────────────────────────────────────
    {
        name: "os_open_file",
        description: "Open a file or folder using the default macOS application. Use for opening documents, folders in Finder, etc.",
        parameters: {
            type: "OBJECT",
            properties: { path: { type: "STRING", description: "Absolute path to the file or folder" } },
            required: ["path"]
        }
    },
    {
        name: "os_open_url",
        description: "Open a URL in the user's default web browser (Safari, Chrome, etc.), NOT in Summer's built-in browser. Use when the user wants to actually use a site themselves.",
        parameters: {
            type: "OBJECT",
            properties: { url: { type: "STRING", description: "Full URL starting with http:// or https://" } },
            required: ["url"]
        }
    },

    // ── Appearance ─────────────────────────────────────────────
    {
        name: "os_toggle_dark_mode",
        description: "Enable or disable macOS Dark Mode. Use when user says 'turn on dark mode', 'switch to light mode', etc.",
        parameters: {
            type: "OBJECT",
            properties: { enable: { type: "BOOLEAN", description: "true for dark mode, false for light mode" } },
            required: ["enable"]
        }
    },
    {
        name: "os_get_dark_mode",
        description: "Check whether macOS Dark Mode is currently enabled or disabled.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },

    // ── Do Not Disturb ─────────────────────────────────────────
    {
        name: "os_toggle_dnd",
        description: "Enable or disable Do Not Disturb / Focus mode. May require a 'Turn On Focus' / 'Turn Off Focus' shortcut in the Shortcuts app.",
        parameters: {
            type: "OBJECT",
            properties: { enable: { type: "BOOLEAN", description: "true to enable DND, false to disable" } },
            required: ["enable"]
        }
    },

    // ── Screenshot ─────────────────────────────────────────────
    {
        name: "os_take_screenshot",
        description: "Take a screenshot of the entire screen and save it to the Desktop. Use when user asks for a screenshot.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },

    // ── Wi-Fi ──────────────────────────────────────────────────
    {
        name: "os_get_wifi_status",
        description: "Get the current Wi-Fi network name and signal strength.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },

    // ── Timer ──────────────────────────────────────────────────
    {
        name: "os_set_timer",
        description: "Set a countdown timer. When it finishes, a system notification will appear. Max 24 hours (86400 seconds). Use when user says 'remind me in 5 minutes', 'set a timer for 30 seconds', etc.",
        parameters: {
            type: "OBJECT",
            properties: {
                seconds: { type: "NUMBER", description: "Duration in seconds (1-86400)" },
                label: { type: "STRING", description: "Label for the timer (e.g. 'Tea timer', 'Break reminder')" }
            },
            required: ["seconds"]
        }
    }
];

module.exports = { osToolDeclarations };

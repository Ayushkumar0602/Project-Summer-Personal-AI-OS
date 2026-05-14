/**
 * app-control-declarations.js — Gemini Function Schemas for Deep App Control
 */

const appControlDeclarations = [

    // ═══════════════ PHASE 1: VISION ═══════════════

    {
        name: "os_screenshot_app",
        description: "Take a screenshot of a specific app's window. Returns the file path. Use os_analyze_screen instead if you want to see and understand the content.",
        parameters: {
            type: "OBJECT",
            properties: { appName: { type: "STRING", description: "Name of the app to screenshot (e.g. 'Safari', 'Visual Studio Code')" } },
            required: ["appName"]
        }
    },
    {
        name: "os_analyze_screen",
        description: "Take a screenshot of an app and analyze it using AI vision. Summer can 'see' what's on screen. Use when user asks 'what's on my screen', 'what am I looking at', 'read my code', or 'what's playing'. You can also ask specific questions about what's visible.",
        parameters: {
            type: "OBJECT",
            properties: {
                appName: { type: "STRING", description: "Name of the app to look at (e.g. 'Visual Studio Code', 'Safari', 'Spotify')" },
                question: { type: "STRING", description: "Specific question about what's on screen (e.g. 'what file is open?', 'are there any errors?', 'what tab is active?')" }
            },
            required: ["appName"]
        }
    },

    // ═══════════════ PHASE 2: UI READING ═══════════════

    {
        name: "os_read_app_ui",
        description: "Read all visible UI elements (buttons, text fields, labels, checkboxes) inside an app using the macOS Accessibility API. Returns a numbered list of elements. Use before clicking or typing in an app. Requires Accessibility permission.",
        parameters: {
            type: "OBJECT",
            properties: { appName: { type: "STRING", description: "Name of the app to read UI from" } },
            required: ["appName"]
        }
    },
    {
        name: "os_get_menu_items",
        description: "List all menu bar items and their sub-items for a specific app. Use to discover what actions an app supports (e.g., File → Save, Edit → Undo).",
        parameters: {
            type: "OBJECT",
            properties: { appName: { type: "STRING", description: "Name of the app to get menus from" } },
            required: ["appName"]
        }
    },

    // ═══════════════ PHASE 3: INTERACTION ═══════════════

    {
        name: "os_click_ui_element",
        description: "Click a specific UI element inside an app by its index number. You MUST call os_read_app_ui first to get the element numbers. REQUIRES PERMISSION.",
        parameters: {
            type: "OBJECT",
            properties: {
                appName: { type: "STRING", description: "App name" },
                elementIndex: { type: "NUMBER", description: "The element index from os_read_app_ui (e.g., 5)" }
            },
            required: ["appName", "elementIndex"]
        }
    },
    {
        name: "os_type_in_app",
        description: "Type text into the currently focused text field of an app. The app will be activated first. REQUIRES PERMISSION.",
        parameters: {
            type: "OBJECT",
            properties: {
                appName: { type: "STRING", description: "App to type into" },
                text: { type: "STRING", description: "Text to type" }
            },
            required: ["appName", "text"]
        }
    },
    {
        name: "os_select_menu",
        description: "Click a menu bar item in an app. Use os_get_menu_items first to discover available menu items. Example: menuName='File', menuItem='Save'.",
        parameters: {
            type: "OBJECT",
            properties: {
                appName: { type: "STRING", description: "App name" },
                menuName: { type: "STRING", description: "Top-level menu name (e.g., 'File', 'Edit', 'View')" },
                menuItem: { type: "STRING", description: "Sub-menu item name (e.g., 'Save', 'Undo', 'New Tab')" }
            },
            required: ["appName", "menuName", "menuItem"]
        }
    },
    {
        name: "os_send_keystroke",
        description: "Send a keyboard shortcut to the frontmost application. Modifiers can include: 'command', 'shift', 'option', 'control'. Examples: key='s' modifiers=['command'] for Cmd+S, key='z' modifiers=['command'] for Cmd+Z, key='c' modifiers=['command'] for Cmd+C.",
        parameters: {
            type: "OBJECT",
            properties: {
                key: { type: "STRING", description: "The key to press (e.g., 's', 'z', 'c', 'v', 'return', 'tab', 'escape', 'space', 'up', 'down')" },
                modifiers: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                    description: "Modifier keys: 'command', 'shift', 'option', 'control'. Can combine multiple."
                }
            },
            required: ["key"]
        }
    },

    // ═══════════════ PHASE 4: SMART APP CONTROLS ═══════════════

    // Music
    {
        name: "music_play_pause",
        description: "Toggle play/pause on Spotify or Apple Music. Use when user says 'play music', 'pause', 'stop the music', etc.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },
    {
        name: "music_next",
        description: "Skip to the next track on Spotify or Apple Music.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },
    {
        name: "music_previous",
        description: "Go back to the previous track on Spotify or Apple Music.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },
    {
        name: "music_now_playing",
        description: "Get the currently playing song name, artist, album, and playback position from Spotify or Apple Music. Use when user asks 'what song is this?', 'what's playing?'.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },

    // Finder
    {
        name: "finder_list_files",
        description: "List files and folders in a directory. Defaults to Desktop. Use when user asks 'what's on my desktop?', 'show me files in Downloads', etc.",
        parameters: {
            type: "OBJECT",
            properties: { path: { type: "STRING", description: "Directory path to list (e.g., '~/Desktop', '~/Downloads', '~/Documents')" } },
            required: []
        }
    },
    {
        name: "finder_create_folder",
        description: "Create a new folder at the specified path. REQUIRES PERMISSION.",
        parameters: {
            type: "OBJECT",
            properties: { path: { type: "STRING", description: "Full path for the new folder (e.g., '~/Desktop/NewProject')" } },
            required: ["path"]
        }
    },
    {
        name: "finder_search_files",
        description: "Search for files by name using macOS Spotlight. Fast and searches everywhere. Use when user says 'find my file', 'where is my SQL Handbook', 'search for screenshots', etc. Returns up to 20 matching file paths.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "File name or partial name to search for (e.g., 'SQL Handbook', 'screenshot', 'resume.pdf')" },
                path: { type: "STRING", description: "Optional: directory to search in (e.g., '~/Desktop', '~/Downloads'). Defaults to home directory." }
            },
            required: ["query"]
        }
    },
    {
        name: "finder_delete_file",
        description: "Delete a file by moving it to the Trash (recoverable). ALWAYS REQUIRES CONFIRMATION. Use when user says 'delete this file', 'remove the screenshots', etc. Use finder_search_files first to find the file path.",
        parameters: {
            type: "OBJECT",
            properties: { path: { type: "STRING", description: "Full absolute path of the file to delete (e.g., '/Users/ayush/Desktop/screenshot.png')" } },
            required: ["path"]
        }
    },

    // Notes
    {
        name: "notes_create",
        description: "Create a new note in Apple Notes. Use when user says 'take a note', 'write this down', 'remember this for me'.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "Note title" },
                body: { type: "STRING", description: "Note body text content" }
            },
            required: ["title", "body"]
        }
    },

    // AirDrop
    {
        name: "airdrop_send_file",
        description: "Send a file via AirDrop to a nearby device (iPhone, iPad, Mac, etc.). Opens the native macOS AirDrop share sheet. REQUIRES PERMISSION. Use finder_search_files first to find the file, then call this with the full path. The user will select the target device from the AirDrop window.",
        parameters: {
            type: "OBJECT",
            properties: {
                path: { type: "STRING", description: "Full absolute path to the file to send (e.g., '/Users/ayushjaiswal/Desktop/SQL Handbook.pdf')" }
            },
            required: ["path"]
        }
    },

    // Clipboard
    {
        name: "clipboard_read",
        description: "Read the current text content of the system clipboard. Use when user asks 'what did I copy?', 'read my clipboard', 'what's in my clipboard?'.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },
    {
        name: "clipboard_write",
        description: "Copy text to the system clipboard. Use when user says 'copy this', 'put this in my clipboard', 'save this text'.",
        parameters: {
            type: "OBJECT",
            properties: {
                text: { type: "STRING", description: "Text to copy to clipboard" }
            },
            required: ["text"]
        }
    },

    // Calendar
    {
        name: "calendar_create_event",
        description: "Create a new event in Apple Calendar. Use when user says 'schedule a meeting', 'add to my calendar', 'create an event'. REQUIRES PERMISSION.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "Event title (e.g., 'Team Meeting', 'Dentist Appointment')" },
                date: { type: "STRING", description: "Date: 'today', 'tomorrow', or YYYY-MM-DD format (e.g., '2026-05-07')" },
                startTime: { type: "STRING", description: "Start time in 24-hour format (e.g., '14:00' for 2 PM). Default: 09:00" },
                endTime: { type: "STRING", description: "End time in 24-hour format (e.g., '15:00'). Default: 1 hour after start" },
                notes: { type: "STRING", description: "Optional notes for the event" }
            },
            required: ["title"]
        }
    },
    {
        name: "calendar_today",
        description: "List all events for today or a specific date from Apple Calendar. Use when user asks 'what's on my calendar?', 'am I free tomorrow?', 'do I have any meetings?'.",
        parameters: {
            type: "OBJECT",
            properties: {
                date: { type: "STRING", description: "Date to check: 'today' (default) or YYYY-MM-DD format (e.g., '2026-05-07')" }
            },
            required: []
        }
    },

    // Reminders
    {
        name: "reminders_add",
        description: "Add a reminder to Apple Reminders. Use when user says 'remind me to...', 'add a reminder', 'don't let me forget to...'.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "Reminder text (e.g., 'Buy groceries', 'Call Mom')" },
                dueDate: { type: "STRING", description: "Optional due date: 'today 18:00' or 'YYYY-MM-DD HH:MM' format" },
                notes: { type: "STRING", description: "Optional additional notes" }
            },
            required: ["title"]
        }
    },

    // Reminders Management
    {
        name: "reminders_list",
        description: "List all reminders from Apple Reminders. Shows active reminders by default. Use when user asks 'what are my reminders?', 'show my to-do list'.",
        parameters: {
            type: "OBJECT",
            properties: {
                showCompleted: { type: "BOOLEAN", description: "Set to true to include completed reminders. Default: false (active only)" }
            },
            required: []
        }
    },
    {
        name: "reminders_complete",
        description: "Mark a reminder as completed/done. Use when user says 'I did the groceries', 'mark buy milk as done', 'complete that reminder'.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "Reminder title to mark as complete (partial match works)" }
            },
            required: ["title"]
        }
    },
    {
        name: "reminders_delete",
        description: "Delete a reminder permanently. REQUIRES PERMISSION. Use when user says 'remove that reminder', 'delete the groceries reminder'.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "Reminder title to delete (partial match works)" }
            },
            required: ["title"]
        }
    },

    // Calendar Management
    {
        name: "calendar_delete_event",
        description: "Delete a calendar event by title. REQUIRES PERMISSION. Searches today's events by default, or a specific date. Use when user says 'cancel my meeting', 'remove the dentist appointment'.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "Event title to delete (partial match works)" },
                date: { type: "STRING", description: "Date to search: 'today' (default) or YYYY-MM-DD format" }
            },
            required: ["title"]
        }
    },

    // WhatsApp
    {
        name: "whatsapp_open_chat",
        description: "Open a specific contact or group chat in WhatsApp WITHOUT sending any message. Use when user says 'open Parth's chat', 'go to Srijan's chat', 'show me the chat with Mom'. This ONLY navigates — it does NOT type or send anything. No permission needed.",
        parameters: {
            type: "OBJECT",
            properties: {
                contact: { type: "STRING", description: "Contact or group name to navigate to (e.g., 'Parth', 'Srijan', 'Mom', 'Ola hu uber')" }
            },
            required: ["contact"]
        }
    },
    {
        name: "whatsapp_send_message",
        description: "Send a WhatsApp message to a contact. Opens WhatsApp, searches for the contact, types and sends the message. REQUIRES PERMISSION. ONLY use when user EXPLICITLY asks to SEND a message. Do NOT use this just to open or navigate to a chat.",
        parameters: {
            type: "OBJECT",
            properties: {
                contact: { type: "STRING", description: "Contact or group name to message (e.g., 'Srijan', 'Mom', 'Work Group')" },
                message: { type: "STRING", description: "The message text to send" }
            },
            required: ["contact", "message"]
        }
    },

    // Terminal
    {
        name: "terminal_run_command",
        description: "Execute a terminal command on the user's system and return the output. ALWAYS REQUIRES CONFIRMATION — this is the highest-risk action. Use for git commands, npm, system queries, etc. Only use when the user explicitly asks to run a command.",
        parameters: {
            type: "OBJECT",
            properties: { command: { type: "STRING", description: "The shell command to run (e.g., 'git status', 'npm run build', 'ls -la')" } },
            required: ["command"]
        }
    }
];

module.exports = { appControlDeclarations };

/**
 * app-control-tools.js — Deep In-App Control for Summer
 * 
 * Gives Summer "eyes" (via screenshots + Gemini Vision) and "hands"
 * (via macOS Accessibility API / AppleScript) to see and interact with
 * the UI elements inside any application.
 * 
 * SECURITY: All actions are audit-logged. Dangerous actions (send messages,
 * run terminal commands, move files) always require confirmation.
 */

const { exec } = require('child_process');
const { GoogleGenAI } = require('@google/genai');
const path = require('node:path');
const fs = require('node:fs');
const Paths = require('../core/utils/paths');
const { isPermissionGranted, grantPermission } = require('../settings/permissions-store');

// Lazy-load Electron APIs
function _electron() {
    try { return require('electron'); } catch { return {}; }
}

// Reuse the audit log infrastructure
const LOG_DIR = Paths.auditLogs();
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const TMP_DIR = path.join(Paths.temp(), 'summer-vision');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function auditLog(action, args, result, approved = true) {
    const entry = {
        timestamp: new Date().toISOString(),
        action,
        args: typeof args === 'object' ? JSON.stringify(args).substring(0, 300) : args,
        result: typeof result === 'string' ? result.substring(0, 500) : result,
        approved
    };
    const logFile = path.join(LOG_DIR, `audit-${new Date().toISOString().split('T')[0]}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    console.log(`[AppControl-Audit] ${approved ? '✅' : '🚫'} ${action}`, typeof args === 'object' ? JSON.stringify(args).substring(0, 100) : args);
}

function sanitize(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9 .\-_\/]/g, '');
}

// App name resolver — maps common names to actual macOS process names
const APP_NAME_MAP = {
    'antigravity': 'Summer',
    'project summer': 'Summer',
    'summer': 'Summer',
    'vs code': 'Code',
    'vscode': 'Code',
    'visual studio code': 'Code',
    'chrome': 'Google Chrome',
    'firefox': 'Firefox',
    'terminal': 'Terminal',
    'iterm': 'iTerm2',
    'slack': 'Slack',
    'discord': 'Discord',
    'whatsapp': 'WhatsApp',
    'telegram': 'Telegram',
    'music': 'Music',
    'spotify': 'Spotify',
    'safari': 'Safari',
    'finder': 'Finder',
    'notes': 'Notes',
    'messages': 'Messages',
    'mail': 'Mail',
    'photos': 'Photos',
    'preview': 'Preview',
    'pages': 'Pages',
    'numbers': 'Numbers',
    'keynote': 'Keynote',
    'xcode': 'Xcode',
    'activity monitor': 'Activity Monitor',
    'system preferences': 'System Preferences',
    'system settings': 'System Settings',
};

function resolveAppName(input) {
    if (!input) return '';
    const lower = input.toLowerCase().trim();
    return APP_NAME_MAP[lower] || input;
}

function runShell(cmd, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout.trim());
        });
    });
}

function runAppleScript(script, timeoutMs = 15000) {
    return runShell(`osascript -e '${script.replace(/'/g, "'\\''")}'`, timeoutMs);
}

async function confirmDangerous(toolName, actionDescription, actionLabel) {
    if (isPermissionGranted(toolName)) {
        console.log(`[Permissions] ✅ ${toolName} — pre-approved.`);
        return true;
    }
    const { BrowserWindow, dialog } = _electron();
    if (!BrowserWindow || !dialog) return true; // headless daemon — auto-approve
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return true; // no window — auto-approve in daemon mode
    const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Deny', 'Allow Once', 'Always Allow'],
        defaultId: 0, cancelId: 0,
        title: '🔒 Summer — Permission Request',
        message: `Summer wants to:`,
        detail: actionDescription + '\n\n"Always Allow" saves this permission. Revoke anytime in Settings.',
    });
    if (response === 2) { grantPermission(toolName, actionLabel); return true; }
    return response === 1;
}

// ════════════════════════════════════════════════════════════════════
//  PHASE 1: APP VISION (Screenshot + Gemini Vision)
// ════════════════════════════════════════════════════════════════════


/**
 * Capture a screenshot of a specific app window.
 */
async function screenshotApp(args) {
    const rawName = args.appName || '';
    const appName = resolveAppName(sanitize(rawName));
    auditLog('screenshot_app', { rawName, resolved: appName }, 'executing');

    const filepath = path.join(TMP_DIR, `app-${Date.now()}.png`);

    try {
        // First: activate the target app so it's frontmost
        try {
            await runAppleScript(`tell application "${appName}" to activate`);
            await new Promise(r => setTimeout(r, 700));
        } catch (_) {
            console.log(`[Screenshot] Could not activate ${appName}, continuing anyway.`);
        }

        let captured = false;

        // Strategy 1: Capture using window ID (most precise)
        if (!captured) {
            try {
                // Get the CGWindowID (not the AX id) using the window list
                const windowIdScript = `
tell application "System Events"
    tell process "${appName}"
        set frontWindow to first window
        return id of frontWindow
    end tell
end tell`;
                const windowId = await runAppleScript(windowIdScript);
                if (windowId && /^\d+$/.test(windowId.trim())) {
                    await runShell(`screencapture -l ${windowId.trim()} -x -o "${filepath}"`);
                    if (fs.existsSync(filepath) && fs.statSync(filepath).size > 1000) {
                        captured = true;
                        console.log(`[Screenshot] ✅ Captured via window ID: ${windowId.trim()}`);
                    }
                }
            } catch (e) {
                console.log(`[Screenshot] Strategy 1 (window ID) failed: ${e.message}`);
            }
        }

        // Strategy 2: Capture the bounds of the frontmost window
        if (!captured) {
            try {
                const boundsScript = `
tell application "System Events"
    tell process "${appName}"
        set {x, y} to position of first window
        set {w, h} to size of first window
        return (x as text) & "," & (y as text) & "," & (w as text) & "," & (h as text)
    end tell
end tell`;
                const bounds = await runAppleScript(boundsScript);
                if (bounds && bounds.includes(',')) {
                    const [x, y, w, h] = bounds.split(',').map(n => parseInt(n.trim()));
                    await runShell(`screencapture -x -R${x},${y},${w},${h} "${filepath}"`);
                    if (fs.existsSync(filepath) && fs.statSync(filepath).size > 1000) {
                        captured = true;
                        console.log(`[Screenshot] ✅ Captured via bounds: ${bounds}`);
                    }
                }
            } catch (e) {
                console.log(`[Screenshot] Strategy 2 (bounds) failed: ${e.message}`);
            }
        }

        // Strategy 3: Full screen capture as last resort
        if (!captured) {
            console.log('[Screenshot] Falling back to full screen capture.');
            await runShell(`screencapture -x "${filepath}"`);
            if (fs.existsSync(filepath) && fs.statSync(filepath).size > 1000) {
                captured = true;
            }
        }

        if (!captured || !fs.existsSync(filepath) || fs.statSync(filepath).size < 500) {
            return { error: `Failed to capture screenshot. Go to System Settings → Privacy & Security → Screen Recording and add project-summer.` };
        }

        return {
            status: 'success',
            message: `Screenshot of ${appName} captured successfully.`,
            path: filepath,
            appName
        };
    } catch (e) {
        return { error: `Screenshot failed: ${e.message}. Grant Screen Recording permission in System Settings.` };
    }
}

/**
 * Take a screenshot of an app and analyze it using Gemini Vision.
 */
async function analyzeScreen(args) {
    const rawName = args.appName || '';
    const appName = resolveAppName(sanitize(rawName));
    const question = args.question || 'Describe everything you see on this screen in detail. What app is this? What content is visible?';
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return { error: 'GEMINI_API_KEY missing.' };
    auditLog('analyze_screen', { rawName, resolved: appName, question }, 'executing');

    try {
        // Step 1: Capture screenshot
        const screenshotResult = await screenshotApp({ appName });
        if (screenshotResult.error) {
            console.error('[Vision] Screenshot failed:', screenshotResult.error);
            return { error: `Could not capture ${appName}: ${screenshotResult.error}` };
        }

        // Step 2: Read image as base64
        const imageBuffer = fs.readFileSync(screenshotResult.path);
        const base64Image = imageBuffer.toString('base64');
        console.log(`[Vision] Image captured: ${(imageBuffer.length / 1024).toFixed(0)}KB`);

        // Step 3: Send to Gemini Vision with retry
        const ai = new GoogleGenAI({ apiKey });
        let analysis = '';
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-3.1-flash-lite-preview',
                    contents: [{
                        parts: [
                            {
                                inlineData: {
                                    mimeType: 'image/png',
                                    data: base64Image
                                }
                            },
                            {
                                text: `You are Summer, a Jarvis-like AI assistant. You are looking at a screenshot of the "${rawName || appName}" app on the user's Mac.\n\nUser's question: ${question}\n\nIMPORTANT: Describe what you see concisely and specifically. Mention visible text, buttons, chat names, file names, tab titles, and any other actionable content. If it's a chat app, list the visible conversation names. Keep under 150 words.`
                            }
                        ]
                    }],
                    generationConfig: { temperature: 0.2 }
                });

                if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
                    analysis = response.candidates[0].content.parts[0].text.trim();
                    break;
                }
            } catch (retryErr) {
                console.error(`[Vision] Attempt ${attempt} failed:`, retryErr.message);
                if (attempt === 2) throw retryErr;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // Cleanup temp file
        try { fs.unlinkSync(screenshotResult.path); } catch (_) {}

        if (!analysis) {
            return { error: 'Vision API returned empty response. The screenshot may be blank — check Screen Recording permission.' };
        }

        return { status: 'success', analysis, appName };
    } catch (e) {
        console.error('[Vision] Fatal error:', e.message);
        return { error: `Vision analysis failed: ${e.message}. Check Screen Recording permission in System Settings.` };
    }
}


// ════════════════════════════════════════════════════════════════════
//  PHASE 2: UI ELEMENT READING (Accessibility API)
// ════════════════════════════════════════════════════════════════════

/**
 * Read all visible UI elements in an app via Accessibility API.
 */
async function readAppUI(args) {
    const appName = resolveAppName(sanitize(args.appName || ''));
    if (!appName) return { error: 'Missing app name.' };
    auditLog('read_app_ui', { appName }, 'executing');

    try {
        // Get a summary of UI elements in the frontmost window
        const script = `
tell application "System Events"
    tell process "${appName}"
        set windowElements to {}
        try
            set win to first window
            set winTitle to name of win
            set allElements to entire contents of win
            set idx to 0
            set output to "Window: " & winTitle & return
            repeat with elem in allElements
                set idx to idx + 1
                if idx > 80 then exit repeat
                try
                    set elemRole to role of elem
                    set elemTitle to ""
                    try
                        set elemTitle to name of elem
                    end try
                    if elemTitle is missing value then set elemTitle to ""
                    set elemDesc to ""
                    try
                        set elemDesc to description of elem
                    end try
                    if elemDesc is missing value then set elemDesc to ""
                    set elemValue to ""
                    try
                        set elemValue to value of elem as text
                    end try
                    if elemValue is missing value then set elemValue to ""
                    if elemTitle is not "" or elemDesc is not "" then
                        set output to output & "[" & idx & "] " & elemRole & " | " & elemTitle & " | " & elemDesc & " | val:" & (text 1 thru (min of {60, length of elemValue}) of (elemValue & "")) & return
                    end if
                end try
            end repeat
            return output
        end try
    end tell
end tell`;

        const raw = await runAppleScript(script, 20000);
        
        if (!raw || raw.length < 5) {
            return { status: 'success', elements: [], message: `Could not read UI of ${appName}. It may not support Accessibility, or permission may be needed.` };
        }

        // Parse into structured list
        const lines = raw.split('\n').filter(l => l.trim());
        const windowTitle = lines[0] || '';
        const elements = lines.slice(1).map(line => line.trim()).filter(Boolean);

        return {
            status: 'success',
            appName,
            windowTitle,
            elements,
            elementCount: elements.length,
            hint: 'Use os_click_ui_element with the element index [N] to interact.'
        };
    } catch (e) {
        return { error: `Failed to read UI: ${e.message}. Make sure Accessibility permission is granted.` };
    }
}

/**
 * Get all menu bar items and sub-items for an app.
 */
async function getMenuItems(args) {
    const appName = resolveAppName(sanitize(args.appName || ''));
    if (!appName) return { error: 'Missing app name.' };
    auditLog('get_menu_items', { appName }, 'executing');

    try {
        const script = `
tell application "System Events"
    tell process "${appName}"
        set menuOutput to ""
        set menuBar to menu bar 1
        set menuBarItems to menu bar items of menuBar
        repeat with mbi in menuBarItems
            set mbiName to name of mbi
            set menuOutput to menuOutput & "📂 " & mbiName & return
            try
                set subItems to menu items of menu 1 of mbi
                repeat with si in subItems
                    set siName to name of si
                    if siName is not missing value and siName is not "" then
                        set menuOutput to menuOutput & "   ├─ " & siName & return
                    end if
                end repeat
            end try
        end repeat
        return menuOutput
    end tell
end tell`;

        const raw = await runAppleScript(script, 15000);
        return {
            status: 'success',
            appName,
            menus: raw || 'No menus found.',
            hint: 'Use os_select_menu to click a specific menu item.'
        };
    } catch (e) {
        return { error: `Failed to read menus: ${e.message}` };
    }
}


// ════════════════════════════════════════════════════════════════════
//  PHASE 3: IN-APP INTERACTION (Click, Type, Menu, Keystroke)
// ════════════════════════════════════════════════════════════════════

/**
 * Click a UI element by its index inside an app.
 */
async function clickUIElement(args) {
    const appName = resolveAppName(sanitize(args.appName || ''));
    const elementIndex = parseInt(args.elementIndex, 10);
    if (!appName || isNaN(elementIndex)) return { error: 'Missing appName or elementIndex.' };

    const allowed = await confirmDangerous('os_click_ui_element', `Click element [${elementIndex}] inside "${appName}".`, 'Click UI Elements');
    if (!allowed) { auditLog('click_ui_element', args, 'denied', false); return { status: 'denied' }; }
    auditLog('click_ui_element', { appName, elementIndex }, 'executing');

    try {
        const script = `
tell application "System Events"
    tell process "${appName}"
        set win to first window
        set allElements to entire contents of win
        set targetElement to item ${elementIndex} of allElements
        click targetElement
        return "Clicked element ${elementIndex}"
    end tell
end tell`;
        const result = await runAppleScript(script, 10000);
        return { status: 'success', message: result };
    } catch (e) {
        return { error: `Click failed: ${e.message}` };
    }
}

/**
 * Type text into the currently focused text field of an app.
 */
async function typeInApp(args) {
    const appName = resolveAppName(sanitize(args.appName || ''));
    const text = args.text || '';
    if (!appName || !text) return { error: 'Missing appName or text.' };

    const allowed = await confirmDangerous('os_type_in_app', `Type text into "${appName}": "${text.substring(0, 50)}..."`, 'Type In Apps');
    if (!allowed) { auditLog('type_in_app', args, 'denied', false); return { status: 'denied' }; }
    auditLog('type_in_app', { appName, textLength: text.length }, 'executing');

    try {
        // Activate the app, then type
        await runAppleScript(`tell application "${appName}" to activate`);
        await new Promise(r => setTimeout(r, 300));
        
        // Type using keystroke — handles most cases
        // Split into chunks to avoid AppleScript string limits
        const chunks = text.match(/.{1,100}/g) || [];
        for (const chunk of chunks) {
            const safeChunk = chunk.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            await runAppleScript(
                `tell application "System Events" to keystroke "${safeChunk}"`
            );
        }

        return { status: 'success', message: `Typed ${text.length} characters into ${appName}.` };
    } catch (e) {
        return { error: `Typing failed: ${e.message}` };
    }
}

/**
 * Select a menu item from the menu bar.
 */
async function selectMenu(args) {
    const appName = resolveAppName(sanitize(args.appName || ''));
    const menuName = args.menuName || '';
    const menuItem = args.menuItem || '';
    if (!appName || !menuName || !menuItem) return { error: 'Missing appName, menuName, or menuItem.' };

    auditLog('select_menu', { appName, menuName, menuItem }, 'executing');

    try {
        await runAppleScript(`tell application "${appName}" to activate`);
        await new Promise(r => setTimeout(r, 300));
        
        const script = `
tell application "System Events"
    tell process "${appName}"
        click menu item "${menuItem}" of menu "${menuName}" of menu bar 1
    end tell
end tell`;
        await runAppleScript(script, 10000);
        return { status: 'success', message: `Selected ${menuName} → ${menuItem} in ${appName}.` };
    } catch (e) {
        return { error: `Menu selection failed: ${e.message}` };
    }
}

/**
 * Send a keyboard shortcut to the frontmost app.
 */
async function sendKeystroke(args) {
    const key = args.key || '';
    const modifiers = args.modifiers || []; // ["command", "shift", "option", "control"]
    if (!key) return { error: 'Missing key.' };

    auditLog('send_keystroke', { key, modifiers }, 'executing');

    try {
        let modStr = '';
        if (modifiers.length > 0) {
            modStr = ' using {' + modifiers.map(m => `${m} down`).join(', ') + '}';
        }

        // Handle special keys
        const specialKeys = {
            'return': 'return', 'enter': 'return', 'tab': 'tab',
            'delete': 'delete', 'backspace': 'delete', 'escape': 'escape',
            'space': 'space', 'up': 'up arrow', 'down': 'down arrow',
            'left': 'left arrow', 'right': 'right arrow',
            'f1': 'F1', 'f2': 'F2', 'f3': 'F3', 'f4': 'F4', 'f5': 'F5',
        };

        const lowerKey = key.toLowerCase();
        if (specialKeys[lowerKey]) {
            await runAppleScript(
                `tell application "System Events" to key code (key code of ${specialKeys[lowerKey]})${modStr}`
            ).catch(async () => {
                // Fallback approach
                await runAppleScript(
                    `tell application "System Events" to keystroke "${key}"${modStr}`
                );
            });
        } else {
            await runAppleScript(
                `tell application "System Events" to keystroke "${key}"${modStr}`
            );
        }

        const combo = [...modifiers.map(m => m.charAt(0).toUpperCase() + m.slice(1)), key.toUpperCase()].join('+');
        return { status: 'success', message: `Sent ${combo}.` };
    } catch (e) {
        return { error: `Keystroke failed: ${e.message}` };
    }
}


// ════════════════════════════════════════════════════════════════════
//  PHASE 4: APP-SPECIFIC SMART CONTROLS
// ════════════════════════════════════════════════════════════════════

// ── Spotify / Apple Music ──────────────────────────────────────────

async function musicPlayPause() {
    auditLog('music_play_pause', {}, 'executing');
    try {
        // Try Spotify first, then Apple Music
        const result = await runAppleScript(
            'tell application "Spotify" to playpause'
        ).catch(async () => {
            return await runAppleScript('tell application "Music" to playpause');
        });
        return { status: 'success', message: 'Toggled play/pause.' };
    } catch (e) {
        return { error: `No music player running: ${e.message}` };
    }
}

async function musicNext() {
    auditLog('music_next', {}, 'executing');
    try {
        await runAppleScript('tell application "Spotify" to next track').catch(async () => {
            await runAppleScript('tell application "Music" to next track');
        });
        return { status: 'success', message: 'Skipped to next track.' };
    } catch (e) {
        return { error: e.message };
    }
}

async function musicPrevious() {
    auditLog('music_previous', {}, 'executing');
    try {
        await runAppleScript('tell application "Spotify" to previous track').catch(async () => {
            await runAppleScript('tell application "Music" to previous track');
        });
        return { status: 'success', message: 'Went to previous track.' };
    } catch (e) {
        return { error: e.message };
    }
}

async function musicNowPlaying() {
    auditLog('music_now_playing', {}, 'executing');
    try {
        // Try Spotify
        const spotifyPlaying = await runAppleScript(`
tell application "Spotify"
    if player state is playing then
        set trackName to name of current track
        set artistName to artist of current track
        set albumName to album of current track
        set trackDuration to duration of current track
        set trackPos to player position
        set mins to (trackDuration / 1000 / 60) as integer
        set secs to ((trackDuration / 1000) mod 60) as integer
        set posMin to (trackPos / 60) as integer
        set posSec to (trackPos mod 60) as integer
        return "Playing: " & trackName & " by " & artistName & " (" & albumName & ") — " & posMin & ":" & (text -2 thru -1 of ("0" & posSec)) & " / " & mins & ":" & (text -2 thru -1 of ("0" & secs))
    else
        return "Spotify is paused."
    end if
end tell
        `).catch(() => null);

        if (spotifyPlaying) {
            return { status: 'success', nowPlaying: spotifyPlaying };
        }

        // Fallback: Apple Music
        const musicPlaying = await runAppleScript(`
tell application "Music"
    if player state is playing then
        set trackName to name of current track
        set artistName to artist of current track
        return "Playing: " & trackName & " by " & artistName
    else
        return "Music is paused."
    end if
end tell
        `).catch(() => null);

        if (musicPlaying) {
            return { status: 'success', nowPlaying: musicPlaying };
        }

        return { status: 'success', nowPlaying: 'No music player is currently active.' };
    } catch (e) {
        return { error: e.message };
    }
}

// ── Finder ─────────────────────────────────────────────────────────

async function finderListFiles(args) {
    const dirPath = args.path || '~/Desktop';
    auditLog('finder_list_files', { path: dirPath }, 'executing');

    try {
        const raw = await runShell(`ls -la ${dirPath} | head -30`);
        return { status: 'success', path: dirPath, listing: raw };
    } catch (e) {
        return { error: e.message };
    }
}

async function finderCreateFolder(args) {
    const folderPath = args.path || '';
    if (!folderPath) return { error: 'Missing folder path.' };

    const allowed = await confirmDangerous('os_finder_create_folder', `Create folder: "${folderPath}"`, 'Create Folders');
    if (!allowed) { auditLog('finder_create_folder', args, 'denied', false); return { status: 'denied' }; }
    auditLog('finder_create_folder', { path: folderPath }, 'executing');

    try {
        await runShell(`mkdir -p "${folderPath}"`);
        return { status: 'success', message: `Created folder: ${folderPath}` };
    } catch (e) {
        return { error: e.message };
    }
}

/**
 * Search for files by name using macOS Spotlight (mdfind).
 */
async function finderSearchFiles(args) {
    const query = args.query || '';
    const searchPath = args.path || '~';
    if (!query) return { error: 'Missing search query.' };
    auditLog('finder_search_files', { query, path: searchPath }, 'executing');

    try {
        const raw = await runShell(`mdfind -name "${query}" -onlyin ${searchPath} 2>/dev/null | head -20`, 10000);
        const files = raw.split('\n').filter(Boolean);
        return {
            status: 'success',
            query,
            searchPath,
            files,
            count: files.length,
            message: files.length > 0 ? `Found ${files.length} files matching "${query}".` : `No files found matching "${query}".`
        };
    } catch (e) {
        return { error: e.message };
    }
}

/**
 * Delete a file (moves to Trash for safety). Uses persistent permission system.
 */
async function finderDeleteFile(args) {
    const filePath = args.path || '';
    if (!filePath) return { error: 'Missing file path.' };

    const allowed = await confirmDangerous('finder_delete_file', `Move file to Trash:\n${filePath}`, 'Delete Files (Move to Trash)');
    if (!allowed) {
        auditLog('finder_delete_file', { path: filePath }, 'denied', false);
        return { status: 'denied', message: 'User cancelled file deletion.' };
    }

    auditLog('finder_delete_file', { path: filePath }, 'executing');
    try {
        // Use Finder's 'move to trash' for safe deletion
        await runAppleScript(
            `tell application "Finder" to delete POSIX file "${filePath}"`
        );
        return { status: 'success', message: `Moved to Trash: ${filePath}` };
    } catch (e) {
        return { error: `Delete failed: ${e.message}` };
    }
}

// ── Notes ──────────────────────────────────────────────────────────

async function notesCreate(args) {
    const title = (args.title || 'Untitled').replace(/"/g, '\\"');
    const body = (args.body || '').replace(/"/g, '\\"');
    auditLog('notes_create', { title }, 'executing');

    try {
        await runAppleScript(`
tell application "Notes"
    tell account "iCloud"
        make new note at folder "Notes" with properties {name:"${title}", body:"${body}"}
    end tell
end tell
        `);
        return { status: 'success', message: `Created note: "${title}".` };
    } catch (e) {
        // Fallback without specifying account
        try {
            await runAppleScript(`
tell application "Notes"
    make new note with properties {name:"${title}", body:"${body}"}
end tell
            `);
            return { status: 'success', message: `Created note: "${title}".` };
        } catch (e2) {
            return { error: `Failed to create note: ${e2.message}` };
        }
    }
}

// ── Terminal ───────────────────────────────────────────────────────

async function terminalRunCommand(args) {
    const command = args.command || '';
    if (!command) return { error: 'Missing command.' };

    // ALWAYS require confirmation — never auto-save
    const { BrowserWindow, dialog } = _electron();
    if (!BrowserWindow || !dialog) return { error: 'Terminal commands require a UI client connected.' };
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return { error: 'No window available for confirmation.' };
    const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Deny', 'Allow'],
        defaultId: 0, cancelId: 0,
        title: '⚠️ Summer — Terminal Command',
        message: `Summer wants to run a terminal command:`,
        detail: `$ ${command}\n\nThis will execute on your system. Only allow if you trust this command.`,
    });
    if (response !== 1) {
        auditLog('terminal_run_command', { command }, 'denied', false);
        return { status: 'denied', message: 'User denied terminal command.' };
    }

    auditLog('terminal_run_command', { command }, 'executing');
    try {
        const output = await runShell(command, 30000);
        return { status: 'success', command, output: output.substring(0, 5000) };
    } catch (e) {
        return { error: `Command failed: ${e.message}` };
    }
}

// ── AirDrop ────────────────────────────────────────────────────────

/**
 * Send a file via AirDrop. Uses Finder's Share menu to trigger native AirDrop UI.
 */
async function airdropSendFile(args) {
    const filePath = args.path || '';
    if (!filePath) return { error: 'Missing file path. Use finder_search_files first to find the file.' };

    // Verify file exists
    const expandedPath = filePath.replace(/^~/, process.env.HOME || '/Users/ayushjaiswal');
    if (!fs.existsSync(expandedPath)) {
        return { error: `File not found: ${filePath}. Use finder_search_files to locate it first.` };
    }

    const allowed = await confirmDangerous('airdrop_send_file', `AirDrop file:\n${path.basename(expandedPath)}`, 'AirDrop Files');
    if (!allowed) {
        auditLog('airdrop_send_file', { path: expandedPath }, 'denied', false);
        return { status: 'denied', message: 'User cancelled AirDrop.' };
    }

    auditLog('airdrop_send_file', { path: expandedPath }, 'executing');

    try {
        // Strategy 1: Use standalone helper script (runs as its own GUI process)
        // This is needed because NSSharingService requires a GUI context to show the AirDrop sheet
        const helperScript = path.join(__dirname, 'airdrop-share.py');
        
        if (fs.existsSync(helperScript)) {
            console.log('[AirDrop] Using helper script...');
            // Spawn as a detached process so the share sheet stays open
            const { spawn } = require('child_process');
            const child = spawn('python3', [helperScript, expandedPath], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            
            // Give the share sheet time to appear
            await new Promise(r => setTimeout(r, 2000));
            
            return {
                status: 'success',
                message: `AirDrop share sheet opened for "${path.basename(expandedPath)}". Select the target device (iPhone, iPad, Mac) to send the file.`,
                fileName: path.basename(expandedPath),
                path: expandedPath
            };
        }

        // Strategy 2: Finder menu bar → File → Share
        console.log('[AirDrop] Helper not found, using Finder menu...');
        await runAppleScript(`
tell application "Finder"
    activate
    reveal POSIX file "${expandedPath}"
    select POSIX file "${expandedPath}"
end tell`);
        await new Promise(r => setTimeout(r, 800));

        await runAppleScript(`
tell application "System Events"
    tell process "Finder"
        click menu item "Share…" of menu "File" of menu bar 1
    end tell
end tell`);
        
        return {
            status: 'success',
            message: `File share menu opened for "${path.basename(expandedPath)}". Click AirDrop in the share options to send.`,
            fileName: path.basename(expandedPath),
            path: expandedPath
        };
    } catch (e) {
        // Strategy 3: At minimum, select the file in Finder
        try {
            await runShell(`open -R "${expandedPath}"`);
            return {
                status: 'partial',
                message: `File revealed in Finder: "${path.basename(expandedPath)}". Right-click → Share → AirDrop to send it.`,
                fileName: path.basename(expandedPath),
                path: expandedPath
            };
        } catch (_) {
            return { error: `AirDrop failed: ${e.message}. File: ${expandedPath}` };
        }
    }
}


// ── Clipboard ──────────────────────────────────────────────────────

/**
 * Read current clipboard text content.
 */
async function clipboardRead() {
    auditLog('clipboard_read', {}, 'executing');
    const text = clipboard.readText();
    return {
        status: 'success',
        content: text || '(clipboard is empty or contains non-text data)',
        length: text ? text.length : 0
    };
}

/**
 * Write text to the clipboard.
 */
async function clipboardWrite(args) {
    const text = args.text || '';
    if (!text) return { error: 'Missing text to copy.' };
    auditLog('clipboard_write', { textLength: text.length }, 'executing');
    clipboard.writeText(text);
    return {
        status: 'success',
        message: `Copied ${text.length} characters to clipboard.`,
        preview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
    };
}


// ── Calendar ───────────────────────────────────────────────────────

/**
 * Create an event in Apple Calendar.
 */
async function calendarCreateEvent(args) {
    const title = (args.title || 'Untitled Event').replace(/"/g, '\\"');
    const notes = (args.notes || '').replace(/"/g, '\\"');
    const date = args.date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const startTime = args.startTime || '09:00';
    const endTime = args.endTime || (() => {
        const [h, m] = startTime.split(':');
        return `${String(Math.min(parseInt(h) + 1, 23)).padStart(2, '0')}:${m}`;
    })();

    const allowed = await confirmDangerous('calendar_create_event', `Create calendar event:\n"${title}"\n${date} ${startTime}–${endTime}`, 'Create Calendar Events');
    if (!allowed) {
        auditLog('calendar_create_event', { title }, 'denied', false);
        return { status: 'denied' };
    }

    auditLog('calendar_create_event', { title, date, startTime, endTime }, 'executing');

    try {
        // Parse date - handle "tomorrow", "today", etc.
        let dateStr = date;
        const now = new Date();
        if (date.toLowerCase() === 'today') {
            dateStr = now.toISOString().split('T')[0];
        } else if (date.toLowerCase() === 'tomorrow') {
            now.setDate(now.getDate() + 1);
            dateStr = now.toISOString().split('T')[0];
        }

        const [year, month, day] = dateStr.split('-').map(Number);

        await runAppleScript(`
tell application "Calendar"
    tell calendar "Home"
        set startDate to current date
        set year of startDate to ${year}
        set month of startDate to ${month}
        set day of startDate to ${day}
        set hours of startDate to ${parseInt(startTime.split(':')[0])}
        set minutes of startDate to ${parseInt(startTime.split(':')[1] || '0')}
        set seconds of startDate to 0
        
        set endDate to current date
        set year of endDate to ${year}
        set month of endDate to ${month}
        set day of endDate to ${day}
        set hours of endDate to ${parseInt(endTime.split(':')[0])}
        set minutes of endDate to ${parseInt(endTime.split(':')[1] || '0')}
        set seconds of endDate to 0
        
        make new event with properties {summary:"${title}", start date:startDate, end date:endDate, description:"${notes}"}
    end tell
end tell`);

        return {
            status: 'success',
            message: `Created event "${args.title}" on ${dateStr} from ${startTime} to ${endTime}.`
        };
    } catch (e) {
        return { error: `Calendar error: ${e.message}` };
    }
}

/**
 * Get today's (or a specific date's) calendar events.
 */
async function calendarToday(args) {
    const date = args?.date || 'today';
    auditLog('calendar_today', { date }, 'executing');

    try {
        let dateSetup;
        if (date === 'today') {
            dateSetup = `
set startOfDay to current date
set hours of startOfDay to 0
set minutes of startOfDay to 0
set seconds of startOfDay to 0
set endOfDay to current date
set hours of endOfDay to 23
set minutes of endOfDay to 59
set seconds of endOfDay to 59`;
        } else {
            const [year, month, day] = date.split('-').map(Number);
            dateSetup = `
set startOfDay to current date
set year of startOfDay to ${year}
set month of startOfDay to ${month}
set day of startOfDay to ${day}
set hours of startOfDay to 0
set minutes of startOfDay to 0
set seconds of startOfDay to 0
set endOfDay to current date
set year of endOfDay to ${year}
set month of endOfDay to ${month}
set day of endOfDay to ${day}
set hours of endOfDay to 23
set minutes of endOfDay to 59
set seconds of endOfDay to 59`;
        }

        const raw = await runAppleScript(`
tell application "Calendar"
    ${dateSetup}
    set eventList to ""
    repeat with cal in calendars
        set calEvents to (every event of cal whose start date >= startOfDay and start date <= endOfDay)
        repeat with evt in calEvents
            set eventList to eventList & (summary of evt) & " | " & (start date of evt) & " — " & (end date of evt) & "\\n"
        end repeat
    end repeat
    return eventList
end tell`, 15000);

        const events = raw.split('\n').filter(Boolean);
        return {
            status: 'success',
            date,
            events,
            count: events.length,
            message: events.length > 0 ? `You have ${events.length} event(s) ${date === 'today' ? 'today' : 'on ' + date}.` : `No events ${date === 'today' ? 'today' : 'on ' + date}. Your calendar is clear!`
        };
    } catch (e) {
        return { error: `Calendar error: ${e.message}` };
    }
}


// ── Reminders ──────────────────────────────────────────────────────

/**
 * Add a reminder to Apple Reminders.
 */
async function remindersAdd(args) {
    const title = (args.title || '').replace(/"/g, '\\"');
    const notes = (args.notes || '').replace(/"/g, '\\"');
    if (!title) return { error: 'Missing reminder title.' };

    auditLog('reminders_add', { title }, 'executing');

    try {
        const dueDate = args.dueDate || '';
        let dateClause = '';

        if (dueDate) {
            // Simple due date: "today 18:00" or "2026-05-07 09:00"
            if (dueDate.toLowerCase().startsWith('today')) {
                const time = dueDate.split(' ')[1] || '09:00';
                const [h, m] = time.split(':');
                dateClause = `
set dueD to current date
set hours of dueD to ${parseInt(h)}
set minutes of dueD to ${parseInt(m || '0')}
set seconds of dueD to 0`;
            } else if (dueDate.includes('-')) {
                const parts = dueDate.split(' ');
                const [year, month, day] = parts[0].split('-').map(Number);
                const time = parts[1] || '09:00';
                const [h, m] = time.split(':');
                dateClause = `
set dueD to current date
set year of dueD to ${year}
set month of dueD to ${month}
set day of dueD to ${day}
set hours of dueD to ${parseInt(h)}
set minutes of dueD to ${parseInt(m || '0')}
set seconds of dueD to 0`;
            }
        }

        if (dateClause) {
            await runAppleScript(`
tell application "Reminders"
    ${dateClause}
    tell list "Reminders"
        make new reminder with properties {name:"${title}", body:"${notes}", due date:dueD}
    end tell
end tell`);
        } else {
            await runAppleScript(`
tell application "Reminders"
    tell list "Reminders"
        make new reminder with properties {name:"${title}", body:"${notes}"}
    end tell
end tell`);
        }

        return {
            status: 'success',
            message: `Reminder created: "${args.title}"${dueDate ? ` (due: ${dueDate})` : ''}.`
        };
    } catch (e) {
        return { error: `Reminder error: ${e.message}` };
    }
}

/**
 * List reminders from Apple Reminders.
 */
async function remindersList(args) {
    const showCompleted = args?.showCompleted === true || args?.showCompleted === 'true';
    auditLog('reminders_list', { showCompleted }, 'executing');

    try {
        const filter = showCompleted ? 'every reminder' : 'every reminder whose completed is false';
        const raw = await runAppleScript(`
tell application "Reminders"
    set reminderList to ""
    set allReminders to ${filter} of list "Reminders"
    repeat with r in allReminders
        set reminderLine to (name of r)
        try
            set reminderLine to reminderLine & " | Due: " & (due date of r)
        end try
        if completed of r then
            set reminderLine to reminderLine & " [DONE]"
        end if
        set reminderList to reminderList & reminderLine & "\\n"
    end repeat
    return reminderList
end tell`, 15000);

        const items = raw.split('\n').filter(Boolean);
        return {
            status: 'success',
            reminders: items,
            count: items.length,
            message: items.length > 0 ? `You have ${items.length} reminder(s).` : 'No reminders found.'
        };
    } catch (e) {
        return { error: `Reminders error: ${e.message}` };
    }
}

/**
 * Mark a reminder as completed.
 */
async function remindersComplete(args) {
    const title = (args.title || '').replace(/"/g, '\\"');
    if (!title) return { error: 'Missing reminder title.' };

    auditLog('reminders_complete', { title }, 'executing');
    try {
        await runAppleScript(`
tell application "Reminders"
    set matchedReminders to (every reminder of list "Reminders" whose name contains "${title}" and completed is false)
    if (count of matchedReminders) > 0 then
        set completed of item 1 of matchedReminders to true
        return "done"
    else
        return "not_found"
    end if
end tell`);
        return { status: 'success', message: `Marked reminder "${args.title}" as completed.` };
    } catch (e) {
        return { error: `Reminders error: ${e.message}` };
    }
}

/**
 * Delete a reminder.
 */
async function remindersDelete(args) {
    const title = (args.title || '').replace(/"/g, '\\"');
    if (!title) return { error: 'Missing reminder title.' };

    const allowed = await confirmDangerous('reminders_delete', `Delete reminder:\n"${title}"`, 'Delete Reminders');
    if (!allowed) {
        auditLog('reminders_delete', { title }, 'denied', false);
        return { status: 'denied' };
    }

    auditLog('reminders_delete', { title }, 'executing');
    try {
        await runAppleScript(`
tell application "Reminders"
    set matchedReminders to (every reminder of list "Reminders" whose name contains "${title}")
    if (count of matchedReminders) > 0 then
        delete item 1 of matchedReminders
        return "deleted"
    else
        return "not_found"
    end if
end tell`);
        return { status: 'success', message: `Deleted reminder "${args.title}".` };
    } catch (e) {
        return { error: `Reminders error: ${e.message}` };
    }
}

/**
 * Delete a calendar event by title (matches the first event with that name today or on a specific date).
 */
async function calendarDeleteEvent(args) {
    const title = (args.title || '').replace(/"/g, '\\"');
    if (!title) return { error: 'Missing event title.' };
    const date = args.date || 'today';

    const allowed = await confirmDangerous('calendar_delete_event', `Delete calendar event:\n"${title}"`, 'Delete Calendar Events');
    if (!allowed) {
        auditLog('calendar_delete_event', { title }, 'denied', false);
        return { status: 'denied' };
    }

    auditLog('calendar_delete_event', { title, date }, 'executing');
    try {
        let dateSetup;
        if (date === 'today') {
            dateSetup = `
set startOfDay to current date
set hours of startOfDay to 0
set minutes of startOfDay to 0
set seconds of startOfDay to 0
set endOfDay to current date
set hours of endOfDay to 23
set minutes of endOfDay to 59`;
        } else {
            const [year, month, day] = date.split('-').map(Number);
            dateSetup = `
set startOfDay to current date
set year of startOfDay to ${year}
set month of startOfDay to ${month}
set day of startOfDay to ${day}
set hours of startOfDay to 0
set minutes of startOfDay to 0
set endOfDay to current date
set year of endOfDay to ${year}
set month of endOfDay to ${month}
set day of endOfDay to ${day}
set hours of endOfDay to 23
set minutes of endOfDay to 59`;
        }

        await runAppleScript(`
tell application "Calendar"
    ${dateSetup}
    repeat with cal in calendars
        set calEvents to (every event of cal whose start date >= startOfDay and start date <= endOfDay and summary contains "${title}")
        repeat with evt in calEvents
            delete evt
            return "deleted"
        end repeat
    end repeat
    return "not_found"
end tell`, 15000);

        return { status: 'success', message: `Deleted calendar event "${args.title}".` };
    } catch (e) {
        return { error: `Calendar error: ${e.message}` };
    }
}


// ── WhatsApp ─────────────────────────────────────────────────────

/**
 * Open a specific chat in WhatsApp WITHOUT sending any message.
 */
async function whatsappOpenChat(args) {
    const contact = args.contact || '';
    if (!contact) return { error: 'Missing contact name.' };

    auditLog('whatsapp_open_chat', { contact }, 'executing');

    try {
        // Step 1: Open WhatsApp
        await runAppleScript('tell application "WhatsApp" to activate');
        await new Promise(r => setTimeout(r, 1000));

        // Step 2: Open search
        await runAppleScript(
            'tell application "System Events" to keystroke "k" using command down'
        );
        await new Promise(r => setTimeout(r, 600));

        // Step 3: Clear and type contact name
        await runAppleScript(
            'tell application "System Events" to keystroke "a" using command down'
        );
        await new Promise(r => setTimeout(r, 100));

        const safeContact = contact.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await runAppleScript(
            `tell application "System Events" to keystroke "${safeContact}"`
        );
        await new Promise(r => setTimeout(r, 1500));

        // Step 4: Down arrow to select first result
        await runAppleScript(
            'tell application "System Events" to key code 125'
        );
        await new Promise(r => setTimeout(r, 300));

        // Step 5: Enter to open the chat
        await runAppleScript(
            'tell application "System Events" to key code 36'
        );
        await new Promise(r => setTimeout(r, 800));

        // Step 6: Escape to close search overlay
        await runAppleScript(
            'tell application "System Events" to key code 53'
        );
        await new Promise(r => setTimeout(r, 300));

        return {
            status: 'success',
            message: `Opened chat with ${contact} in WhatsApp. No message was sent.`
        };
    } catch (e) {
        return { error: `Failed to open chat: ${e.message}. Make sure WhatsApp is open.` };
    }
}

async function whatsappSendMessage(args) {
    const contact = args.contact || '';
    const message = args.message || '';
    if (!contact || !message) return { error: 'Missing contact name or message.' };

    // Use persistent permission system — ask once, remember forever
    const allowed = await confirmDangerous('whatsapp_send_message', `Send WhatsApp message:\nTo: ${contact}\nMessage: ${message}`, 'Send WhatsApp Messages');
    if (!allowed) {
        auditLog('whatsapp_send_message', { contact }, 'denied', false);
        return { status: 'denied', message: 'User cancelled sending message.' };
    }

    auditLog('whatsapp_send_message', { contact, message: message.substring(0, 50) }, 'executing');

    try {
        // Step 1: Open WhatsApp and bring to front
        await runAppleScript('tell application "WhatsApp" to activate');
        await new Promise(r => setTimeout(r, 1000));

        // Step 2: Open search with Cmd+K (WhatsApp's search/new chat shortcut)
        await runAppleScript(
            'tell application "System Events" to keystroke "k" using command down'
        );
        await new Promise(r => setTimeout(r, 600));

        // Step 3: Clear any existing search text
        await runAppleScript(
            'tell application "System Events" to keystroke "a" using command down'
        );
        await new Promise(r => setTimeout(r, 100));

        // Step 4: Type the contact name to search
        const safeContact = contact.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await runAppleScript(
            `tell application "System Events" to keystroke "${safeContact}"`
        );
        await new Promise(r => setTimeout(r, 1500)); // Wait for search results to populate

        // Step 5: Press Down Arrow to highlight the first search result
        // (NOT Enter — Enter in WhatsApp sends a message!)
        await runAppleScript(
            'tell application "System Events" to key code 125' // Down arrow key code
        );
        await new Promise(r => setTimeout(r, 300));

        // Step 6: Press Enter to open the selected chat
        await runAppleScript(
            'tell application "System Events" to key code 36' // Return key code
        );
        await new Promise(r => setTimeout(r, 1000)); // Wait for chat to load

        // Step 7: Press Escape to ensure search is closed and focus is in message input
        await runAppleScript(
            'tell application "System Events" to key code 53' // Escape key code
        );
        await new Promise(r => setTimeout(r, 300));

        // Step 8: Click on the message input area (at the bottom of the window)
        // Use tab to navigate to the message field as fallback
        await runAppleScript(`
tell application "System Events"
    tell process "WhatsApp"
        set {winX, winY} to position of first window
        set {winW, winH} to size of first window
        -- Click in the message input area (bottom center of the window)
        set clickX to winX + (winW / 2)
        set clickY to winY + winH - 50
        do shell script "cliclick c:" & (clickX as integer) & "," & (clickY as integer)
    end tell
end tell
        `).catch(async () => {
            // Fallback if cliclick not available — just try typing directly
            console.log('[WhatsApp] cliclick not available, typing directly');
        });
        await new Promise(r => setTimeout(r, 300));

        // Step 9: Type the message
        const safeMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const chunks = safeMessage.match(/.{1,80}/g) || [];
        for (const chunk of chunks) {
            await runAppleScript(
                `tell application "System Events" to keystroke "${chunk}"`
            );
            await new Promise(r => setTimeout(r, 150));
        }

        await new Promise(r => setTimeout(r, 200));

        // Step 10: Press Enter to send the message
        await runAppleScript(
            'tell application "System Events" to key code 36' // Return key code
        );

        return {
            status: 'success',
            message: `Message sent to ${contact} on WhatsApp: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`
        };
    } catch (e) {
        return { error: `WhatsApp messaging failed: ${e.message}. Make sure WhatsApp is open.` };
    }
}


// ════════════════════════════════════════════════════════════════════
//  TOOL DISPATCHER
// ════════════════════════════════════════════════════════════════════

const APP_CONTROL_HANDLERS = {
    // Phase 1: Vision
    os_screenshot_app:       screenshotApp,
    os_analyze_screen:       analyzeScreen,

    // Phase 2: UI Reading
    os_read_app_ui:          readAppUI,
    os_get_menu_items:       getMenuItems,

    // Phase 3: Interaction
    os_click_ui_element:     clickUIElement,
    os_type_in_app:          typeInApp,
    os_select_menu:          selectMenu,
    os_send_keystroke:        sendKeystroke,

    // Phase 4: Smart App Controls
    music_play_pause:        musicPlayPause,
    music_next:              musicNext,
    music_previous:          musicPrevious,
    music_now_playing:       musicNowPlaying,
    finder_list_files:       finderListFiles,
    finder_create_folder:    finderCreateFolder,
    finder_search_files:     finderSearchFiles,
    finder_delete_file:      finderDeleteFile,
    notes_create:            notesCreate,

    // Phase 5: AirDrop, Clipboard, Calendar, Reminders
    airdrop_send_file:       airdropSendFile,
    clipboard_read:          clipboardRead,
    clipboard_write:         clipboardWrite,
    calendar_create_event:   calendarCreateEvent,
    calendar_today:          calendarToday,
    reminders_add:           remindersAdd,
    reminders_list:          remindersList,
    reminders_complete:      remindersComplete,
    reminders_delete:        remindersDelete,
    calendar_delete_event:   calendarDeleteEvent,

    // Phase 6: Messaging
    whatsapp_open_chat:      whatsappOpenChat,
    whatsapp_send_message:   whatsappSendMessage,
    terminal_run_command:    terminalRunCommand,

    // ── Platform adapter aliases (used by MacOSAdapter via adapter-macos.js) ──
    app_screenshot:          screenshotApp,
    app_finder_search:       finderSearchFiles,
    app_read_ui:             readAppUI,
    app_click_ui:            clickUIElement,
    app_type:                typeInApp,
    app_select_menu:         selectMenu,
    app_keystroke:           sendKeystroke,
    app_music_play_pause:    musicPlayPause,
    app_music_next:          musicNext,
    app_music_previous:      musicPrevious,
    app_music_now_playing:   musicNowPlaying,
};

async function executeAppControlTool(name, args = {}) {
    const handler = APP_CONTROL_HANDLERS[name];
    if (!handler) return null;
    return await handler(args);
}

function isAppControlTool(name) {
    return name in APP_CONTROL_HANDLERS;
}

module.exports = { executeAppControlTool, isAppControlTool };

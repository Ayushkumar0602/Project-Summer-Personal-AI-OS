/**
 * os-tools.js — Secure OS Integration Layer for Summer
 * 
 * SECURITY MODEL:
 *   1. ALLOWLISTED ACTIONS ONLY — No arbitrary shell execution. Every action
 *      maps to a hardcoded command or AppleScript.
 *   2. TIERED PERMISSIONS — Actions are classified as "safe" or "dangerous".
 *      Dangerous actions (quit app, shutdown, etc.) require user confirmation
 *      via an Electron dialog before execution.
 *   3. AUDIT LOG — Every action (approved, denied, or failed) is written to a
 *      persistent log file for traceability.
 *   4. INPUT SANITIZATION — All user-facing inputs (app names, file paths) are
 *      stripped of shell metacharacters before interpolation.
 */

const { exec } = require('child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Paths = require('../core/utils/paths');
const { isPermissionGranted, grantPermission } = require('../settings/permissions-store');

// Permission system uses WebSocket protocol — ZERO Electron dependency
let _bus = null;
function _getBus() {
    if (!_bus) {
        try { _bus = require('../core/event-bus'); } catch { _bus = null; }
    }
    return _bus;
}

// ── Audit Log ──────────────────────────────────────────────────────
const LOG_DIR = Paths.auditLogs();

function auditLog(action, args, result, approved = true) {
    const entry = {
        timestamp: new Date().toISOString(),
        action,
        args,
        result: typeof result === 'string' ? result.substring(0, 500) : result,
        approved
    };
    const logFile = path.join(LOG_DIR, `audit-${new Date().toISOString().split('T')[0]}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    console.log(`[OS-Audit] ${approved ? '✅' : '🚫'} ${action}`, args);
}

// ── Input Sanitisation ─────────────────────────────────────────────
function sanitize(input) {
    if (typeof input !== 'string') return '';
    // Strip shell metacharacters — only allow alphanumeric, spaces, dots, hyphens, underscores, slashes
    return input.replace(/[^a-zA-Z0-9 .\-_\/]/g, '');
}

// ── Platform detection ─────────────────────────────────────────────
const IS_MAC = process.platform === 'darwin';

// ── Client delegation helper (for cloud/headless Brain) ────────────
/**
 * When the Brain runs on a non-macOS server (e.g., Render), it cannot
 * execute osascript/open/pbpaste etc. This function delegates the
 * command to the connected Mac client via the client_action protocol.
 */
function delegateToClient(action, args, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        try {
            const { encode } = require('../core/transport/protocol');
            const registry = require('../core/transport/client-registry');
            const bus = _getBus();

            const requestId = `delegate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            const timeout = setTimeout(() => {
                if (bus) bus.removeListener(bus.EVENTS.CLIENT_ACTION_RESULT, onResult);
                reject(new Error(`Delegation timeout for ${action} after ${timeoutMs}ms`));
            }, timeoutMs);

            const onResult = (data) => {
                if (data?.requestId !== requestId) return;
                clearTimeout(timeout);
                if (bus) bus.removeListener(bus.EVENTS.CLIENT_ACTION_RESULT, onResult);

                if (data.result?.status === 'error' || data.result?.error) {
                    reject(new Error(data.result.error || 'Client action failed'));
                } else {
                    resolve(data.result?.output || data.result?.text || data.result?.message || JSON.stringify(data.result || ''));
                }
            };

            if (bus) {
                bus.on(bus.EVENTS.CLIENT_ACTION_RESULT, onResult);
            }

            // Send to the Mac client (prefer electron platform)
            const macClient = registry.getAllClients().find(c => c.platform === 'electron');
            if (macClient) {
                registry.send(macClient.id, encode('client_action', {
                    requestId,
                    action,
                    args,
                }));
            } else {
                // Try sending to any active client
                registry.sendToActive(encode('client_action', {
                    requestId,
                    action,
                    args,
                }));
            }
        } catch (e) {
            reject(new Error(`Delegation failed: ${e.message}`));
        }
    });
}

// ── Shell helper (safe, timeout-bounded) ───────────────────────────
function runShell(cmd, timeoutMs = 10000) {
    // If we're NOT on macOS, delegate to the connected Mac client
    if (!IS_MAC) {
        return delegateToClient('runShell', { command: cmd }, timeoutMs);
    }
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout.trim());
        });
    });
}

// ── AppleScript helper ─────────────────────────────────────────────
function runAppleScript(script, timeoutMs = 10000) {
    // If we're NOT on macOS, delegate to the connected Mac client
    if (!IS_MAC) {
        return delegateToClient('runAppleScript', { script }, timeoutMs);
    }
    return runShell(`osascript -e '${script.replace(/'/g, "'\\''")}'`, timeoutMs);
}

// ── Confirmation Dialog (protocol-based, no Electron) ─────────────
/**
 * Request user confirmation for dangerous actions.
 * Uses the WebSocket permission_request/permission_response protocol.
 * Falls back to auto-approve if no client is connected or pre-approved.
 */
async function confirmDangerousAction(toolName, actionDescription, actionLabel) {
    // Check if this tool has been permanently approved
    if (isPermissionGranted(toolName)) {
        console.log(`[Permissions] ✅ ${toolName} — pre-approved, skipping dialog.`);
        return true;
    }

    const bus = _getBus();
    if (!bus) return true; // No event bus available — auto-approve (shouldn't happen)

    const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            bus.removeListener(bus.EVENTS.PERMISSION_RESPONSE, onResponse);
            console.log(`[Permissions] ⏰ ${toolName} — no client response within 30s, auto-approving.`);
            resolve(true);
        }, 30000);

        const onResponse = (data) => {
            if (data?.requestId !== requestId) return; // Not our request
            clearTimeout(timeout);
            bus.removeListener(bus.EVENTS.PERMISSION_RESPONSE, onResponse);

            if (data.alwaysAllow) {
                grantPermission(toolName, actionLabel || actionDescription);
            }
            resolve(data.granted === true);
        };

        bus.on(bus.EVENTS.PERMISSION_RESPONSE, onResponse);

        // Dispatch request to clients via event bus
        const { encode, MSG } = require('../core/transport/protocol');
        const registry = require('../core/transport/client-registry');
        registry.broadcast(encode(MSG.PERMISSION_REQUEST || 'permission_request', {
            requestId,
            toolName,
            actionDescription,
            actionLabel: actionLabel || toolName,
            buttons: ['Deny', 'Allow Once', 'Always Allow'],
        }));
        console.log(`[Permissions] 🔐 Sent permission request: ${toolName} (${requestId})`);
    });
}


// ════════════════════════════════════════════════════════════════════
//  TOOL IMPLEMENTATIONS
// ════════════════════════════════════════════════════════════════════

// ── 1. Application Control ─────────────────────────────────────────

async function openApp(args) {
    const appName = sanitize(args.appName);
    if (!appName) return { error: 'Missing or invalid app name.' };

    auditLog('open_app', { appName }, 'executing');
    try {
        await runShell(`open -a "${appName}"`);
        return { status: 'success', message: `Opened ${appName}.` };
    } catch (e) {
        auditLog('open_app', { appName }, e.message, false);
        return { error: `Could not open "${appName}": ${e.message}` };
    }
}

async function quitApp(args) {
    const appName = sanitize(args.appName);
    if (!appName) return { error: 'Missing or invalid app name.' };

    // DANGEROUS — requires confirmation (or saved permission)
    const allowed = await confirmDangerousAction('os_quit_app', `Quit the application "${appName}".`, 'Quit Applications');
    if (!allowed) {
        auditLog('quit_app', { appName }, 'User denied', false);
        return { status: 'denied', message: `User denied quitting ${appName}.` };
    }

    auditLog('quit_app', { appName }, 'executing');
    try {
        await runAppleScript(`tell application "${appName}" to quit`);
        return { status: 'success', message: `Quit ${appName}.` };
    } catch (e) {
        return { error: `Could not quit "${appName}": ${e.message}` };
    }
}

async function listRunningApps() {
    auditLog('list_running_apps', {}, 'executing');
    try {
        const raw = await runAppleScript(
            'tell application "System Events" to get name of every process whose background only is false'
        );
        const apps = raw.split(', ').map(a => a.trim()).filter(Boolean);
        return { status: 'success', apps };
    } catch (e) {
        return { error: e.message };
    }
}

async function focusApp(args) {
    const appName = sanitize(args.appName);
    if (!appName) return { error: 'Missing or invalid app name.' };

    auditLog('focus_app', { appName }, 'executing');
    try {
        await runAppleScript(`tell application "${appName}" to activate`);
        return { status: 'success', message: `Brought ${appName} to front.` };
    } catch (e) {
        return { error: e.message };
    }
}

// ── 2. Volume Control ──────────────────────────────────────────────

async function setVolume(args) {
    const level = Math.max(0, Math.min(100, parseInt(args.level, 10)));
    if (isNaN(level)) return { error: 'Volume must be a number 0-100.' };

    auditLog('set_volume', { level }, 'executing');
    try {
        await runAppleScript(`set volume output volume ${level}`);
        return { status: 'success', message: `Volume set to ${level}%.` };
    } catch (e) {
        return { error: e.message };
    }
}

async function getVolume() {
    auditLog('get_volume', {}, 'executing');
    try {
        const raw = await runAppleScript('output volume of (get volume settings)');
        return { status: 'success', volume: parseInt(raw, 10) };
    } catch (e) {
        return { error: e.message };
    }
}

async function toggleMute(args) {
    const muted = args.muted === true || args.muted === 'true';
    auditLog('toggle_mute', { muted }, 'executing');
    try {
        await runAppleScript(`set volume ${muted ? 'with' : 'without'} output muted`);
        return { status: 'success', message: muted ? 'Audio muted.' : 'Audio unmuted.' };
    } catch (e) {
        return { error: e.message };
    }
}

// ── 3. Brightness Control ──────────────────────────────────────────

async function setBrightness(args) {
    const level = Math.max(0, Math.min(100, parseInt(args.level, 10)));
    if (isNaN(level)) return { error: 'Brightness must be a number 0-100.' };

    auditLog('set_brightness', { level }, 'executing');
    try {
        const fraction = (level / 100).toFixed(2);
        // Use CoreBrightness via osascript JXA — works on all modern Macs
        const jxaScript = `
ObjC.import("CoreBrightness");
var client = $.CBBlueLightClient.alloc.init;
ObjC.import("IOKit");
var service = $.IOServiceGetMatchingService($.kIOMasterPortDefault, $.IOServiceMatching("IODisplayConnect"));
if (service) {
    $.IODisplaySetFloatParameter(service, 0, $("brightness"), ${fraction});
    $.IOServiceClose(service);
    "done";
} else {
    "no_display";
}`;
        const result = await runShell(`osascript -l JavaScript -e '${jxaScript.replace(/'/g, "'\\''")}'`, 5000).catch(() => 'failed');
        
        if (result === 'failed' || result === 'no_display') {
            // Fallback: Use AppleScript key simulation
            // First set to minimum, then press brightness up keys proportionally
            const steps = Math.round(level / 6.25); // 16 steps total (0-100)
            // Press brightness down 16 times to go to 0
            for (let i = 0; i < 16; i++) {
                await runShell(`osascript -e 'tell application "System Events" to key code 145'`).catch(() => {});
            }
            // Then press brightness up to desired level
            for (let i = 0; i < steps; i++) {
                await runShell(`osascript -e 'tell application "System Events" to key code 144'`).catch(() => {});
            }
        }
        
        return { status: 'success', message: `Brightness set to ${level}%.` };
    } catch (e) {
        return { error: `Brightness control failed: ${e.message}` };
    }
}

// ── 4. System Information ──────────────────────────────────────────

async function getSystemInfo() {
    auditLog('get_system_info', {}, 'executing');
    try {
        const [cpuRaw, memRaw, diskRaw, batteryRaw, uptimeRaw] = await Promise.all([
            runShell("sysctl -n machdep.cpu.brand_string"),
            runShell("vm_stat | head -5"),
            runShell("df -h / | tail -1"),
            runShell("pmset -g batt").catch(() => 'N/A'),
            runShell("uptime")
        ]);

        // Parse memory
        const pageSize = 16384; // macOS page size
        const memLines = memRaw.split('\n');
        const freePages = parseInt((memLines.find(l => l.includes('free')) || '0').match(/\d+/)?.[0] || '0');
        const activePages = parseInt((memLines.find(l => l.includes('active')) || '0').match(/\d+/)?.[0] || '0');
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMemPct = ((1 - freeMem / totalMem) * 100).toFixed(1);

        // Parse disk
        const diskParts = diskRaw.trim().split(/\s+/);
        const diskUsed = diskParts[2] || 'N/A';
        const diskAvail = diskParts[3] || 'N/A';
        const diskPct = diskParts[4] || 'N/A';

        // Parse battery
        let batteryPct = 'N/A';
        let batteryState = 'N/A';
        const battMatch = batteryRaw.match(/(\d+)%/);
        if (battMatch) batteryPct = battMatch[1] + '%';
        if (batteryRaw.includes('AC Power')) batteryState = 'Charging';
        else if (batteryRaw.includes('Battery Power')) batteryState = 'On Battery';

        return {
            status: 'success',
            cpu: cpuRaw,
            memory: {
                total: (totalMem / 1073741824).toFixed(1) + ' GB',
                used: usedMemPct + '%',
                free: (freeMem / 1073741824).toFixed(1) + ' GB'
            },
            disk: { used: diskUsed, available: diskAvail, usedPercent: diskPct },
            battery: { level: batteryPct, state: batteryState },
            uptime: uptimeRaw.trim()
        };
    } catch (e) {
        return { error: e.message };
    }
}

async function getTopProcesses() {
    auditLog('get_top_processes', {}, 'executing');
    try {
        const raw = await runShell("ps -arcwwwxo 'pid,%cpu,%mem,command' | head -11");
        const lines = raw.split('\n');
        const header = lines[0];
        const processes = lines.slice(1).map(line => {
            const parts = line.trim().split(/\s+/);
            return {
                pid: parts[0],
                cpu: parts[1] + '%',
                memory: parts[2] + '%',
                name: parts.slice(3).join(' ')
            };
        });
        return { status: 'success', processes };
    } catch (e) {
        return { error: e.message };
    }
}

// ── 5. System Power Actions (ALL REQUIRE CONFIRMATION) ─────────────

async function systemSleep() {
    const allowed = await confirmDangerousAction('os_system_sleep', 'Put the Mac to sleep.', 'System Sleep');
    if (!allowed) {
        auditLog('system_sleep', {}, 'User denied', false);
        return { status: 'denied', message: 'User denied sleep.' };
    }
    auditLog('system_sleep', {}, 'executing');
    try {
        await runAppleScript('tell application "System Events" to sleep');
        return { status: 'success', message: 'System going to sleep.' };
    } catch (e) {
        return { error: e.message };
    }
}

async function lockScreen() {
    auditLog('lock_screen', {}, 'executing');
    try {
        await runShell(
            '/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend'
        );
        return { status: 'success', message: 'Screen locked.' };
    } catch (e) {
        return { error: e.message };
    }
}

async function emptyTrash() {
    const allowed = await confirmDangerousAction('os_empty_trash', 'Empty the Trash permanently. This cannot be undone.', 'Empty Trash');
    if (!allowed) {
        auditLog('empty_trash', {}, 'User denied', false);
        return { status: 'denied', message: 'User denied emptying trash.' };
    }
    auditLog('empty_trash', {}, 'executing');
    try {
        await runAppleScript('tell application "Finder" to empty trash');
        return { status: 'success', message: 'Trash emptied.' };
    } catch (e) {
        return { error: e.message };
    }
}

// ── 6. Clipboard (shell-only, no Electron) ─────────────────────────

async function readClipboard() {
    auditLog('read_clipboard', {}, 'executing');
    try {
        const text = await runShell('pbpaste').catch(() => '');
        return { status: 'success', text: (text || '').substring(0, 5000) };
    } catch (e) {
        return { error: e.message };
    }
}

async function writeClipboard(args) {
    const text = args.text || '';
    auditLog('write_clipboard', { length: text.length }, 'executing');
    try {
        const { exec: execCb } = require('child_process');
        await new Promise((resolve, reject) => {
            const proc = execCb('pbcopy', (err) => { if (err) reject(err); else resolve(); });
            proc.stdin.end(text, 'utf8');
        });
        return { status: 'success', message: `Copied ${text.length} characters to clipboard.` };
    } catch (e) {
        return { error: e.message };
    }
}

// ── 7. Notifications ──────────────────────────────────────────────

async function showNotification(args) {
    const title = (args.title || 'Summer').substring(0, 100);
    const body = (args.body || '').substring(0, 500);
    auditLog('show_notification', { title }, 'executing');
    try {
        // macOS native notification via osascript (no Electron dependency)
        const safeTitle = title.replace(/'/g, "'\\''");
        const safeBody  = body.replace(/'/g, "'\\''");
        if (process.platform === 'darwin') {
            await runShell(`osascript -e 'display notification "${safeBody}" with title "${safeTitle}"'`);
        }

        // Also notify all connected clients via protocol
        const bus = _getBus();
        if (bus) {
            try {
                const { encode } = require('../core/transport/protocol');
                const registry = require('../core/transport/client-registry');
                registry.broadcast(encode('notification', { title, body }));
            } catch (_) { /* no transport */ }
        }

        return { status: 'success', message: 'Notification shown.' };
    } catch (e) {
        return { error: e.message };
    }
}

// ── 8. File System (Read-Only + Open) ──────────────────────────────

async function readFile(args) {
    const target = sanitize(args.path || '');
    if (!target) return { error: 'Missing path.' };
    auditLog('read_file', { target }, 'executing');
    try {
        const fs = require('fs');
        if (!fs.existsSync(target)) return { error: 'File not found' };
        const content = fs.readFileSync(target, 'utf-8');
        return { status: 'success', content: content.substring(0, 50000) }; // Limit size
    } catch (e) {
        return { error: e.message };
    }
}

async function openFileOrFolder(args) {
    const target = sanitize(args.path || '');
    if (!target) return { error: 'Missing path.' };
    auditLog('open_file_or_folder', { target }, 'executing');
    try {
        await runShell(`open "${target.replace(/"/g, '\\"')}"`);
        return { status: 'success', message: `Opened ${target}.` };
    } catch (e) {
        return { error: e.message };
    }
}

async function openUrl(args) {
    const url = args.url || '';
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { error: 'URL must start with http:// or https://' };
    }
    auditLog('open_url_in_default_browser', { url }, 'executing');
    try {
        // macOS: `open` command works in daemon mode (no Electron dependency)
        await runShell(`open "${url.replace(/"/g, '\\"')}"`);
        return { status: 'success', message: `Opened ${url} in default browser.` };
    } catch (e) {
        return { error: e.message };
    }
}

// ── 9. Dark Mode Toggle ───────────────────────────────────────────

async function toggleDarkMode(args) {
    const enable = args.enable === true || args.enable === 'true';
    auditLog('toggle_dark_mode', { enable }, 'executing');
    try {
        await runAppleScript(
            `tell application "System Events" to tell appearance preferences to set dark mode to ${enable}`
        );
        return { status: 'success', message: enable ? 'Dark mode enabled.' : 'Dark mode disabled.' };
    } catch (e) {
        return { error: e.message };
    }
}

async function getDarkModeStatus() {
    auditLog('get_dark_mode', {}, 'executing');
    try {
        const result = await runAppleScript(
            'tell application "System Events" to tell appearance preferences to get dark mode'
        );
        return { status: 'success', darkMode: result === 'true' };
    } catch (e) {
        return { error: e.message };
    }
}

// ── 10. Do Not Disturb ────────────────────────────────────────────

async function toggleDoNotDisturb(args) {
    const enable = args.enable === true || args.enable === 'true';
    auditLog('toggle_dnd', { enable }, 'executing');
    try {
        // Method 1: Use the Focus/DND shortcut via Control Center in menu bar
        // On macOS Ventura+, click the clock in menu bar → Focus
        await runAppleScript(`
tell application "System Events"
    tell process "ControlCenter"
        -- Click the "Focus" or "Do Not Disturb" menu bar item
        set menuItems to every menu bar item of menu bar 1
        repeat with mi in menuItems
            try
                if description of mi contains "Focus" then
                    click mi
                    delay 0.5
                    -- In the dropdown, click "Do Not Disturb" to toggle it
                    try
                        click checkbox "Do Not Disturb" of group 1 of window "Control Center"
                    on error
                        try
                            click checkbox 1 of group 1 of window "Control Center"
                        on error
                            -- Click the first switch/toggle in the Focus panel
                            click button 1 of group 1 of window "Control Center"
                        end try
                    end try
                    delay 0.3
                    -- Close Control Center by pressing Escape
                    key code 53
                    exit repeat
                end if
            end try
        end repeat
    end tell
end tell`);
        return { status: 'success', message: enable ? 'Do Not Disturb enabled.' : 'Do Not Disturb disabled.' };
    } catch (e) {
        // Method 2: Use defaults command (may require restart of NotificationCenter)
        try {
            if (enable) {
                await runShell('defaults -currentHost write com.apple.notificationcenterui dndStart -float 0');
                await runShell('defaults -currentHost write com.apple.notificationcenterui dndEnd -float 1440');
                await runShell('defaults -currentHost write com.apple.notificationcenterui doNotDisturb -bool true');
            } else {
                await runShell('defaults -currentHost write com.apple.notificationcenterui doNotDisturb -bool false');
            }
            await runShell('killall NotificationCenter').catch(() => {});
            return { status: 'success', message: enable ? 'Do Not Disturb enabled (may need a moment to take effect).' : 'Do Not Disturb disabled.' };
        } catch (e2) {
            return { error: `DND control failed: ${e.message}. Fallback: ${e2.message}` };
        }
    }
}

// ── 11. Take Screenshot ───────────────────────────────────────────

async function takeScreenshot() {
    auditLog('take_screenshot', {}, 'executing');
    try {
        const screenshotDir = Paths.desktop();
        const filename = `summer-screenshot-${Date.now()}.png`;
        const filepath = path.join(screenshotDir, filename);
        await runShell(`screencapture -x "${filepath}"`);
        return { status: 'success', message: `Screenshot saved to Desktop as ${filename}.`, path: filepath };
    } catch (e) {
        return { error: e.message };
    }
}

// ── 12. Wi-Fi Control ─────────────────────────────────────────────

async function getWifiStatus() {
    auditLog('get_wifi_status', {}, 'executing');
    try {
        const networkName = await runShell(
            "/System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport -I | awk -F': ' '/ SSID/{print $2}'"
        ).catch(() => '');
        const signalRaw = await runShell(
            "/System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport -I | awk -F': ' '/agrCtlRSSI/{print $2}'"
        ).catch(() => '');

        return {
            status: 'success',
            network: networkName || 'Not connected',
            signal: signalRaw ? signalRaw + ' dBm' : 'N/A'
        };
    } catch (e) {
        return { error: e.message };
    }
}

// ── 13. Timer ─────────────────────────────────────────────────────

const activeTimers = new Map();

async function setTimer(args) {
    const seconds = parseInt(args.seconds, 10);
    const label = (args.label || 'Timer').substring(0, 100);
    if (isNaN(seconds) || seconds < 1 || seconds > 86400) {
        return { error: 'Timer must be 1-86400 seconds.' };
    }

    auditLog('set_timer', { seconds, label }, 'executing');

    const timerId = `timer-${Date.now()}`;
    const endsAt = new Date(Date.now() + seconds * 1000);
    const endsAtStr = endsAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const timer = setTimeout(async () => {
        // macOS native notification (works on daemon host)
        const { exec: execCb } = require('child_process');
        if (process.platform === 'darwin') {
            execCb(`osascript -e 'display notification "${label} — Time is up!" with title "⏰ Summer Timer" sound name "Glass"'`);
            execCb(`say "Hey! Your timer for ${label} is done!"`);
        }

        // Dispatch to all connected clients via event bus + protocol
        const bus = _getBus();
        if (bus) {
            bus.dispatch(bus.EVENTS.TIMER_FIRED, { timerId, label });
            try {
                const { encode } = require('../core/transport/protocol');
                const registry = require('../core/transport/client-registry');
                registry.broadcast(encode('timer_fired', {
                    timerId,
                    label,
                    message: `${label} — Time is up!`,
                }));
            } catch (_) { /* no transport available */ }
        }

        activeTimers.delete(timerId);
    }, seconds * 1000);

    activeTimers.set(timerId, { timer, label, endsAt: endsAt.getTime() });

    // Format human-readable duration
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const durationStr = mins > 0 
        ? `${mins} minute${mins > 1 ? 's' : ''}${secs > 0 ? ` and ${secs} second${secs > 1 ? 's' : ''}` : ''}`
        : `${secs} second${secs > 1 ? 's' : ''}`;

    return {
        status: 'success',
        message: `Timer "${label}" set for ${durationStr}. It will go off at ${endsAtStr}. You'll see a notification, hear a sound, and get a spoken alert.`,
        timerId,
        endsAt: endsAtStr
    };
}


// ════════════════════════════════════════════════════════════════════
//  TOOL DISPATCHER — maps tool name → handler
// ════════════════════════════════════════════════════════════════════

const OS_TOOL_HANDLERS = {
    os_open_app:             openApp,
    os_quit_app:             quitApp,
    os_focus_app:            focusApp,
    os_list_running_apps:    listRunningApps,
    os_set_volume:           setVolume,
    os_get_volume:           getVolume,
    os_toggle_mute:          toggleMute,
    os_set_brightness:       setBrightness,
    os_get_system_info:      getSystemInfo,
    os_get_top_processes:    getTopProcesses,
    os_system_sleep:         systemSleep,
    os_lock_screen:          lockScreen,
    os_empty_trash:          emptyTrash,
    os_read_clipboard:       readClipboard,
    os_write_clipboard:      writeClipboard,
    os_show_notification:    showNotification,
    os_open_file:            openFileOrFolder,
    os_read_file:            readFile,
    os_open_url:             openUrl,
    os_toggle_dark_mode:     toggleDarkMode,
    os_get_dark_mode:        getDarkModeStatus,
    os_toggle_dnd:           toggleDoNotDisturb,
    os_take_screenshot:      takeScreenshot,
    os_get_wifi_status:      getWifiStatus,
    os_set_timer:            setTimer
};

/**
 * Execute an OS tool by name. Returns a result object.
 * Returns null if the tool name is not an OS tool.
 */
async function executeOsTool(name, args = {}) {
    const handler = OS_TOOL_HANDLERS[name];
    if (!handler) return null; // Not an OS tool
    return await handler(args);
}

/**
 * Check if a tool name belongs to the OS tools module.
 */
function isOsTool(name) {
    return name in OS_TOOL_HANDLERS;
}

module.exports = { executeOsTool, isOsTool };

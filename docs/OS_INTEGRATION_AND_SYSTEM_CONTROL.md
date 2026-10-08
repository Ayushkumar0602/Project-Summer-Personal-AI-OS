# OS Integration & Deep System Control Architecture

**System:** Project Summer — Personal AI Assistant  
**Subsystem:** Operating System Integration & App Control  
**Implementation Directory:** `src/tools/`, `src/core/platform/`, `src/overlay/`, `src/main/`  
**Core Modules:** `os-tools.js`, `app-control-tools.js`, `adapter-macos.js`, `permissions-store.js`, `windows.js`, `overlay-renderer.js`

---

## 1. Executive Summary & Vision

Most personal AI assistants are confined inside a sandboxed web chat window. They can tell you how to change your computer's settings, but they cannot actually adjust the volume, launch an application, or interact with native software on your screen.

Summer implements **Deep Operating System & Application Integration** tailored for macOS, designed to function as an authentic Jarvis-class operating system companion. Summer possesses both **"Hands"** (native AppleScript, shell commands, and the macOS Accessibility API) and **"Eyes"** (screencapture coupled with Gemini Vision), governed by a **Zero-Trust Security & Permission Model**.

```mermaid
graph TD
    User([Voice Command: "Mute sound, open VS Code and switch to dark mode"]) --> LiveSession[Gemini Live Tool Dispatcher]
    
    LiveSession --> Router[Tool Router\nsrc/tools/tool-router.js]
    
    Router --> OSTools[OS Tools\nsrc/tools/os-tools.js]
    Router --> AppTools[Deep App Control\nsrc/tools/app-control-tools.js]
    
    subgraph "Zero-Trust Security Architecture"
        OSTools --> Sanitize[Input Sanitizer\nMetacharacter Stripping]
        Sanitize --> PermCheck{Tiered Permission Check\npermissions-store.js}
        PermCheck -->|Dangerous Action| Confirm[WebSocket Confirmation Dialog\nDeny / Allow Once / Always Allow]
        PermCheck -->|Safe Action| Exec[Command Execution]
        Confirm -->|Approved| Exec
        Exec --> AuditLog[Persistent JSONL Audit Log]
    end
    
    subgraph "Execution Adapters"
        Exec --> LocalMac[Native macOS: AppleScript / osascript]
        Exec --> RemoteClient[Remote Mac Client Delegation\nBinary WebSocket Protocol]
    end
    
    subgraph "Visual Interface"
        Exec --> HUD[Unified Transparent HUD Canvas\n3-Zone Tiling & Pointer Watchdog]
    end
```

---

## 2. Zero-Trust Security & Audit Architecture (`src/tools/os-tools.js`)

Giving an autonomous AI access to native OS controls introduces critical security risks if unconstrained. Summer enforces a four-pillar security boundary:

### 1. Allowlisted Actions Only
Summer completely prohibits arbitrary shell command execution from conversational prompts. Every capability maps to a specific, hardcoded, pre-validated handler function.

### 2. Strict Input Sanitization
All string parameters (e.g., application names, file paths, URLs) are sanitized to eliminate shell metacharacters:
```javascript
function sanitize(input) {
    if (typeof input !== 'string') return '';
    // Only allow alphanumeric, spaces, dots, hyphens, underscores, slashes
    return input.replace(/[^a-zA-Z0-9 .\-_\/]/g, '');
}
```

### 3. Tiered Permissions & Interactive Confirmation
Actions are split into two security tiers:
* **Safe Actions:** Read-only queries (system specs, WiFi status, battery level, current volume) and non-destructive adjustments (set brightness, launch application) execute immediately.
* **Dangerous Actions:** Destructive operations (`os_quit_app`, `os_system_sleep`, `os_lock_screen`, `os_empty_trash`, terminal script execution) require explicit user authorization:
  ```javascript
  const allowed = await confirmDangerousAction(
      'os_quit_app', 
      `Quit the application "${appName}".`, 
      'Quit Applications'
  );
  ```
  The confirmation prompt is delivered over the WebSocket protocol to the user's active client, presenting options: `[Deny]`, `[Allow Once]`, and `[Always Allow]`. Permanent approvals are saved in `permissions-store.js`.

### 4. Persistent Daily Audit Logging
Every action—whether executed, approved, denied by user, or failed—is appended to an immutable daily JSONL log file:
```javascript
// Located at ~/.config/summer/audit-logs/audit-YYYY-MM-DD.jsonl
{
  "timestamp": "2026-10-08T11:42:01.120Z",
  "action": "open_app",
  "args": { "appName": "Visual Studio Code" },
  "result": "Opened Visual Studio Code.",
  "approved": true
}
```

---

## 3. Native macOS System Controls

Summer provides comprehensive control over the macOS operating system:

| Domain | Implemented Tools | Underlying Mechanism |
| :--- | :--- | :--- |
| **Application Lifecycle** | `os_open_app`, `os_quit_app`, `os_focus_app`, `os_list_running_apps` | `open -a`, AppleScript `System Events` process activation |
| **Audio Controls** | `os_set_volume`, `os_get_volume`, `os_toggle_mute` | AppleScript `set volume output volume X` / `output muted` |
| **Display Controls** | `os_set_brightness`, `os_get_brightness`, `os_toggle_dark_mode` | Command-line brightness utilities & System Events appearance toggle |
| **System Diagnostics** | `os_get_system_info`, `os_get_top_processes` | Node `os` module, `sysctl`, `ps aux` CPU/RAM sorting |
| **Power & Security** | `os_system_sleep`, `os_lock_screen` | `pmset sleepnow`, macOS lock keychain command |
| **Clipboard & Notifications** | `os_read_clipboard`, `os_write_clipboard`, `os_show_notification` | `pbpaste`, `pbcopy`, AppleScript `display notification` |
| **Filesystem & Finder** | `finder_list_files`, `finder_get_info`, `os_open_file`, `os_empty_trash` | AppleScript Finder inspection, macOS `trash` subsystem |
| **Network & Timers** | `os_get_wifi_status`, `os_set_timer` | `airport` CLI Wi-Fi parsing, background timeout timers |

---

## 4. Headless Cloud & Client Delegation (`delegateToClient`)

Summer is architected to run both locally on a MacBook and headlessly on a remote server (e.g., cloud daemon).

When the Summer daemon runs on a non-macOS server or inside a Docker container, it cannot execute native `osascript` or `pbpaste` directly on the host machine. Summer resolves this via **Transparent Client Delegation**:
```javascript
function delegateToClient(action, args, timeoutMs = 15000, ctx = {}) {
    const registry = require('../core/transport/client-registry');
    const macClient = registry.getClientsByPlatform('darwin')[0];
    if (macClient) {
        macClient.send(encode('client_action', { action, args }));
    }
}
```
If a mobile client (iOS) requests an action on the user's Mac, or if the cloud Brain processes the command, the action payload is dispatched over the WebSocket binary protocol to the connected Mac desktop client, executed locally, and the result is returned seamlessly.

---

## 5. Deep In-App Control: "Eyes" & "Hands" (`src/tools/app-control-tools.js`)

Beyond operating system toggles, Summer features in-app UI automation through a unified vision-and-accessibility pipeline:

### 1. Eyes: Screencapture & Vision Inspection
* Summer captures high-resolution screenshots of the active foreground window using macOS `screencapture -l<window_id>`.
* The image is analyzed using Gemini Vision to detect visual coordinates, text blocks, form fields, and status indicators.

### 2. Hands: macOS Accessibility API (`System Events`)
* Interacts with buttons, menus, and text fields inside third-party apps:
  ```applescript
  tell application "System Events"
      tell process "AppName"
          click button "Submit" of window 1
      end tell
  end tell
  ```
* Supports direct keystroke typing, shortcut simulation (e.g., `Cmd+S`, `Cmd+Shift+P`), and menu item clicking across apps like VS Code, Notes, Finder, and Slack.

---

## 6. Holographic Transparent HUD Overlay & Pointer Watchdog

Rather than using intrusive floating desktop windows, Summer renders widgets on a **Unified Full-Screen Transparent Overlay** (`src/overlay/overlay-renderer.js` and `src/main/windows.js`).

### Content-Aware 3-Zone Tiling Engine
The overlay divides the screen into a dynamic 3-zone layout:
* **Center Zone (Primary):** Active focus cards (Deep Research reports, active PPT generation progress, rich HTML dashboards).
* **Left Margin (Secondary):** System diagnostics, active background agent statuses, and memory graph previews.
* **Right Margin (Tertiary):** Media players, timers, and transient toasts.

### The Real-Time Pointer Watchdog (Click-Through Logic)
A major challenge with full-screen overlays is that they block the user's mouse from interacting with desktop apps underneath. Summer solves this with an active **500ms Pointer Watchdog**:
1. The overlay window is created with `setIgnoreMouseEvents(true, { forward: true })`, allowing clicks to pass directly through to macOS desktop applications.
2. In the renderer process, an event loop continuously tracks cursor coordinates against the bounding boxes (`getBoundingClientRect()`) of active Summer widgets.
3. When the user hovers over an active Summer widget, the window dynamically toggles mouse events back on (`setIgnoreMouseEvents(false)`), allowing scrolling, clicking, and button interaction.
4. When the cursor leaves the widget, mouse events are disabled again instantly, restoring native OS click-through.

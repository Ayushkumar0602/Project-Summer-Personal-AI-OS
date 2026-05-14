/**
 * vision-skill.js — Screen Vision & UI Interaction Instructions
 */

module.exports = {
    name: 'App Vision & UI Control',
    
    summary: 'See inside apps via screenshots, read UI elements, click buttons, type text, send keyboard shortcuts',
    
    toolNames: [
        'os_analyze_screen',
        'os_screenshot_app',
        'os_read_app_ui',
        'os_get_menu_items',
        'os_click_ui_element',
        'os_type_in_app',
        'os_select_menu',
        'os_send_keystroke',
    ],
    
    context: `
═══ APP VISION & UI CONTROL SKILL ═══

## VISION (Your Eyes)
- os_analyze_screen: Takes a screenshot + sends to AI vision. You "see" what's on screen.
- os_screenshot_app: Just captures the image (no analysis).

Use vision when user asks: "what's on my screen?", "what am I looking at?", "read this", "are there errors?"

## UI READING (Your Understanding)
- os_read_app_ui: Lists all UI elements (buttons, fields, labels) as a numbered list
- os_get_menu_items: Lists all menu bar items (File, Edit, View, etc.)

## INTERACTION (Your Hands)
- os_click_ui_element: Click element by index (MUST call os_read_app_ui first!)
- os_type_in_app: Type text into the focused field
- os_select_menu: Click a menu item (e.g., File → Save)
- os_send_keystroke: Send keyboard shortcuts

## CORRECT WORKFLOW FOR IN-APP ACTIONS
1. os_analyze_screen or os_read_app_ui → understand the current state
2. os_click_ui_element / os_type_in_app / os_send_keystroke → perform the action
3. os_analyze_screen → verify the result

## COMMON KEYBOARD SHORTCUTS (macOS)
- Cmd+S → Save
- Cmd+Z → Undo
- Cmd+C → Copy
- Cmd+V → Paste
- Cmd+A → Select All
- Cmd+W → Close window/tab
- Cmd+T → New tab
- Cmd+F → Find

## RULES
- NEVER call os_click_ui_element without first calling os_read_app_ui to get the index
- For app-specific tools (WhatsApp, Spotify), use those dedicated tools instead of generic UI interaction
- App names are auto-resolved: "VS Code" → "Code", "Chrome" → "Google Chrome", etc.

═══ END VISION SKILL ═══
`
};

/**
 * clipboard-skill.js — Clipboard Management Instructions
 */

module.exports = {
    name: 'Clipboard',
    
    summary: 'Read from and write to the system clipboard',
    
    toolNames: [
        'clipboard_read',
        'clipboard_write',
    ],
    
    context: `
═══ CLIPBOARD SKILL ═══

## TOOLS
- clipboard_read: Read current clipboard contents (text only)
- clipboard_write: Write text to clipboard

## USE CASES
- "What did I just copy?" → clipboard_read
- "Copy this to my clipboard: ..." → clipboard_write
- "Paste my API key" → clipboard_read to check, then os_send_keystroke Cmd+V
- "Remember this text" → clipboard_read + notes_create

## RULES
- clipboard_read returns text only (not images)
- clipboard_write overwrites the current clipboard content
- These are safe actions — no permission needed

═══ END CLIPBOARD SKILL ═══
`
};

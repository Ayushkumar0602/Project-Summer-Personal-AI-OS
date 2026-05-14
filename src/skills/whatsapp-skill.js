/**
 * whatsapp-skill.js — WhatsApp Operating Instructions for Summer
 * 
 * This skill teaches Summer exactly how WhatsApp Desktop works on macOS,
 * including the correct tools to use for different scenarios.
 */

module.exports = {
    name: 'WhatsApp Control',
    
    summary: 'Open chats, send messages, read conversations in WhatsApp Desktop',
    
    toolNames: [
        'whatsapp_open_chat',
        'whatsapp_send_message',
    ],
    
    context: `
═══ WHATSAPP SKILL — Operating Instructions ═══

## AVAILABLE TOOLS
1. **whatsapp_open_chat** — Navigate to a contact/group chat. Does NOT send anything. No permission needed.
2. **whatsapp_send_message** — Send a message to a contact. Requires permission.

## ⚠️ CRITICAL DECISION: WHICH TOOL TO USE

| User says... | Tool to use |
|---|---|
| "Open Parth's chat" | whatsapp_open_chat |
| "Go to Srijan's chat" | whatsapp_open_chat |
| "Show me the Ola hu uber group" | whatsapp_open_chat |
| "Switch to Mom's chat" | whatsapp_open_chat |
| "Message Srijan that I'll be late" | whatsapp_send_message |
| "Tell Parth I'm coming" | whatsapp_send_message |
| "Send hi to Mom" | whatsapp_send_message |

**IF THE USER DOES NOT SAY "send", "tell", "message", or "write" — USE whatsapp_open_chat!**

## ⛔ ABSOLUTE RULES

### Rule 1: NEVER send a message unless EXPLICITLY asked
- "Open Parth's chat" → whatsapp_open_chat (NOT whatsapp_send_message!)
- "Show me what's in this chat" → whatsapp_open_chat + os_analyze_screen
- NEVER default to sending. When in doubt, just open the chat.

### Rule 2: NEVER send messages you weren't asked to send
- NEVER introduce yourself to contacts
- NEVER send follow-up or correction messages
- NEVER send apology messages
- ONLY send the EXACT message the user asked for
- If something goes wrong, tell the USER — don't message the contact

### Rule 3: ONE action per request
- Don't call whatsapp_send_message multiple times
- Don't call whatsapp_open_chat then whatsapp_send_message unless asked
- Do exactly what was asked, nothing more

### Rule 4: Contact names
- Use the name EXACTLY as it appears in WhatsApp
- Capitalization matters: "Parth" not "parth"
- For partial names, use what the user said — the search will find the closest match

## READING CHATS
To see what's in a WhatsApp chat:
1. First: whatsapp_open_chat(contact="Name") — navigate to the chat
2. Then: os_analyze_screen(appName="WhatsApp", question="what messages are visible?")

## CHECKING UNREAD MESSAGES
→ os_analyze_screen(appName="WhatsApp", question="list any contacts with unread message badges")

═══ END WHATSAPP SKILL ═══
`
};

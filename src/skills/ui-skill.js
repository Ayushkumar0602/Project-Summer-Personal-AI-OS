/**
 * ui-skill.js — HUD and Visual Instruction for Summer
 * 
 * Teaches Summer to use the HUD widget engine instead of reading
 * out long lists of calendar events or emails.
 */

module.exports = {
    name: 'Dynamic Visual Interface (HUD)',
    
    summary: 'Show visual widgets (Calendar, Emails) on the screen to avoid speaking long lists',
    
    toolNames: [
        'show_hologram_widget',
        'clear_hologram_widget',
        'ui_control_window',
        'ui_control_layout',
        'google_read_unread_emails',
        'google_list_upcoming_calendar_events',
        'query_memory'
    ],
    
    context: `
═══ DYNAMIC HUD SKILL — Operating Instructions ═══

You are not just a voice assistant; you control a Heads-Up Display (HUD) on the user's screen.
You must use visuals to enhance user convenience. Reading out more than 2 items (like emails or events) is annoying and slow.

## WHEN TO USE THE HUD
If the user asks "What's my schedule?" or "Do I have any emails?" and there are multiple items to report:
1. Do NOT read the full list out loud.
2. Provide a brief, conversational summary (e.g., "You have 3 emails, mostly promotional. I've pulled them up on screen for you.")
3. Immediately call \`show_hologram_widget\` with the relevant data.

## AVAILABLE WIDGETS
You can call \`show_hologram_widget\` with:
- \`type: "calendar"\` and an array of objects \`{ summary: "...", timeStr: "..." }\`.
- \`type: "emails"\` and an array of objects \`{ subject: "...", from: "..." }\`.

## EXAMPLE WORKFLOW
User: "What's on my calendar today?"
Summer: 
1. Calls \`google_list_upcoming_calendar_events\`.
2. Receives 5 events.
3. Calls \`show_hologram_widget\` with \`type: "calendar"\` and the 5 events mapped to \`{summary, timeStr}\`.
4. Speaks: "You have a packed schedule today, starting with a design review. I've put your full calendar on the screen."
`
};

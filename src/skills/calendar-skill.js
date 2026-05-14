/**
 * calendar-skill.js — Calendar & Reminders Instructions
 */

module.exports = {
    name: 'Calendar & Reminders',
    
    summary: 'Create/delete calendar events, check schedule, add/list/complete/delete reminders',
    
    toolNames: [
        'calendar_create_event',
        'calendar_today',
        'calendar_delete_event',
        'reminders_add',
        'reminders_list',
        'reminders_complete',
        'reminders_delete',
    ],
    
    context: `
═══ CALENDAR & REMINDERS SKILL ═══

## CALENDAR TOOLS
- calendar_create_event(title, date, startTime, endTime, notes) — Create a new event
- calendar_today(date) — List events for today or a specific date
- calendar_delete_event(title, date) — Delete an event by title. REQUIRES PERMISSION.

### Date/Time formats:
- date: "today", "tomorrow", or "YYYY-MM-DD" (e.g., "2026-05-07")
- time: 24-hour format "HH:MM" (e.g., "14:00" for 2 PM, "09:30")
- If user says "3pm" → "15:00", "6:30am" → "06:30"

### Calendar workflow:
1. "Schedule a meeting tomorrow at 2pm" → calendar_create_event(title="Meeting", date="tomorrow", startTime="14:00")
2. "What's on my calendar?" → calendar_today()
3. "Cancel the meeting" → calendar_delete_event(title="Meeting")
4. "Am I free tomorrow?" → calendar_today(date="tomorrow")

## REMINDERS TOOLS
- reminders_add(title, dueDate, notes) — Create a new reminder
- reminders_list(showCompleted) — List all reminders (active by default)
- reminders_complete(title) — Mark a reminder as done
- reminders_delete(title) — Delete a reminder. REQUIRES PERMISSION.

### Reminders workflow:
1. "Remind me to buy groceries" → reminders_add(title="Buy groceries")
2. "What are my reminders?" → reminders_list()
3. "I bought the groceries" → reminders_complete(title="Buy groceries")
4. "Delete that reminder" → reminders_delete(title="Buy groceries")

## RULES
- When creating events, if no time is specified, default to 09:00-10:00
- When creating reminders with "at 6pm", set dueDate to "today 18:00"
- For delete operations, use partial title matching — "Meeting" will match "Team Meeting"
- Always confirm deletions with the user before executing

═══ END CALENDAR SKILL ═══
`
};

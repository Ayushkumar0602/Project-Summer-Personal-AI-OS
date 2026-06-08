const { google } = require('googleapis');
const { getClient, isAuthenticated, getAccounts, getAllAccountIds, getAccountInfo } = require('../auth/google-auth');

/**
 * Fetches today's agenda from Google Calendar.
 * @param {string} [accountId] - specific account ID, or primary if omitted
 */
async function getTodaysSchedule(accountId = null) {
    if (!(await isAuthenticated(accountId))) {
        return "Google Calendar: Not connected.";
    }

    try {
        const calendar = google.calendar({ version: 'v3', auth: getClient(accountId) });
        const now = new Date();
        
        // Start of today
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
        // End of today
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

        const res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: startOfDay,
            timeMax: endOfDay,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = res.data.items;
        if (!events || events.length === 0) {
            return "Google Calendar: No events scheduled for today.";
        }

        let schedule = "TODAY'S SCHEDULE (Google Calendar):\n";
        events.forEach(event => {
            const start = event.start.dateTime || event.start.date;
            const timeStr = event.start.dateTime ? new Date(start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'All Day';
            schedule += `- [${timeStr}] ${event.summary}\n`;
        });

        return schedule;
    } catch (e) {
        console.error("[GoogleService] Calendar error:", e.message);
        return "Google Calendar: Error fetching schedule.";
    }
}

/**
 * Fetches pending and recently completed tasks from Google Tasks.
 * @param {string} [accountId] - specific account ID, or primary if omitted
 */
async function getTasksContext(accountId = null) {
    if (!(await isAuthenticated(accountId))) {
        return "Google Tasks: Not connected.";
    }

    try {
        const tasksService = google.tasks({ version: 'v1', auth: getClient(accountId) });
        
        // Fetch all task lists, pick the primary one (usually the first one "@default")
        const listsRes = await tasksService.tasklists.list();
        const primaryListId = listsRes.data.items?.[0]?.id || '@default';

        // 1. Fetch pending tasks
        const pendingRes = await tasksService.tasks.list({
            tasklist: primaryListId,
            showCompleted: false,
            showHidden: false
        });

        // 2. Fetch completed tasks (to give AI context of what's been done recently)
        const completedRes = await tasksService.tasks.list({
            tasklist: primaryListId,
            showCompleted: true,
            showHidden: true,
            maxResults: 5 // Just the 5 most recently completed ones
        });

        const pending = pendingRes.data.items || [];
        const completed = (completedRes.data.items || []).filter(t => t.status === 'completed');

        let context = "GOOGLE TASKS:\n";
        
        if (pending.length > 0) {
            context += "Pending Tasks:\n";
            pending.forEach(t => {
                context += `- [ ] ${t.title}\n`;
            });
        } else {
            context += "No pending tasks.\n";
        }

        if (completed.length > 0) {
            context += "\nRecently Completed Tasks (Context):\n";
            completed.slice(0, 5).forEach(t => {
                context += `- [x] ${t.title}\n`;
            });
        }

        return context;
    } catch (e) {
        console.error("[GoogleService] Tasks error:", e.message);
        return "Google Tasks: Error fetching tasks.";
    }
}

/**
 * Compiles a full daily briefing from Google APIs to inject into context.
 * Uses the primary account by default.
 */
async function getDailyBriefingContext() {
    const isAuth = await isAuthenticated();
    if (!isAuth) return null;

    const [schedule, tasks] = await Promise.all([
        getTodaysSchedule(),
        getTasksContext()
    ]);

    // Include account info in context
    const accounts = getAccounts();
    let accountInfo = '';
    if (accounts.length > 0) {
        accountInfo = '\nCONNECTED GOOGLE ACCOUNTS:\n';
        accounts.forEach(a => {
            accountInfo += `- ${a.email}${a.isPrimary ? ' (PRIMARY)' : ''}\n`;
        });
    }

    return `\n\n--- GOOGLE WORKSPACE CONTEXT ---\n${schedule}\n\n${tasks}${accountInfo}\n---------------------------------`;
}

// ── MUTATIONS (Tools) ──

async function createGoogleTask(title, notes = '', due = null, accountId = null) {
    if (!(await isAuthenticated(accountId))) throw new Error("Google Tasks not connected.");
    const tasksService = google.tasks({ version: 'v1', auth: getClient(accountId) });
    
    const listsRes = await tasksService.tasklists.list();
    const primaryListId = listsRes.data.items?.[0]?.id || '@default';

    const taskBody = { title, notes };
    if (due) {
        // 'due' must be RFC 3339 timestamp
        taskBody.due = new Date(due).toISOString();
    }

    const res = await tasksService.tasks.insert({
        tasklist: primaryListId,
        requestBody: taskBody
    });

    return `Successfully created Google Task: "${res.data.title}" (ID: ${res.data.id})`;
}

async function createGoogleCalendarEvent(summary, startTime, endTime, description = '', accountId = null) {
    if (!(await isAuthenticated(accountId))) throw new Error("Google Calendar not connected.");
    const calendar = google.calendar({ version: 'v3', auth: getClient(accountId) });

    const event = {
        summary,
        description,
        start: { dateTime: new Date(startTime).toISOString() },
        end: { dateTime: new Date(endTime).toISOString() },
    };

    const res = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
    });

    return `Successfully created Google Calendar Event: "${res.data.summary}" at ${res.data.start.dateTime} (ID: ${res.data.id})`;
}

async function listUpcomingGoogleCalendarEvents(maxResults = 10, accountId = null) {
    if (!(await isAuthenticated(accountId))) throw new Error("Google Calendar not connected.");
    const calendar = google.calendar({ version: 'v3', auth: getClient(accountId) });
    
    const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
    });
    
    const events = res.data.items;
    if (!events || events.length === 0) return "No upcoming events found.";
    
    return events.map(e => `ID: ${e.id} | Summary: ${e.summary} | Start: ${e.start.dateTime || e.start.date}`).join("\n");
}

async function deleteGoogleCalendarEvent(eventId, accountId = null) {
    if (!(await isAuthenticated(accountId))) throw new Error("Google Calendar not connected.");
    const calendar = google.calendar({ version: 'v3', auth: getClient(accountId) });
    await calendar.events.delete({
        calendarId: 'primary',
        eventId: eventId,
    });
    return `Successfully deleted Google Calendar Event with ID: ${eventId}`;
}

module.exports = {
    getTodaysSchedule,
    getTasksContext,
    getDailyBriefingContext,
    createGoogleTask,
    createGoogleCalendarEvent,
    listUpcomingGoogleCalendarEvents,
    deleteGoogleCalendarEvent
};

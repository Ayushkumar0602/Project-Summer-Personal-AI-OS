const googleService = require('../services/google-service');
const mailService = require('../services/mail-service');
const driveService = require('../services/drive-service');
const youtubeService = require('../services/youtube-service');
const mapsService = require('../services/maps-service');
const { sendToRenderer, executeInRenderer } = require('../core/utils/renderer-bridge');

/**
 * Tool definitions for Google Workspace (Calendar, Tasks, Gmail)
 * These tools will be mapped to Gemini Live's tools array.
 */

const declarations = [
    {
        name: "google_create_task",
        description: "Creates a new task in the user's primary Google Tasks list.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "The title of the task." },
                notes: { type: "STRING", description: "Optional notes or details for the task." },
                due: { type: "STRING", description: "Optional due date as a valid ISO 8601 or RFC 3339 timestamp." }
            },
            required: ["title"]
        }
    },
    {
        name: "google_create_calendar_event",
        description: "Creates a new event in the user's primary Google Calendar.",
        parameters: {
            type: "OBJECT",
            properties: {
                summary: { type: "STRING", description: "The title/summary of the calendar event." },
                startTime: { type: "STRING", description: "The start time as a valid ISO 8601 timestamp (e.g. 2026-05-07T15:00:00Z). ALWAYS infer the correct date from the current context." },
                endTime: { type: "STRING", description: "The end time as a valid ISO 8601 timestamp (e.g. 2026-05-07T16:00:00Z)." },
                description: { type: "STRING", description: "Optional description for the event." }
            },
            required: ["summary", "startTime", "endTime"]
        }
    },
    {
        name: "google_list_upcoming_calendar_events",
        description: "Lists upcoming events in the user's primary Google Calendar. Useful for checking conflicts before scheduling or finding an event ID to delete.",
        parameters: {
            type: "OBJECT",
            properties: {
                maxResults: { type: "INTEGER", description: "The maximum number of events to return. Default is 10." }
            }
        }
    },
    {
        name: "google_delete_calendar_event",
        description: "Deletes an event from the user's primary Google Calendar using its event ID. First use google_list_upcoming_calendar_events to find the ID.",
        parameters: {
            type: "OBJECT",
            properties: {
                eventId: { type: "STRING", description: "The ID of the event to delete." }
            },
            required: ["eventId"]
        }
    },
    {
        name: "google_read_unread_emails",
        description: "Reads the user's unread emails from Gmail. Returns the sender, subject, and date.",
        parameters: {
            type: "OBJECT",
            properties: {
                maxResults: { type: "INTEGER", description: "Maximum number of unread emails to fetch. Default is 5." }
            }
        }
    },
    {
        name: "google_send_email",
        description: "Sends an email using the user's Gmail account.",
        parameters: {
            type: "OBJECT",
            properties: {
                to: { type: "STRING", description: "The email address of the recipient." },
                subject: { type: "STRING", description: "The subject line of the email." },
                bodyText: { type: "STRING", description: "The body content of the email." }
            },
            required: ["to", "subject", "bodyText"]
        }
    },
    {
        name: "google_search_emails",
        description: "Searches Gmail using standard Gmail queries (e.g. 'category:promotions', 'from:spam@spam.com', 'is:unread'). Returns a list of matching emails and their IDs.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "The Gmail search query." },
                maxResults: { type: "INTEGER", description: "Maximum number of results to fetch. Default is 10." }
            },
            required: ["query"]
        }
    },
    {
        name: "google_trash_email",
        description: "Moves a specific email to the trash using its ID. Find the ID using google_search_emails or google_read_unread_emails first.",
        parameters: {
            type: "OBJECT",
            properties: {
                messageId: { type: "STRING", description: "The ID of the email to trash." }
            },
            required: ["messageId"]
        }
    },
    {
        name: "google_archive_email",
        description: "Archives a specific email (removes it from INBOX) using its ID.",
        parameters: {
            type: "OBJECT",
            properties: {
                messageId: { type: "STRING", description: "The ID of the email to archive." }
            },
            required: ["messageId"]
        }
    },
    {
        name: "google_read_full_email",
        description: "Reads the full HTML body of a specific email and uses the HUD to display it securely on the user's screen.",
        parameters: {
            type: "OBJECT",
            properties: {
                messageId: { type: "STRING", description: "The ID of the email." }
            },
            required: ["messageId"]
        }
    },
    {
        name: "google_drive_search",
        description: "Searches Google Drive for files. Good for finding the ID of a document or spreadsheet.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "The Drive search query. Example: name contains 'budget' or mimeType='application/vnd.google-apps.spreadsheet'" },
                maxResults: { type: "INTEGER", description: "Default 10." }
            },
            required: ["query"]
        }
    },
    {
        name: "google_drive_create",
        description: "Creates a new Google Doc or Google Sheet.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "The name of the file." },
                type: { type: "STRING", description: "The type of file. Must be 'doc' or 'sheet'." }
            },
            required: ["title", "type"]
        }
    },
    {
        name: "google_drive_read_file",
        description: "Reads, shows, or plays a file from Google Drive (e.g., video, audio, pdf, ppt, image). It downloads media to present in a custom widget, and extracts text for you to read if possible.",
        parameters: {
            type: "OBJECT",
            properties: {
                fileId: { type: "STRING", description: "The ID of the file to read or play." }
            },
            required: ["fileId"]
        }
    },
    {
        name: "google_drive_delete",
        description: "Deletes a file from Google Drive. You MUST ask the user for explicit permission BEFORE calling this tool.",
        parameters: {
            type: "OBJECT",
            properties: {
                fileId: { type: "STRING", description: "The ID of the file to delete." }
            },
            required: ["fileId"]
        }
    },
    {
        name: "google_sheet_read",
        description: "Reads data from a specific Google Sheet and displays it on the HUD.",
        parameters: {
            type: "OBJECT",
            properties: {
                spreadsheetId: { type: "STRING", description: "The ID of the spreadsheet." },
                range: { type: "STRING", description: "The A1 notation range to read (e.g., 'Sheet1!A1:D10')." }
            },
            required: ["spreadsheetId", "range"]
        }
    },
    {
        name: "google_sheet_append",
        description: "Appends a row of data to the bottom of a Google Sheet.",
        parameters: {
            type: "OBJECT",
            properties: {
                spreadsheetId: { type: "STRING", description: "The ID of the spreadsheet." },
                range: { type: "STRING", description: "The A1 notation range (e.g., 'Sheet1!A1')." },
                values: { 
                    type: "ARRAY", 
                    description: "An array of arrays representing the rows to append. Example: [['John', '25', 'Active']]",
                    items: {
                        type: "ARRAY",
                        items: { type: "STRING" }
                    }
                }
            },
            required: ["spreadsheetId", "range", "values"]
        }
    },
    {
        name: "google_youtube_play",
        description: "Searches YouTube for a video and plays the top result visually on the HUD screen.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "The YouTube search query." }
            },
            required: ["query"]
        }
    },
    {
        name: "google_maps_find_place",
        description: "Searches Google Maps for a place and displays the interactive map on the HUD.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "The place to search for (e.g. 'Coffee shops in Seattle' or 'Eiffel Tower')." }
            },
            required: ["query"]
        }
    }
];

const handlers = {
    google_create_task: async (args) => {
        try {
            return await googleService.createGoogleTask(args.title, args.notes, args.due);
        } catch (e) {
            return `Failed to create task: ${e.message}`;
        }
    },
    google_create_calendar_event: async (args) => {
        try {
            return await googleService.createGoogleCalendarEvent(args.summary, args.startTime, args.endTime, args.description);
        } catch (e) {
            return `Failed to create calendar event: ${e.message}`;
        }
    },
    google_list_upcoming_calendar_events: async (args) => {
        try {
            return await googleService.listUpcomingGoogleCalendarEvents(args.maxResults || 10);
        } catch (e) {
            return `Failed to list calendar events: ${e.message}`;
        }
    },
    google_delete_calendar_event: async (args) => {
        try {
            return await googleService.deleteGoogleCalendarEvent(args.eventId);
        } catch (e) {
            return `Failed to delete calendar event: ${e.message}`;
        }
    },
    google_read_unread_emails: async (args) => {
        try {
            return await mailService.getUnreadEmails(args.maxResults || 5);
        } catch (e) {
            return `Failed to read emails: ${e.message}`;
        }
    },
    google_send_email: async (args) => {
        try {
            return await mailService.sendEmail(args.to, args.subject, args.bodyText);
        } catch (e) {
            return `Failed to send email: ${e.message}`;
        }
    },
    google_search_emails: async (args) => {
        try {
            return await mailService.searchEmails(args.query, args.maxResults || 10);
        } catch (e) {
            return `Failed to search emails: ${e.message}`;
        }
    },
    google_trash_email: async (args) => {
        try {
            return await mailService.trashEmail(args.messageId);
        } catch (e) {
            return `Failed to trash email: ${e.message}`;
        }
    },
    google_archive_email: async (args) => {
        try {
            return await mailService.archiveEmail(args.messageId);
        } catch (e) {
            return `Failed to archive email: ${e.message}`;
        }
    },
    google_read_full_email: async (args) => {
        try {
            const html = await mailService.getEmailHtml(args.messageId);
            sendToRenderer('show-hud-widget', { type: 'full-email', data: html });
            return "Successfully rendered the full email on the user's screen. You do not need to read the content to them.";
        } catch (e) {
            return `Failed to get full email: ${e.message}`;
        }
    },
    google_drive_search: async (args) => {
        try {
            return await driveService.searchFiles(args.query, args.maxResults);
        } catch (e) {
            return `Drive search failed: ${e.message}`;
        }
    },
    google_drive_create: async (args) => {
        try {
            return await driveService.createFile(args.title, args.type);
        } catch (e) {
            return `Drive creation failed: ${e.message}`;
        }
    },
    google_drive_read_file: async (args, ctx = {}) => {
        try {
            const meta = await driveService.getFileMetadata(args.fileId);
            const mimeType = meta.mimeType || '';
            const isVideo = mimeType.startsWith('video/');
            const isAudio = mimeType.startsWith('audio/');
            const isImage = mimeType.startsWith('image/');
            const isPdf = mimeType === 'application/pdf';
            const isGoogleSlides = mimeType === 'application/vnd.google-apps.presentation';
            const isPpt = isGoogleSlides || mimeType.includes('presentation');
            const fileType = isVideo ? 'Video' : isAudio ? 'Audio' : isPdf ? 'PDF' : isPpt ? 'Presentation' : 'File';
            const previewUrl = isGoogleSlides
                ? `https://docs.google.com/presentation/d/${args.fileId}/embed?start=false&loop=false&delayms=3000`
                : `https://drive.google.com/file/d/${args.fileId}/preview`;

            const openInBrowser = async (url) => {
                if (ctx.callBrowser) {
                    const nav = await ctx.callBrowser('browser_navigate', { url });
                    if (nav?.error) throw new Error(nav.error);
                    return nav;
                }
                sendToRenderer('browser-control', {
                    action: 'browser_navigate',
                    args: { url }
                });
                return { result: { status: 'sent', url } };
            };

            if (isImage) {
                // Images are small — download and show in overlay widget
                const localPath = await driveService.downloadFile(args.fileId, meta.name, { expectedSize: meta.size });
                sendToRenderer('show-hud-widget', {
                    type: 'drive_image',
                    data: { path: localPath, title: meta.name, mimeType, webViewLink: meta.webViewLink }
                });
                return `Successfully displayed image "${meta.name}" on the HUD.`;

            } else if (isVideo || isAudio || isPdf || isPpt) {
                let textResult = '';
                let localPath = null;
                let openedUrl = previewUrl;
                
                if (isGoogleSlides || isPpt) {
                    await openInBrowser(previewUrl);
                    textResult = `Successfully opened ${fileType} "${meta.name}" in the browser panel.`;
                    
                } else if (isPdf) {
                    await openInBrowser(previewUrl);
                    textResult = `Successfully opened ${fileType} "${meta.name}" in the browser panel.`;
                    
                } else if (isVideo || isAudio) {
                    // Download media to avoid Google Drive authentication issues in webview
                    localPath = await driveService.downloadFile(args.fileId, meta.name, { expectedSize: meta.size });
                    openedUrl = 'summer-media://' + encodeURIComponent(localPath);
                    await openInBrowser(openedUrl);
                    textResult = `Successfully opened ${fileType.toLowerCase()} "${meta.name}" in the browser panel.`;
                }

                // Show info card on overlay
                sendToRenderer('show-hud-widget', {
                    type: isVideo ? 'drive_video' : isAudio ? 'drive_audio' : isPdf ? 'drive_pdf' : 'drive_ppt',
                    data: {
                        title: meta.name,
                        fileType,
                        mimeType,
                        path: localPath,
                        url: openedUrl,
                        previewUrl,
                        webViewLink: meta.webViewLink
                    }
                });

                // For PDFs, also try to extract text silently for Q&A context
                if (isPdf) {
                    try {
                        const localPdfPath = await driveService.downloadFile(args.fileId, meta.name, { expectedSize: meta.size });
                        const fs = require('fs');
                        const pdfParse = require('pdf-parse');
                        const dataBuffer = fs.readFileSync(localPdfPath);
                        const pdfData = await pdfParse(dataBuffer);
                        textResult += `\n\nCRITICAL INSTRUCTION: DO NOT read the PDF text out loud! The user is already reading it on their screen. Just say "I have opened the PDF for you."\n\n[Silent Context - PDF Content (first 1500 chars)]:\n${pdfData.text.substring(0, 1500)}...`;
                    } catch (e) {
                        // PDF text extraction is optional — preview still works
                    }
                }

                return textResult;

            } else {
                // Unknown/unsupported type — show generic file card
                sendToRenderer('show-hud-widget', {
                    type: 'file_viewer',
                    data: { filename: meta.name, metadata: `Type: ${mimeType}`, webViewLink: meta.webViewLink }
                });
                return `Displayed a generic file viewer for "${meta.name}". Link: ${meta.webViewLink}`;
            }
        } catch (e) {
            return `Failed to read file from Drive: ${e.message}`;
        }
    },
    google_drive_delete: async (args) => {
        try {
            return await driveService.deleteFile(args.fileId);
        } catch (e) {
            return `Failed to delete file from Drive: ${e.message}`;
        }
    },
    google_sheet_read: async (args) => {
        try {
            const result = await driveService.readSheetRange(args.spreadsheetId, args.range);
            if (typeof result === 'string') return result;
            sendToRenderer('show-hud-widget', {
                type: 'sheet-data',
                data: { title: `Sheet Data: ${args.range}`, rows: result.rawData }
            });
            return `Successfully read sheet and displayed on screen.\n\nRaw Text Summary:\n${result.textSummary}`;
        } catch (e) {
            return `Sheet read failed: ${e.message}`;
        }
    },
    google_sheet_append: async (args) => {
        try {
            return await driveService.appendSheetData(args.spreadsheetId, args.range, args.values);
        } catch (e) {
            return `Sheet append failed: ${e.message}`;
        }
    },
    google_youtube_play: async (args) => {
        try {
            let videoId = null;
            let textSummary = '';

            const urlMatch = args.query.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);

            if (urlMatch && urlMatch[1]) {
                videoId = urlMatch[1];
                textSummary = `Direct URL parsed. Video ID: ${videoId}`;
            } else {
                const result = await youtubeService.searchYouTube(args.query);
                if (typeof result === 'string') return result;
                videoId = result.topVideoId;
                textSummary = result.textSummary;
            }

            executeInRenderer(`
                const layout = document.getElementById('appLayout');
                if (layout) {
                    layout.classList.remove('browser-hidden');
                    if (typeof navigateBrowser === 'function') {
                        navigateBrowser('https://www.youtube.com/watch?v=${videoId}');
                    }
                }
            `);
            return `Successfully opened YouTube video in the built-in browser panel. Summary: ${textSummary}`;
        } catch (e) {
            return `YouTube play failed: ${e.message}`;
        }
    },
    google_maps_find_place: async (args) => {
        try {
            const result = await mapsService.findPlace(args.query);
            if (typeof result === 'string') return result;

            executeInRenderer(`
                const layout = document.getElementById('appLayout');
                if (layout) {
                    layout.classList.remove('browser-hidden');
                    if (typeof navigateBrowser === 'function') {
                        navigateBrowser('${result.mapUrl}');
                    }
                }
            `);
            return `Successfully opened interactive map in the built-in browser panel.\n\nDetails:\n${result.textSummary}`;
        } catch (e) {
            return `Maps API failed: ${e.message}`;
        }
    }
};

module.exports = {
    declarations,
    handlers
};

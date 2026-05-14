const { google } = require('googleapis');
const { getClient, isAuthenticated } = require('../auth/google-auth');

function maskSensitiveInfo(subject, snippet) {
    const textToScan = (subject + " " + (snippet || "")).toLowerCase();
    const sensitiveKeywords = ['otp', 'password', 'verification code', 'verify', 'credentials', 'login', 'sign in', 'security alert', 'auth'];
    
    for (const kw of sensitiveKeywords) {
        if (textToScan.includes(kw)) {
            return {
                subject: "*** MASKED SECURITY EMAIL ***",
                snippet: "This email contains sensitive authentication or credential information and has been redacted for your security."
            };
        }
    }
    return { subject, snippet };
}

async function getUnreadEmails(maxResults = 5) {
    if (!(await isAuthenticated())) throw new Error("Gmail not connected.");
    const gmail = google.gmail({ version: 'v1', auth: getClient() });

    const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread',
        maxResults
    });

    const messages = res.data.messages;
    if (!messages || messages.length === 0) return "No unread emails found.";

    let resultStr = "UNREAD EMAILS:\n";
    for (const msg of messages) {
        const msgData = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date']
        });
        const headers = msgData.data.payload.headers;
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
        const rawSubject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        const date = headers.find(h => h.name === 'Date')?.value || 'Unknown Date';
        const rawSnippet = msgData.data.snippet || '';
        
        const { subject, snippet } = maskSensitiveInfo(rawSubject, rawSnippet);
        
        resultStr += `- From: ${from} | Subject: ${subject} | Date: ${date} | ID: ${msg.id}\n  Snippet: ${snippet}\n`;
    }
    return resultStr;
}

async function searchEmails(query, maxResults = 10) {
    if (!(await isAuthenticated())) throw new Error("Gmail not connected.");
    const gmail = google.gmail({ version: 'v1', auth: getClient() });

    const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults
    });

    const messages = res.data.messages;
    if (!messages || messages.length === 0) return `No emails found for query: ${query}`;

    let resultStr = `SEARCH RESULTS (${query}):\n`;
    for (const msg of messages) {
        const msgData = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date']
        });
        const headers = msgData.data.payload.headers;
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
        const rawSubject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        const date = headers.find(h => h.name === 'Date')?.value || 'Unknown Date';
        const rawSnippet = msgData.data.snippet || '';
        
        const { subject, snippet } = maskSensitiveInfo(rawSubject, rawSnippet);
        
        resultStr += `- ID: ${msg.id} | From: ${from} | Subject: ${subject}\n`;
    }
    return resultStr;
}

async function trashEmail(messageId) {
    if (!(await isAuthenticated())) throw new Error("Gmail not connected.");
    const gmail = google.gmail({ version: 'v1', auth: getClient() });
    await gmail.users.messages.trash({
        userId: 'me',
        id: messageId
    });
    return `Successfully moved email ${messageId} to trash.`;
}

async function archiveEmail(messageId) {
    if (!(await isAuthenticated())) throw new Error("Gmail not connected.");
    const gmail = google.gmail({ version: 'v1', auth: getClient() });
    await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
            removeLabelIds: ['INBOX']
        }
    });
    return `Successfully archived email ${messageId}.`;
}

async function sendEmail(to, subject, bodyText) {
    if (!(await isAuthenticated())) throw new Error("Gmail not connected.");
    const gmail = google.gmail({ version: 'v1', auth: getClient() });

    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
        `To: ${to}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${utf8Subject}`,
        '',
        bodyText,
    ];
    const message = messageParts.join('\n');

    const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
            raw: encodedMessage,
        },
    });

    return `Email successfully sent to ${to} (Message ID: ${res.data.id})`;
}

/**
 * NEW: Fetches the full HTML body of an email to be rendered on screen.
 */
async function getEmailHtml(messageId) {
    if (!(await isAuthenticated())) throw new Error("Gmail not connected.");
    const gmail = google.gmail({ version: 'v1', auth: getClient() });
    
    const msgData = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
    });

    const payload = msgData.data.payload;
    let htmlBody = '';

    function extractHtml(part) {
        if (part.mimeType === 'text/html' && part.body.data) {
            htmlBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
        } else if (part.parts) {
            for (const p of part.parts) extractHtml(p);
        }
    }
    
    extractHtml(payload);
    
    if (!htmlBody) {
        if (payload.body && payload.body.data) {
             htmlBody = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        } else {
             htmlBody = "<p>No HTML content found for this email.</p>";
        }
    }
    
    return htmlBody;
}

module.exports = {
    getUnreadEmails,
    searchEmails,
    trashEmail,
    archiveEmail,
    sendEmail,
    getEmailHtml
};

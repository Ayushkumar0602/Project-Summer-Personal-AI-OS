const { google } = require('googleapis');
const { getClient, isAuthenticated, getAllAccountIds, getAccountInfo } = require('../auth/google-auth');

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

/**
 * Helper: get a Gmail API instance for a specific account or primary.
 */
function _getGmail(accountId) {
    return google.gmail({ version: 'v1', auth: getClient(accountId) });
}

/**
 * Helper: get account label string for multi-account results.
 */
function _accountLabel(accountId) {
    if (!accountId) return '';
    const info = getAccountInfo(accountId);
    return info ? `[${info.email}] ` : '';
}

async function getUnreadEmails(maxResults = 5, accountId = null) {
    if (!(await isAuthenticated(accountId))) throw new Error("Gmail not connected.");
    const gmail = _getGmail(accountId);

    const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread',
        maxResults
    });

    const messages = res.data.messages;
    if (!messages || messages.length === 0) return "No unread emails found.";

    const label = _accountLabel(accountId);
    let resultStr = `UNREAD EMAILS${label ? ' — ' + label.trim() : ''}:\n`;
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
        
        resultStr += `- ${label}From: ${from} | Subject: ${subject} | Date: ${date} | ID: ${msg.id}\n  Snippet: ${snippet}\n`;
    }
    return resultStr;
}

/**
 * Fetches unread emails across ALL connected Google accounts.
 */
async function getUnreadEmailsAllAccounts(maxResults = 5) {
    const accountIds = getAllAccountIds();
    if (accountIds.length === 0) return "No Google accounts connected.";

    let allResults = `UNREAD EMAILS — ALL ACCOUNTS (${accountIds.length} accounts):\n\n`;
    
    for (const accountId of accountIds) {
        try {
            const result = await getUnreadEmails(maxResults, accountId);
            allResults += result + '\n';
        } catch (e) {
            const info = getAccountInfo(accountId);
            allResults += `[${info?.email || accountId}] Error: ${e.message}\n`;
        }
    }

    return allResults;
}

async function searchEmails(query, maxResults = 10, accountId = null) {
    if (!(await isAuthenticated(accountId))) throw new Error("Gmail not connected.");
    const gmail = _getGmail(accountId);

    const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults
    });

    const messages = res.data.messages;
    if (!messages || messages.length === 0) return `No emails found for query: ${query}`;

    const label = _accountLabel(accountId);
    let resultStr = `SEARCH RESULTS (${query})${label ? ' — ' + label.trim() : ''}:\n`;
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
        
        resultStr += `- ${label}ID: ${msg.id} | From: ${from} | Subject: ${subject}\n`;
    }
    return resultStr;
}

/**
 * Searches emails across ALL connected Google accounts.
 */
async function searchEmailsAllAccounts(query, maxResults = 10) {
    const accountIds = getAllAccountIds();
    if (accountIds.length === 0) return "No Google accounts connected.";

    let allResults = `SEARCH RESULTS (${query}) — ALL ACCOUNTS (${accountIds.length} accounts):\n\n`;
    
    for (const accountId of accountIds) {
        try {
            const result = await searchEmails(query, maxResults, accountId);
            allResults += result + '\n';
        } catch (e) {
            const info = getAccountInfo(accountId);
            allResults += `[${info?.email || accountId}] Error: ${e.message}\n`;
        }
    }

    return allResults;
}

async function trashEmail(messageId, accountId = null) {
    if (!(await isAuthenticated(accountId))) throw new Error("Gmail not connected.");
    const gmail = _getGmail(accountId);
    await gmail.users.messages.trash({
        userId: 'me',
        id: messageId
    });
    return `Successfully moved email ${messageId} to trash.`;
}

async function archiveEmail(messageId, accountId = null) {
    if (!(await isAuthenticated(accountId))) throw new Error("Gmail not connected.");
    const gmail = _getGmail(accountId);
    await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
            removeLabelIds: ['INBOX']
        }
    });
    return `Successfully archived email ${messageId}.`;
}

async function sendEmail(to, subject, bodyText, accountId = null) {
    if (!(await isAuthenticated(accountId))) throw new Error("Gmail not connected.");
    const gmail = _getGmail(accountId);

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

    const label = _accountLabel(accountId);
    return `${label}Email successfully sent to ${to} (Message ID: ${res.data.id})`;
}

/**
 * Fetches the full HTML body of an email to be rendered on screen.
 */
async function getEmailHtml(messageId, accountId = null) {
    if (!(await isAuthenticated(accountId))) throw new Error("Gmail not connected.");
    const gmail = _getGmail(accountId);
    
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
    getUnreadEmailsAllAccounts,
    searchEmails,
    searchEmailsAllAccounts,
    trashEmail,
    archiveEmail,
    sendEmail,
    getEmailHtml
};

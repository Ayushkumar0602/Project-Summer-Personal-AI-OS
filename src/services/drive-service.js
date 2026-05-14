const { google } = require('googleapis');
const { getClient, isAuthenticated } = require('../auth/google-auth');

/**
 * Searches Google Drive for files matching a query.
 * Example queries: "name contains 'budget'", "mimeType='application/vnd.google-apps.spreadsheet'"
 */
async function searchFiles(query, maxResults = 10) {
    if (!(await isAuthenticated())) throw new Error("Google Drive not connected.");
    const drive = google.drive({ version: 'v3', auth: getClient() });

    const res = await drive.files.list({
        q: query,
        pageSize: maxResults,
        fields: 'files(id, name, mimeType, webViewLink, createdTime)'
    });

    const files = res.data.files;
    if (!files || files.length === 0) return `No files found for query: ${query}`;

    let resultStr = `DRIVE SEARCH RESULTS:\n`;
    files.forEach(f => {
        resultStr += `- ID: ${f.id} | Name: "${f.name}" | Type: ${f.mimeType} | Link: ${f.webViewLink}\n`;
    });
    return resultStr;
}

/**
 * Creates a new file in Google Drive.
 * type: 'doc' or 'sheet'
 */
async function createFile(title, type = 'doc') {
    if (!(await isAuthenticated())) throw new Error("Google Drive not connected.");
    const drive = google.drive({ version: 'v3', auth: getClient() });

    const mimeType = type === 'sheet' 
        ? 'application/vnd.google-apps.spreadsheet'
        : 'application/vnd.google-apps.document';

    const res = await drive.files.create({
        requestBody: {
            name: title,
            mimeType: mimeType
        },
        fields: 'id, name, webViewLink'
    });

    return `Successfully created ${type}: "${res.data.name}". ID: ${res.data.id}. Link: ${res.data.webViewLink}`;
}

/**
 * Reads a range of data from a Google Sheet.
 * spreadsheetId: ID of the sheet
 * range: A1 notation, e.g., 'Sheet1!A1:D10'
 */
async function readSheetRange(spreadsheetId, range) {
    if (!(await isAuthenticated())) throw new Error("Google Sheets not connected.");
    const sheets = google.sheets({ version: 'v4', auth: getClient() });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) {
        return 'No data found in the specified range.';
    }

    // Format as a simple markdown table string
    let resultStr = `SHEET DATA (${range}):\n`;
    rows.forEach(row => {
        resultStr += `| ${row.join(' | ')} |\n`;
    });
    
    // Also return raw data for HUD if needed
    return {
        textSummary: resultStr,
        rawData: rows
    };
}

/**
 * Writes a row of data to a Google Sheet (Appends to the bottom of the range).
 * spreadsheetId: ID of the sheet
 * range: A1 notation, e.g., 'Sheet1!A1'
 * values: Array of Arrays (e.g., [['John', 'Doe', '25']])
 */
async function appendSheetData(spreadsheetId, range, values) {
    if (!(await isAuthenticated())) throw new Error("Google Sheets not connected.");
    const sheets = google.sheets({ version: 'v4', auth: getClient() });

    const res = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: values
        }
    });

    return `Successfully appended data to ${range}. Updated ${res.data.updates.updatedCells} cells.`;
}

module.exports = {
    searchFiles,
    createFile,
    readSheetRange,
    appendSheetData
};

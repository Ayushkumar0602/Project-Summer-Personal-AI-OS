const { google } = require('googleapis');
const { getClient, isAuthenticated } = require('../auth/google-auth');
const fs = require('node:fs');
const path = require('node:path');
const Paths = require('../core/utils/paths');

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
 * Uploads a local file to Google Drive and optionally deletes it locally.
 * Solves "Storage Costs & Bloat" (Problem C) for cloud architecture.
 */
async function uploadFile(filePath, mimeType, deleteAfter = true) {
    if (!(await isAuthenticated())) throw new Error("Google Drive not connected.");
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const drive = google.drive({ version: 'v3', auth: getClient() });
    const fileName = path.basename(filePath);

    try {
        const res = await drive.files.create({
            requestBody: { name: fileName, mimeType },
            media: { mimeType, body: fs.createReadStream(filePath) },
            fields: 'id, name, webViewLink'
        });

        if (deleteAfter) {
            try { fs.unlinkSync(filePath); } catch(e) {}
        }

        return {
            id: res.data.id,
            name: res.data.name,
            url: res.data.webViewLink,
            status: 'success'
        };
    } catch (e) {
        throw new Error(`Google Drive upload failed: ${e.message}`);
    }
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

/**
 * Gets metadata for a specific file in Google Drive.
 */
async function getFileMetadata(fileId) {
    if (!(await isAuthenticated())) throw new Error("Google Drive not connected.");
    const drive = google.drive({ version: 'v3', auth: getClient() });

    const res = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, webViewLink, webContentLink, thumbnailLink, size'
    });

    return res.data;
}

/**
 * Downloads a file from Google Drive to a local temporary cache.
 * Uses the media download approach.
 */
async function downloadFile(fileId, fileName, options = {}) {
    if (!(await isAuthenticated())) throw new Error("Google Drive not connected.");
    const drive = google.drive({ version: 'v3', auth: getClient() });

    const tempDir = path.join(Paths.userData(), 'drive-cache');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const safeFileId = String(fileId || 'drive').replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const safeBaseName = fileName ? fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_') : 'file';
    const safeName = `${safeFileId}_${safeBaseName}`;
    const destPath = path.join(tempDir, safeName);
    const tempPath = `${destPath}.download`;
    const expectedSize = Number(options.expectedSize || 0);

    if (fs.existsSync(destPath)) {
        const stat = fs.statSync(destPath);
        if (stat.size > 0 && (!expectedSize || stat.size === expectedSize)) {
            return destPath;
        }
    }

    return new Promise(async (resolve, reject) => {
        const fail = (err) => {
            try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
            reject(err);
        };

        try {
            const res = await drive.files.get(
                { fileId, alt: 'media' },
                { responseType: 'stream' }
            );

            const dest = fs.createWriteStream(tempPath);
            dest.on('finish', () => {
                try {
                    fs.renameSync(tempPath, destPath);
                    resolve(destPath);
                } catch (err) {
                    fail(err);
                }
            });
            dest.on('error', fail);
            res.data
                .on('error', fail)
                .pipe(dest);
        } catch (err) {
            fail(new Error(`Download failed: ${err.message}`));
        }
    });
}

/**
 * Deletes a file from Google Drive.
 */
async function deleteFile(fileId) {
    if (!(await isAuthenticated())) throw new Error("Google Drive not connected.");
    const drive = google.drive({ version: 'v3', auth: getClient() });

    await drive.files.delete({ fileId });
    return `Successfully deleted file with ID: ${fileId}`;
}

module.exports = {
    searchFiles,
    createFile,
    uploadFile,
    readSheetRange,
    appendSheetData,
    getFileMetadata,
    downloadFile,
    deleteFile
};

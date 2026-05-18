const { GoogleGenAI } = require('@google/genai');
const path = require('path');
const fs   = require('fs');
const Paths = require('../core/utils/paths');
const { withMemoryApiKey } = require('./memory-api-key');

const DIARY_DIR = path.join(Paths.userData(), 'session-diary');

const DIARY_PROMPT = `You are a personal memory assistant for an AI called Summer.
A voice conversation just ended. Your job is to write a concise, natural "diary entry" summarizing what was learned or discussed.

RULES:
1. Write in third-person about the user (e.g. "Ayush mentioned..." or "The user discussed...")
2. Focus ONLY on new facts, decisions, or meaningful topics — skip small talk
3. Include any personal details shared (projects, plans, feelings, skills mentioned)
4. Keep it under 150 words — dense with facts, not narrative fluff
5. If nothing meaningful happened, write exactly: "No significant facts learned."

OUTPUT FORMAT: Plain text only. No bullet points, no headers. 2-4 sentences.`;

/**
 * Generates a short diary-entry summary of a conversation session.
 * @param {string} transcriptText - The full session transcript
 * @param {string} apiKey
 * @param {string} existingSummary - Optional, if continuing a past session
 * @returns {Promise<string>} The diary entry text
 */
async function summariseSession(transcriptText, apiKey, existingSummary = null) {
    let prompt = '';
    if (existingSummary) {
        prompt = `You are a personal memory assistant for an AI called Summer.
The user is continuing a past conversation. Below is the summary of that past conversation, followed by the transcript of the NEW continuation session.
Update the summary to incorporate the new facts, decisions, or meaningful topics discussed. Keep the overall summary under 200 words.

PAST SUMMARY:
${existingSummary}

NEW CONTINUATION TRANSCRIPT:
${transcriptText.slice(0, 12000)}`;
    } else {
        prompt = DIARY_PROMPT + '\n\nCONVERSATION TRANSCRIPT:\n' + transcriptText.slice(0, 12000);
    }

    return await withMemoryApiKey(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite-preview',
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 300
            }
        });
        return response.candidates[0].content.parts[0].text.trim();
    });
}

/**
 * Appends a diary entry to the session diary JSON file.
 * @param {string} entry - The diary entry text
 * @param {number} replaceTimestamp - Optional, the timestamp of the entry being updated
 */
function appendDiaryEntry(entry, replaceTimestamp = null) {
    try {
        if (!fs.existsSync(DIARY_DIR)) fs.mkdirSync(DIARY_DIR, { recursive: true });

        const DIARY_PATH = path.join(DIARY_DIR, 'diary.json');
        let diary = [];

        if (fs.existsSync(DIARY_PATH)) {
            try { diary = JSON.parse(fs.readFileSync(DIARY_PATH, 'utf-8')); }
            catch { diary = []; }
        }

        if (replaceTimestamp) {
            diary = diary.filter(d => d.timestamp !== replaceTimestamp);
        }

        diary.push({
            timestamp: Date.now(),
            date: new Date().toLocaleString(),
            entry,
            originalTimestamp: replaceTimestamp || undefined
        });

        // Sort descending by timestamp
        diary.sort((a, b) => b.timestamp - a.timestamp);

        // Keep last 365 entries
        if (diary.length > 365) diary = diary.slice(0, 365);

        fs.writeFileSync(DIARY_PATH, JSON.stringify(diary, null, 2), 'utf-8');
        console.log(`[Diary] Entry saved (${entry.length} chars).`);
        return { success: true, path: DIARY_PATH };
    } catch (e) {
        console.error('[Diary] Failed to save entry:', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * Loads all diary entries.
 * @returns {Array<{timestamp: number, date: string, entry: string}>}
 */
function loadDiary() {
    try {
        const DIARY_PATH = path.join(DIARY_DIR, 'diary.json');
        if (!fs.existsSync(DIARY_PATH)) return [];
        const raw = fs.readFileSync(DIARY_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

module.exports = { summariseSession, appendDiaryEntry, loadDiary };

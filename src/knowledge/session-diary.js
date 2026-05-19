const { GoogleGenAI } = require('@google/genai');
const path = require('path');
const fs   = require('fs');
const Paths = require('../core/utils/paths');
const { withMemoryApiKey } = require('./memory-api-key');
const { supabase } = require('../services/supabase-client');

const DIARY_DIR = path.join(Paths.userData(), 'session-diary');
const DIARY_PATH = path.join(DIARY_DIR, 'diary.json');
const TABLE_DIARY = 'memory_diary';

let memoryDiaryCache = null;

async function initDiaryStore() {
    if (memoryDiaryCache) return memoryDiaryCache;
    
    if (supabase) {
        try {
            console.log('[DiaryStore] Fetching diary from Supabase...');
            const { data } = await supabase.from(TABLE_DIARY).select('*').order('timestamp', { ascending: false }).limit(365);
            memoryDiaryCache = data || [];
            
            if (memoryDiaryCache.length === 0 && fs.existsSync(DIARY_PATH)) {
                try {
                    const localData = JSON.parse(fs.readFileSync(DIARY_PATH, 'utf-8'));
                    if (localData.length > 0) {
                        console.log('[DiaryStore] Cloud is empty but local has data. Pushing local to cloud...');
                        memoryDiaryCache = localData;
                        await supabase.from(TABLE_DIARY).upsert(localData);
                    }
                } catch(e) {}
            }
            
            if (!fs.existsSync(DIARY_DIR)) fs.mkdirSync(DIARY_DIR, { recursive: true });
            fs.writeFileSync(DIARY_PATH, JSON.stringify(memoryDiaryCache, null, 2), 'utf-8');
            return memoryDiaryCache;
        } catch (e) {
            console.error('[DiaryStore] Supabase fetch failed:', e.message);
        }
    }
    
    try {
        if (fs.existsSync(DIARY_PATH)) {
            memoryDiaryCache = JSON.parse(fs.readFileSync(DIARY_PATH, 'utf-8'));
        } else {
            memoryDiaryCache = [];
        }
    } catch {
        memoryDiaryCache = [];
    }

    try {
        fs.watch(DIARY_PATH, (eventType) => {
            if (eventType === 'change') {
                console.log('[DiaryStore] Local diary file changed. Reloading cache...');
                try {
                    const raw = fs.readFileSync(DIARY_PATH, 'utf-8');
                    memoryDiaryCache = JSON.parse(raw);
                } catch(e) {}
            }
        });
    } catch(e) {}

    return memoryDiaryCache;
}

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
        if (!memoryDiaryCache) loadDiary(); // force load from disk if cache is null

        if (replaceTimestamp) {
            memoryDiaryCache = memoryDiaryCache.filter(d => d.timestamp !== replaceTimestamp);
        }

        const newEntry = {
            timestamp: Date.now(),
            date: new Date().toLocaleString(),
            entry,
            originalTimestamp: replaceTimestamp || null
        };

        memoryDiaryCache.push(newEntry);
        memoryDiaryCache.sort((a, b) => b.timestamp - a.timestamp);
        if (memoryDiaryCache.length > 365) memoryDiaryCache = memoryDiaryCache.slice(0, 365);

        if (!fs.existsSync(DIARY_DIR)) fs.mkdirSync(DIARY_DIR, { recursive: true });
        fs.writeFileSync(DIARY_PATH, JSON.stringify(memoryDiaryCache, null, 2), 'utf-8');
        console.log(`[Diary] Entry saved (${entry.length} chars).`);

        if (supabase) {
            supabase.from(TABLE_DIARY).upsert(newEntry).then(() => {
                if (replaceTimestamp) supabase.from(TABLE_DIARY).delete().eq('timestamp', replaceTimestamp).then();
                console.log('[DiaryStore] Synced to Supabase.');
            }).catch(e => console.error('[DiaryStore] Supabase sync failed:', e.message));
        }

        return { success: true, path: DIARY_PATH };
    } catch (e) {
        console.error('[Diary] Failed to save entry:', e.message);
        return { success: false, error: e.message };
    }
}

function loadDiary() {
    if (!memoryDiaryCache) {
        try {
            if (fs.existsSync(DIARY_PATH)) {
                memoryDiaryCache = JSON.parse(fs.readFileSync(DIARY_PATH, 'utf-8'));
            } else {
                memoryDiaryCache = [];
            }
        } catch {
            memoryDiaryCache = [];
        }
    }
    return memoryDiaryCache;
}

module.exports = { initDiaryStore, summariseSession, appendDiaryEntry, loadDiary };

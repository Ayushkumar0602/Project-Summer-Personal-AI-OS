const { GoogleGenAI } = require('@google/genai');
const path = require('path');
const fs   = require('fs');
const Paths = require('../core/utils/paths');
const { withMemoryApiKey } = require('./memory-api-key');
const { supabase } = require('../services/supabase-client');
const { getSessionLocation } = require('./location-tagger');

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
6. On the VERY LAST LINE, add a mood tag in this exact format:
MOOD: <one of: happy|stressed|frustrated|excited|neutral|focused|sad|curious|casual>

OUTPUT FORMAT: Plain text diary entry (2-4 sentences), then a blank line, then the MOOD line.`;

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
            model: 'gemini-flash-latest',
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 400
            }
        });
        const rawText = response.candidates[0].content.parts[0].text.trim();

        // Parse mood from last line (MOOD: excited)
        const lines = rawText.split('\n');
        const moodLine = lines.find(l => l.trim().toUpperCase().startsWith('MOOD:'));
        let emotion = 'neutral';
        if (moodLine) {
            emotion = moodLine.replace(/^MOOD:\s*/i, '').trim().toLowerCase();
        }
        // Remove the MOOD line from the diary text
        const diaryText = lines.filter(l => !l.trim().toUpperCase().startsWith('MOOD:')).join('\n').trim();

        return { text: diaryText, emotion };
    });
}

/**
 * Appends a diary entry to the session diary JSON file.
 * @param {string} entry - The diary entry text
 * @param {number} replaceTimestamp - Optional, the timestamp of the entry being updated
 */
function appendDiaryEntry(entry, replaceTimestamp = null, emotion = null, location = null) {
    try {
        if (!memoryDiaryCache) loadDiary(); // force load from disk if cache is null

        if (replaceTimestamp) {
            memoryDiaryCache = memoryDiaryCache.filter(d => d.timestamp !== replaceTimestamp);
        }

        const now = Date.now();
        const newEntry = {
            id: `diary_${now}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp: now,
            date: new Date().toLocaleString(),
            entry,
            emotion: emotion || null,
            location: location || null,
            originalTimestamp: replaceTimestamp || null
        };

        memoryDiaryCache.push(newEntry);
        memoryDiaryCache.sort((a, b) => b.timestamp - a.timestamp);
        if (memoryDiaryCache.length > 365) memoryDiaryCache = memoryDiaryCache.slice(0, 365);

        if (!fs.existsSync(DIARY_DIR)) fs.mkdirSync(DIARY_DIR, { recursive: true });
        fs.writeFileSync(DIARY_PATH, JSON.stringify(memoryDiaryCache, null, 2), 'utf-8');
        console.log(`[Diary] Entry saved locally (${entry.length} chars).`);

        // Sync to Supabase — fire-and-forget with proper error logging
        if (supabase) {
            (async () => {
                try {
                    // Delete the old entry first if we're replacing
                    if (replaceTimestamp) {
                        const { error: delErr } = await supabase
                            .from(TABLE_DIARY)
                            .delete()
                            .eq('timestamp', replaceTimestamp);
                        if (delErr) console.warn('[DiaryStore] Delete old entry failed:', delErr.message);
                    }

                    // Only send columns that exist in the Supabase table.
                    // Local-only fields (emotion, location, originalTimestamp)
                    // are kept in the JSON file but NOT sent to Supabase.
                    const supabaseRow = {
                        id:        newEntry.id,
                        timestamp: newEntry.timestamp,
                        date:      newEntry.date,
                        entry:     newEntry.entry,
                    };

                    const { error: insertErr } = await supabase
                        .from(TABLE_DIARY)
                        .upsert(supabaseRow, { onConflict: 'id' });

                    if (insertErr) {
                        console.error('[DiaryStore] ❌ Supabase insert FAILED:', insertErr.message, insertErr.details || '');
                    } else {
                        console.log('[DiaryStore] ✅ Synced to Supabase successfully.');
                    }
                } catch (e) {
                    console.error('[DiaryStore] ❌ Supabase sync exception:', e.message);
                }
            })();
        }

        return { success: true, path: DIARY_PATH };
    } catch (e) {
        console.error('[Diary] Failed to save entry:', e.message);
        return { success: false, error: e.message };
    }
}

function loadDiary() {
    try {
        if (fs.existsSync(DIARY_PATH)) {
            memoryDiaryCache = JSON.parse(fs.readFileSync(DIARY_PATH, 'utf-8'));
        } else if (!memoryDiaryCache) {
            memoryDiaryCache = [];
        }
    } catch {
        if (!memoryDiaryCache) memoryDiaryCache = [];
    }
    return memoryDiaryCache;
}

module.exports = { initDiaryStore, summariseSession, appendDiaryEntry, loadDiary, getSessionLocation };

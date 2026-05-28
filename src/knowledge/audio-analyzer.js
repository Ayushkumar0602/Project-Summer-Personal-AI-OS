/**
 * audio-analyzer.js — Summer's Audio Memory Engine
 *
 * The audio counterpart to image-analyzer.js. Handles:
 *   1. Audio file storage and deduplication
 *   2. Transcription via Gemini multimodal (audio understanding)
 *   3. Fact/topic extraction from transcripts
 *   4. Speaker count detection
 *   5. Graph node creation (type: AudioMemory)
 *   6. Graph integration (connects audio nodes to existing knowledge)
 *
 * AudioMemory nodes contain:
 *   - transcript: Full text transcription
 *   - audioPath: Filename in audio-store/
 *   - durationSec: Approximate duration
 *   - speakerCount: Number of distinct speakers detected
 *   - tags: Auto-generated topic tags
 */

const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
const { withMemoryApiKey } = require('./memory-api-key');
const {
    AUDIO_STORE,
    ensureAudioStore,
    computeAudioHash,
    convertAudioFormat,
    uploadToCloud,
    getAudioMimeType
} = require('./audio-store');

// Maximum audio file size for Gemini (25MB)
const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Build the audio analysis prompt.
 * Asks Gemini to transcribe + extract structured data from audio.
 */
function buildAudioPrompt() {
    return `You are analyzing an audio file from a personal AI assistant called Summer.
Your job is to transcribe the audio and extract structured information.

Analyze this audio carefully. Return ONLY valid JSON (no markdown, no code fences):
{
  "transcript": "Full transcription of everything said in the audio. Include all words, even filler words. If multiple speakers, prefix with Speaker 1:, Speaker 2:, etc.",
  "summary": "A concise 2-3 sentence summary of what this audio contains",
  "suggestedLabel": "A short descriptive title (max 8 words)",
  "topics": ["list", "of", "main", "topics", "discussed"],
  "suggestedTags": ["#tag1", "#tag2", "#tag3"],
  "speakerCount": 1,
  "estimatedDurationSec": 30,
  "language": "en",
  "mood": "neutral/excited/stressed/happy/focused/casual",
  "keyFacts": ["List of key facts, decisions, or action items mentioned"],
  "isMusic": false
}

Tag generation guidelines:
- Topic tags: #coding, #startup, #study, #meeting, #brainstorm, #idea, #debug
- Context tags: #voice_note, #lecture, #conversation, #reminder
- Mood tags: #focused, #excited, #casual

If the audio is primarily music or non-speech, set isMusic: true and provide minimal analysis.
Return ONLY the JSON object. No extra text.`;
}

/**
 * Analyzes and stores a single audio file.
 * Creates an AudioMemory node for the knowledge graph.
 *
 * @param {Object} file - { name, type, buffer (Uint8Array) }
 * @returns {Promise<{ node, edges, analysis, filename, deduplicated }>}
 */
async function analyzeAndStoreAudio(file) {
    // 1. Ensure audio-store directory exists
    ensureAudioStore();

    // 2. Compute hash for deduplication
    const rawBuffer = Buffer.from(file.buffer);
    const hash = computeAudioHash(rawBuffer);

    // 3. Check for duplicates
    const existing = findExistingByHash(hash);
    if (existing) {
        console.log(`[AudioMemory] Audio already in store (hash: ${hash}), skipping re-analysis.`);
        return { node: existing, edges: [], analysis: null, deduplicated: true };
    }

    // 4. Check file size
    if (rawBuffer.length > MAX_AUDIO_SIZE_BYTES) {
        console.warn(`[AudioMemory] Audio file too large (${(rawBuffer.length / 1024 / 1024).toFixed(1)}MB). Max: 25MB.`);
        // Create a basic node without full analysis
        return createFallbackNode(file, hash, 'Audio file too large for analysis (>25MB)');
    }

    // 5. Write raw file to audio-store
    let ext = path.extname(file.name || '').toLowerCase() || '.mp3';
    let filename = `audio_${Date.now()}_${hash}${ext}`;
    let destPath = path.join(AUDIO_STORE, filename);
    fs.writeFileSync(destPath, rawBuffer);

    // 6. Convert to compatible format if needed
    const converted = convertAudioFormat(destPath);
    if (converted !== destPath) {
        filename = path.basename(converted);
        destPath = converted;
        ext = path.extname(converted).toLowerCase();
    }
    console.log(`[AudioMemory] Stored audio: ${filename} (${(rawBuffer.length / 1024).toFixed(0)}KB)`);

    // 7. Analyze with Gemini multimodal audio
    const base64 = fs.readFileSync(destPath).toString('base64');
    const mimeType = getAudioMimeType(filename);

    let analysis = null;
    try {
        const prompt = buildAudioPrompt();
        analysis = await withMemoryApiKey(async (key) => {
            const ai = new GoogleGenAI({ apiKey: key });
            const response = await ai.models.generateContent({
                model: 'gemini-3.1-flash',
                contents: [{
                    parts: [
                        { inlineData: { mimeType, data: base64 } },
                        { text: prompt }
                    ]
                }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
            });
            let rawText = response.candidates[0].content.parts[0].text.trim();
            rawText = rawText.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
            return JSON.parse(rawText);
        });
        console.log(`[AudioMemory] Analysis complete: "${analysis.suggestedLabel}" | Speakers: ${analysis.speakerCount} | Mood: ${analysis.mood}`);
    } catch (err) {
        console.error(`[AudioMemory] Gemini audio analysis error:`, err.message);
        analysis = {
            transcript: '',
            summary: `Audio uploaded: ${file.name || filename}`,
            suggestedLabel: path.basename(file.name || filename, ext),
            topics: [],
            suggestedTags: ['#audio', '#uploaded'],
            speakerCount: 0,
            estimatedDurationSec: 0,
            language: 'unknown',
            mood: 'unknown',
            keyFacts: [],
            isMusic: false
        };
    }

    // 8. Upload to Supabase Storage (if available)
    const publicUrl = await uploadToCloud(filename, destPath);

    // 9. Build the AudioMemory node
    const nodeId = `audio_${Date.now()}_${hash.slice(0, 8)}`;
    const node = {
        id: nodeId,
        type: 'AudioMemory',
        label: analysis.suggestedLabel || path.basename(file.name || filename, ext),
        description: analysis.summary || '',
        audioPath: filename,
        publicUrl: publicUrl,
        audioHash: hash,
        transcript: analysis.transcript || '',
        durationSec: analysis.estimatedDurationSec || 0,
        speakerCount: analysis.speakerCount || 1,
        language: analysis.language || 'en',
        mood: analysis.mood || 'neutral',
        keyFacts: analysis.keyFacts || [],
        topics: analysis.topics || [],
        tags: analysis.suggestedTags || [],
        importance: analysis.isMusic ? 0.4 : 0.7,
        source: 'user_upload',
        createdAt: Date.now(),
        lastAccessedAt: Date.now()
    };

    // 10. Build edges
    const edges = [];

    // Link to user_self (audio is personal content)
    edges.push({
        from: nodeId,
        to: 'user_self',
        label: 'recorded_by',
        confidence: 0.9
    });

    // 11. Graph integration pass — connect to existing knowledge nodes
    try {
        const { loadGraph } = require('./graph-store');
        const currentGraph = loadGraph();
        const integrationEdges = await integrateAudioWithGraph(node, analysis, currentGraph);
        edges.push(...integrationEdges);
    } catch (e) {
        // Non-critical
    }

    console.log(`[AudioMemory] Node ready: ${nodeId} | "${node.label}" | Tags: ${node.tags.join(', ')}`);
    return { node, edges, analysis, filename, deduplicated: false };
}

/**
 * Connect audio node to existing knowledge graph nodes by topic overlap.
 */
async function integrateAudioWithGraph(node, analysis, existingGraph) {
    const textNodes = existingGraph.nodes.filter(n => n.type !== 'AudioMemory' && n.type !== 'ImageMemory');
    if (textNodes.length === 0) return [];

    // Find candidates by topic/tag intersection
    const audioTopics = [
        ...(node.topics || []),
        ...(node.tags || []).map(t => t.replace('#', ''))
    ].map(t => t.toLowerCase());

    if (audioTopics.length === 0) return [];

    const candidates = textNodes
        .filter(n => {
            const nTags = (n.tags || []).map(t => t.replace('#', '').toLowerCase());
            const nLabel = (n.label || '').toLowerCase();
            const nDesc = (n.description || '').toLowerCase();
            return audioTopics.some(t => nTags.includes(t) || nLabel.includes(t) || nDesc.includes(t));
        })
        .slice(0, 10);

    if (candidates.length === 0) return [];

    // Use Gemini to find meaningful connections
    const candidateStr = candidates.map(n =>
        `- ID: "${n.id}", Label: "${n.label}", Type: "${n.type}"`
    ).join('\n');

    const prompt = `Given this audio analysis:
Label: "${node.label}"
Summary: "${node.description}"
Topics: ${(node.topics || []).join(', ')}
Key Facts: ${(node.keyFacts || []).join('; ')}

And these existing knowledge graph nodes:
${candidateStr}

Which nodes does this audio meaningfully relate to?
Return ONLY valid JSON array (empty [] if none, max 3):
[
  { "to": "existing_node_id", "label": "discusses|mentions|related_to|about", "confidence": 0.85 }
]
Only include edges where confidence >= 0.75. Return ONLY the JSON array.`;

    try {
        const edges = await withMemoryApiKey(async (key) => {
            const ai = new GoogleGenAI({ apiKey: key });
            const response = await ai.models.generateContent({
                model: 'gemini-3.1-flash-lite',
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.05, maxOutputTokens: 512 }
            });
            let raw = response.candidates[0].content.parts[0].text.trim();
            raw = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
            return JSON.parse(raw);
        });

        if (Array.isArray(edges) && edges.length > 0) {
            const validEdges = edges
                .filter(e => e.to && e.label && (e.confidence || 0) >= 0.75)
                .filter(e => candidates.some(c => c.id === e.to))
                .map(e => ({ from: node.id, to: e.to, label: e.label, confidence: e.confidence }));

            if (validEdges.length > 0) {
                console.log(`[AudioMemory] Graph integration: ${validEdges.length} edge(s) found → ${validEdges.map(e => e.to).join(', ')}`);
            }
            return validEdges;
        }
    } catch (e) {
        console.warn(`[AudioMemory] Graph integration pass failed: ${e.message}`);
    }
    return [];
}

/**
 * Find an existing AudioMemory node by audio hash (deduplication).
 */
function findExistingByHash(hash) {
    try {
        const { loadGraph } = require('./graph-store');
        const graph = loadGraph();
        return graph.nodes.find(n => n.type === 'AudioMemory' && n.audioHash === hash) || null;
    } catch {
        return null;
    }
}

/**
 * Create a fallback node when full analysis isn't possible.
 */
function createFallbackNode(file, hash, reason) {
    const ext = path.extname(file.name || '').toLowerCase() || '.mp3';
    const nodeId = `audio_${Date.now()}_${hash.slice(0, 8)}`;
    const node = {
        id: nodeId,
        type: 'AudioMemory',
        label: path.basename(file.name || 'Audio File', ext),
        description: reason,
        audioPath: null,
        audioHash: hash,
        transcript: '',
        durationSec: 0,
        speakerCount: 0,
        mood: 'unknown',
        topics: [],
        tags: ['#audio'],
        importance: 0.4,
        source: 'user_upload',
        createdAt: Date.now(),
        lastAccessedAt: Date.now()
    };
    return { node, edges: [], analysis: null, filename: null, deduplicated: false };
}

/**
 * Find AudioMemory nodes matching keywords (for search/recall).
 * Mirrors findMatchingImageNodes from image-analyzer.js.
 */
function findMatchingAudioNodes(keywords, graph, maxResults = 4) {
    if (!keywords || keywords.length === 0) return [];
    const kws = keywords.map(k => k.toLowerCase().trim()).filter(k => k.length > 2);
    if (kws.length === 0) return [];

    const audioNodes = (graph.nodes || []).filter(n => n.type === 'AudioMemory');
    if (audioNodes.length === 0) return [];

    const scored = audioNodes.map(node => {
        let score = 0;
        for (const kw of kws) {
            if ((node.label || '').toLowerCase().includes(kw)) score += 30;
            if ((node.transcript || '').toLowerCase().includes(kw)) score += 25;
            if ((node.topics || []).some(t => t.toLowerCase().includes(kw))) score += 20;
            if ((node.tags || []).some(t => t.toLowerCase().replace('#', '').includes(kw))) score += 20;
            if ((node.description || '').toLowerCase().includes(kw)) score += 10;
            if ((node.keyFacts || []).some(f => f.toLowerCase().includes(kw))) score += 15;
        }
        // Recency boost
        const daysSince = node.lastAccessedAt
            ? (Date.now() - node.lastAccessedAt) / 86400000 : 30;
        if (score > 0) score *= Math.max(0.3, 1 - daysSince / 60);

        return { node, score };
    });

    return scored
        .filter(s => s.score >= 40)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(s => s.node);
}

module.exports = {
    analyzeAndStoreAudio,
    findMatchingAudioNodes,
    AUDIO_STORE
};

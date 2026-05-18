/**
 * image-analyzer.js — Summer's Visual Memory Engine (v3)
 *
 * Fixes implemented:
 *  1. Identity injection: user_self description passed to Gemini so it can identify Ayush
 *  2. Explicit isUserSelf confidence from AI (not fragile tag heuristic)
 *  3. Score threshold >= 40 for findMatchingImageNodes (eliminates noise)
 *  4. HEIC → JPEG conversion via macOS sips (no extra dependencies)
 *  5. Post-analysis graph integration pass (connects image to existing knowledge nodes)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const Paths = require('../core/utils/paths');
const { GoogleGenAI } = require('@google/genai');
const { withMemoryApiKey } = require('./memory-api-key');

// All Summer visual memories live in Summer's own userData directory
const IMAGE_STORE = path.join(Paths.userData(), 'image-store');

const IMAGE_MIME_TYPES = new Set([
    'image/jpeg', 'image/jpg', 'image/png',
    'image/webp', 'image/gif', 'image/heic', 'image/avif'
]);

function isImageFile(file) {
    return IMAGE_MIME_TYPES.has((file.type || '').toLowerCase()) ||
        /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.name || '');
}

/**
 * Build the vision analysis prompt, injecting user identity from the graph.
 * This is the critical fix for Bug 1 & 2 — Gemini now knows who owns the app.
 */
function buildVisionPrompt(userSelfNode) {
    const userName = userSelfNode?.label || 'Ayush';
    const userDesc = userSelfNode?.description
        ? userSelfNode.description.slice(0, 200)
        : 'Indian male, early 20s, software engineering student';

    return `You are analyzing a photo from the personal memory system of ${userName}.

IDENTITY CONTEXT: The app owner is ${userName} — ${userDesc}.
If you see a young Indian male who appears to be the PRIMARY SUBJECT of this photo (solo portrait, selfie, or focal person), he is very likely ${userName}. Name him accordingly.

Analyze this image with deep attention to detail. Return ONLY valid JSON (no markdown, no code fences):
{
  "people": [
    { "name": "person name — use '${userName}' if you believe it is them, else 'Unknown Person'", "description": "physical description, clothing, expression, approximate age", "isOwner": true/false }
  ],
  "objects": ["list", "of", "notable", "objects"],
  "scene": "Detailed description of setting, environment, lighting, and context",
  "ocrText": "Any visible text, exactly as written. Empty string if none.",
  "summary": "A concise 2-3 sentence summary of what this image shows",
  "suggestedLabel": "A short descriptive title (max 8 words)",
  "suggestedTags": ["#tag1", "#tag2"],
  "dominantMood": "happy/serious/professional/casual/celebratory/outdoor/indoor/etc",
  "ownerConfidence": "high/medium/low/no",
  "ownerRole": "sole_subject/group_focal/background/absent"
}

For suggestedTags, generate 6-10 highly relevant tags:
- People: #${userName.toLowerCase().split(' ')[0]}, #family, #friend, #team, #colleague, #group
- Event: #graduation, #birthday, #holi, #travel, #celebration, #festival, #meeting
- Setting: #outdoor, #office, #campus, #home, #restaurant, #gym, #mountains
- Activity: #coding, #studying, #celebrating, #working, #sports, #travel
- Mood/style: #formal, #casual, #happy, #professional, #relaxed
- Subject: #technology, #nature, #food, #architecture, #selfie, #portrait

ownerConfidence: "high" = very likely the owner, "medium" = possibly, "low" = unlikely, "no" = definitely not
ownerRole: "sole_subject" = only person, "group_focal" = in a group but clearly central, "background" = minor presence, "absent" = not visible

Return ONLY the JSON object. No extra text.`;
}

/**
 * Convert HEIC/HEIF file to JPEG using macOS sips utility.
 * Returns the new filepath. No npm dependencies needed.
 */
function convertHeicToJpeg(heicPath) {
    const jpgPath = heicPath.replace(/\.(heic|heif)$/i, '.jpg');
    try {
        execSync(`sips -s format jpeg "${heicPath}" --out "${jpgPath}"`, { timeout: 30000 });
        fs.unlinkSync(heicPath); // remove original HEIC after conversion
        console.log(`[ImageMemory] Converted HEIC → JPEG: ${path.basename(jpgPath)}`);
        return jpgPath;
    } catch (e) {
        console.warn(`[ImageMemory] HEIC conversion failed (sips): ${e.message}. Keeping original.`);
        return heicPath; // fallback to original if conversion fails
    }
}

/**
 * Run a lightweight second-pass to connect this image to existing knowledge nodes.
 * Bug 5 fix: image nodes were isolated islands with no edges to text memory.
 */
async function integrateWithGraph(node, analysis, existingGraph) {
    const imageNodes = existingGraph.nodes.filter(n => n.type !== 'ImageMemory');
    if (imageNodes.length === 0) return [];

    // Find candidate text nodes by tag intersection
    const imageTags = (node.tags || []).map(t => t.replace('#', '').toLowerCase());
    const candidates = imageNodes
        .filter(n => {
            const nTags = (n.tags || []).map(t => t.replace('#', '').toLowerCase());
            const nLabel = (n.label || '').toLowerCase();
            const nDesc = (n.description || '').toLowerCase();
            // Candidate if tag overlaps or label/description has a strong keyword match
            return imageTags.some(t => nTags.includes(t) || nLabel.includes(t) || nDesc.includes(t));
        })
        .slice(0, 15); // max 15 candidates for prompt

    if (candidates.length === 0) return [];

    const candidateStr = candidates.map(n =>
        `- ID: "${n.id}", Label: "${n.label}", Type: "${n.type}"`
    ).join('\n');

    const prompt = `Given this image analysis:
Label: "${node.label}"
Summary: "${node.description}"
Tags: ${node.tags.join(', ')}
Scene: "${analysis.scene || ''}"

And these existing knowledge graph nodes:
${candidateStr}

Which of these nodes does this image meaningfully relate to?
Return ONLY valid JSON array (empty [] if none are relevant, max 3 edges):
[
  { "to": "existing_node_id", "label": "event_of|taken_at|related_to|depicts|associated_with", "confidence": 0.85 }
]

Only include edges where confidence >= 0.75. Return [] if unsure. Return ONLY the JSON array.`;

    try {
        const edges = await withMemoryApiKey(async (key) => {
            const ai = new GoogleGenAI({ apiKey: key });
            const response = await ai.models.generateContent({
                model: 'gemini-3.1-flash-lite-preview',
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
                .filter(e => candidates.some(c => c.id === e.to)) // only link to actual candidates
                .map(e => ({ from: node.id, to: e.to, label: e.label, confidence: e.confidence }));
            if (validEdges.length > 0) {
                console.log(`[ImageMemory] Graph integration: ${validEdges.length} edge(s) found →`, validEdges.map(e => e.to).join(', '));
            }
            return validEdges;
        }
    } catch (e) {
        // Graph integration is non-critical — don't fail the whole pipeline
        console.warn(`[ImageMemory] Graph integration pass failed: ${e.message}`);
    }
    return [];
}

/**
 * Analyzes a single image using Gemini Flash Lite vision via the memory key pool.
 * Stores the image in Summer's image-store and returns a fully-formed ImageMemory node.
 */
async function analyzeAndStoreImage(file) {
    // 1. Ensure image-store directory exists
    if (!fs.existsSync(IMAGE_STORE)) {
        fs.mkdirSync(IMAGE_STORE, { recursive: true });
        console.log(`[ImageMemory] Created image-store at: ${IMAGE_STORE}`);
    }

    // 2. Compute SHA-256 hash for deduplication (first 16 hex chars)
    const rawBuffer = Buffer.from(file.buffer);
    const hash = crypto.createHash('sha256').update(rawBuffer).digest('hex').slice(0, 16);

    // 3. Check if already stored (deduplicate by hash)
    const existing = findExistingByHash(hash);
    if (existing) {
        console.log(`[ImageMemory] Image already in store (hash: ${hash}), skipping re-analysis.`);
        return { node: existing, edges: [], analysis: null, deduplicated: true };
    }

    // 4. Write raw file to image-store
    let ext = path.extname(file.name || '').toLowerCase() || '.jpg';
    let filename = `img_${Date.now()}_${hash}${ext}`;
    let destPath = path.join(IMAGE_STORE, filename);
    fs.writeFileSync(destPath, rawBuffer);

    // 5. HEIC → JPEG conversion (Phase 4 fix)
    if (ext === '.heic' || ext === '.heif') {
        const converted = convertHeicToJpeg(destPath);
        if (converted !== destPath) {
            filename = path.basename(converted);
            destPath = converted;
            ext = '.jpg';
        }
    }
    console.log(`[ImageMemory] Stored image: ${filename}`);

    // 6. Load user_self node for identity injection (Phase 2 fix — Bug 1)
    let userSelfNode = null;
    try {
        const { loadGraph } = require('./graph-store');
        const currentGraph = loadGraph();
        userSelfNode = currentGraph.nodes.find(n => n.id === 'user_self') || null;
    } catch { /* non-critical */ }

    // 7. Analyze with Gemini Flash Lite + identity context
    const base64 = fs.readFileSync(destPath).toString('base64'); // re-read converted file
    const apiMime = 'image/jpeg'; // always send as JPEG after conversion

    let analysis = null;
    try {
        const prompt = buildVisionPrompt(userSelfNode);
        analysis = await withMemoryApiKey(async (key) => {
            const ai = new GoogleGenAI({ apiKey: key });
            const response = await ai.models.generateContent({
                model: 'gemini-3.1-flash-lite-preview',
                contents: [{
                    parts: [
                        { inlineData: { mimeType: apiMime, data: base64 } },
                        { text: prompt }
                    ]
                }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
            });
            let rawText = response.candidates[0].content.parts[0].text.trim();
            rawText = rawText.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
            return JSON.parse(rawText);
        });
        console.log(`[ImageMemory] Analysis complete: "${analysis.suggestedLabel}" | Owner: ${analysis.ownerConfidence} (${analysis.ownerRole})`);
    } catch (err) {
        console.error(`[ImageMemory] Gemini vision error:`, err.message);
        analysis = {
            people: [],
            objects: [],
            scene: 'Unable to analyze image',
            ocrText: '',
            summary: `Image uploaded: ${file.name || filename}`,
            suggestedLabel: path.basename(file.name || filename, ext),
            suggestedTags: ['#photo', '#uploaded'],
            dominantMood: 'unknown',
            ownerConfidence: 'low',
            ownerRole: 'absent'
        };
    }

    // 8. Build entities list
    const entities = [
        ...analysis.people.map(p => p.name).filter(n => n && n !== 'Unknown Person'),
        ...(analysis.objects || [])
    ].filter(Boolean).slice(0, 20);

    // 9. Determine user_self connection (Phase 2 fix — Bug 2)
    // Only link if Gemini explicitly says high/medium confidence AND owner is focal
    const ownerConf = (analysis.ownerConfidence || 'low').toLowerCase();
    const ownerRole = (analysis.ownerRole || 'absent').toLowerCase();
    const isUserSelf =
        (ownerConf === 'high') ||
        (ownerConf === 'medium' && (ownerRole === 'sole_subject' || ownerRole === 'group_focal'));

    // 10. Build the complete ImageMemory node
    const nodeId = `img_${Date.now()}_${hash.slice(0, 8)}`;
    const node = {
        id: nodeId,
        type: 'ImageMemory',
        label: analysis.suggestedLabel || path.basename(file.name || filename, ext),
        description: analysis.summary || '',
        imagePath: filename, // filename only — full path constructed at runtime
        imageHash: hash,
        entities,
        faceIds: analysis.people
            .map(p => p.name?.toLowerCase().replace(/\s+/g, '_'))
            .filter(Boolean),
        ocrText: analysis.ocrText || '',
        mood: analysis.dominantMood || '',
        scene: analysis.scene || '',
        ownerConfidence: analysis.ownerConfidence || 'low',
        ownerRole: analysis.ownerRole || 'absent',
        tags: analysis.suggestedTags || [],
        importance: isUserSelf ? 0.85 : 0.65,
        source: 'user_upload',
        createdAt: Date.now(),
        lastAccessedAt: Date.now()
    };

    // 11. Build edges
    const edges = [];
    if (isUserSelf) {
        edges.push({ from: nodeId, to: 'user_self', label: 'depicts', confidence: 0.9 });
        console.log(`[ImageMemory] Linked → user_self (confidence: ${ownerConf}, role: ${ownerRole})`);
    } else {
        console.log(`[ImageMemory] NOT linked to user_self (confidence: ${ownerConf}, role: ${ownerRole})`);
    }

    // Connect named non-user people to their person nodes
    for (const person of (analysis.people || [])) {
        const name = person.name;
        if (name && name !== 'Unknown Person' && !person.isOwner) {
            const personId = name.toLowerCase().replace(/\s+/g, '_');
            if (personId !== 'user_self') {
                edges.push({ from: nodeId, to: personId, label: 'depicts', confidence: 0.8 });
            }
        }
    }

    // 12. Graph integration pass (Phase 3 fix — Bug 5): connect to existing knowledge nodes
    try {
        const { loadGraph } = require('./graph-store');
        const currentGraph = loadGraph();
        const integrationEdges = await integrateWithGraph(node, analysis, currentGraph);
        edges.push(...integrationEdges);
    } catch (e) {
        // Non-critical
    }

    console.log(`[ImageMemory] Node ready: ${nodeId} | "${node.label}" | Tags: ${node.tags.join(', ')}`);

    return { node, edges, analysis, filename, deduplicated: false };
}

/**
 * Find an existing ImageMemory node in the graph by image hash (for deduplication).
 */
function findExistingByHash(hash) {
    try {
        const { loadGraph } = require('./graph-store');
        const graph = loadGraph();
        return graph.nodes.find(n => n.type === 'ImageMemory' && n.imageHash === hash) || null;
    } catch {
        return null;
    }
}

// Keywords that indicate a VISUAL INTENT — only these should trigger shadow image retrieval
const VISUAL_INTENT_WORDS = new Set([
    'photo', 'image', 'picture', 'pic', 'photos', 'images', 'pictures', 'show',
    'look', 'see', 'view', 'display', 'selfie', 'portrait', 'memory', 'memories',
    'gallery', 'snap', 'snapshot', 'shot', 'visual', 'face', 'holi', 'trip',
    'travel', 'vacation', 'festival', 'celebration', 'birthday', 'graduation'
]);

// Person name aliases that should trigger shadow retrieval
const USER_NAME_ALIASES = new Set(['ayush', 'ayushjaiswal', 'jaiswal', 'me', 'myself', 'mine']);

/**
 * Determine if the user's text has visual intent (should trigger shadow image retrieval).
 * Bug 3 fix: only show images when the conversation is actually about photos or people.
 */
function hasVisualIntent(text) {
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
    return words.some(w => VISUAL_INTENT_WORDS.has(w) || USER_NAME_ALIASES.has(w));
}

/**
 * Find ImageMemory nodes matching keywords. Minimum score of 40 to avoid noise.
 * Bug 3+7 fix: score threshold raised from > 0 to >= 40.
 *
 * If `personalOnly` is true, only returns nodes that have a 'depicts → user_self' edge.
 */
function findMatchingImageNodes(keywords, graph, maxResults = 4, personalOnly = false) {
    if (!keywords || keywords.length === 0) return [];
    const kws = keywords.map(k => k.toLowerCase().trim()).filter(k => k.length > 2);
    if (kws.length === 0) return [];

    // Pre-compute which image nodes are linked to user_self
    const userSelfImageIds = new Set(
        (graph.edges || [])
            .filter(e => e.to === 'user_self' && e.label === 'depicts')
            .map(e => e.from)
    );

    let imageNodes = (graph.nodes || []).filter(n => n.type === 'ImageMemory');

    // Bug 4 fix (partial): if personalOnly, restrict to user_self-linked images
    if (personalOnly) {
        imageNodes = imageNodes.filter(n => userSelfImageIds.has(n.id));
    }

    if (imageNodes.length === 0) return [];

    const scored = imageNodes.map(node => {
        let score = 0;
        for (const kw of kws) {
            if ((node.label || '').toLowerCase().includes(kw)) score += 30;
            if ((node.entities || []).some(e => e.toLowerCase().includes(kw))) score += 25;
            if ((node.tags || []).some(t => t.toLowerCase().replace('#', '').includes(kw))) score += 20;
            if ((node.description || '').toLowerCase().includes(kw)) score += 10;
            if ((node.scene || '').toLowerCase().includes(kw)) score += 5;
            if ((node.ocrText || '').toLowerCase().includes(kw)) score += 5;
        }
        // Boost for user_self-linked images (personal photos always more relevant)
        if (userSelfImageIds.has(node.id)) score *= 1.3;
        // Recency boost
        const daysSince = node.lastAccessedAt
            ? (Date.now() - node.lastAccessedAt) / 86400000 : 30;
        if (score > 0) score *= Math.max(0.3, 1 - daysSince / 60);

        return { node, score };
    });

    return scored
        .filter(s => s.score >= 40) // Bug 7 fix: meaningful match only (was > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(s => s.node);
}

/**
 * Extract content-bearing keywords from conversation text (removes stopwords).
 */
function extractKeywordsFromText(text) {
    const STOPWORDS = new Set([
        'the','a','an','is','are','was','were','i','you','he','she','it','we','they',
        'my','your','his','her','our','their','what','which','who','this','that','these',
        'those','do','did','does','have','has','had','will','would','can','could','should',
        'may','might','must','be','been','being','and','or','but','not','so','if','then',
        'than','as','at','by','for','in','on','to','up','with','of','about','just','like',
        'also','tell','show','know','think','want','yes','no','ok','okay','hey','summer',
        'still','visible','see','that','look','there','here','now','then','only','even',
        'right','let','test','can','put','got','set','get','say','said','going','let'
    ]);
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

module.exports = {
    analyzeAndStoreImage,
    findMatchingImageNodes,
    extractKeywordsFromText,
    hasVisualIntent,
    isImageFile,
    IMAGE_STORE
};

/**
 * procedural-memory.js — Summer's Skill Learning Engine
 *
 * Extracts implicit rules, preferences, workflows, and anti-patterns from
 * conversation transcripts. These "ProceduralMemory" nodes are stored in
 * the knowledge graph and later injected into the system prompt by
 * context-injector.js so Summer silently adapts to the user's style.
 *
 * Subtypes:
 *   - style_preference : "Use arrow functions", "Always dark mode"
 *   - workflow          : "test → build → deploy"
 *   - anti_pattern      : "Never use setTimeout in async"
 *   - tool_preference   : "Use Fira Code for code blocks"
 *
 * Confidence lifecycle:
 *   - New rule → 0.50
 *   - Each reinforcement → +0.10 (capped at 0.99)
 *   - Each contradiction → -0.20 (floored at 0.10)
 *   - Only rules with confidence ≥ 0.70 are injected into sessions
 */

const { GoogleGenAI } = require('@google/genai');
const { withMemoryApiKey } = require('./memory-api-key');
const { loadGraph, saveGraph, mergeGraph } = require('./graph-store');

// ── Extraction prompt ──────────────────────────────────────────────────────

const PROCEDURAL_EXTRACTION_PROMPT = `You are a behavioral pattern analyzer for a personal AI assistant called Summer.

Analyze this conversation transcript and extract IMPLICIT RULES the user is teaching the AI through:
1. **Corrections** — User says "no, do X instead" or "don't do Y" → extract rule
2. **Style preferences** — User consistently asks for a specific coding style, formatting, or approach
3. **Workflow sequences** — User always follows a specific order of steps (e.g. test → build → deploy)
4. **Tool/library preferences** — User prefers specific tools, frameworks, or libraries
5. **Anti-patterns** — User explicitly says "never do X" or corrects a repeated mistake

CRITICAL RULES:
- Only extract GENUINE patterns, NOT conversational filler
- Each rule must be a clear, actionable instruction Summer can follow
- If the user made a one-off comment, do NOT extract it as a rule
- Focus on things that would apply to FUTURE conversations
- Do NOT extract facts about the user (that's handled by the graph extractor)
- Extract 0-5 rules max. Return empty array if nothing meaningful.

For each rule, provide:
- "id": stable lowercase_underscore ID (e.g. "proc_js_arrow_functions")
- "subtype": "style_preference" | "workflow" | "anti_pattern" | "tool_preference"
- "label": Short human-readable title (max 8 words)
- "description": Detailed 1-2 sentence description of the rule
- "rules": Array of 1-3 actionable rule strings
- "triggerContext": Array of 3-6 keywords that would trigger this rule in future conversations

Return ONLY valid JSON:
{
  "procedures": [
    {
      "id": "proc_example_rule",
      "subtype": "style_preference",
      "label": "Prefer Arrow Functions",
      "description": "User consistently corrects function declarations to arrow syntax in JavaScript",
      "rules": ["Use arrow functions instead of function declarations in JavaScript"],
      "triggerContext": ["javascript", "function", "code", "write", "js"]
    }
  ]
}

Return {"procedures": []} if no patterns are found. Return ONLY the JSON object.`;

// ── Core extraction function ───────────────────────────────────────────────

/**
 * Analyzes a session transcript for implicit behavioral patterns.
 * Runs as a fire-and-forget background task — failures are non-critical.
 *
 * @param {string} transcriptText - The full session transcript
 * @returns {Promise<void>}
 */
async function extractProceduralPatterns(transcriptText) {
    if (!transcriptText || transcriptText.length < 100) return;

    try {
        const result = await withMemoryApiKey(async (key) => {
            const ai = new GoogleGenAI({ apiKey: key });
            const response = await ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: [{
                    parts: [{
                        text: PROCEDURAL_EXTRACTION_PROMPT +
                              '\n\nCONVERSATION TRANSCRIPT:\n' +
                              transcriptText.slice(0, 10000)
                    }]
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 2048
                }
            });

            let raw = response.candidates[0].content.parts[0].text.trim();
            raw = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
            return JSON.parse(raw);
        });

        const procedures = result?.procedures;
        if (!Array.isArray(procedures) || procedures.length === 0) {
            console.log('[ProceduralMemory] No patterns detected in this session.');
            return;
        }

        console.log(`[ProceduralMemory] Detected ${procedures.length} pattern(s). Merging into graph...`);

        // Merge into the knowledge graph
        const graph = loadGraph();
        let addedCount = 0;
        let reinforcedCount = 0;

        for (const proc of procedures) {
            if (!proc.id || !proc.rules || proc.rules.length === 0) continue;

            // Ensure ID has proc_ prefix
            const procId = proc.id.startsWith('proc_') ? proc.id : `proc_${proc.id}`;

            // Check if this procedural memory already exists
            const existing = graph.nodes.find(n =>
                n.type === 'ProceduralMemory' && n.id === procId
            );

            if (existing) {
                // Reinforce: boost confidence + merge rules
                existing.confidence = Math.min(0.99, (existing.confidence || 0.5) + 0.10);
                existing.observedCount = (existing.observedCount || 1) + 1;
                existing.lastReinforced = Date.now();

                // Merge new rules that don't already exist
                const existingRules = new Set(existing.rules || []);
                for (const rule of proc.rules) {
                    if (!existingRules.has(rule)) {
                        existing.rules = existing.rules || [];
                        existing.rules.push(rule);
                    }
                }

                // Merge trigger contexts
                const existingTriggers = new Set(existing.triggerContext || []);
                for (const ctx of (proc.triggerContext || [])) {
                    existingTriggers.add(ctx.toLowerCase());
                }
                existing.triggerContext = Array.from(existingTriggers);

                reinforcedCount++;
                console.log(`[ProceduralMemory] ↑ Reinforced: "${existing.label}" (confidence: ${existing.confidence.toFixed(2)}, observed: ${existing.observedCount}x)`);
            } else {
                // New procedural memory
                const newNode = {
                    id: procId,
                    type: 'ProceduralMemory',
                    subtype: proc.subtype || 'style_preference',
                    label: proc.label || procId,
                    description: proc.description || proc.rules.join('; '),
                    rules: proc.rules,
                    triggerContext: (proc.triggerContext || []).map(c => c.toLowerCase()),
                    confidence: 0.50,
                    observedCount: 1,
                    lastReinforced: Date.now(),
                    importance: 0.7,
                    source: 'procedural_extraction',
                    createdAt: Date.now(),
                    tags: ['#learned', `#${proc.subtype || 'preference'}`]
                };

                graph.nodes.push(newNode);

                // Link to user_self
                graph.edges.push({
                    from: 'user_self',
                    to: procId,
                    label: 'has_preference',
                    confidence: 0.9,
                    source: 'procedural_extraction',
                    updatedAt: Date.now()
                });

                addedCount++;
                console.log(`[ProceduralMemory] + New: "${newNode.label}" (subtype: ${newNode.subtype})`);
            }
        }

        if (addedCount > 0 || reinforcedCount > 0) {
            saveGraph(graph);
            console.log(`[ProceduralMemory] Graph saved. Added: ${addedCount}, Reinforced: ${reinforcedCount}`);
        }

    } catch (err) {
        // Non-critical — session diary still saves even if this fails
        console.warn(`[ProceduralMemory] Extraction failed (non-critical): ${err.message}`);
    }
}

/**
 * Retrieves all ProceduralMemory nodes from the graph.
 *
 * @param {Object} options - { minConfidence: number, subtype: string }
 * @returns {Array} Array of ProceduralMemory nodes
 */
function getProceduralMemories(options = {}) {
    const { minConfidence = 0, subtype = null } = options;
    const graph = loadGraph();

    return graph.nodes
        .filter(n => n.type === 'ProceduralMemory')
        .filter(n => (n.confidence || 0) >= minConfidence)
        .filter(n => !subtype || n.subtype === subtype)
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

/**
 * Reduces confidence of a procedural memory (when user contradicts a rule).
 *
 * @param {string} procId - The procedural memory node ID
 * @returns {{ success: boolean, confidence?: number }}
 */
function weakenProcedural(procId) {
    const graph = loadGraph();
    const node = graph.nodes.find(n => n.id === procId && n.type === 'ProceduralMemory');
    if (!node) return { success: false };

    node.confidence = Math.max(0.10, (node.confidence || 0.5) - 0.20);
    console.log(`[ProceduralMemory] ↓ Weakened: "${node.label}" → confidence: ${node.confidence.toFixed(2)}`);
    saveGraph(graph);
    return { success: true, confidence: node.confidence };
}

module.exports = {
    extractProceduralPatterns,
    getProceduralMemories,
    weakenProcedural
};

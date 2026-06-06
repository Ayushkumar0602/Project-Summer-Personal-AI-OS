/**
 * cortex/gap-detector.js
 *
 * Mines session diaries and procedural memory for capability gaps.
 *
 * A "gap" is something Summer failed at, couldn't do, or was asked to do
 * repeatedly without good results. The detector:
 *   1. Reads the last N diary entries for failure patterns
 *   2. Reads procedural anti-patterns (user corrections)
 *   3. Uses Gemini to classify and prioritize gaps
 *   4. Writes CapabilityGap nodes to the knowledge graph
 *
 * Data sources (all read-only):
 *   - session-diary.js → loadDiary()
 *   - procedural-memory.js → loadProceduralPatterns()
 *   - skill-loader.js → getSkillSummaries() (what we already know)
 *
 * Output:
 *   - CapabilityGap graph nodes with { gapId, category, priority, description }
 */

'use strict';

const { GoogleGenAI, Type } = require('@google/genai');
const { createLogger } = require('../core/utils/logger');
const { loadDiary } = require('../knowledge/session-diary');
const { loadGraph, mergeGraph, saveGraph } = require('../knowledge/graph-store');
const { withMemoryApiKey, reportTokenUsage } = require('../knowledge/memory-api-key');
const { getSkillSummaries } = require('../skills/skill-loader');
const { logEvolution, ACTIONS } = require('./evolution-log');
const { safeParseLlmJson } = require('./json-repair');
const staging = require('./staging-registry');

const log = createLogger('GapDetector');

// ── Configuration ────────────────────────────────────────────────────────────

const MAX_DIARY_ENTRIES = 15;      // Analyze last 15 sessions
const MAX_GAPS_PER_CYCLE = 5;      // Don't generate more than 5 gaps at once
const GAP_COOLDOWN_MS = 3600_000;  // Don't re-analyze the same diary window within 1 hour

let _lastAnalysisTime = 0;

// ── Prompt ───────────────────────────────────────────────────────────────────

const GAP_DETECTION_PROMPT = `You are analyzing conversation session logs from an AI voice assistant called "Summer".
Your job is to identify CAPABILITY GAPS — things Summer couldn't do, did poorly, or was asked to do repeatedly.

Summer's CURRENT capabilities (skills already loaded):
{SKILL_SUMMARIES}

Analyze the session diary entries below and identify capability gaps.

RULES:
1. A gap must be something Summer was ASKED to do but FAILED or LACKED a skill for.
2. Do NOT create gaps for things Summer already has skills for (see above).
3. Prioritize gaps that appeared MULTIPLE times across sessions (recurring needs).
4. Each gap should be actionable — specific enough to create a skill for.
5. Return 0-5 gaps. If Summer is doing well, return an empty array.
6. For each gap, provide:
   - id: A short snake_case identifier (e.g., "docker_commands", "api_debugging")
   - category: One of "knowledge" (needs context), "tool" (needs new tool), "behavior" (needs better prompting)
   - priority: "high" (appeared 3+ times), "medium" (2 times), "low" (1 time)
   - description: What Summer needs to learn/do (1-2 sentences)
   - evidence: The diary excerpts that show this gap

SESSION DIARY ENTRIES:
{DIARY_ENTRIES}`;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyze session diaries for capability gaps.
 *
 * @returns {{ gaps: Object[], analyzed: number, skipped: boolean }}
 */
async function detectGaps() {
    // Cooldown check — don't re-analyze too frequently
    if (Date.now() - _lastAnalysisTime < GAP_COOLDOWN_MS) {
        log.info('Gap detection: skipped (cooldown active).');
        return { gaps: [], analyzed: 0, skipped: true };
    }

    // Load diary entries
    const diary = loadDiary();
    if (!diary || diary.length === 0) {
        log.info('Gap detection: no diary entries to analyze.');
        return { gaps: [], analyzed: 0, skipped: false };
    }

    const recentEntries = diary.slice(0, MAX_DIARY_ENTRIES);
    const diaryText = recentEntries.map((d, i) => {
        const mood = d.emotion ? ` [mood: ${d.emotion}]` : '';
        return `--- Session ${i + 1} (${d.date})${mood} ---\n${d.entry}`;
    }).join('\n\n');

    // Get current skill summaries to avoid duplicates
    const skillSummaries = getSkillSummaries() || 'No skills currently loaded.';

    // Build prompt
    const prompt = GAP_DETECTION_PROMPT
        .replace('{SKILL_SUMMARIES}', skillSummaries)
        .replace('{DIARY_ENTRIES}', diaryText);

    log.info(`Analyzing ${recentEntries.length} diary entries for capability gaps...`);

    try {
        const result = await withMemoryApiKey(async (key) => {
            const ai = new GoogleGenAI({ apiKey: key });
            return await ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: [{ parts: [{ text: prompt }] }],
                config: {
                    temperature: 0.1,
                    maxOutputTokens: 2048,
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id:          { type: Type.STRING },
                                category:    { type: Type.STRING },
                                priority:    { type: Type.STRING },
                                description: { type: Type.STRING },
                                evidence:    { type: Type.STRING },
                            },
                            required: ['id', 'category', 'priority', 'description'],
                        },
                    },
                },
            });
        }, { caller: 'GapDetector' });

        // Track token usage
        if (result.usageMetadata?.totalTokenCount) {
            reportTokenUsage(null, result.usageMetadata.totalTokenCount);
        }

        const gaps = safeParseLlmJson(result.text, []);
        if (!Array.isArray(gaps)) {
            log.warn('Gap detection: LLM returned non-array response. Skipping.');
            _lastAnalysisTime = Date.now();
            return { gaps: [], analyzed: recentEntries.length, skipped: false };
        }
        _lastAnalysisTime = Date.now();

        if (gaps.length === 0) {
            log.info('Gap detection: no capability gaps found. Summer is doing well! 🎉');
            return { gaps: [], analyzed: recentEntries.length, skipped: false };
        }

        // Filter out gaps that already have skills being staged
        const newGaps = gaps
            .slice(0, MAX_GAPS_PER_CYCLE)
            .filter(gap => {
                const gapId = `gap_${gap.id}`;
                if (staging.hasSkillForGap(gapId)) {
                    log.info(`Gap "${gap.id}" already has a staged skill — skipping.`);
                    return false;
                }
                return true;
            });

        // Write gaps to knowledge graph as CapabilityGap nodes
        if (newGaps.length > 0) {
            _writeGapsToGraph(newGaps);
        }

        log.info(`Gap detection: found ${newGaps.length} new gap(s) out of ${gaps.length} detected.`);
        return { gaps: newGaps, analyzed: recentEntries.length, skipped: false };

    } catch (e) {
        log.error(`Gap detection failed: ${e.message}`);
        logEvolution(ACTIONS.ERROR, {
            module: 'gap-detector',
            error: e.message,
        });
        return { gaps: [], analyzed: 0, skipped: false };
    }
}

/**
 * Load procedural anti-patterns (user corrections) to supplement gap detection.
 * Falls back gracefully if procedural-memory doesn't expose the right API.
 */
function _loadAntiPatterns() {
    try {
        const pm = require('../knowledge/procedural-memory');
        if (typeof pm.loadProceduralPatterns === 'function') {
            const patterns = pm.loadProceduralPatterns();
            return patterns.filter(p => p.subtype === 'anti_pattern' || p.type === 'correction');
        }
    } catch {}
    return [];
}

/**
 * Write detected gaps as CapabilityGap nodes in the knowledge graph.
 */
function _writeGapsToGraph(gaps) {
    const graph = loadGraph();
    const newNodes = [];
    const newEdges = [];

    for (const gap of gaps) {
        const nodeId = `gap_${gap.id}`;

        // Check if this gap already exists
        if (graph.nodes.some(n => n.id === nodeId)) {
            log.info(`Gap node "${nodeId}" already exists — updating.`);
            const existing = graph.nodes.find(n => n.id === nodeId);
            existing.description = gap.description;
            existing.tags = [gap.category, gap.priority, '#cortex_gap'];
            existing.updatedAt = Date.now();
            continue;
        }

        newNodes.push({
            id: nodeId,
            label: `Gap: ${gap.id.replace(/_/g, ' ')}`,
            type: 'CapabilityGap',
            description: gap.description,
            importance: gap.priority === 'high' ? 0.9 : gap.priority === 'medium' ? 0.7 : 0.5,
            tags: [gap.category, gap.priority, '#cortex_gap'],
            source: 'cortex_gap_detector',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            _evidence: gap.evidence || null,
            _status: 'open', // open → resolved → expired
        });

        // Connect to user_self
        newEdges.push({
            from: 'user_self',
            to: nodeId,
            label: 'has_capability_gap',
            source: 'cortex',
            confidence: 0.8,
            updatedAt: Date.now(),
        });

        logEvolution(ACTIONS.GAP_DETECTED, {
            gapId: nodeId,
            category: gap.category,
            priority: gap.priority,
            description: gap.description,
        });
    }

    if (newNodes.length > 0) {
        const merged = mergeGraph(graph, { nodes: newNodes, edges: newEdges });
        saveGraph(merged);
        log.info(`Wrote ${newNodes.length} CapabilityGap node(s) to knowledge graph.`);
    }
}

/**
 * Get all open gaps from the knowledge graph.
 *
 * @returns {Object[]}
 */
function getOpenGaps() {
    const graph = loadGraph();
    return graph.nodes
        .filter(n => n.type === 'CapabilityGap' && n._status !== 'resolved' && n._status !== 'expired')
        .sort((a, b) => (b.importance || 0) - (a.importance || 0));
}

/**
 * Mark a gap as resolved (a skill was successfully generated for it).
 */
function resolveGap(gapId) {
    const graph = loadGraph();
    const node = graph.nodes.find(n => n.id === gapId);
    if (node) {
        node._status = 'resolved';
        node.updatedAt = Date.now();
        saveGraph(graph);
        logEvolution(ACTIONS.GAP_RESOLVED, { gapId });
        log.info(`Gap resolved: ${gapId}`);
    }
}

module.exports = {
    detectGaps,
    getOpenGaps,
    resolveGap,
};

/**
 * cortex/self-reflector.js
 *
 * Meta-analysis engine — writes a daily "evolution journal" that Summer
 * uses to prioritize what to learn next.
 *
 * Runs once per idle wake period (not every cycle). Produces:
 *   1. EvolutionJournal node in the knowledge graph
 *   2. Priority queue for the next wake cycle
 *   3. Summary notification for the user's next session
 *
 * Reads:
 *   - evolution-log.js → recent activity
 *   - staging-registry.js → skill lifecycle stats
 *   - gap-detector.js → open/resolved gap counts
 *   - memory-consolidator.js → graph health stats
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { GoogleGenAI } = require('@google/genai');
const { createLogger } = require('../core/utils/logger');
const { loadGraph, mergeGraph, saveGraph } = require('../knowledge/graph-store');
const { withMemoryApiKey, reportTokenUsage, getTotalTokensToday } = require('../knowledge/memory-api-key');
const { getSummaryForReflection, readRecentEntries, logEvolution, ACTIONS } = require('./evolution-log');
const { safeParseLlmJson } = require('./json-repair');
const staging = require('./staging-registry');
const Paths = require('../core/utils/paths');

const log = createLogger('SelfReflector');

// ── Configuration ────────────────────────────────────────────────────────────

const PRIORITIES_FILE = path.join(Paths.cortexData(), 'evolution-priorities.json');
const MIN_REFLECTION_INTERVAL_MS = 4 * 3600 * 1000; // At most once per 4 hours

let _lastReflectionTime = 0;

// ── Reflection prompt ────────────────────────────────────────────────────────

const REFLECTION_PROMPT = `You are Summer's Self-Reflection Engine — the meta-cognitive layer of an evolving AI assistant.

Analyze the following evolution activity report and produce a reflection journal entry.

ACTIVITY REPORT:
{ACTIVITY_REPORT}

SKILL LIFECYCLE STATUS:
{SKILL_STATUS}

KNOWLEDGE GRAPH HEALTH:
{GRAPH_HEALTH}

TOKEN BUDGET STATUS:
{TOKEN_STATUS}

Write a concise journal entry (3-5 sentences) that:
1. Summarizes what was accomplished during this idle period
2. Identifies what should be prioritized next
3. Notes any concerning patterns (too many failures, budget issues, etc.)
4. Suggests 1-2 specific improvements

Also provide a priority_queue: an array of 1-3 items to focus on next idle period.
Each item has: id (string), action (string: "detect_gaps", "forge_skill", "consolidate", "harvest"), reason (string).

Output as JSON with keys: journal_text, priority_queue`;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the self-reflection process.
 * Should be called once per idle wake period (not every cycle).
 *
 * @returns {{ reflected: boolean, journalText: string, priorities: Object[] }}
 */
async function reflect() {
    // Check minimum interval
    if (Date.now() - _lastReflectionTime < MIN_REFLECTION_INTERVAL_MS) {
        log.info('Self-reflection: skipped (minimum interval not reached).');
        return { reflected: false, journalText: '', priorities: [] };
    }

    log.info('Starting self-reflection...');

    // Gather data from all subsystems
    const activityReport = getSummaryForReflection();
    const skillStatus = _buildSkillStatusReport();
    const graphHealth = _buildGraphHealthReport();
    const tokenStatus = _buildTokenStatusReport();

    // If there's nothing to reflect on, skip the LLM call
    if (activityReport.includes('No evolution activity')) {
        log.info('Self-reflection: no activity to reflect on.');
        _lastReflectionTime = Date.now();
        return { reflected: false, journalText: 'No evolution activity.', priorities: [] };
    }

    try {
        const prompt = REFLECTION_PROMPT
            .replace('{ACTIVITY_REPORT}', activityReport)
            .replace('{SKILL_STATUS}', skillStatus)
            .replace('{GRAPH_HEALTH}', graphHealth)
            .replace('{TOKEN_STATUS}', tokenStatus);

        const response = await withMemoryApiKey(async (key) => {
            const ai = new GoogleGenAI({ apiKey: key });
            return await ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: [{ parts: [{ text: prompt }] }],
                config: {
                    temperature: 0.3,
                    maxOutputTokens: 1024,
                    responseMimeType: 'application/json',
                },
            });
        }, { caller: 'SelfReflector' });

        if (response.usageMetadata?.totalTokenCount) {
            reportTokenUsage(null, response.usageMetadata.totalTokenCount);
        }

        const result = safeParseLlmJson(response.text, {});
        const journalText = result.journal_text || 'Reflection completed but no structured text produced.';
        const priorities = Array.isArray(result.priority_queue) ? result.priority_queue : [];

        _lastReflectionTime = Date.now();

        // Write journal to knowledge graph
        _writeJournalToGraph(journalText);

        // Save priorities for next wake
        _savePriorities(priorities);

        // Log
        logEvolution(ACTIONS.JOURNAL_WRITTEN, {
            textLength: journalText.length,
            priorityCount: priorities.length,
        });

        log.info(`Self-reflection complete. Journal: "${journalText.slice(0, 80)}..."`);
        return { reflected: true, journalText, priorities };

    } catch (e) {
        log.error(`Self-reflection failed: ${e.message}`);
        logEvolution(ACTIONS.ERROR, { module: 'self-reflector', error: e.message });
        _lastReflectionTime = Date.now(); // Still set to prevent retry storm
        return { reflected: false, journalText: '', priorities: [] };
    }
}

/**
 * Load priorities from the last reflection.
 *
 * @returns {Object[]}
 */
function loadPriorities() {
    try {
        if (fs.existsSync(PRIORITIES_FILE)) {
            return JSON.parse(fs.readFileSync(PRIORITIES_FILE, 'utf-8'));
        }
    } catch {}
    return [];
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _buildSkillStatusReport() {
    const counts = staging.getStatusCounts();
    const pending = staging.getPending();

    let report = `Skills: ${counts.staged} staged, ${counts.active} active, ${counts.promoted} promoted, ${counts.demoted} demoted.`;

    if (pending.length > 0) {
        report += '\nPending skills:\n';
        for (const s of pending) {
            report += `  - ${s.skillName} (tier ${s.tier}): ${s.useCount} uses, ${s.errorCount} errors\n`;
        }
    }

    return report;
}

function _buildGraphHealthReport() {
    const graph = loadGraph();
    const gapNodes = graph.nodes.filter(n => n.type === 'CapabilityGap');
    const openGaps = gapNodes.filter(n => n._status !== 'resolved');
    const journalNodes = graph.nodes.filter(n => n.type === 'EvolutionJournal');

    return `Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges.\n` +
        `Capability gaps: ${openGaps.length} open, ${gapNodes.length - openGaps.length} resolved.\n` +
        `Evolution journals: ${journalNodes.length} entries.`;
}

function _buildTokenStatusReport() {
    const tokensToday = getTotalTokensToday();
    const budget = 100_000; // Daily budget
    const pct = Math.round((tokensToday / budget) * 100);
    return `Tokens used today: ${tokensToday} / ${budget} (${pct}%)`;
}

function _writeJournalToGraph(journalText) {
    const graph = loadGraph();
    const journalId = `evolution_journal_${Date.now()}`;

    const newNodes = [{
        id: journalId,
        label: `Evolution Journal — ${new Date().toLocaleDateString()}`,
        type: 'EvolutionJournal',
        description: journalText,
        importance: 0.6,
        tags: ['#cortex_journal'],
        source: 'cortex_self_reflector',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }];

    const newEdges = [{
        from: 'user_self',
        to: journalId,
        label: 'evolved_during',
        source: 'cortex',
        confidence: 1.0,
        updatedAt: Date.now(),
    }];

    const merged = mergeGraph(graph, { nodes: newNodes, edges: newEdges });
    saveGraph(merged);
}

function _savePriorities(priorities) {
    try {
        const dir = path.dirname(PRIORITIES_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PRIORITIES_FILE, JSON.stringify(priorities, null, 2), 'utf-8');

        if (priorities.length > 0) {
            logEvolution(ACTIONS.PRIORITIES_UPDATED, {
                count: priorities.length,
                items: priorities.map(p => p.id),
            });
        }
    } catch (e) {
        log.warn(`Failed to save priorities: ${e.message}`);
    }
}

module.exports = {
    reflect,
    loadPriorities,
};

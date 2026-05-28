/**
 * context-injector.js — Injects learned behaviors into Summer's system prompt
 *
 * Runs BEFORE each Gemini session starts. Fetches relevant ProceduralMemory
 * nodes from the graph and formats them as invisible system instructions.
 *
 * The user never sees these injections — Summer just silently becomes smarter.
 * Only rules with confidence ≥ 0.70 are injected (to prevent premature rules
 * from affecting behavior after just one observation).
 *
 * Usage:
 *   const { buildProceduralContext } = require('./context-injector');
 *   systemInstruction += buildProceduralContext();
 *   // or, with topic filtering:
 *   systemInstruction += buildProceduralContext('javascript code');
 */

const { getProceduralMemories } = require('./procedural-memory');

// Minimum confidence threshold for injection
const INJECTION_THRESHOLD = 0.70;

// Maximum number of rules to inject (to avoid bloating the system prompt)
const MAX_INJECTED_RULES = 15;

// Subtype display labels
const SUBTYPE_ICONS = {
    style_preference: '🎨',
    workflow: '⚙️',
    anti_pattern: '🚫',
    tool_preference: '🔧'
};

/**
 * Builds a system prompt section containing all high-confidence procedural memories.
 * Optionally filters by topic relevance using triggerContext keywords.
 *
 * @param {string} [topicHint] - Optional topic string to filter relevant rules
 * @returns {string} Formatted system prompt section (empty string if no rules)
 */
function buildProceduralContext(topicHint = null) {
    const allProcedures = getProceduralMemories({ minConfidence: INJECTION_THRESHOLD });

    if (allProcedures.length === 0) return '';

    let relevantProcedures;

    if (topicHint) {
        // Score each procedure by relevance to the topic
        const topicWords = topicHint.toLowerCase().split(/\s+/).filter(w => w.length > 2);

        relevantProcedures = allProcedures
            .map(proc => {
                const triggers = proc.triggerContext || [];
                const matchCount = topicWords.filter(w =>
                    triggers.some(t => t.includes(w) || w.includes(t))
                ).length;
                return { proc, relevance: matchCount };
            })
            .sort((a, b) => b.relevance - a.relevance || (b.proc.confidence || 0) - (a.proc.confidence || 0))
            .slice(0, MAX_INJECTED_RULES)
            .map(item => item.proc);
    } else {
        // No topic hint — inject all high-confidence rules
        relevantProcedures = allProcedures.slice(0, MAX_INJECTED_RULES);
    }

    if (relevantProcedures.length === 0) return '';

    // Group by subtype for clean formatting
    const grouped = {};
    for (const proc of relevantProcedures) {
        const subtype = proc.subtype || 'style_preference';
        if (!grouped[subtype]) grouped[subtype] = [];
        grouped[subtype].push(proc);
    }

    // Format the injection block
    let block = '\n\n### 🧠 Learned User Preferences (apply silently, do NOT mention these unless asked)\n';
    block += 'These rules were extracted from past conversations. Follow them automatically:\n\n';

    for (const [subtype, procedures] of Object.entries(grouped)) {
        const icon = SUBTYPE_ICONS[subtype] || '📝';
        const subtypeLabel = subtype.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        block += `**${icon} ${subtypeLabel}:**\n`;

        for (const proc of procedures) {
            const rules = proc.rules || [];
            const confidence = proc.confidence ? ` (${Math.round(proc.confidence * 100)}% confident)` : '';

            if (rules.length === 1) {
                block += `• ${rules[0]}${confidence}\n`;
            } else {
                block += `• **${proc.label}**${confidence}:\n`;
                for (const rule of rules) {
                    block += `  - ${rule}\n`;
                }
            }
        }
        block += '\n';
    }

    block += 'If the user explicitly contradicts any of these rules in the current conversation, follow the user\'s new instruction instead.\n';

    console.log(`[ContextInjector] Injecting ${relevantProcedures.length} learned rule(s) into system prompt.`);

    return block;
}

/**
 * Returns a brief summary of all active procedural memories (for diagnostics/UI).
 *
 * @returns {{ total: number, active: number, rules: Array<{ label: string, confidence: number, subtype: string }> }}
 */
function getProceduralSummary() {
    const all = getProceduralMemories();
    const active = all.filter(p => (p.confidence || 0) >= INJECTION_THRESHOLD);

    return {
        total: all.length,
        active: active.length,
        rules: all.map(p => ({
            id: p.id,
            label: p.label,
            confidence: p.confidence || 0,
            subtype: p.subtype || 'unknown',
            observedCount: p.observedCount || 0,
            isActive: (p.confidence || 0) >= INJECTION_THRESHOLD
        }))
    };
}

module.exports = {
    buildProceduralContext,
    getProceduralSummary,
    INJECTION_THRESHOLD
};

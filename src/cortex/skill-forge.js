/**
 * cortex/skill-forge.js
 *
 * The Skill Forge — generates Tier 1 skills from detected capability gaps.
 *
 * Tier 1 skills are CONTEXT-ONLY — they inject instructional text into tool
 * responses, teaching Summer how to handle specific domains better.
 * They contain ZERO executable code, making them inherently safe.
 *
 * Flow:
 *   1. Read open CapabilityGap nodes from the graph
 *   2. For "knowledge" category gaps → Generate a Tier 1 skill file
 *   3. Validate via sandbox-validator.js (AST check)
 *   4. Write to src/skills/ → hot-reload into runtime
 *   5. Register in staging-registry for lifecycle tracking
 *   6. Queue evolution notification for next user session
 *
 * For "tool" category gaps → Generate a tool declaration proposal
 *   (stored as a CapabilityGap with _status='needs_tool', not auto-built)
 *
 * Integration:
 *   - gap-detector.js → reads CapabilityGap nodes
 *   - sandbox-validator.js → validates generated code
 *   - skill-loader.js → hotReloadSkill() to inject at runtime
 *   - staging-registry.js → lifecycle tracking
 *   - pending-notifications.js → "Sir, I learned X while you were away"
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { GoogleGenAI } = require('@google/genai');
const { createLogger } = require('../core/utils/logger');
const { withMemoryApiKey, reportTokenUsage } = require('../knowledge/memory-api-key');
const { validateSkillFile } = require('./sandbox-validator');
const staging = require('./staging-registry');
const { logEvolution, ACTIONS } = require('./evolution-log');
const pendingNotifications = require('../core/pending-notifications');
const bus = require('../core/event-bus');

const log = createLogger('SkillForge');

// ── Configuration ────────────────────────────────────────────────────────────

const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const MAX_FORGE_PER_CYCLE = 2;  // Don't generate more than 2 skills per cycle
const SKILL_FILE_PREFIX = 'cortex-'; // All generated skills start with this

// ── Generation prompt ────────────────────────────────────────────────────────

const SKILL_GENERATION_PROMPT = `You are generating a skill context file for an AI voice assistant called "Summer".

A skill file provides instructional context text that gets injected into Summer's responses when specific tools are used. 
It does NOT contain executable code — it's pure knowledge text.

The skill file format is a Node.js module that exports:
- name: Human-readable skill name (string)
- toolNames: Array of tool names this context applies to (string[])
- context: The instructional text (string, using backtick template literal)

CAPABILITY GAP TO ADDRESS:
ID: {GAP_ID}
Category: {GAP_CATEGORY}
Description: {GAP_DESCRIPTION}
Evidence: {GAP_EVIDENCE}

EXISTING TOOLS IN SUMMER (pick relevant ones for toolNames):
search_web, scrape_webpage, get_news, search_images, query_memory, mutate_memory_graph,
show_visual_memory, browser_navigate, browser_read, browser_click, browser_type,
os_open_app, os_quit_app, os_focus_app, os_set_volume, os_get_volume, os_toggle_mute,
os_set_brightness, os_get_system_info, os_get_top_processes, os_system_sleep,
os_lock_screen, os_read_clipboard, os_write_clipboard, os_show_notification,
os_open_file, os_open_url, os_toggle_dark_mode, os_take_screenshot, os_set_timer,
os_empty_trash, os_get_wifi_status, music_play_pause, music_next, music_prev,
music_get_track, whatsapp_send_message, whatsapp_read_messages, finder_list_files,
finder_get_info, terminal_run_command, delegate_domain_agent, get_active_agents_status

GENERATE a skill file with these STRICT rules:
1. module.exports must be an object with EXACTLY: name, toolNames, context
2. The context string should be expert-level knowledge about the gap topic
3. Include specific best practices, common pitfalls, and usage patterns
4. Keep context under 2000 characters (concise but comprehensive)
5. toolNames should list 1-5 existing tools that this knowledge enhances
6. Do NOT use require(), import, eval, or any function definitions
7. The ENTIRE file must be ONLY the module.exports = { ... } statement
8. Use backtick template literals for the context string

Output ONLY the JavaScript code. No markdown formatting, no explanations.`;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Attempt to forge skills for open capability gaps.
 *
 * @returns {{ forged: number, failed: number, skipped: number, skills: string[] }}
 */
async function forgeSkills() {
    // Load open gaps from knowledge graph
    const { getOpenGaps } = require('./gap-detector');
    const openGaps = getOpenGaps();

    if (openGaps.length === 0) {
        log.info('Skill Forge: no open gaps to address.');
        return { forged: 0, failed: 0, skipped: 0, skills: [] };
    }

    // Filter to only "knowledge" category gaps (Tier 1 only)
    // "tool" category gaps need manual implementation
    const forgeableGaps = openGaps.filter(gap => {
        const category = (gap.tags || []).find(t => ['knowledge', 'behavior'].includes(t));
        return !!category;
    });

    // Also filter out gaps that already have staged/active skills
    const newGaps = forgeableGaps.filter(gap => !staging.hasSkillForGap(gap.id));

    if (newGaps.length === 0) {
        log.info('Skill Forge: all gaps either need manual tools or already have skills.');
        return { forged: 0, failed: 0, skipped: openGaps.length, skills: [] };
    }

    const batch = newGaps.slice(0, MAX_FORGE_PER_CYCLE);
    let forged = 0;
    let failed = 0;
    const forgedSkills = [];

    for (const gap of batch) {
        try {
            const result = await _forgeOneSkill(gap);
            if (result.success) {
                forged++;
                forgedSkills.push(result.skillName);
            } else {
                failed++;
            }
        } catch (e) {
            log.error(`Forge failed for gap ${gap.id}: ${e.message}`);
            failed++;
        }
    }

    log.info(`Skill Forge: ${forged} forged, ${failed} failed, ${openGaps.length - batch.length} skipped.`);
    return { forged, failed, skipped: openGaps.length - batch.length, skills: forgedSkills };
}

/**
 * Generate a single Tier 1 skill file for a capability gap.
 */
async function _forgeOneSkill(gap) {
    const gapId = gap.id;
    const category = (gap.tags || []).find(t => ['knowledge', 'behavior'].includes(t)) || 'knowledge';
    const description = gap.description || gap.label;
    const evidence = gap._evidence || 'No specific evidence available.';

    log.info(`Forging skill for gap: ${gapId} (${category})`);

    // Generate skill file via LLM
    const prompt = SKILL_GENERATION_PROMPT
        .replace('{GAP_ID}', gapId)
        .replace('{GAP_CATEGORY}', category)
        .replace('{GAP_DESCRIPTION}', description)
        .replace('{GAP_EVIDENCE}', evidence);

    const response = await withMemoryApiKey(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        return await ai.models.generateContent({
            model: 'gemini-flash-latest',
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                temperature: 0.3,
                maxOutputTokens: 2048,
            },
        });
    }, { caller: 'SkillForge' });

    // Track token usage
    if (response.usageMetadata?.totalTokenCount) {
        reportTokenUsage(null, response.usageMetadata.totalTokenCount);
    }

    let code = response.text?.trim() || '';

    // Strip markdown code fences if present
    code = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();

    // ── SECURITY GATE: Validate generated code ──────────────────────────────
    const validation = validateSkillFile(code, { tier: 1 });

    if (!validation.valid) {
        log.warn(`❌ Skill validation FAILED for gap ${gapId}: ${validation.errors.join(', ')}`);
        logEvolution(ACTIONS.SKILL_REJECTED, {
            gapId,
            errors: validation.errors,
        });
        return { success: false, errors: validation.errors };
    }

    logEvolution(ACTIONS.SKILL_VALIDATED, { gapId });

    // Write file
    const safeName = gapId.replace(/^gap_/, '').replace(/[^a-z0-9_-]/gi, '-');
    const fileName = `${SKILL_FILE_PREFIX}${safeName}-skill.js`;
    const filePath = path.join(SKILLS_DIR, fileName);

    // Add generation metadata header
    const fileContent = `/**
 * AUTO-GENERATED by Cortex Skill Forge
 * Gap: ${gapId}
 * Generated: ${new Date().toISOString()}
 * 
 * This is a Tier 1 skill (context-only). It contains NO executable code.
 * It will be auto-promoted after 3 successful uses or auto-demoted after 2 errors.
 * 
 * DO NOT add require(), functions, or any logic to this file.
 */

${code}
`;

    fs.writeFileSync(filePath, fileContent, 'utf-8');
    log.info(`✅ Skill file written: ${fileName}`);

    logEvolution(ACTIONS.SKILL_GENERATED, {
        gapId,
        fileName,
        filePath,
    });

    // Hot-reload into runtime
    try {
        const { hotReloadSkill } = require('../skills/skill-loader');
        const loaded = hotReloadSkill(filePath);
        if (loaded) {
            logEvolution(ACTIONS.SKILL_LOADED, { gapId, fileName });
        }
    } catch (e) {
        log.warn(`Hot-reload failed for ${fileName}: ${e.message}`);
    }

    // Register in staging registry
    const skillNameMatch = code.match(/name\s*:\s*['"](.*?)['"]/);
    const skillName = skillNameMatch ? skillNameMatch[1] : safeName;

    staging.registerSkill(skillName, {
        tier: 1,
        filePath,
        gapId,
    });
    staging.activateSkill(skillName);

    // Mark gap as resolved
    const { resolveGap } = require('./gap-detector');
    resolveGap(gapId);

    // Queue notification for next user session
    pendingNotifications.push(
        `[CORTEX EVOLUTION: While idle, I noticed I kept struggling with "${description.slice(0, 100)}". ` +
        `I generated a new skill "${skillName}" to improve my performance in this area. ` +
        `This skill is now active and being monitored for effectiveness.]`
    );

    // Emit event for any connected listeners
    bus.dispatch(bus.EVENTS.CORTEX_SKILL_FORGED, {
        skillName,
        gapId,
        tier: 1,
        fileName,
    });

    log.info(`🎉 Skill "${skillName}" forged and loaded for gap ${gapId}`);
    return { success: true, skillName, fileName };
}

/**
 * Generate a tool declaration proposal for "tool" category gaps.
 * These are NOT auto-implemented — they're stored as proposals for the user.
 *
 * @param {Object} gap - The CapabilityGap node
 * @returns {{ name: string, declaration: Object }}
 */
async function proposeToolDeclaration(gap) {
    const description = gap.description || gap.label;

    const prompt = `You are designing a new tool for an AI voice assistant called "Summer".

The user needs a capability that doesn't exist yet:
"${description}"

Design a Gemini function declaration for this tool. Include:
1. name: lowercase_snake_case tool name
2. description: Clear description of what it does
3. parameters: JSON Schema for the tool's inputs
4. implementation_hint: Brief description of how to implement it (1-2 sentences)

Return as JSON with keys: name, description, parameters, implementation_hint`;

    const response = await withMemoryApiKey(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        return await ai.models.generateContent({
            model: 'gemini-flash-latest',
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                temperature: 0.2,
                maxOutputTokens: 1024,
                responseMimeType: 'application/json',
            },
        });
    }, { caller: 'SkillForge.proposeToolDeclaration' });

    const proposal = JSON.parse(response.text || '{}');

    log.info(`Tool declaration proposed: ${proposal.name || 'unknown'}`);
    return proposal;
}

module.exports = {
    forgeSkills,
    proposeToolDeclaration,
};

/**
 * skill-loader.js — Modular Skill System for Summer
 * 
 * Instead of dumping all app-specific instructions into the system prompt,
 * skills are loaded ON-DEMAND when the agent calls a related tool.
 * 
 * How it works:
 * 1. Each skill file defines: toolNames[] (which tools it covers) + context (detailed instructions)
 * 2. When a tool is executed, the skill loader checks if a skill exists for that tool
 * 3. If yes, the skill's context is injected INTO the tool response
 * 4. The agent reads the context and follows the instructions for its next action
 * 
 * This keeps the system prompt lean and gives the agent detailed, relevant
 * instructions only when it actually needs them.
 */

const fs = require('node:fs');
const path = require('node:path');

const SKILLS_DIR = __dirname;
const skills = new Map();

/**
 * Load all skill files from the skills directory.
 */
function loadAllSkills() {
    skills.clear();
    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('-skill.js'));
    
    for (const file of files) {
        try {
            const skill = require(path.join(SKILLS_DIR, file));
            if (skill.name && skill.toolNames && skill.context) {
                // Map each tool name to this skill
                for (const toolName of skill.toolNames) {
                    skills.set(toolName, skill);
                }
                console.log(`[Skills] ✅ Loaded skill: ${skill.name} (${skill.toolNames.length} tools)`);
            }
        } catch (e) {
            console.error(`[Skills] ❌ Failed to load ${file}:`, e.message);
        }
    }
    
    console.log(`[Skills] Total: ${skills.size} tool-to-skill mappings loaded.`);
}

/**
 * Get the skill context for a given tool name.
 * Returns the context string if a skill exists, or null.
 */
function getSkillContext(toolName) {
    const skill = skills.get(toolName);
    return skill ? skill.context : null;
}

/**
 * Get a summary of all loaded skills (for the system prompt).
 */
function getSkillSummaries() {
    const seen = new Set();
    const summaries = [];
    
    for (const [, skill] of skills) {
        if (!seen.has(skill.name)) {
            seen.add(skill.name);
            summaries.push(`- **${skill.name}**: ${skill.summary} (tools: ${skill.toolNames.join(', ')})`);
        }
    }
    
    return summaries.length > 0
        ? `\n\n### Available App Skills\nWhen you use any of these tools, you will receive detailed operating instructions in the tool response.\n${summaries.join('\n')}`
        : '';
}

/**
 * Enhance a tool response with skill context if available.
 * This injects the skill's instructions into the response the agent sees.
 */
function enhanceToolResponse(toolName, result) {
    const context = getSkillContext(toolName);
    if (!context) return result;
    
    // Add skill context to the result so the agent can read it
    if (typeof result === 'object' && result !== null) {
        return {
            ...result,
            _skillContext: context
        };
    }
    return result;
}

// Load skills on startup
loadAllSkills();

module.exports = { loadAllSkills, getSkillContext, getSkillSummaries, enhanceToolResponse };

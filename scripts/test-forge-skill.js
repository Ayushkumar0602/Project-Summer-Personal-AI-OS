#!/usr/bin/env node
/**
 * test-forge-skill.js
 * 
 * Directly tests the Skill Forge by injecting a "knowledge" category gap
 * and forcing skill generation + validation + Git Harvester PR creation.
 * 
 * This bypasses the Gap Detector entirely to test the forge → validate → 
 * stage → promote → harvest pipeline.
 */

'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const C = {
    reset:  '\x1b[0m',
    green:  '\x1b[32m',
    red:    '\x1b[31m',
    yellow: '\x1b[33m',
    cyan:   '\x1b[36m',
    bold:   '\x1b[1m',
    dim:    '\x1b[2m',
};

function banner(text) {
    console.log(`\n${C.bold}${C.cyan}${'═'.repeat(60)}${C.reset}`);
    console.log(`${C.bold}${C.cyan}  ${text}${C.reset}`);
    console.log(`${C.bold}${C.cyan}${'═'.repeat(60)}${C.reset}\n`);
}

function pass(msg) { console.log(`  ${C.green}✅ PASS${C.reset}  ${msg}`); }
function fail(msg) { console.log(`  ${C.red}❌ FAIL${C.reset}  ${msg}`); }
function info(msg) { console.log(`  ${C.dim}ℹ️  ${msg}${C.reset}`); }
function warn(msg) { console.log(`  ${C.yellow}⚠️  ${msg}${C.reset}`); }

async function main() {
    banner('🔨 FORGE TEST — Generate a Real Skill End-to-End');

    // ── Step 1: Inject a knowledge gap into the graph ─────────────────────
    banner('STEP 1: Inject Knowledge Gap');

    const { loadGraph, mergeGraph, saveGraph } = require('../src/knowledge/graph-store');
    const graph = loadGraph();

    const testGapId = 'gap_docker_best_practices';
    
    // Remove any existing gap with this ID
    graph.nodes = graph.nodes.filter(n => n.id !== testGapId);

    const newGap = {
        id: testGapId,
        label: 'Gap: docker best practices',
        type: 'CapabilityGap',
        description: 'Summer struggles with Docker commands — gives incorrect flags, uses deprecated docker-compose syntax, and does not know best practices for container management.',
        importance: 0.9,
        tags: ['knowledge', 'high', '#cortex_gap'],  // ← "knowledge" makes it forgeable
        source: 'cortex_gap_detector',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        _evidence: 'User corrected Summer 3 times about docker compose vs docker-compose syntax.',
        _status: 'open',
    };

    const merged = mergeGraph(graph, { nodes: [newGap], edges: [] });
    saveGraph(merged);
    
    pass(`Injected gap "${testGapId}" into knowledge graph`);
    info(`Category: knowledge, Priority: high`);
    info(`Description: ${newGap.description.slice(0, 80)}...`);

    // ── Step 2: Run Skill Forge ──────────────────────────────────────────
    banner('STEP 2: Forge Skill (LLM Call)');

    const { forgeSkills } = require('../src/cortex/skill-forge');
    const result = await forgeSkills();

    info(`Forge result: ${result.forged} forged, ${result.failed} failed, ${result.skipped} skipped`);

    if (result.forged === 0) {
        fail(`No skill was forged! Check the LLM response.`);
        if (result.failed > 0) fail(`${result.failed} forge attempt(s) failed.`);
        process.exit(1);
    }

    pass(`Forged ${result.forged} skill(s): [${result.skills.join(', ')}]`);

    // ── Step 3: Verify the generated file ────────────────────────────────
    banner('STEP 3: Verify Generated Skill File');

    const skillsDir = path.join(__dirname, '..', 'src', 'skills');
    const cortexFiles = fs.readdirSync(skillsDir)
        .filter(f => f.startsWith('cortex-') && f.includes('docker'));

    if (cortexFiles.length === 0) {
        fail('No cortex-*docker* skill file found in src/skills/');
        process.exit(1);
    }

    const skillFile = cortexFiles[0];
    const skillPath = path.join(skillsDir, skillFile);
    const skillContent = fs.readFileSync(skillPath, 'utf-8');

    pass(`Found skill file: ${skillFile}`);
    info(`File size: ${skillContent.length} bytes`);
    
    // Display the generated code
    console.log(`\n${C.dim}── Generated Skill File ──${C.reset}`);
    console.log(C.cyan + skillContent + C.reset);
    console.log(`${C.dim}── End of File ──${C.reset}\n`);

    // ── Step 4: Validate the generated code again ────────────────────────
    banner('STEP 4: Re-Validate Generated Code');

    const { validateSkillFile } = require('../src/cortex/sandbox-validator');
    const validation = validateSkillFile(skillContent, { tier: 1 });

    if (validation.valid) {
        pass('Generated code passes sandbox validation ✅');
    } else {
        fail(`Sandbox validation FAILED: ${validation.errors.join(', ')}`);
    }

    // Check the code structure
    const hasModuleExports = skillContent.includes('module.exports');
    const hasName = skillContent.includes("name:");
    const hasToolNames = skillContent.includes("toolNames:");
    const hasContext = skillContent.includes("context:");
    const hasRequire = /require\s*\(/.test(skillContent);
    const hasFunction = /function\s+\w+/.test(skillContent);

    pass(`Has module.exports: ${hasModuleExports}`);
    pass(`Has name field: ${hasName}`);
    pass(`Has toolNames field: ${hasToolNames}`);  
    pass(`Has context field: ${hasContext}`);
    if (!hasRequire) pass('No require() calls (safe)');
    else fail('Contains require() — DANGEROUS');
    if (!hasFunction) pass('No function declarations (safe)');
    else fail('Contains function declarations — DANGEROUS');

    // ── Step 5: Check staging registry ───────────────────────────────────
    banner('STEP 5: Staging Registry Status');

    const staging = require('../src/cortex/staging-registry');
    const skill = staging.getByStatus(staging.STATUS.ACTIVE);

    if (skill.length > 0) {
        const entry = skill.find(s => s.gapId === testGapId);
        if (entry) {
            pass(`Skill "${entry.skillName}" is ACTIVE in staging`);
            info(`Gap: ${entry.gapId}`);
            info(`File: ${entry.filePath}`);
            info(`Uses: ${entry.useCount}, Errors: ${entry.errorCount}`);

            // Simulate 3 successful uses to promote it
            info('Simulating 3 successful uses to trigger promotion...');
            staging.recordSuccess(entry.skillName);
            staging.recordSuccess(entry.skillName);
            staging.recordSuccess(entry.skillName);

            const promoted = staging.getSkill(entry.skillName);
            if (promoted.status === 'promoted') {
                pass(`Skill auto-promoted! Status: ${promoted.status}`);
            } else {
                warn(`Status after 3 uses: ${promoted.status}`);
            }
        } else {
            warn('Active skill not found for our test gap');
        }
    } else {
        warn('No active skills in staging');
    }

    // ── Step 6: Git Harvester ────────────────────────────────────────────
    banner('STEP 6: Git Harvester — Create PR');

    const { harvest, _isConfigured } = require('../src/cortex/git-harvester');

    if (!_isConfigured()) {
        warn('GitHub not configured — skipping PR creation');
        info('Add GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME to .env');
    } else {
        info('GitHub configured. Creating Pull Request...');
        const harvestResult = await harvest();
        
        if (harvestResult.harvested > 0) {
            pass(`🎉 Created ${harvestResult.harvested} Pull Request(s) on GitHub!`);
        } else if (harvestResult.errors.length > 0) {
            warn(`Harvest errors: ${harvestResult.errors.join('; ')}`);
        } else {
            info('No un-harvested promoted skills (may have been harvested already)');
            pass('Git Harvester ran cleanly');
        }
    }

    // ── Summary ──────────────────────────────────────────────────────────
    banner('SUMMARY');
    console.log(`  Gap injected:     ${testGapId}`);
    console.log(`  Skill generated:  ${result.skills.join(', ')}`);
    console.log(`  File:             src/skills/${cortexFiles[0]}`);
    console.log(`  Sandbox:          ${validation.valid ? '✅ SAFE' : '❌ FAILED'}`);
    console.log(`  Pipeline:         Gap → Forge → Validate → Load → Stage → Promote`);
    console.log();
}

main().catch(e => {
    console.error(`\n${C.red}Fatal error:${C.reset}`, e.message);
    console.error(e.stack);
    process.exit(1);
});

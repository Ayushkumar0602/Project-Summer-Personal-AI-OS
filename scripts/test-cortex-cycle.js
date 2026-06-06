#!/usr/bin/env node
/**
 * test-cortex-cycle.js
 *
 * End-to-end integration test for the Cortex Engine.
 * Runs each subsystem in isolation, then simulates a full idle cycle.
 *
 * Usage:
 *   node scripts/test-cortex-cycle.js              # Full test with LLM calls
 *   node scripts/test-cortex-cycle.js --dry-run     # Skip LLM calls (structural test only)
 */

'use strict';

require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');

// ── Fancy logging ────────────────────────────────────────────────────────────

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
function fail(msg, err) { console.log(`  ${C.red}❌ FAIL${C.reset}  ${msg}${err ? ': ' + err : ''}`); }
function info(msg) { console.log(`  ${C.dim}ℹ️  ${msg}${C.reset}`); }
function warn(msg) { console.log(`  ${C.yellow}⚠️  ${msg}${C.reset}`); }

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, msg) {
    if (condition) { pass(msg); testsPassed++; }
    else { fail(msg); testsFailed++; }
}

// ── Test 1: Evolution Log ────────────────────────────────────────────────────

async function testEvolutionLog() {
    banner('TEST 1: Evolution Log');

    const { logEvolution, ACTIONS, readRecentEntries, countByAction, getSummaryForReflection } = require('../src/cortex/evolution-log');

    // Write some entries
    logEvolution(ACTIONS.CORTEX_AWAKE, { enabledModules: { consolidator: true } });
    logEvolution(ACTIONS.CYCLE_START, { cycle: 1 });
    logEvolution(ACTIONS.NODES_PRUNED, { count: 3, nodes: ['old_fact_1', 'old_fact_2', 'old_fact_3'] });
    logEvolution(ACTIONS.GAP_DETECTED, { gapId: 'gap_test_docker', category: 'knowledge', priority: 'high' });
    logEvolution(ACTIONS.CYCLE_COMPLETE, { cycle: 1 });

    // Read them back
    const entries = readRecentEntries(60_000); // Last 60 seconds
    assert(entries.length >= 5, `Read ${entries.length} recent entries (expected ≥5)`);

    // Count by action
    const counts = countByAction(60_000);
    assert(counts.get(ACTIONS.CORTEX_AWAKE) >= 1, `CORTEX_AWAKE count: ${counts.get(ACTIONS.CORTEX_AWAKE)}`);
    assert(counts.get(ACTIONS.GAP_DETECTED) >= 1, `GAP_DETECTED count: ${counts.get(ACTIONS.GAP_DETECTED)}`);

    // Summary
    const summary = getSummaryForReflection(60_000);
    assert(summary.includes('cortex_awake'), `Summary contains activity data`);
    info(`Summary preview: "${summary.slice(0, 100)}..."`);
}

// ── Test 2: Sandbox Validator ────────────────────────────────────────────────

async function testSandboxValidator() {
    banner('TEST 2: Sandbox Validator (Security Gate)');

    const { validateSkillFile, validateToolDeclaration } = require('../src/cortex/sandbox-validator');

    // ── VALID skill file ──
    const validSkill = `
module.exports = {
    name: 'Docker Assistant',
    toolNames: ['terminal_run_command'],
    context: \`When running Docker commands:
- Always use 'docker compose' (not docker-compose)
- Check container status with 'docker ps' first
- Use --rm flag for temporary containers
- Mount volumes with absolute paths\`,
    summary: 'Best practices for Docker CLI usage',
};
`;

    const validResult = validateSkillFile(validSkill, { tier: 1 });
    assert(validResult.valid === true, `Valid skill file passes validation`);
    assert(validResult.errors.length === 0, `Zero errors on valid file`);

    // ── INVALID: contains require() ──
    const requireSkill = `
const fs = require('fs');
module.exports = { name: 'Bad Skill', toolNames: ['test'], context: 'test' };
`;
    const requireResult = validateSkillFile(requireSkill, { tier: 1 });
    assert(requireResult.valid === false, `Skill with require() is REJECTED`);
    assert(requireResult.errors.some(e => e.includes('require')), `Error mentions require(): "${requireResult.errors[0]}"`);

    // ── INVALID: contains eval() ──
    const evalSkill = `
module.exports = { name: 'Evil', toolNames: ['test'], context: eval('bad') };
`;
    const evalResult = validateSkillFile(evalSkill, { tier: 1 });
    assert(evalResult.valid === false, `Skill with eval() is REJECTED`);

    // ── INVALID: contains function declaration ──
    const funcSkill = `
function helper() { return 'bad'; }
module.exports = { name: 'Funcy', toolNames: ['test'], context: helper() };
`;
    const funcResult = validateSkillFile(funcSkill, { tier: 1 });
    assert(funcResult.valid === false, `Skill with function declaration is REJECTED`);

    // ── INVALID: contains process access ──
    const processSkill = `
module.exports = { name: 'Proc', toolNames: ['test'], context: process.env.SECRET };
`;
    const processResult = validateSkillFile(processSkill, { tier: 1 });
    assert(processResult.valid === false, `Skill with process access is REJECTED`);

    // ── INVALID: too large ──
    const bigSkill = `module.exports = { name: 'Big', toolNames: ['test'], context: '${'x'.repeat(5000)}' };`;
    const bigResult = validateSkillFile(bigSkill, { tier: 1 });
    assert(bigResult.valid === false, `Oversized skill (${Buffer.byteLength(bigSkill)} bytes) is REJECTED`);

    // ── VALID: Tool declaration ──
    const validDecl = { name: 'docker_build', description: 'Build a Docker image', parameters: { type: 'object', properties: {} } };
    const declResult = validateToolDeclaration(validDecl);
    assert(declResult.valid === true, `Valid tool declaration passes`);

    // ── INVALID: Bad tool declaration name ──
    const badDecl = { name: 'Docker Build!', description: 'test' };
    const badDeclResult = validateToolDeclaration(badDecl);
    assert(badDeclResult.valid === false, `Tool declaration with bad name is REJECTED`);

    info(`Validated ${8} security test cases.`);
}

// ── Test 3: Staging Registry ─────────────────────────────────────────────────

async function testStagingRegistry() {
    banner('TEST 3: Staging Registry (Lifecycle Tracker)');

    const staging = require('../src/cortex/staging-registry');

    // Register a test skill
    staging.registerSkill('Test Docker Skill', {
        tier: 1,
        filePath: '/tmp/test-docker-skill.js',
        gapId: 'gap_test_docker',
    });

    // Check it's staged
    const skill = staging.getSkill('Test Docker Skill');
    assert(skill !== null, `Skill registered successfully`);
    assert(skill.status === 'staged', `Status is "staged" (got: ${skill.status})`);
    assert(skill.gapId === 'gap_test_docker', `Gap ID matches`);

    // Activate it
    staging.activateSkill('Test Docker Skill');
    assert(staging.getSkill('Test Docker Skill').status === 'active', `Status changed to "active"`);

    // Record successes — should auto-promote after 3
    staging.recordSuccess('Test Docker Skill');
    staging.recordSuccess('Test Docker Skill');
    const promoted = staging.recordSuccess('Test Docker Skill');
    assert(promoted === true, `Auto-promoted after 3 successes`);
    assert(staging.getSkill('Test Docker Skill').status === 'promoted', `Status is now "promoted"`);

    // Test demotion flow
    staging.registerSkill('Bad Skill', { tier: 1, filePath: '/tmp/bad-skill.js', gapId: 'gap_test_bad' });
    staging.activateSkill('Bad Skill');
    staging.recordError('Bad Skill');
    const demoted = staging.recordError('Bad Skill');
    assert(!!demoted, `Auto-demoted after 2 errors (returned: ${JSON.stringify(demoted)})`);
    assert(staging.getSkill('Bad Skill').status === 'demoted', `Status is now "demoted"`);

    // Check counts
    const counts = staging.getStatusCounts();
    info(`Status counts: ${JSON.stringify(counts)}`);
    assert(counts.promoted >= 1, `At least 1 promoted skill`);
    assert(counts.demoted >= 1, `At least 1 demoted skill`);

    // Gap check
    assert(staging.hasSkillForGap('gap_test_docker') === true, `hasSkillForGap returns true for promoted skill`);
    assert(staging.hasSkillForGap('gap_nonexistent') === false, `hasSkillForGap returns false for unknown gap`);
}

// ── Test 4: Memory Consolidator ──────────────────────────────────────────────

async function testMemoryConsolidator() {
    banner('TEST 4: Memory Consolidator');

    const { pruneDecayedNodes, deduplicateNodes } = require('../src/cortex/memory-consolidator');

    // Test pruning (operates on actual graph — non-destructive if graph is small)
    const pruneResult = pruneDecayedNodes();
    assert(typeof pruneResult.prunedCount === 'number', `Prune returned count: ${pruneResult.prunedCount}`);
    info(`Pruned ${pruneResult.prunedCount} decayed nodes`);

    // Test dedup
    const dedupResult = deduplicateNodes();
    assert(typeof dedupResult.mergedCount === 'number', `Dedup returned count: ${dedupResult.mergedCount}`);
    info(`Merged ${dedupResult.mergedCount} duplicate entities`);
}

// ── Test 5: API Key Pool ─────────────────────────────────────────────────────

async function testApiKeyPool() {
    banner('TEST 5: API Key Pool (12-Key Fallback System)');

    const { getMemoryApiKey, getKeyPoolStatus, getTotalTokensToday, reportTokenUsage } = require('../src/knowledge/memory-api-key');

    const key = getMemoryApiKey();
    assert(key !== null && key !== undefined, `Got a valid API key`);
    assert(key.length >= 10, `Key has valid length (${key.length} chars)`);

    const status = getKeyPoolStatus();
    assert(Array.isArray(status), `Pool status is an array`);
    assert(status.length >= 1, `Pool has ${status.length} keys`);
    info(`Key pool status:`);
    for (const entry of status) {
        info(`  ${entry.label}: score=${entry.score}, success=${entry.successCount}, fail=${entry.failCount}, hint=${entry.keyHint}`);
    }

    // Test token reporting
    reportTokenUsage(key, 1000);
    const tokens = getTotalTokensToday();
    assert(tokens >= 1000, `Token tracking works (${tokens} tokens today)`);
}

// ── Test 6: Gap Detector (LLM) ──────────────────────────────────────────────

async function testGapDetector() {
    banner('TEST 6: Gap Detector (LLM Call)');

    if (DRY_RUN) {
        warn('Skipping LLM call (--dry-run mode)');
        return;
    }

    // First, check if diary has entries
    const { loadDiary } = require('../src/knowledge/session-diary');
    const diary = loadDiary();
    info(`Found ${diary.length} diary entries`);

    if (diary.length === 0) {
        warn('No diary entries — creating a synthetic one for testing...');
        // Write a test diary entry to test the pipeline
        const { appendDiaryEntry } = require('../src/knowledge/session-diary');
        appendDiaryEntry(
            'The user asked Summer to help debug a Docker container that was crashing. Summer tried to use terminal_run_command but gave incorrect Docker flags. The user had to manually correct the docker compose syntax. The user also asked about Kubernetes deployments but Summer had no knowledge of k8s cluster management.',
            null, 'frustrated', null
        );
        info('Synthetic diary entry created.');
    }

    const { detectGaps } = require('../src/cortex/gap-detector');
    const result = await detectGaps();

    assert(!result.skipped, `Gap detection was not skipped`);
    info(`Analyzed ${result.analyzed} diary entries`);
    info(`Found ${result.gaps.length} capability gap(s)`);

    for (const gap of result.gaps) {
        info(`  📋 Gap: ${gap.id} [${gap.category}] (${gap.priority})`);
        info(`     ${gap.description}`);
    }

    if (result.gaps.length > 0) {
        pass(`Gap detector found ${result.gaps.length} actionable gap(s)`);
    } else {
        warn(`No gaps found — Summer might be doing well, or diary entries are insufficient.`);
        // Still pass — 0 gaps is a valid outcome
        pass(`Gap detector ran without errors`);
    }
}

// ── Test 7: Skill Forge (LLM) ───────────────────────────────────────────────

async function testSkillForge() {
    banner('TEST 7: Skill Forge (LLM Call → Generate Skill)');

    if (DRY_RUN) {
        warn('Skipping LLM call (--dry-run mode)');
        return;
    }

    const { getOpenGaps } = require('../src/cortex/gap-detector');
    const openGaps = getOpenGaps();
    info(`Found ${openGaps.length} open gap(s) in knowledge graph`);

    if (openGaps.length === 0) {
        warn('No open gaps to forge skills for. Skipping.');
        return;
    }

    const { forgeSkills } = require('../src/cortex/skill-forge');
    const result = await forgeSkills();

    info(`Forge result: ${result.forged} forged, ${result.failed} failed, ${result.skipped} skipped`);

    if (result.forged > 0) {
        pass(`Successfully forged ${result.forged} skill(s): [${result.skills.join(', ')}]`);

        // Verify the skill file exists
        const fs = require('fs');
        const path = require('path');
        const skillsDir = path.join(__dirname, '..', 'src', 'skills');
        const cortexSkills = fs.readdirSync(skillsDir).filter(f => f.startsWith('cortex-'));
        info(`Cortex-generated skill files in src/skills/: ${cortexSkills.join(', ')}`);

        // Read and display the generated skill
        if (cortexSkills.length > 0) {
            const skillContent = fs.readFileSync(path.join(skillsDir, cortexSkills[0]), 'utf-8');
            console.log(`\n${C.dim}── Generated Skill File: ${cortexSkills[0]} ──${C.reset}`);
            console.log(C.dim + skillContent.slice(0, 800) + C.reset);
            if (skillContent.length > 800) console.log(C.dim + '... (truncated)' + C.reset);
        }
    } else if (result.failed > 0) {
        fail(`Forge failed for ${result.failed} gap(s)`);
    } else {
        warn('No forgeable gaps (all gaps may need manual tool implementation)');
        pass('Skill Forge ran without errors');
    }
}

// ── Test 8: Self-Reflector (LLM) ────────────────────────────────────────────

async function testSelfReflector() {
    banner('TEST 8: Self-Reflector (Meta-Analysis)');

    if (DRY_RUN) {
        warn('Skipping LLM call (--dry-run mode)');
        return;
    }

    const { reflect, loadPriorities } = require('../src/cortex/self-reflector');
    const result = await reflect();

    if (result.reflected) {
        pass(`Self-reflection complete`);
        info(`Journal: "${result.journalText.slice(0, 200)}..."`);
        info(`Priorities: ${result.priorities.length} item(s)`);
        for (const p of result.priorities) {
            info(`  🎯 ${p.id}: ${p.action} — ${p.reason}`);
        }
    } else {
        warn(`Reflection skipped: ${result.journalText}`);
        pass('Self-Reflector ran without errors');
    }

    // Verify priorities file
    const priorities = loadPriorities();
    info(`Saved priorities: ${priorities.length} item(s)`);
}

// ── Test 9: Git Harvester ───────────────────────────────────────────────────

async function testGitHarvester() {
    banner('TEST 9: Git Harvester (GitHub PR Automation)');

    const { harvest, _isConfigured } = require('../src/cortex/git-harvester');
    const staging = require('../src/cortex/staging-registry');

    // Check configuration detection
    const configured = _isConfigured();
    info(`GitHub configured: ${configured}`);
    info(`GITHUB_TOKEN: ${process.env.GITHUB_TOKEN ? '✅ set' : '❌ not set'}`);
    info(`GITHUB_REPO_OWNER: ${process.env.GITHUB_REPO_OWNER || '(not set)'}`);
    info(`GITHUB_REPO_NAME: ${process.env.GITHUB_REPO_NAME || '(not set)'}`);

    if (!configured) {
        // Test that it gracefully skips when not configured
        const result = await harvest();
        assert(result.harvested === 0, `Harvest gracefully returns 0 when not configured`);
        assert(result.errors.length === 0, `No errors when not configured`);
        pass('Git Harvester safely no-ops without GitHub credentials');
    } else {
        // GitHub IS configured — test the actual flow
        info('GitHub credentials found. Testing PR creation...');

        // Check if there are any un-harvested promoted skills
        const promoted = staging.getByStatus(staging.STATUS.PROMOTED)
            .filter(s => !s.harvestedAt);
        info(`Un-harvested promoted skills: ${promoted.length}`);

        if (promoted.length > 0 && !DRY_RUN) {
            const result = await harvest();
            info(`Harvest result: ${result.harvested} harvested, ${result.errors.length} errors`);
            if (result.harvested > 0) {
                pass(`Created ${result.harvested} Pull Request(s) on GitHub!`);
            } else if (result.errors.length > 0) {
                warn(`Harvest had errors: ${result.errors.join('; ')}`);
                pass('Git Harvester ran without crashing');
            } else {
                pass('Git Harvester ran successfully (0 eligible skills)');
            }
        } else {
            if (DRY_RUN) warn('Skipping GitHub API calls (--dry-run mode)');
            else warn('No un-harvested promoted skills to test with');
            pass('Git Harvester configuration validated');
        }
    }

    // Test markHarvested function
    staging.registerSkill('Harvest Test Skill', {
        tier: 1, filePath: '/tmp/harvest-test.js', gapId: 'gap_harvest_test',
    });
    staging.activateSkill('Harvest Test Skill');
    staging.recordSuccess('Harvest Test Skill');
    staging.recordSuccess('Harvest Test Skill');
    staging.recordSuccess('Harvest Test Skill'); // triggers promotion
    const markedOk = staging.markHarvested('Harvest Test Skill', 'https://github.com/test/repo/pull/99');
    assert(!!markedOk, `markHarvested returns truthy`);
    const entry = staging.getSkill('Harvest Test Skill');
    assert(entry.harvestedAt !== null, `harvestedAt is set (${new Date(entry.harvestedAt).toISOString()})`);
    assert(entry.prUrl === 'https://github.com/test/repo/pull/99', `prUrl is correct`);
}

// ── Test 10: Full Engine Simulation ──────────────────────────────────────────

async function testEngineSimulation() {
    banner('TEST 10: Cortex Engine State Machine');

    const { CortexEngine } = require('../src/cortex/cortex-engine');
    const bus = require('../src/core/event-bus');

    const engine = new CortexEngine({
        idleCooldownMs:   2000,    // 2 seconds for fast testing
        cycleIntervalMs:  1000,    // 1 second between cycles
        maxCyclesPerWake:  2,      // Just 2 cycles
        enabledModules: {
            consolidator: true,
            gapDetector:  false,    // Skip LLM in engine test
            skillForge:   false,    // Skip LLM in engine test
            gitHarvester: false,    // Skip GitHub in engine test
            reflector:    false,    // Skip LLM in engine test
            harvester:    false,
        },
    });

    // Track events
    const events = [];
    bus.on(bus.EVENTS.CORTEX_AWAKE, () => events.push('awake'));
    bus.on(bus.EVENTS.CORTEX_SLEEP, () => events.push('sleep'));
    bus.on(bus.EVENTS.CORTEX_CYCLE_DONE, (r) => events.push(`cycle_${r.cycle}`));

    engine.start();
    assert(engine.getState().state === 'cooldown' || engine.getState().state === 'dormant',
        `Engine started in correct state: ${engine.getState().state}`);

    // Simulate: no clients connected → should enter cooldown → awake
    info('Waiting for engine to awaken (2s cooldown + 2 cycles)...');

    await new Promise(resolve => setTimeout(resolve, 7000)); // Wait for cooldown + 2 cycles

    const state = engine.getState();
    info(`Engine state: ${state.state}, cycles: ${state.cyclesThisWake}`);
    info(`Events received: [${events.join(', ')}]`);

    // Simulate client connection → should sleep
    bus.dispatch(bus.EVENTS.CLIENT_CONNECTED, { clientId: 'test-client' });
    await new Promise(resolve => setTimeout(resolve, 500));

    assert(engine.getState().state === 'dormant', `Engine went dormant after client connect (state: ${engine.getState().state})`);

    engine.stop();
    assert(engine.getState().state === 'stopped', `Engine stopped cleanly`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    banner('🧠 CORTEX ENGINE — INTEGRATION TEST SUITE');
    info(`Mode: ${DRY_RUN ? 'DRY RUN (no LLM calls)' : 'FULL (with LLM calls)'}`);
    info(`Time: ${new Date().toLocaleString()}`);

    const startMs = Date.now();

    try {
        await testEvolutionLog();
        await testSandboxValidator();
        await testStagingRegistry();
        await testMemoryConsolidator();
        await testApiKeyPool();
        await testGapDetector();
        await testSkillForge();
        await testSelfReflector();
        await testGitHarvester();
        await testEngineSimulation();
    } catch (e) {
        fail(`Unhandled error: ${e.message}`);
        console.error(e.stack);
        testsFailed++;
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    banner('TEST RESULTS');
    console.log(`  ${C.green}Passed: ${testsPassed}${C.reset}`);
    console.log(`  ${C.red}Failed: ${testsFailed}${C.reset}`);
    console.log(`  ${C.dim}Time:   ${elapsed}s${C.reset}`);
    console.log();

    if (testsFailed === 0) {
        console.log(`  ${C.bold}${C.green}🎉 ALL TESTS PASSED!${C.reset}\n`);
    } else {
        console.log(`  ${C.bold}${C.red}💀 ${testsFailed} TEST(S) FAILED${C.reset}\n`);
    }

    process.exit(testsFailed > 0 ? 1 : 0);
}

main();

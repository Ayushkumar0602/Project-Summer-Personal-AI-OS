/**
 * cortex/staging-registry.js
 *
 * Tracks the full lifecycle of Cortex-generated capabilities.
 *
 * Every skill the Cortex generates goes through this lifecycle:
 *   staged → active → promoted | demoted
 *
 * Promotion rules:
 *   - Tier 1 (context-only): Auto-promote after useCount >= 3 AND errorCount === 0
 *   - Tier 2 (tool declaration): Requires manual approval (future)
 *   - Any skill with errorCount >= 2 → auto-demote, file deleted, gap re-opened
 *
 * Storage: Paths.cortexData() + '/cortex-staging.json'
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { createLogger } = require('../core/utils/logger');
const Paths = require('../core/utils/paths');
const { logEvolution, ACTIONS } = require('./evolution-log');

const log = createLogger('StagingRegistry');

const STAGING_FILE = path.join(Paths.cortexData(), 'cortex-staging.json');

// ── Lifecycle states ─────────────────────────────────────────────────────────

const STATUS = Object.freeze({
    STAGED:   'staged',     // Generated, loaded, not yet proven
    ACTIVE:   'active',     // Being used in sessions, tracking success
    PROMOTED: 'promoted',   // Proven reliable, becomes permanent
    DEMOTED:  'demoted',    // Failed, file removed, gap re-opened
});

// ── Promotion thresholds ─────────────────────────────────────────────────────

const PROMOTE_MIN_USES = 3;        // Must be used at least 3 times
const PROMOTE_MAX_ERRORS = 0;      // Must have zero errors
const DEMOTE_ERROR_THRESHOLD = 2;  // 2+ errors → auto-demote

// ── In-memory state ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} StagedSkill
 * @property {string} skillName     - The skill's export name
 * @property {number} tier          - 1 (context), 2 (tool decl), 3 (plugin)
 * @property {string} filePath      - Absolute path to the generated file
 * @property {string} gapId         - The CapabilityGap node ID this resolves
 * @property {string} status        - One of STATUS.*
 * @property {number} useCount      - Times the skill's tools were invoked
 * @property {number} errorCount    - Times the skill's tools failed
 * @property {number} createdAt     - Unix ms
 * @property {number} promotedAt    - Unix ms (null until promoted)
 * @property {number} demotedAt     - Unix ms (null unless demoted)
 * @property {string} demoteReason  - Why it was demoted (null unless demoted)
 * @property {number} harvestedAt   - Unix ms when PR was created (null until harvested)
 * @property {string} prUrl         - GitHub PR URL (null until harvested)
 */

/** @type {Map<string, StagedSkill>} */
let _registry = new Map();
let _loaded = false;

// ── Load / Save ──────────────────────────────────────────────────────────────

function _load() {
    if (_loaded) return;
    _loaded = true;
    try {
        if (fs.existsSync(STAGING_FILE)) {
            const raw = JSON.parse(fs.readFileSync(STAGING_FILE, 'utf-8'));
            _registry = new Map(Object.entries(raw));
        }
    } catch (e) {
        log.warn(`Failed to load staging registry: ${e.message}`);
        _registry = new Map();
    }
}

function _save() {
    try {
        const dir = path.dirname(STAGING_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STAGING_FILE, JSON.stringify(Object.fromEntries(_registry), null, 2), 'utf-8');
    } catch (e) {
        log.warn(`Failed to save staging registry: ${e.message}`);
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a newly generated skill in staging.
 *
 * @param {string} skillName
 * @param {Object} opts
 * @param {number} opts.tier
 * @param {string} opts.filePath
 * @param {string} opts.gapId
 */
function registerSkill(skillName, opts = {}) {
    _load();

    const entry = {
        skillName,
        tier:        opts.tier || 1,
        filePath:    opts.filePath,
        gapId:       opts.gapId,
        status:      STATUS.STAGED,
        useCount:    0,
        errorCount:  0,
        createdAt:   Date.now(),
        promotedAt:  null,
        demotedAt:   null,
        demoteReason: null,
        harvestedAt: null,
        prUrl:       null,
    };

    _registry.set(skillName, entry);
    _save();

    log.info(`Staged skill: ${skillName} (tier ${entry.tier}, gap: ${entry.gapId})`);
}

/**
 * Mark a staged skill as active (loaded into runtime).
 */
function activateSkill(skillName) {
    _load();
    const entry = _registry.get(skillName);
    if (!entry || entry.status !== STATUS.STAGED) return false;

    entry.status = STATUS.ACTIVE;
    _save();
    log.info(`Activated skill: ${skillName}`);
    return true;
}

/**
 * Record a successful use of a skill's tools.
 * Returns true if the skill was auto-promoted.
 */
function recordSuccess(skillName) {
    _load();
    const entry = _registry.get(skillName);
    if (!entry || entry.status === STATUS.DEMOTED) return false;

    entry.useCount++;
    _save();

    // Check for auto-promotion
    if (entry.status === STATUS.ACTIVE &&
        entry.useCount >= PROMOTE_MIN_USES &&
        entry.errorCount <= PROMOTE_MAX_ERRORS) {
        return _promote(skillName);
    }

    return false;
}

/**
 * Record an error from a skill's tools.
 * Returns true if the skill was auto-demoted.
 */
function recordError(skillName) {
    _load();
    const entry = _registry.get(skillName);
    if (!entry || entry.status === STATUS.DEMOTED) return false;

    entry.errorCount++;
    _save();

    // Check for auto-demotion
    if (entry.errorCount >= DEMOTE_ERROR_THRESHOLD) {
        return _demote(skillName, `Error threshold reached (${entry.errorCount} errors)`);
    }

    return false;
}

/**
 * Promote a skill to permanent status.
 */
function _promote(skillName) {
    const entry = _registry.get(skillName);
    if (!entry) return false;

    entry.status = STATUS.PROMOTED;
    entry.promotedAt = Date.now();
    _save();

    logEvolution(ACTIONS.SKILL_PROMOTED, {
        skillName,
        gapId: entry.gapId,
        useCount: entry.useCount,
    });

    log.info(`🎉 Skill promoted: ${skillName} (${entry.useCount} uses, 0 errors)`);
    return true;
}

/**
 * Demote a skill — removes it from runtime and marks as failed.
 *
 * @param {string} skillName
 * @param {string} reason
 * @returns {Object|null} The gap info (gapId) for re-opening
 */
function _demote(skillName, reason) {
    const entry = _registry.get(skillName);
    if (!entry) return null;

    entry.status = STATUS.DEMOTED;
    entry.demotedAt = Date.now();
    entry.demoteReason = reason;
    _save();

    // Try to delete the generated file
    try {
        if (entry.filePath && fs.existsSync(entry.filePath)) {
            fs.unlinkSync(entry.filePath);
            log.info(`Deleted demoted skill file: ${entry.filePath}`);
        }
    } catch (e) {
        log.warn(`Failed to delete skill file: ${e.message}`);
    }

    logEvolution(ACTIONS.SKILL_DEMOTED, {
        skillName,
        gapId: entry.gapId,
        reason,
        errorCount: entry.errorCount,
    });

    log.warn(`❌ Skill demoted: ${skillName} — ${reason}`);
    return { gapId: entry.gapId };
}

/**
 * Get all skills with a given status.
 */
function getByStatus(status) {
    _load();
    return [..._registry.values()].filter(e => e.status === status);
}

/**
 * Get all staged/active skills (not yet promoted or demoted).
 */
function getPending() {
    _load();
    return [..._registry.values()].filter(
        e => e.status === STATUS.STAGED || e.status === STATUS.ACTIVE
    );
}

/**
 * Get a specific skill entry.
 */
function getSkill(skillName) {
    _load();
    return _registry.get(skillName) || null;
}

/**
 * Get counts by status for the Self-Reflector.
 */
function getStatusCounts() {
    _load();
    const counts = { staged: 0, active: 0, promoted: 0, demoted: 0 };
    for (const entry of _registry.values()) {
        counts[entry.status] = (counts[entry.status] || 0) + 1;
    }
    return counts;
}

/**
 * Check if a skill exists for a given gap ID.
 */
function hasSkillForGap(gapId) {
    _load();
    for (const entry of _registry.values()) {
        if (entry.gapId === gapId && entry.status !== STATUS.DEMOTED) return true;
    }
    return false;
}

/**
 * Mark a promoted skill as harvested (PR created on GitHub).
 *
 * @param {string} skillName
 * @param {string} prUrl - The GitHub Pull Request URL
 */
function markHarvested(skillName, prUrl) {
    _load();
    const entry = _registry.get(skillName);
    if (!entry) return false;

    entry.harvestedAt = Date.now();
    entry.prUrl = prUrl;
    _save();

    log.info(`📦 Skill harvested: ${skillName} → ${prUrl}`);
    return true;
}

module.exports = {
    STATUS,
    registerSkill,
    activateSkill,
    recordSuccess,
    recordError,
    getByStatus,
    getPending,
    getSkill,
    getStatusCounts,
    hasSkillForGap,
    markHarvested,
};

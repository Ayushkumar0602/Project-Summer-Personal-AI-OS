/**
 * cortex/evolution-log.js
 *
 * Append-only audit trail for ALL Cortex Engine actions.
 *
 * Every gap detected, skill generated, memory consolidated, and reflection
 * is logged here as a single JSON line. This provides:
 *   1. Full accountability — you can trace every autonomous action
 *   2. Input data for the Self-Reflector
 *   3. Debugging when a generated skill doesn't work
 *
 * Format: JSON Lines (JSONL) — one JSON object per line.
 * Storage: Paths.cortexData() + '/evolution-log.jsonl'
 * Rotation: Files > 5MB are archived with a timestamp suffix.
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { createLogger } = require('../core/utils/logger');
const Paths = require('../core/utils/paths');

const log = createLogger('EvolutionLog');

const LOG_FILE = path.join(Paths.cortexData(), 'evolution-log.jsonl');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB before rotation

// ── Valid action types ───────────────────────────────────────────────────────

const ACTIONS = Object.freeze({
    // Lifecycle
    CORTEX_AWAKE:           'cortex_awake',
    CORTEX_SLEEP:           'cortex_sleep',
    CYCLE_START:            'cycle_start',
    CYCLE_COMPLETE:         'cycle_complete',

    // Gap Detection
    GAP_DETECTED:           'gap_detected',
    GAP_RESOLVED:           'gap_resolved',
    GAP_EXPIRED:            'gap_expired',

    // Skill Forge
    SKILL_GENERATED:        'skill_generated',
    SKILL_VALIDATED:        'skill_validated',
    SKILL_REJECTED:         'skill_rejected',
    SKILL_LOADED:           'skill_loaded',
    SKILL_PROMOTED:         'skill_promoted',
    SKILL_DEMOTED:          'skill_demoted',

    // Memory Consolidation
    NODES_PRUNED:           'nodes_pruned',
    NODES_DEDUPED:          'nodes_deduped',
    ISLANDS_CONNECTED:      'islands_connected',
    TEMPORAL_PATTERN:       'temporal_pattern',

    // Knowledge Harvester
    HARVEST_STARTED:        'harvest_started',
    HARVEST_COMPLETE:       'harvest_complete',
    PR_CREATED:             'pr_created',

    // Self-Reflection
    JOURNAL_WRITTEN:        'journal_written',
    PRIORITIES_UPDATED:     'priorities_updated',

    // Errors
    ERROR:                  'error',
});

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Log an evolution event.
 *
 * @param {string} action - One of ACTIONS.*
 * @param {object} [data] - Additional data specific to the action
 */
function logEvolution(action, data = {}) {
    try {
        _rotateIfNeeded();

        const entry = {
            action,
            ...data,
            _ts: Date.now(),
            _date: new Date().toISOString(),
        };

        const line = JSON.stringify(entry) + '\n';
        fs.appendFileSync(LOG_FILE, line, 'utf-8');

        log.debug(`Evolution: ${action}`, data.gapId || data.skillName ? { id: data.gapId || data.skillName } : undefined);
    } catch (e) {
        // Log file write should never crash the engine
        log.warn(`Failed to write evolution log: ${e.message}`);
    }
}

/**
 * Read recent evolution entries.
 *
 * @param {number} [maxAgeMs=86400000] - Max age in ms (default: 24 hours)
 * @param {string} [filterAction]      - Optional action type filter
 * @returns {object[]}
 */
function readRecentEntries(maxAgeMs = 24 * 3600 * 1000, filterAction = null) {
    try {
        if (!fs.existsSync(LOG_FILE)) return [];

        const cutoff = Date.now() - maxAgeMs;
        const lines = fs.readFileSync(LOG_FILE, 'utf-8')
            .split('\n')
            .filter(line => line.trim().length > 0);

        const entries = [];
        // Read from end for efficiency (recent entries are at bottom)
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(lines[i]);
                if (entry._ts < cutoff) break; // Entries are chronological, so stop early
                if (filterAction && entry.action !== filterAction) continue;
                entries.unshift(entry);
            } catch {
                // Skip malformed lines
            }
        }

        return entries;
    } catch (e) {
        log.warn(`Failed to read evolution log: ${e.message}`);
        return [];
    }
}

/**
 * Count entries by action type within a time window.
 *
 * @param {number} [maxAgeMs=86400000]
 * @returns {Map<string, number>}
 */
function countByAction(maxAgeMs = 24 * 3600 * 1000) {
    const entries = readRecentEntries(maxAgeMs);
    const counts = new Map();
    for (const entry of entries) {
        counts.set(entry.action, (counts.get(entry.action) || 0) + 1);
    }
    return counts;
}

/**
 * Get a summary string for the Self-Reflector.
 *
 * @param {number} [maxAgeMs=86400000]
 * @returns {string}
 */
function getSummaryForReflection(maxAgeMs = 24 * 3600 * 1000) {
    const counts = countByAction(maxAgeMs);
    if (counts.size === 0) return 'No evolution activity in the last 24 hours.';

    const lines = [];
    for (const [action, count] of counts) {
        lines.push(`  ${action}: ${count}`);
    }
    return `Evolution activity (last ${Math.round(maxAgeMs / 3600000)}h):\n${lines.join('\n')}`;
}

// ── File rotation ────────────────────────────────────────────────────────────

function _rotateIfNeeded() {
    try {
        if (!fs.existsSync(LOG_FILE)) return;
        const stats = fs.statSync(LOG_FILE);
        if (stats.size >= MAX_FILE_SIZE) {
            const archiveName = `evolution-log-${new Date().toISOString().split('T')[0]}.jsonl`;
            const archivePath = path.join(Paths.cortexData(), archiveName);
            fs.renameSync(LOG_FILE, archivePath);
            log.info(`Evolution log rotated → ${archiveName}`);
        }
    } catch {
        // Non-critical
    }
}

module.exports = {
    ACTIONS,
    logEvolution,
    readRecentEntries,
    countByAction,
    getSummaryForReflection,
};

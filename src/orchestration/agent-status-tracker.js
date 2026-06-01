/**
 * agent-status-tracker.js
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         GLOBAL BACKGROUND AGENT STATUS TRACKER                  ║
 * ║                                                                  ║
 * ║  Tracks all Tier 2 background agents (running, completed,        ║
 * ║  failed) in-memory, on local disk, and synced to Supabase so    ║
 * ║  Summer can see all background processes from ANY device.        ║
 * ║                                                                  ║
 * ║  Key design rules:                                               ║
 * ║  - Notifies Summer (via latestShadowContext) at milestones:      ║
 * ║    50%, 75%, and 100% (complete/fail) — not every tick.          ║
 * ║  - Shadow context is ONLY injected at those milestones           ║
 * ║    so Summer speaks about it proactively at the right time.      ║
 * ║  - On daemon restart, running tasks are auto-marked as           ║
 * ║    'terminated_by_restart' to prevent stale entries.             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { createLogger } = require('../core/utils/logger');
const Paths = require('../core/utils/paths');
const { supabase } = require('../services/supabase-client');

const log = createLogger('AgentStatusTracker');

// ── Storage paths ─────────────────────────────────────────────────────────────
const STATUS_FILE = path.join(Paths.userData(), 'background-agents.json');
const SUPABASE_KEY = 'active_background_agents';
const TABLE_SETTINGS = 'app_settings';

// ── Milestone thresholds at which Summer gets proactively notified ────────────
const MILESTONE_THRESHOLDS = [50, 75];

// ── In-memory store: sessionId → AgentRecord ─────────────────────────────────
let _cache = new Map();

/**
 * @typedef {Object} AgentRecord
 * @property {string}  sessionId       - Unique session ID (e.g. run_42)
 * @property {string}  agent_id        - Plugin ID (e.g. research_analyst)
 * @property {string}  display_name    - Human-readable name (e.g. "Deep Research")
 * @property {'running'|'completed'|'failed'|'killed'|'terminated_by_restart'} status
 * @property {number}  percent         - 0–100
 * @property {string}  message         - Latest status message
 * @property {number}  startedAt       - Unix ms
 * @property {number}  updatedAt       - Unix ms
 * @property {number[]} notifiedMilestones - Milestones (50, 75) already spoken about
 * @property {boolean}  completionNotified - Whether completion was spoken
 * @property {object}  [result]        - Set on completion
 * @property {object}  [error]         - Set on failure
 */

// ── Initialization ────────────────────────────────────────────────────────────

/**
 * Call once at daemon startup.
 * Loads existing state and marks any stale running tasks as terminated.
 */
async function init() {
    _loadFromDisk();
    _cleanupStaleRunning();
    await _syncToSupabase();
    log.info(`AgentStatusTracker initialized. Loaded ${_cache.size} record(s).`);
}

function _loadFromDisk() {
    try {
        if (fs.existsSync(STATUS_FILE)) {
            const raw = fs.readFileSync(STATUS_FILE, 'utf-8');
            const records = JSON.parse(raw);
            _cache = new Map(Object.entries(records));
        }
    } catch (e) {
        log.warn('Could not load background-agents.json from disk — starting fresh.', { err: e.message });
        _cache = new Map();
    }
}

/** Mark any 'running' records as terminated_by_restart (daemon was killed mid-task). */
function _cleanupStaleRunning() {
    let cleaned = 0;
    for (const [sid, rec] of _cache) {
        if (rec.status === 'running') {
            rec.status = 'terminated_by_restart';
            rec.message = 'Task interrupted — daemon was restarted.';
            rec.updatedAt = Date.now();
            _cache.set(sid, rec);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        log.warn(`Marked ${cleaned} stale running task(s) as terminated_by_restart.`);
        _saveToDisk();
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a new agent task when it starts.
 * @param {string} sessionId
 * @param {string} agent_id
 * @param {string} display_name
 * @param {string} [clientId]  - The client that initiated this task
 */
function onAgentStarted(sessionId, agent_id, display_name, clientId = null) {
    const record = {
        sessionId,
        agent_id,
        display_name: display_name || agent_id,
        status: 'running',
        percent: 0,
        message: 'Starting...',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        clientId: clientId || null,     // Flaw 10: track initiating client
        notifiedMilestones: [],
        completionNotified: false,
    };
    _cache.set(sessionId, record);
    _persist();
    log.info(`Agent started: ${display_name} (${sessionId}) [clientId: ${clientId || 'any'}]`);
}

/**
 * Update progress on a running agent.
 * Returns a milestone notification object if a threshold was just crossed, otherwise null.
 *
 * @param {string} sessionId
 * @param {number} percent
 * @param {string} message
 * @returns {{ shouldNotify: boolean, text: string } | null}
 */
function onAgentProgress(sessionId, percent, message) {
    const rec = _cache.get(sessionId);
    if (!rec || rec.status !== 'running') return null;

    rec.percent = Math.min(100, Math.max(0, percent));
    rec.message = message || rec.message;
    rec.updatedAt = Date.now();
    _cache.set(sessionId, rec);

    // Check if we just crossed a milestone threshold
    for (const threshold of MILESTONE_THRESHOLDS) {
        if (rec.percent >= threshold && !rec.notifiedMilestones.includes(threshold)) {
            rec.notifiedMilestones.push(threshold);
            _cache.set(sessionId, rec);
            _persist();
            return {
                shouldNotify: true,
                text: `[SYSTEM MILESTONE — Background Task "${rec.display_name}" is now ${threshold}% complete. Latest status: "${rec.message}". You may proactively mention this to the user if conversation permits.]`,
            };
        }
    }

    _persist();
    return null;
}

/**
 * Mark a task as completed.
 * @param {string} sessionId
 * @param {object} result
 * @returns {{ shouldNotify: boolean, text: string }}
 */
function onAgentComplete(sessionId, result) {
    const rec = _cache.get(sessionId);
    if (!rec) return { shouldNotify: false, text: '' };

    rec.status = 'completed';
    rec.percent = 100;
    rec.message = result?.file_path ? `Saved: ${result.file_path}` : 'Completed successfully.';
    rec.result = result;
    rec.updatedAt = Date.now();
    _cache.set(sessionId, rec);
    _persist();

    log.info(`Agent completed: ${rec.display_name} (${sessionId})`);

    return {
        shouldNotify: true,
        text: `[SYSTEM COMPLETION — Background Task "${rec.display_name}" has finished. ${rec.message} Proactively inform the user it is ready.]`,
    };
}

/**
 * Mark a task as failed.
 * @param {string} sessionId
 * @param {object} error
 * @returns {{ shouldNotify: boolean, text: string }}
 */
function onAgentFail(sessionId, error) {
    const rec = _cache.get(sessionId);
    if (!rec) return { shouldNotify: false, text: '' };

    rec.status = 'failed';
    rec.percent = 0;
    rec.message = error?.error || 'Task failed.';
    rec.error = error;
    rec.updatedAt = Date.now();
    _cache.set(sessionId, rec);
    _persist();

    log.warn(`Agent failed: ${rec.display_name} (${sessionId}) — ${rec.message}`);

    return {
        shouldNotify: true,
        text: `[SYSTEM FAILURE — Background Task "${rec.display_name}" failed. Reason: "${rec.message}". Inform the user and offer to retry or assist.]`,
    };
}

/**
 * Mark a task as killed/cancelled.
 * @param {string} sessionId
 * @param {string} reason
 */
function onAgentKilled(sessionId, reason) {
    const rec = _cache.get(sessionId);
    if (!rec) return;

    rec.status = 'killed';
    rec.message = `Cancelled: ${reason}`;
    rec.updatedAt = Date.now();
    _cache.set(sessionId, rec);
    _persist();
    log.info(`Agent killed: ${rec.display_name} (${sessionId}) — ${reason}`);
}

/**
 * Returns a formatted status summary string for injection into shadow context.
 * Only includes CURRENTLY RUNNING tasks.
 * Called on every turn-complete to give Summer passive awareness.
 */
function getRunningStatusSummary() {
    const running = [];
    for (const rec of _cache.values()) {
        if (rec.status === 'running') {
            running.push(`"${rec.display_name}" → ${rec.percent}% (${rec.message})`);
        }
    }
    if (running.length === 0) return null;
    return `[SYSTEM ACTIVE BACKGROUND PROCESSES — These are currently running:\n${running.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}\nDo NOT interrupt the conversation to report these unless the user asks or a milestone is reached.]`;
}

/**
 * Returns all agent records as a clean array (for the get_active_agents_status tool).
 * Sorts by updatedAt descending, limits to 20.
 */
function getAllStatus() {
    const records = [..._cache.values()];
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    return records.slice(0, 20).map(r => ({
        sessionId:    r.sessionId,
        agent_id:     r.agent_id,
        display_name: r.display_name,
        status:       r.status,
        percent:      r.percent,
        message:      r.message,
        startedAt:    new Date(r.startedAt).toLocaleString(),
        updatedAt:    new Date(r.updatedAt).toLocaleString(),
        result:       r.result || null,
        error:        r.error || null,
    }));
}

// ── Persistence helpers ───────────────────────────────────────────────────────

let _syncDebounceTimer = null;

function _persist() {
    _saveToDisk();
    // Debounce Supabase sync to avoid hammering on every progress tick
    if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = setTimeout(() => _syncToSupabase(), 3000);
}

function _saveToDisk() {
    try {
        const dir = path.dirname(STATUS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const obj = Object.fromEntries(_cache);
        fs.writeFileSync(STATUS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (e) {
        log.warn('Failed to save background-agents.json.', { err: e.message });
    }
}

async function _syncToSupabase() {
    if (!supabase) return;
    try {
        const payload = JSON.stringify(Object.fromEntries(_cache));
        await supabase.from(TABLE_SETTINGS).upsert({
            key: SUPABASE_KEY,
            value: payload,
            updated_at: new Date().toISOString(),
        });
        log.debug('Background agent status synced to Supabase.');
    } catch (e) {
        log.warn('Supabase sync for agent status failed (non-critical).', { err: e.message });
    }
}

module.exports = {
    init,
    onAgentStarted,
    onAgentProgress,
    onAgentComplete,
    onAgentFail,
    onAgentKilled,
    getRunningStatusSummary,
    getAllStatus,
};

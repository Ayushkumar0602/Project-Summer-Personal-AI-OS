/**
 * pending-notifications.js
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          PENDING NOTIFICATIONS QUEUE                             ║
 * ║                                                                  ║
 * ║  FLAW 7 FIX — Session Inactivity Timer Race                     ║
 * ║                                                                  ║
 * ║  Problem: When a background agent completes while no Gemini     ║
 * ║  session is active (e.g., auto-closed after 10min inactivity),  ║
 * ║  the `agent-milestone` event fires but no LiveSessionManager    ║
 * ║  is listening. The user never gets a verbal notification.       ║
 * ║                                                                  ║
 * ║  Solution: Queue undelivered milestone notifications to a       ║
 * ║  local JSON file. Replay them as priority shadow context on     ║
 * ║  the NEXT session start, so the user is informed naturally.     ║
 * ║                                                                  ║
 * ║  Queue is self-pruning — entries older than 24h are discarded.  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { createLogger } = require('./utils/logger');
const Paths = require('./utils/paths');

const log = createLogger('PendingNotifications');

const QUEUE_FILE = path.join(Paths.userData(), 'pending-notifications.json');
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours — older notifications are discarded
const MAX_QUEUE  = 20;                   // Never store more than 20 pending items

/**
 * @typedef {Object} PendingNotification
 * @property {string} id         - Unique ID
 * @property {string} text       - The shadow context text to inject
 * @property {number} createdAt  - Unix ms timestamp
 * @property {string} [clientId] - If set, only replay for this client's session
 */

let _queue = [];
let _loaded = false;

// ── Internal helpers ──────────────────────────────────────────────────────────

function _load() {
    if (_loaded) return;
    _loaded = true;
    try {
        if (fs.existsSync(QUEUE_FILE)) {
            const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
            _queue = JSON.parse(raw);
        }
    } catch {
        _queue = [];
    }
}

function _save() {
    try {
        const dir = path.dirname(QUEUE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(_queue, null, 2), 'utf-8');
    } catch (e) {
        log.warn('Failed to save pending-notifications.json', { err: e.message });
    }
}

function _prune() {
    const cutoff = Date.now() - MAX_AGE_MS;
    const before = _queue.length;
    _queue = _queue.filter(n => n.createdAt > cutoff);
    if (_queue.length !== before) {
        log.info(`Pruned ${before - _queue.length} expired notification(s).`);
    }
    // Cap at max
    if (_queue.length > MAX_QUEUE) {
        _queue = _queue.slice(-MAX_QUEUE);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Push a notification that could not be delivered to an active session.
 * Called by the daemon's `agent-milestone` listener when no session is open.
 *
 * @param {string} text       - The shadow context text
 * @param {string} [clientId] - Optional: scope to a specific client
 */
function push(text, clientId = null) {
    _load();
    _prune();

    const notification = {
        id:        `pn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text,
        createdAt: Date.now(),
        clientId:  clientId || null,
    };

    _queue.push(notification);
    _save();
    log.info(`Queued pending notification (queue size: ${_queue.length}): "${text.slice(0, 80)}..."`);
}

/**
 * Drain all pending notifications and return them as a single combined
 * shadow context string, ready to inject into the next session start.
 *
 * Automatically clears the queue after draining.
 *
 * @param {string} [clientId] - If provided, only drain notifications for this client
 * @returns {string|null}     - Combined shadow context string, or null if empty
 */
function drainForSession(clientId = null) {
    _load();
    _prune();

    const relevant = _queue.filter(n =>
        !n.clientId || !clientId || n.clientId === clientId
    );

    if (relevant.length === 0) return null;

    // Remove the drained items from queue
    const drainedIds = new Set(relevant.map(n => n.id));
    _queue = _queue.filter(n => !drainedIds.has(n.id));
    _save();

    const combined = relevant.map(n => n.text).join('\n');
    log.info(`Drained ${relevant.length} pending notification(s) into session start.`);
    return combined;
}

/**
 * How many notifications are currently pending.
 * @param {string} [clientId]
 */
function pendingCount(clientId = null) {
    _load();
    _prune();
    if (!clientId) return _queue.length;
    return _queue.filter(n => !n.clientId || n.clientId === clientId).length;
}

module.exports = { push, drainForSession, pendingCount };

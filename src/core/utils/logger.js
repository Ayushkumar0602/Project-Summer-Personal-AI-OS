/**
 * core/utils/logger.js
 *
 * Structured, levelled logger for the Core Daemon.
 * Writes to stdout AND a rolling log file in daemonData/logs/.
 * Zero Electron dependency.
 *
 * EPIPE Fix:
 *   When Electron closes the daemon subprocess pipe (e.g. on restart or quit),
 *   any console.log() call throws "Error: write EPIPE" which kills the daemon.
 *   We handle this in two layers:
 *     1. Attach 'error' handlers to stdout/stderr so Node.js does not treat
 *        EPIPE as an uncaught exception (standard Node.js idiom).
 *     2. Wrap every console.log() in try/catch so even if it slips through,
 *        the daemon survives and logs fall back to the file only.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const Paths = require('./paths');

// ── EPIPE suppression ─────────────────────────────────────────────────────────
// Electron may close the child-process pipe at any time (window close, restart).
// Attaching 'error' handlers prevents Node from treating EPIPE as uncaught.
if (process.stdout && !process.stdout.destroyed) {
    process.stdout.on('error', (err) => {
        if (err.code !== 'EPIPE') throw err; // re-throw unexpected errors
    });
}
if (process.stderr && !process.stderr.destroyed) {
    process.stderr.on('error', (err) => {
        if (err.code !== 'EPIPE') throw err;
    });
}

// ── Log directory ─────────────────────────────────────────────────────────────
const LOG_DIR = path.join(Paths.daemonData(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS       = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const LEVEL_LABELS = { 0: 'DEBUG', 1: 'INFO ', 2: 'WARN ', 3: 'ERROR' };
const COLORS       = { 0: '\x1b[36m', 1: '\x1b[32m', 2: '\x1b[33m', 3: '\x1b[31m' };
const RESET        = '\x1b[0m';

const currentLevel = LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LEVELS.INFO;

function _logFile() {
    const today = new Date().toISOString().split('T')[0];
    return path.join(LOG_DIR, `summer-daemon-${today}.log`);
}

function _write(level, namespace, message, meta) {
    if (level < currentLevel) return;
    const ts      = new Date().toISOString();
    const label   = LEVEL_LABELS[level];
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';

    // Console (coloured) — try/catch: EPIPE must never crash the daemon
    try {
        const color = COLORS[level];
        console.log(`${color}[${label}]${RESET} ${ts} [${namespace}] ${message}${metaStr}`);
    } catch (err) {
        // EPIPE = pipe broken (Electron closed). Fall through to file-only logging.
        // Any other error is also swallowed here to avoid recursive failure.
    }

    // File (plain text) — always attempted, independent of stdout state
    try {
        fs.appendFileSync(_logFile(), `[${label}] ${ts} [${namespace}] ${message}${metaStr}\n`);
    } catch (_) { /* non-fatal */ }
}

/**
 * Create a namespaced logger.
 * @param {string} namespace
 */
function createLogger(namespace) {
    return {
        debug: (msg, meta) => _write(LEVELS.DEBUG, namespace, msg, meta),
        info:  (msg, meta) => _write(LEVELS.INFO,  namespace, msg, meta),
        warn:  (msg, meta) => _write(LEVELS.WARN,  namespace, msg, meta),
        error: (msg, meta) => _write(LEVELS.ERROR, namespace, msg, meta),
    };
}

module.exports = { createLogger };

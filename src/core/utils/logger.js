/**
 * core/utils/logger.js
 *
 * Structured, levelled logger for the Core Daemon.
 * Writes to stdout AND a rolling log file in daemonData/logs/.
 * Zero Electron dependency.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const Paths = require('./paths');

const LOG_DIR = path.join(Paths.daemonData(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const LEVEL_LABELS = { 0: 'DEBUG', 1: 'INFO ', 2: 'WARN ', 3: 'ERROR' };
const COLORS = { 0: '\x1b[36m', 1: '\x1b[32m', 2: '\x1b[33m', 3: '\x1b[31m' };
const RESET = '\x1b[0m';

const currentLevel = LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LEVELS.INFO;

function _logFile() {
    const today = new Date().toISOString().split('T')[0];
    return path.join(LOG_DIR, `summer-daemon-${today}.log`);
}

function _write(level, namespace, message, meta) {
    if (level < currentLevel) return;
    const ts = new Date().toISOString();
    const label = LEVEL_LABELS[level];
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';

    // Console (coloured)
    const color = COLORS[level];
    console.log(`${color}[${label}]${RESET} ${ts} [${namespace}] ${message}${metaStr}`);

    // File (plain)
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

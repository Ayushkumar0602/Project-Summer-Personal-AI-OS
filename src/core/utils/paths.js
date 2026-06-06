/**
 * core/utils/paths.js
 *
 * Platform-agnostic path resolver.
 * ZERO Electron dependency — works in daemon, test, or any future Node.js context.
 */

'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

const PLATFORM = process.platform; // 'darwin' | 'win32' | 'linux'

function _ensure(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

const Paths = {
    /**
     * Root data directory for Summer (persists across updates).
     * macOS  → ~/Library/Application Support/Summer
     * Windows → %APPDATA%/Summer
     * Linux  → ~/.summer
     */
    userData() {
        if (PLATFORM === 'darwin')
            return _ensure(path.join(os.homedir(), 'Library', 'Application Support', 'Summer'));
        if (PLATFORM === 'win32')
            return _ensure(path.join(process.env.APPDATA || os.homedir(), 'Summer'));
        return _ensure(path.join(os.homedir(), '.summer'));
    },

    /** Temporary scratch directory — cleared on reboot. */
    temp() {
        return _ensure(path.join(os.tmpdir(), 'summer'));
    },

    /** User's desktop, cross-platform. */
    desktop() {
        return path.join(os.homedir(), 'Desktop');
    },

    /** User's Downloads folder. */
    downloads() {
        return path.join(os.homedir(), 'Downloads');
    },

    /** Daemon-specific data (memory graph, tokens, logs). */
    daemonData() {
        return _ensure(path.join(Paths.userData(), 'daemon'));
    },

    /** Audit / OS action log directory. */
    auditLogs() {
        return _ensure(path.join(Paths.daemonData(), 'audit-logs'));
    },

    /** Persistent timer store. */
    timerStore() {
        return path.join(Paths.daemonData(), 'timers.json');
    },

    /** Pairing token file used by all clients. */
    pairingToken() {
        return path.join(Paths.daemonData(), '.pairing-token');
    },

    /** Cortex Engine data directory (evolution logs, staging, priorities). */
    cortexData() {
        return _ensure(path.join(Paths.daemonData(), 'cortex'));
    },
};

module.exports = Paths;

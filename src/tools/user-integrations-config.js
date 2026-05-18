/**
 * User preferences for tool routing (persisted in userData).
 */

const Paths = require('../core/utils/paths');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = () => path.join(Paths.userData(), 'integrations-config.json');

const DEFAULT_CONFIG = {
    /** balanced = smart Google gating; full = every built-in tool at session start */
    mode: 'balanced',
    pinnedPacks: [],
};

let cachedConfig = null;
let cachedMtime = 0;

function loadConfig() {
    try {
        const configPath = CONFIG_PATH();
        if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };
        const stat = fs.statSync(configPath);
        if (cachedConfig && stat.mtimeMs === cachedMtime) return cachedConfig;
        const raw = fs.readFileSync(configPath, 'utf8');
        cachedConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        cachedMtime = stat.mtimeMs;
        return cachedConfig;
    } catch (e) {
        console.warn('[Integrations] Config load failed, using defaults:', e.message);
        return { ...DEFAULT_CONFIG };
    }
}

function saveConfig(updates) {
    const next = { ...loadConfig(), ...updates };
    fs.writeFileSync(CONFIG_PATH(), JSON.stringify(next, null, 2));
    cachedConfig = next;
    cachedMtime = Date.now();
    return next;
}

function invalidateConfigCache() {
    cachedConfig = null;
    cachedMtime = 0;
}

module.exports = { loadConfig, saveConfig, invalidateConfigCache, DEFAULT_CONFIG };

/**
 * plugin-env-policy.js
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║           PLUGIN ENVIRONMENT SANDBOX POLICY                     ║
 * ║                                                                  ║
 * ║  FLAW 5 FIX — Worker Thread Environment Isolation               ║
 * ║                                                                  ║
 * ║  Node.js worker_threads are NOT OS-level sandboxes. A plugin    ║
 * ║  inherits the full process.env by default — including           ║
 * ║  GEMINI_API_KEY, SUPABASE_SERVICE_KEY, Google OAuth tokens.    ║
 * ║                                                                  ║
 * ║  This module builds a filtered env object for each worker       ║
 * ║  based on the plugin's declared permissions in skill.json.      ║
 * ║                                                                  ║
 * ║  Trust Levels:                                                   ║
 * ║    "core"    → built-in Summer plugins (full access)            ║
 * ║    "trusted" → curated, reviewed third-party (limited access)   ║
 * ║    "community"→ unverified (minimal, OS-only env)               ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const { createLogger } = require('../core/utils/logger');
const log = createLogger('PluginEnvPolicy');

// ── Env var categories ────────────────────────────────────────────────────────

/** Always safe to pass — non-secret OS environment */
const OS_SAFE_KEYS = new Set([
    'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP',
    'USER', 'USERNAME', 'SHELL', 'LANG', 'LC_ALL',
    'NODE_PATH', 'NODE_ENV',
    'npm_config_cache', 'npm_config_prefix',
    'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES',
    'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME',
]);

/** Keys that grant access to Summer's Gemini quota — only for "core" plugins */
const GEMINI_KEYS = new Set([
    'GEMINI_API_KEY', 'GEMINI_LIVE_MODEL', 'GEMINI_VOICE_NAME',
]);

/** Keys that grant full cloud database access — never share with non-core */
const CLOUD_CREDENTIAL_KEYS = new Set([
    'SUPABASE_URL', 'SUPABASE_SERVICE_KEY',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
]);

/** Permissions declared in skill.json that unlock specific env keys */
const PERMISSION_ENV_MAP = {
    'env.gemini_api': GEMINI_KEYS,
    // Future: 'env.supabase' → CLOUD_CREDENTIAL_KEYS (for trusted plugins only)
};

// ── Trust-level profiles ──────────────────────────────────────────────────────

const TRUST_PROFILES = {
    /**
     * Built-in Summer plugins — these are first-party, reviewed code.
     * They get Gemini API access (they need it for AI calls) but NOT
     * the Supabase service key (they should use the graph-store module, not raw Supabase).
     */
    core: {
        extraKeys: new Set([...GEMINI_KEYS]),
        blockedKeys: new Set([...CLOUD_CREDENTIAL_KEYS]),
        logLabel: 'CORE',
    },

    /**
     * Reviewed, trusted third-party plugins.
     * Get Gemini access ONLY if they declare 'env.gemini_api' in permissions.
     * No cloud credentials.
     */
    trusted: {
        extraKeys: new Set(),
        blockedKeys: new Set([...CLOUD_CREDENTIAL_KEYS, ...GEMINI_KEYS]),
        logLabel: 'TRUSTED',
    },

    /**
     * Community / unverified plugins.
     * OS env vars only. No API keys whatsoever.
     * They must proxy all AI calls through the AgentSDK resource request mechanism.
     */
    community: {
        extraKeys: new Set(),
        blockedKeys: new Set([...CLOUD_CREDENTIAL_KEYS, ...GEMINI_KEYS]),
        logLabel: 'COMMUNITY',
    },
};

// ── Core plugin identifiers (built-in first-party) ────────────────────────────
const CORE_PLUGIN_IDS = new Set([
    'research_analyst_v2',
    'ppt_editor_v1',
]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a filtered env object for a plugin worker.
 *
 * @param {object} manifest  - Parsed skill.json manifest
 * @returns {object}         - Safe env object to pass as Worker `env` option
 */
function buildPluginEnv(manifest) {
    const agentId     = manifest.agent_id || 'unknown';
    const permissions = manifest.permissions || [];
    const trustLevel  = _resolveTrustLevel(agentId, manifest);
    const profile     = TRUST_PROFILES[trustLevel];

    const safeEnv = {};

    // 1. Start with OS-safe keys
    for (const key of OS_SAFE_KEYS) {
        if (process.env[key] !== undefined) {
            safeEnv[key] = process.env[key];
        }
    }

    // 2. Add profile-specific extra keys
    for (const key of profile.extraKeys) {
        if (process.env[key] !== undefined) {
            safeEnv[key] = process.env[key];
        }
    }

    // 3. Apply permission-gated keys (e.g., 'env.gemini_api' unlocks Gemini keys for trusted)
    if (trustLevel === 'trusted') {
        for (const perm of permissions) {
            const permKeys = PERMISSION_ENV_MAP[perm];
            if (permKeys) {
                for (const key of permKeys) {
                    if (!profile.blockedKeys.has(key) && process.env[key] !== undefined) {
                        safeEnv[key] = process.env[key];
                    }
                }
            }
        }
    }

    // 4. Final safety pass — strip anything that's explicitly blocked
    for (const key of profile.blockedKeys) {
        delete safeEnv[key];
    }

    const passedKeys = Object.keys(safeEnv);
    log.info(`Plugin env built for "${agentId}" [${profile.logLabel}]: ${passedKeys.length} vars passed.`);

    if (profile.blockedKeys.size > 0) {
        const blockedPresent = [...profile.blockedKeys].filter(k => process.env[k]);
        if (blockedPresent.length > 0) {
            log.warn(`🔒 Blocked ${blockedPresent.length} secret(s) from plugin "${agentId}": [${blockedPresent.join(', ')}]`);
        }
    }

    return safeEnv;
}

/**
 * Returns the trust level for a plugin.
 * Future: could read from a signed manifest or Summer's plugin registry.
 */
function _resolveTrustLevel(agentId, manifest) {
    if (CORE_PLUGIN_IDS.has(agentId)) return 'core';
    // Future: check a cryptographic signature or registry approval
    if (manifest.trust_level === 'trusted') return 'trusted';
    return 'community';
}

module.exports = { buildPluginEnv };

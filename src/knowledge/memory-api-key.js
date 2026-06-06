/**
 * memory-api-key.js
 *
 * Provides a resilient, multi-key API pool for ALL memory-related operations:
 *   - Graph extraction (graph-extractor.js)
 *   - Session diary summarization (session-diary.js)
 *   - Cortex Engine cycles (gap-detector, skill-forge, etc.)
 *
 * Supports 10-12 fallback keys with an efficient scoring algorithm:
 *   1. Keys are scored by: success rate × recency × latency
 *   2. On failure (429/503), key enters cooldown (exponential backoff)
 *   3. Round-robin across healthy keys, best-scoring key used first
 *   4. Daily token budget tracked per key for cost governance
 *
 * Key priority order:
 *   1. MEMORY_API_KEY           — dedicated primary
 *   2. MEMORY_API_KEY_FALLBACK  — secondary
 *   3-12. MEMORY_API_KEY_3..12  — additional fallback pool
 *   Last. GEMINI_API_KEY        — last resort (main conversation key)
 *
 * Usage:
 *   const { withMemoryApiKey } = require('./memory-api-key');
 *   const result = await withMemoryApiKey(async (key) => { ... });
 */

'use strict';

const { createLogger } = require('../core/utils/logger');
const log = createLogger('ApiKeyPool');

// ── Build key pool from environment ──────────────────────────────────────────

const KEY_ENV_NAMES = [
    'MEMORY_API_KEY',
    'MEMORY_API_KEY_FALLBACK',
    'MEMORY_API_KEY_3',
    'MEMORY_API_KEY_4',
    'MEMORY_API_KEY_5',
    'MEMORY_API_KEY_6',
    'MEMORY_API_KEY_7',
    'MEMORY_API_KEY_8',
    'MEMORY_API_KEY_9',
    'MEMORY_API_KEY_10',
    'MEMORY_API_KEY_11',
    'MEMORY_API_KEY_12',
    'GEMINI_API_KEY',  // Always last resort
];

/** @typedef {{ key: string, envName: string, index: number }} PoolEntry */

/** @type {PoolEntry[]} */
const KEY_POOL = KEY_ENV_NAMES
    .map((envName, index) => ({
        key: process.env[envName]?.trim() || null,
        envName,
        index,
    }))
    .filter(e => e.key && e.key.length >= 10); // Filter empty/invalid

// Deduplicate keys (same key in multiple env vars → keep first occurrence only)
const _seenKeys = new Set();
const UNIQUE_KEY_POOL = KEY_POOL.filter(entry => {
    if (_seenKeys.has(entry.key)) return false;
    _seenKeys.add(entry.key);
    return true;
});

if (UNIQUE_KEY_POOL.length === 0) {
    log.error('❌ No API keys found! Set MEMORY_API_KEY or GEMINI_API_KEY in .env');
}

// ── Per-key health tracking ──────────────────────────────────────────────────

/**
 * @typedef {Object} KeyHealth
 * @property {number} successCount    - Total successful calls
 * @property {number} failCount       - Total failed calls
 * @property {number} consecutiveFails - Sequential failures (resets on success)
 * @property {number} lastSuccessAt   - Timestamp of last success
 * @property {number} lastFailAt      - Timestamp of last failure
 * @property {number} cooldownUntil   - Timestamp until which this key is skipped
 * @property {number} avgLatencyMs    - Rolling average latency
 * @property {number} tokensUsedToday - Tokens consumed today (reset daily)
 * @property {string} lastResetDate   - Date string of last token reset
 */

/** @type {Map<number, KeyHealth>} */
const _healthMap = new Map();

function _getHealth(index) {
    if (!_healthMap.has(index)) {
        _healthMap.set(index, {
            successCount: 0,
            failCount: 0,
            consecutiveFails: 0,
            lastSuccessAt: 0,
            lastFailAt: 0,
            cooldownUntil: 0,
            avgLatencyMs: 0,
            tokensUsedToday: 0,
            lastResetDate: new Date().toISOString().split('T')[0],
        });
    }
    const health = _healthMap.get(index);

    // Daily token budget reset
    const today = new Date().toISOString().split('T')[0];
    if (health.lastResetDate !== today) {
        health.tokensUsedToday = 0;
        health.lastResetDate = today;
    }

    return health;
}

// ── Scoring algorithm ────────────────────────────────────────────────────────

/**
 * Calculate a score for a key (higher = better).
 * Factors:
 *   - Success rate (0-1) × 40 points
 *   - Recency of last success (0-1, exponential decay) × 20 points
 *   - Latency (inverse, capped) × 10 points
 *   - Cooldown penalty: -1000 if currently in cooldown
 *   - Position bonus: earlier keys get slight preference (+5 for first)
 */
function _scoreKey(index) {
    const health = _getHealth(index);
    const now = Date.now();

    // Cooldown gate — completely skip
    if (health.cooldownUntil > now) return -1000;

    const total = health.successCount + health.failCount;
    if (total === 0) return 50 + (UNIQUE_KEY_POOL.length - index); // Untested keys get mid score + position bias

    // Success rate: 0-1
    const successRate = health.successCount / total;

    // Recency: how recently this key worked (decay over 1 hour)
    const sinceLastSuccess = now - (health.lastSuccessAt || 0);
    const recency = Math.exp(-sinceLastSuccess / (3600 * 1000)); // Half-life: ~1 hour

    // Latency: inverse, normalized (lower latency = higher score)
    const latencyScore = health.avgLatencyMs > 0
        ? Math.max(0, 1 - (health.avgLatencyMs / 5000)) // 5s = worst
        : 0.5; // Unknown latency = neutral

    // Position bonus (prefer earlier keys slightly)
    const positionBonus = Math.max(0, 5 - index * 0.5);

    return (successRate * 40) + (recency * 20) + (latencyScore * 10) + positionBonus;
}

/**
 * Get the sorted list of available keys, best-scoring first.
 * Keys currently in cooldown are placed at the end.
 */
function _getKeyRanking() {
    return UNIQUE_KEY_POOL
        .map(entry => ({
            ...entry,
            score: _scoreKey(entry.index),
            health: _getHealth(entry.index),
        }))
        .sort((a, b) => b.score - a.score);
}

// ── Cooldown backoff ─────────────────────────────────────────────────────────

const BASE_COOLDOWN_MS = 30_000; // 30 seconds
const MAX_COOLDOWN_MS  = 600_000; // 10 minutes

function _applyCooldown(index) {
    const health = _getHealth(index);
    // Exponential backoff: 30s, 60s, 120s, 240s... capped at 10min
    const backoff = Math.min(
        BASE_COOLDOWN_MS * Math.pow(2, Math.min(health.consecutiveFails - 1, 5)),
        MAX_COOLDOWN_MS
    );
    health.cooldownUntil = Date.now() + backoff;
    log.warn(`Key ${_getLabel(index)} entering cooldown for ${(backoff / 1000).toFixed(0)}s (${health.consecutiveFails} consecutive failures)`);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the currently best-scoring healthy memory API key.
 */
function getMemoryApiKey() {
    const ranking = _getKeyRanking();
    const best = ranking.find(r => r.score > 0);
    return best?.key || UNIQUE_KEY_POOL[0]?.key;
}

/**
 * Runs `fn(apiKey)` with automatic fallback on quota / rate-limit errors.
 * Iterates through keys in score-order. On quota error, applies cooldown
 * and tries the next key. Non-quota errors are thrown immediately.
 *
 * @param {Function} fn - async function that receives an apiKey string
 * @param {Object} [opts]
 * @param {string} [opts.caller] - Name of calling module (for logging)
 * @returns {Promise<any>} Result of fn
 */
async function withMemoryApiKey(fn, opts = {}) {
    const ranking = _getKeyRanking();
    const caller = opts.caller || 'unknown';
    let lastError;
    let attempt = 0;

    for (const entry of ranking) {
        // Skip keys in active cooldown
        if (entry.score <= -1000) continue;

        attempt++;
        const health = _getHealth(entry.index);
        const label = _getLabel(entry.index);
        const startMs = Date.now();

        try {
            const result = await fn(entry.key);
            const latencyMs = Date.now() - startMs;

            // Track success
            health.successCount++;
            health.consecutiveFails = 0;
            health.lastSuccessAt = Date.now();
            health.cooldownUntil = 0; // Clear any residual cooldown
            // Rolling average latency (EMA, alpha=0.3)
            health.avgLatencyMs = health.avgLatencyMs > 0
                ? health.avgLatencyMs * 0.7 + latencyMs * 0.3
                : latencyMs;

            if (attempt > 1) {
                log.info(`✅ ${caller} succeeded with ${label} (fallback #${attempt - 1}, ${latencyMs}ms)`);
            }
            return result;
        } catch (err) {
            const latencyMs = Date.now() - startMs;
            const isQuotaError = _isRateLimitOrQuotaError(err);
            lastError = err;

            health.failCount++;
            health.consecutiveFails++;
            health.lastFailAt = Date.now();

            if (isQuotaError) {
                _applyCooldown(entry.index);
                log.warn(`⚠️  ${caller}: ${label} hit quota/rate-limit (fail #${health.consecutiveFails}, ${latencyMs}ms). Trying next key...`);
            } else {
                // Non-quota error (bad request, parse error, etc.) — don't try more keys
                log.error(`❌ ${caller}: ${label} failed with non-quota error: ${err.message}`);
                throw err;
            }
        }
    }

    // All keys exhausted
    log.error(`❌ ${caller}: All ${UNIQUE_KEY_POOL.length} keys exhausted. Last error: ${lastError?.message}`);
    throw lastError || new Error('No API keys available');
}

/**
 * Report token usage for a key (called after successful API calls for budget tracking).
 * @param {string} apiKey - The key that was used
 * @param {number} tokenCount - Tokens consumed
 */
function reportTokenUsage(apiKey, tokenCount) {
    const entry = UNIQUE_KEY_POOL.find(e => e.key === apiKey);
    if (!entry) return;
    const health = _getHealth(entry.index);
    health.tokensUsedToday += tokenCount;
}

/**
 * Get total tokens used today across all keys.
 */
function getTotalTokensToday() {
    let total = 0;
    for (const entry of UNIQUE_KEY_POOL) {
        total += _getHealth(entry.index).tokensUsedToday;
    }
    return total;
}

// ── Error detection ──────────────────────────────────────────────────────────

function _isRateLimitOrQuotaError(err) {
    const msg = (err?.message || '').toLowerCase();
    const code = err?.status || err?.code || 0;
    return (
        code === 429 || code === 503 ||
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('quota') ||
        msg.includes('rate limit') ||
        msg.includes('resource_exhausted') ||
        msg.includes('too many requests') ||
        msg.includes('unavailable') ||
        msg.includes('high demand') ||
        msg.includes('overloaded')
    );
}

// ── Labels ───────────────────────────────────────────────────────────────────

function _getLabel(index) {
    const entry = UNIQUE_KEY_POOL.find(e => e.index === index);
    if (!entry) return `key[${index}]`;
    const hint = entry.key ? `...${entry.key.slice(-6)}` : 'missing';
    return `${entry.envName} (${hint})`;
}

/**
 * Returns a status summary of the key pool for diagnostics.
 */
function getKeyPoolStatus() {
    return _getKeyRanking().map(entry => {
        const health = _getHealth(entry.index);
        const now = Date.now();
        return {
            label: entry.envName,
            keyHint: entry.key ? `...${entry.key.slice(-6)}` : 'missing',
            score: Math.round(entry.score * 10) / 10,
            successCount: health.successCount,
            failCount: health.failCount,
            consecutiveFails: health.consecutiveFails,
            inCooldown: health.cooldownUntil > now,
            cooldownRemainingMs: Math.max(0, health.cooldownUntil - now),
            avgLatencyMs: Math.round(health.avgLatencyMs),
            tokensUsedToday: health.tokensUsedToday,
        };
    });
}

// ── Startup log ──────────────────────────────────────────────────────────────

log.info(`API Key Pool ready: ${UNIQUE_KEY_POOL.length} unique key(s) from ${KEY_POOL.length} env vars`);
for (const entry of UNIQUE_KEY_POOL) {
    log.info(`  ${entry.envName}: ...${entry.key.slice(-6)}`);
}

module.exports = {
    getMemoryApiKey,
    withMemoryApiKey,
    reportTokenUsage,
    getTotalTokensToday,
    getKeyPoolStatus,
};

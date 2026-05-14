/**
 * memory-api-key.js
 *
 * Provides a dedicated API key pool for ALL memory-related operations:
 *   - Graph extraction (graph-extractor.js)
 *   - Session diary summarization (session-diary.js)
 *
 * Key priority order:
 *   1. MEMORY_API_KEY      — dedicated primary key for memory work
 *   2. MEMORY_API_KEY_FALLBACK — secondary fallback if primary hits quota/rate-limit
 *   3. GEMINI_API_KEY      — last resort (main conversation key)
 *
 * Usage:
 *   const { getMemoryApiKey, withMemoryApiKey } = require('./memory-api-key');
 *   const key = getMemoryApiKey();          // simple getter
 *   const result = await withMemoryApiKey(async (key) => { ... });  // auto-retry
 */

const MEMORY_KEY_POOL = [
    process.env.MEMORY_API_KEY,
    process.env.MEMORY_API_KEY_FALLBACK,
    process.env.GEMINI_API_KEY,
].filter(Boolean); // remove undefined/empty entries

if (MEMORY_KEY_POOL.length === 0) {
    console.error('[MemoryKey] ❌ No API keys found! Set MEMORY_API_KEY or GEMINI_API_KEY in .env');
}

// Which key is currently active (round-robin on failure)
let currentKeyIndex = 0;
const keyFailCounts = new Map();

/**
 * Returns the currently-active memory API key.
 */
function getMemoryApiKey() {
    return MEMORY_KEY_POOL[currentKeyIndex] || MEMORY_KEY_POOL[0];
}

/**
 * Runs `fn(apiKey)` with automatic fallback on quota / rate-limit errors.
 * If the primary key fails with a 429 or quota error, automatically retries
 * with the next key in the pool.
 *
 * @param {Function} fn - async function that receives an apiKey string
 * @returns {Promise<any>} Result of fn
 */
async function withMemoryApiKey(fn) {
    const startIndex = currentKeyIndex;
    let lastError;

    for (let attempt = 0; attempt < MEMORY_KEY_POOL.length; attempt++) {
        const keyIndex = (startIndex + attempt) % MEMORY_KEY_POOL.length;
        const key = MEMORY_KEY_POOL[keyIndex];
        const keyLabel = getKeyLabel(keyIndex);

        try {
            const result = await fn(key);
            // Success — reset fail count for this key
            keyFailCounts.set(keyIndex, 0);
            if (attempt > 0) {
                console.log(`[MemoryKey] ✅ Succeeded with ${keyLabel} (fallback #${attempt})`);
                // Promote this key to primary for future calls
                currentKeyIndex = keyIndex;
            }
            return result;
        } catch (err) {
            const isQuotaError = isRateLimitOrQuotaError(err);
            const count = (keyFailCounts.get(keyIndex) || 0) + 1;
            keyFailCounts.set(keyIndex, count);
            lastError = err;

            if (isQuotaError && attempt < MEMORY_KEY_POOL.length - 1) {
                const nextLabel = getKeyLabel((startIndex + attempt + 1) % MEMORY_KEY_POOL.length);
                console.warn(`[MemoryKey] ⚠️  ${keyLabel} hit quota/rate-limit (fail #${count}). Trying ${nextLabel}...`);
            } else if (!isQuotaError) {
                // Non-quota error (bad request, parse error, etc.) — don't retry with different key
                throw err;
            }
        }
    }

    // All keys exhausted
    console.error(`[MemoryKey] ❌ All ${MEMORY_KEY_POOL.length} keys failed. Last error: ${lastError?.message}`);
    throw lastError;
}

/**
 * Checks if an error is a quota, rate-limit, or server overload error from the Gemini API.
 */
function isRateLimitOrQuotaError(err) {
    const msg = (err?.message || '').toLowerCase();
    return (
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('quota') ||
        msg.includes('rate limit') ||
        msg.includes('resource_exhausted') ||
        msg.includes('too many requests') ||
        msg.includes('unavailable') ||
        msg.includes('high demand')
    );
}

/**
 * Human-readable label for log messages.
 */
function getKeyLabel(index) {
    const labels = ['MEMORY_API_KEY (primary)', 'MEMORY_API_KEY_FALLBACK', 'GEMINI_API_KEY (main)'];
    return labels[index] || `key[${index}]`;
}

/**
 * Returns a status summary of the key pool for diagnostics.
 */
function getKeyPoolStatus() {
    return MEMORY_KEY_POOL.map((key, i) => ({
        label: getKeyLabel(i),
        active: i === currentKeyIndex,
        failCount: keyFailCounts.get(i) || 0,
        keyHint: key ? `...${key.slice(-6)}` : 'missing'
    }));
}

console.log(`[MemoryKey] Pool ready: ${MEMORY_KEY_POOL.length} key(s) [${MEMORY_KEY_POOL.map((_, i) => getKeyLabel(i)).join(' → ')}]`);

module.exports = { getMemoryApiKey, withMemoryApiKey, getKeyPoolStatus };

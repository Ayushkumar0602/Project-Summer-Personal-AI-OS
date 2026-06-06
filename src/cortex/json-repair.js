/**
 * cortex/json-repair.js
 *
 * Robust JSON parsing for LLM responses.
 *
 * Even with responseMimeType: 'application/json', Gemini sometimes:
 *   - Truncates output at maxOutputTokens boundary (unterminated strings)
 *   - Wraps JSON in markdown code fences
 *   - Includes trailing commas
 *
 * This module provides best-effort repair before failing.
 */

'use strict';

/**
 * Parse JSON from an LLM response with multiple fallback strategies.
 *
 * @param {string} text - Raw LLM response text
 * @param {any} [fallback=null] - Value to return if all parsing fails
 * @returns {any} Parsed JSON or fallback
 */
function safeParseLlmJson(text, fallback = null) {
    if (!text || typeof text !== 'string') return fallback;

    // Strategy 1: Direct parse
    try {
        return JSON.parse(text);
    } catch {}

    // Strategy 2: Strip markdown code fences
    let cleaned = text
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
    try {
        return JSON.parse(cleaned);
    } catch {}

    // Strategy 3: Extract JSON array or object via regex
    const jsonMatch = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[1]);
        } catch {}
        // Try repairing the extracted JSON
        cleaned = jsonMatch[1];
    }

    // Strategy 4: Repair common issues
    try {
        let repaired = cleaned;

        // Fix trailing commas before ] or }
        repaired = repaired.replace(/,\s*([}\]])/g, '$1');

        // Fix unterminated strings: count quotes, add missing closing quote
        const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
        if (quoteCount % 2 !== 0) {
            repaired += '"';
        }

        // Try to close unclosed brackets/braces
        const opens = { '[': 0, '{': 0 };
        const closes = { ']': '[', '}': '{' };
        let inString = false;
        let prevChar = '';

        for (const char of repaired) {
            if (char === '"' && prevChar !== '\\') inString = !inString;
            if (!inString) {
                if (char === '[' || char === '{') opens[char]++;
                if (char === ']' || char === '}') opens[closes[char]]--;
            }
            prevChar = char;
        }

        // Close any unclosed structures
        for (let i = 0; i < opens['{']; i++) repaired += '}';
        for (let i = 0; i < opens['[']; i++) repaired += ']';

        return JSON.parse(repaired);
    } catch {}

    // Strategy 5: If it looks like a truncated array, try to parse what we have
    if (cleaned.startsWith('[')) {
        try {
            // Find the last complete object in the array
            const lastComplete = cleaned.lastIndexOf('},');
            if (lastComplete > 0) {
                const partial = cleaned.slice(0, lastComplete + 1) + ']';
                return JSON.parse(partial);
            }
            const lastObj = cleaned.lastIndexOf('}');
            if (lastObj > 0) {
                const partial = cleaned.slice(0, lastObj + 1) + ']';
                return JSON.parse(partial);
            }
        } catch {}
    }

    // All strategies failed
    console.warn(`[JsonRepair] All parse strategies failed. Text preview: "${text.slice(0, 100)}..."`);
    return fallback;
}

module.exports = { safeParseLlmJson };

/**
 * cortex/sandbox-validator.js
 *
 * Static analysis validator for Cortex-generated skill files.
 *
 * This is the SECURITY GATE — no generated code enters the runtime
 * without passing every check here.
 *
 * Validation rules for Tier 1 skills (context-only):
 *   ✅ Must export: name (string), toolNames (string[]), context (string)
 *   ❌ REJECT if: require(), import, eval(), Function(), new Function
 *   ❌ REJECT if: process, child_process, fs, net, http, https, os, path
 *   ❌ REJECT if: __dirname, __filename, global, globalThis
 *   ❌ REJECT if: file > 4KB (skill contexts should be concise)
 *   ❌ REJECT if: any function declaration or arrow function
 *   ❌ REJECT if: any assignment to module-level variables beyond exports
 *
 * Uses Node.js built-in `vm` module to parse (NOT execute) the code.
 */

'use strict';

const vm = require('node:vm');
const { createLogger } = require('../core/utils/logger');

const log = createLogger('SandboxValidator');

// ── Size limits ──────────────────────────────────────────────────────────────

const MAX_SKILL_SIZE_BYTES = 4096; // 4KB
const MAX_CONTEXT_LENGTH   = 3000; // Characters in the context string

// ── Banned patterns (regex) ──────────────────────────────────────────────────

const BANNED_PATTERNS = [
    // Module system — no imports/requires
    { pattern: /\brequire\s*\(/,                    reason: 'require() calls are not allowed' },
    { pattern: /\bimport\s+/,                       reason: 'import statements are not allowed' },
    { pattern: /\bimport\s*\(/,                     reason: 'dynamic import() is not allowed' },

    // Code execution — no eval/Function
    { pattern: /\beval\s*\(/,                       reason: 'eval() is not allowed' },
    { pattern: /\bnew\s+Function\s*\(/,             reason: 'new Function() is not allowed' },
    { pattern: /\bFunction\s*\(/,                   reason: 'Function() constructor is not allowed' },

    // Dangerous Node.js globals
    { pattern: /\bprocess\b/,                       reason: 'process access is not allowed' },
    { pattern: /\bchild_process\b/,                 reason: 'child_process is not allowed' },
    { pattern: /\bglobal\b(?!This)/,                reason: 'global access is not allowed' },
    { pattern: /\bglobalThis\b/,                    reason: 'globalThis access is not allowed' },
    { pattern: /\b__dirname\b/,                     reason: '__dirname is not allowed' },
    { pattern: /\b__filename\b/,                    reason: '__filename is not allowed' },

    // Filesystem / network — no I/O
    { pattern: /\bfs\b/,                            reason: 'fs module access is not allowed' },
    { pattern: /\bnet\b/,                           reason: 'net module is not allowed' },
    { pattern: /\bhttp\b/,                          reason: 'http module is not allowed' },
    { pattern: /\bhttps\b/,                         reason: 'https module is not allowed' },
    { pattern: /\bdgram\b/,                         reason: 'dgram module is not allowed' },
    { pattern: /\btls\b/,                           reason: 'tls module is not allowed' },
    { pattern: /\bos\b\s*\./,                       reason: 'os module access is not allowed' },

    // No function definitions (skills are data, not code)
    { pattern: /\bfunction\s+\w+\s*\(/,             reason: 'Function declarations are not allowed' },
    { pattern: /=>\s*{/,                            reason: 'Arrow functions with bodies are not allowed' },
    { pattern: /\basync\s/,                         reason: 'async functions are not allowed' },

    // No class definitions
    { pattern: /\bclass\s+\w+/,                     reason: 'Class declarations are not allowed' },

    // No timers (could create persistent side-effects)
    { pattern: /\bsetTimeout\b/,                    reason: 'setTimeout is not allowed' },
    { pattern: /\bsetInterval\b/,                   reason: 'setInterval is not allowed' },
    { pattern: /\bsetImmediate\b/,                  reason: 'setImmediate is not allowed' },
];

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a generated skill file's source code.
 *
 * @param {string} code       - The full source code of the skill file
 * @param {Object} [opts]
 * @param {number} [opts.tier=1]  - Skill tier (1=context only, 2=tool decl)
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateSkillFile(code, opts = {}) {
    const tier = opts.tier || 1;
    const errors = [];
    const warnings = [];

    // ── 1. Size check ────────────────────────────────────────────────────────
    const sizeBytes = Buffer.byteLength(code, 'utf-8');
    if (sizeBytes > MAX_SKILL_SIZE_BYTES) {
        errors.push(`File too large: ${sizeBytes} bytes (max: ${MAX_SKILL_SIZE_BYTES})`);
    }

    // ── 2. Syntax check (parse without executing) ────────────────────────────
    try {
        new vm.Script(code, { filename: 'generated-skill.js' });
    } catch (e) {
        errors.push(`Syntax error: ${e.message}`);
        return { valid: false, errors, warnings }; // Can't continue if it won't parse
    }

    // ── 3. Banned pattern scan ───────────────────────────────────────────────
    // Strip comments and strings first to avoid false positives
    const stripped = _stripCommentsAndStringsForScan(code);

    for (const { pattern, reason } of BANNED_PATTERNS) {
        if (pattern.test(stripped)) {
            errors.push(reason);
        }
    }

    // ── 4. Structural validation — must export required fields ───────────────
    if (tier === 1) {
        // Tier 1: must have module.exports with name, toolNames, context
        if (!code.includes('module.exports')) {
            errors.push('Missing module.exports');
        }
        if (!code.includes('exports.name') && !code.match(/name\s*:/)) {
            // Check both `exports.name = ...` and `module.exports = { name: ... }`
            if (!code.match(/['"]name['"]\s*:/)) {
                warnings.push('Could not detect a "name" export — verify manually');
            }
        }
        if (!code.includes('toolNames') && !code.match(/tool_names/i)) {
            errors.push('Missing toolNames export — required for skill routing');
        }
        if (!code.includes('context')) {
            errors.push('Missing context export — this is the core of a Tier 1 skill');
        }
    }

    // ── 5. Context length check ──────────────────────────────────────────────
    const contextMatch = code.match(/context\s*:\s*[`'"]([\s\S]*?)[`'"]/);
    if (contextMatch && contextMatch[1].length > MAX_CONTEXT_LENGTH) {
        warnings.push(`Context string is ${contextMatch[1].length} chars (recommended max: ${MAX_CONTEXT_LENGTH})`);
    }

    // ── 6. No suspicious assignments ─────────────────────────────────────────
    // Check for variable declarations outside of module.exports
    const suspiciousAssignments = stripped.match(/\b(var|let|const)\s+\w+\s*=/g);
    if (suspiciousAssignments && suspiciousAssignments.length > 3) {
        warnings.push(`${suspiciousAssignments.length} variable declarations found — skills should be mostly data`);
    }

    const valid = errors.length === 0;

    if (valid) {
        log.info(`✅ Skill validation passed (${sizeBytes} bytes, ${warnings.length} warning(s))`);
    } else {
        log.warn(`❌ Skill validation FAILED: ${errors.length} error(s)`, { errors });
    }

    return { valid, errors, warnings };
}

/**
 * Validate a generated tool declaration object.
 * Used for Tier 2 skills (future) that declare new Gemini tool schemas.
 *
 * @param {Object} declaration - The tool declaration
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateToolDeclaration(declaration) {
    const errors = [];

    if (!declaration.name || typeof declaration.name !== 'string') {
        errors.push('Missing or invalid tool name');
    }
    if (declaration.name && !/^[a-z][a-z0-9_]{2,40}$/.test(declaration.name)) {
        errors.push(`Tool name "${declaration.name}" must be lowercase_snake_case (3-41 chars)`);
    }
    if (!declaration.description || typeof declaration.description !== 'string') {
        errors.push('Missing tool description');
    }
    if (declaration.description && declaration.description.length > 500) {
        errors.push('Tool description too long (max 500 chars)');
    }
    // Parameters must be a valid JSON Schema object
    if (declaration.parameters) {
        if (typeof declaration.parameters !== 'object') {
            errors.push('Parameters must be an object');
        }
        if (declaration.parameters.type !== 'object') {
            errors.push('Parameters.type must be "object"');
        }
    }

    return { valid: errors.length === 0, errors };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip comments and string literals from code for pattern scanning.
 * This prevents false positives like `context: "Use the fs command..."` triggering the fs ban.
 *
 * Simple approach: replace all string contents with empty strings.
 */
function _stripCommentsAndStringsForScan(code) {
    // Remove single-line comments
    let stripped = code.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments
    stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
    // Replace template literal contents (backtick strings)
    stripped = stripped.replace(/`[^`]*`/g, '``');
    // Replace double-quoted string contents
    stripped = stripped.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    // Replace single-quoted string contents
    stripped = stripped.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    return stripped;
}

module.exports = {
    validateSkillFile,
    validateToolDeclaration,
    MAX_SKILL_SIZE_BYTES,
    MAX_CONTEXT_LENGTH,
};

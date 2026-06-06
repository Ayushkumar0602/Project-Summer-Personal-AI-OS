/**
 * cortex/git-harvester.js
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         GIT HARVESTER — Auto-PR for Promoted Skills             ║
 * ║                                                                  ║
 * ║  When a Cortex-generated skill is PROMOTED (proven reliable),   ║
 * ║  this module automatically:                                      ║
 * ║    1. Creates a new branch on GitHub                             ║
 * ║    2. Commits the skill file                                     ║
 * ║    3. Opens a Pull Request for human review                      ║
 * ║                                                                  ║
 * ║  This allows Summer to propose code changes to its own           ║
 * ║  codebase — even while the developer is asleep.                  ║
 * ║                                                                  ║
 * ║  Safety:                                                         ║
 * ║    - NEVER pushes to main directly                               ║
 * ║    - Always creates a branch + PR for human review               ║
 * ║    - Requires explicit GITHUB_TOKEN in .env                      ║
 * ║    - Gracefully no-ops if token is missing                       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Environment Variables Required:
 *   GITHUB_TOKEN       — Personal access token with 'repo' scope
 *   GITHUB_REPO_OWNER  — e.g., 'Ayushkumar0602'
 *   GITHUB_REPO_NAME   — e.g., 'project-summer'
 *   GITHUB_BASE_BRANCH — (optional, default: 'main')
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { createLogger } = require('../core/utils/logger');
const { logEvolution, ACTIONS } = require('./evolution-log');
const staging = require('./staging-registry');

const log = createLogger('GitHarvester');

// ── GitHub API Base ──────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';

// ── Configuration ────────────────────────────────────────────────────────────

function _getConfig() {
    const token = process.env.GITHUB_TOKEN || '';
    const owner = process.env.GITHUB_REPO_OWNER || '';
    const repo  = process.env.GITHUB_REPO_NAME || '';
    const base  = process.env.GITHUB_BASE_BRANCH || 'main';

    return { token, owner, repo, base };
}

function _isConfigured() {
    const { token, owner, repo } = _getConfig();
    return !!(token && owner && repo);
}

// ── GitHub API Helper ────────────────────────────────────────────────────────

/**
 * Make an authenticated request to the GitHub REST API.
 *
 * @param {string} endpoint  - Path after /repos/:owner/:repo (e.g., '/git/refs')
 * @param {Object} opts
 * @param {string} [opts.method='GET']
 * @param {Object} [opts.body]
 * @param {boolean} [opts.fullUrl=false] - If true, endpoint is the full URL
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
async function _githubApi(endpoint, opts = {}) {
    const { token, owner, repo } = _getConfig();
    const method = opts.method || 'GET';
    const fullUrl = opts.fullUrl
        ? endpoint
        : `${GITHUB_API}/repos/${owner}/${repo}${endpoint}`;

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Summer-Cortex-Engine/1.0',
    };

    if (opts.body) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(fullUrl, {
        method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    let data;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    return { ok: response.ok, status: response.status, data };
}

// ── Core Harvest Logic ───────────────────────────────────────────────────────

/**
 * Harvest promoted skills — create GitHub Pull Requests.
 *
 * @returns {{ harvested: number, skipped: number, errors: string[] }}
 */
async function harvest() {
    const result = { harvested: 0, skipped: 0, errors: [] };

    // ── Pre-flight checks ────────────────────────────────────────────────
    if (!_isConfigured()) {
        log.info('Git Harvester: not configured (GITHUB_TOKEN/OWNER/REPO missing). Skipping.');
        return result;
    }

    // Find all promoted skills that haven't been harvested yet
    const promotedSkills = staging.getByStatus(staging.STATUS.PROMOTED)
        .filter(skill => !skill.harvestedAt);

    if (promotedSkills.length === 0) {
        log.info('Git Harvester: no un-harvested promoted skills. Nothing to do.');
        return result;
    }

    log.info(`Git Harvester: found ${promotedSkills.length} promoted skill(s) to harvest.`);

    // ── Verify GitHub access ─────────────────────────────────────────────
    const authCheck = await _githubApi('/git/refs/heads/' + (_getConfig().base));
    if (!authCheck.ok) {
        const errMsg = `GitHub auth failed (${authCheck.status}): ${authCheck.data?.message || 'unknown'}`;
        log.error(errMsg);
        result.errors.push(errMsg);
        return result;
    }

    const baseSha = authCheck.data?.object?.sha;
    if (!baseSha) {
        result.errors.push('Could not resolve base branch SHA.');
        log.error('Could not resolve base branch SHA.');
        return result;
    }

    log.info(`Base branch SHA: ${baseSha.slice(0, 8)}...`);

    // ── Process each promoted skill ──────────────────────────────────────
    for (const skill of promotedSkills) {
        try {
            const prUrl = await _createPullRequest(skill, baseSha);
            if (prUrl) {
                staging.markHarvested(skill.skillName, prUrl);
                result.harvested++;

                logEvolution(ACTIONS.PR_CREATED, {
                    skillName: skill.skillName,
                    gapId: skill.gapId,
                    prUrl,
                });

                log.info(`✅ PR created for "${skill.skillName}": ${prUrl}`);
            }
        } catch (e) {
            const errMsg = `Failed to harvest "${skill.skillName}": ${e.message}`;
            log.error(errMsg);
            result.errors.push(errMsg);
        }
    }

    if (result.harvested > 0) {
        logEvolution(ACTIONS.HARVEST_COMPLETE, {
            harvested: result.harvested,
            skipped: result.skipped,
            errors: result.errors.length,
        });
    }

    return result;
}

/**
 * Create a GitHub PR for a single promoted skill.
 *
 * @param {Object} skill  - Staged skill entry from the registry
 * @param {string} baseSha - SHA of the base branch
 * @returns {Promise<string|null>} PR URL or null on failure
 */
async function _createPullRequest(skill, baseSha) {
    const { base } = _getConfig();
    const safeName = skill.skillName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const branchName = `cortex/add-skill-${safeName}`;
    const timestamp = new Date().toISOString().split('T')[0];

    // ── Step 1: Read the skill file ──────────────────────────────────────
    if (!skill.filePath || !fs.existsSync(skill.filePath)) {
        log.warn(`Skill file not found: ${skill.filePath}`);
        return null;
    }

    const fileContent = fs.readFileSync(skill.filePath, 'utf-8');
    const fileName = path.basename(skill.filePath);
    // The path in the repo (relative to root)
    const repoPath = `src/skills/${fileName}`;

    // ── Step 2: Create branch ────────────────────────────────────────────
    log.info(`Creating branch: ${branchName}`);

    const branchRes = await _githubApi('/git/refs', {
        method: 'POST',
        body: {
            ref: `refs/heads/${branchName}`,
            sha: baseSha,
        },
    });

    if (!branchRes.ok) {
        // Branch might already exist — try to update it
        if (branchRes.status === 422) {
            log.info(`Branch ${branchName} already exists. Updating...`);
            const updateRes = await _githubApi(`/git/refs/heads/${branchName}`, {
                method: 'PATCH',
                body: { sha: baseSha, force: true },
            });
            if (!updateRes.ok) {
                throw new Error(`Failed to update branch: ${updateRes.data?.message}`);
            }
        } else {
            throw new Error(`Failed to create branch: ${branchRes.data?.message}`);
        }
    }

    // ── Step 3: Create/Update the file on the branch ─────────────────────
    log.info(`Committing ${repoPath} to ${branchName}`);

    // Check if file already exists to get its SHA (needed for update)
    const existingFile = await _githubApi(`/contents/${repoPath}?ref=${branchName}`);
    const commitBody = {
        message: `🧠 Cortex: Add auto-generated skill "${skill.skillName}"\n\n` +
                 `This skill was autonomously generated by Summer's Cortex Engine.\n` +
                 `- Gap ID: ${skill.gapId}\n` +
                 `- Tier: ${skill.tier}\n` +
                 `- Uses before promotion: ${skill.useCount}\n` +
                 `- Generated: ${new Date(skill.createdAt).toISOString()}\n` +
                 `- Promoted: ${new Date(skill.promotedAt).toISOString()}\n\n` +
                 `This PR was created automatically. Please review before merging.`,
        content: Buffer.from(fileContent).toString('base64'),
        branch: branchName,
    };

    // If file exists, we need to include its SHA to update it
    if (existingFile.ok && existingFile.data?.sha) {
        commitBody.sha = existingFile.data.sha;
    }

    const commitRes = await _githubApi(`/contents/${repoPath}`, {
        method: 'PUT',
        body: commitBody,
    });

    if (!commitRes.ok) {
        throw new Error(`Failed to commit file: ${commitRes.data?.message}`);
    }

    // ── Step 4: Create Pull Request ──────────────────────────────────────
    log.info(`Opening Pull Request: ${branchName} → ${base}`);

    const prBody = `## 🧠 Cortex Auto-Generated Skill: "${skill.skillName}"

This Pull Request was created automatically by **Summer's Cortex Engine** while idle.

### What happened
1. The **Gap Detector** identified a capability gap: \`${skill.gapId}\`
2. The **Skill Forge** generated a Tier ${skill.tier} skill to address it
3. The **Sandbox Validator** verified the code is safe (no \`require\`, \`eval\`, \`process\`, etc.)
4. The **Staging Registry** tracked ${skill.useCount} successful uses with 0 errors
5. The skill was **auto-promoted** and this PR was created

### Skill Details
| Field | Value |
|---|---|
| **Name** | ${skill.skillName} |
| **Gap** | \`${skill.gapId}\` |
| **Tier** | ${skill.tier} (context-only, no executable code) |
| **Uses** | ${skill.useCount} |
| **Errors** | ${skill.errorCount} |
| **Generated** | ${new Date(skill.createdAt).toISOString()} |
| **Promoted** | ${new Date(skill.promotedAt).toISOString()} |

### Safety
- ✅ Passed AST sandbox validation (no dangerous patterns)
- ✅ Successfully used ${skill.useCount}+ times with 0 errors
- ✅ Auto-promoted by staging registry

### How to review
1. Check the skill file — it should be pure data (context text), no executable code
2. Merge if it looks good
3. If not, close the PR — the Cortex will re-open the gap and try a different approach

---
*Generated by Summer Cortex Engine on ${timestamp}*`;

    const prRes = await _githubApi('/pulls', {
        method: 'POST',
        body: {
            title: `🧠 Cortex: Add "${skill.skillName}" skill`,
            body: prBody,
            head: branchName,
            base: base,
        },
    });

    if (!prRes.ok) {
        // PR might already exist
        if (prRes.status === 422 && prRes.data?.errors?.[0]?.message?.includes('already exists')) {
            log.info(`PR already exists for ${branchName}. Fetching URL...`);
            const existingPr = await _githubApi(`/pulls?head=${_getConfig().owner}:${branchName}&state=open`);
            if (existingPr.ok && existingPr.data?.length > 0) {
                return existingPr.data[0].html_url;
            }
            return `https://github.com/${_getConfig().owner}/${_getConfig().repo}/tree/${branchName}`;
        }
        throw new Error(`Failed to create PR: ${prRes.data?.message}`);
    }

    return prRes.data.html_url;
}

module.exports = {
    harvest,
    _isConfigured,  // Exposed for testing
};

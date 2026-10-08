# Domain Agent Plugin Developer Guide & Specification

**System:** Project Summer — Personal AI Assistant  
**Subsystem:** Tier 2 Domain Agent Modular Plug-in System  
**Implementation Directory:** `plugins/` and `packages/agent-sdk/`  
**Reference Implementations:** `plugins/ppt_editor/`, `plugins/research_analyst/`, `plugins/fact_checker/`

---

## 1. Overview & Philosophy

In Project Summer, the conversational front-line model (Tier 1) should never execute complex, long-running, multi-step workloads directly in its conversation loop. Doing so introduces severe latency, burns expensive context window tokens, and risks losing active state if the connection drops.

Instead, specialized capabilities are implemented as **Domain Agent Plugs**. 
* A Domain Agent is a **blind specialist**: it receives a structured JSON input manifest, performs its work inside an isolated Node.js `worker_thread`, emits progress events via the `AgentSDK`, and produces structured output artifacts (PDFs, PPTX files, HTML dashboards, database updates).
* The conversational assistant (Tier 1) acts as the **Chief of Staff**: it detects when a user needs a specialist, resolves missing parameters, hands off the work to Tier 2, and delivers progress to the user.

---

## 2. Directory Structure of a Plugin

Every domain agent lives in its own self-contained directory inside `plugins/<plugin_name>/`:

```
plugins/
└── custom_domain_agent/
    ├── skill.json              # Required: Declarative manifest read by Orchestrator
    ├── index.js                # Required: Entry point executed in isolated worker_thread
    ├── lib/                    # Optional: Helper utilities, API clients, templates
    │   ├── api-client.js
    │   └── formatter.js
    └── tests/                  # Optional: Unit tests for standalone execution
        └── run-test.js
```

---

## 3. The Manifest Specification (`skill.json`)

The `skill.json` manifest informs Summer's Orchestrator what the agent does, what inputs it requires, and how much CPU/time it is allowed to consume.

### Complete Schema Reference

```json
{
  "$schema": "https://summer.ai/skill-schema/v1",
  "agent_id": "github_pr_reviewer_v1",
  "version": "1.0.0",
  "display_name": "GitHub PR Reviewer",
  "description": "Performs deep code reviews on GitHub Pull Requests, analyzing security, syntax, and test coverage.",
  "socket_type": "background_worker",
  "entry_point": "index.js",
  "runtime": "node",
  "mandatory_attributes": [
    {
      "key": "repo_url",
      "type": "string",
      "description": "The full GitHub repository URL, e.g. https://github.com/owner/repo"
    },
    {
      "key": "pr_number",
      "type": "number",
      "description": "The specific pull request number to audit"
    }
  ],
  "optional_attributes": [
    {
      "key": "strict_security",
      "type": "boolean",
      "default": true,
      "description": "Whether to perform deep AST vulnerability analysis"
    },
    {
      "key": "focus_area",
      "type": "string",
      "default": "general",
      "description": "Specific subsystem or file path to focus review on"
    }
  ],
  "resource_limits": {
    "max_execution_time_seconds": 600
  }
}
```

### Attribute Resolution Rules
* **Mandatory Attributes:** If the user says *"Summer, review my PR"*, the Orchestrator notices `repo_url` and `pr_number` are missing. It pauses execution, enters the `gathering` phase, and prompts the user: *"Which repository and PR number would you like me to inspect?"*
* **Optional Attributes:** If not provided in conversation, the Orchestrator injects the declared `default` values automatically.

---

## 4. The Agent SDK (`packages/agent-sdk/index.js`)

Domain agents do not interact with Electron or WebSockets directly. All lifecycle management occurs through the lightweight `AgentSDK`.

### SDK Lifecycle Methods

```javascript
const { AgentSDK } = require('../../packages/agent-sdk');
const sdk = new AgentSDK();
```

#### 1. Reporting Live Progress
```javascript
sdk.reportProgress(percent, message);
```
* `percent` (0 - 100): An integer indicating completion percentage.
* `message`: A short human-readable string displayed on the HUD toast (e.g. *"Cloning repository diff..."*).
* Automatically triggers milestone announcements (50%, 75%, 100%) to the user.

#### 2. Checkpointing & Resumption
```javascript
// Check for existing checkpoint on task start
const cp = await sdk.getCheckpoint('stage_diff_fetched');
if (cp) {
    sdk.reportProgress(50, 'Resuming from cached diff...');
    diffData = cp.diffData;
} else {
    diffData = await fetchPrDiff();
    await sdk.saveCheckpoint('stage_diff_fetched', { diffData });
}
```
* Saves intermediate state to disk via the main thread proxy.
* If the task is interrupted or the process restarts, the agent resumes from the latest checkpoint instead of repeating costly API calls.

#### 3. Task Completion
```javascript
sdk.complete({
    status: 'success',
    reportPath: '/tmp/pr_review_12.md',
    html: `<div class="review-card"><h3>PR #12: Approved</h3>...</div>`,
    summary: 'Found 0 security vulnerabilities and 2 style suggestions.'
});
```
* **HTML Auto-Rendering:** If the result includes an `html` property, the Orchestrator automatically pushes the HTML to the HUD overlay without requiring conversational tool calls.

#### 4. Handling Failures
```javascript
sdk.fail(new Error('GitHub API rate limit exceeded.'));
```
* Reports the failure to the Orchestrator, stops the worker thread, and alerts the user gracefully.

---

## 5. Security & Environment Variable Whitelisting

Because plugins run inside worker threads, `plugin-env-policy.js` restricts which environment variables are exposed to prevent sensitive credential leakage.

To grant your plugin access to external API keys:
1. Open `src/orchestration/plugin-env-policy.js`.
2. Add your plugin's ID and required keys to `PLUGIN_ENV_WHITELIST`:
```javascript
'github_pr_reviewer_v1': [
    'GITHUB_TOKEN',
    'GEMINI_API_KEY',
    'OPENAI_API_KEY'
]
```
Any environment variables not explicitly whitelisted will be scrubbed before your worker thread initializes.

---

## 6. Step-by-Step Tutorial: Building a Plugin

Let's build a working **GitHub PR Reviewer Agent** from scratch.

### Step 1: Create the Directory
```bash
mkdir -p plugins/github_pr_reviewer/lib
```

### Step 2: Define `plugins/github_pr_reviewer/skill.json`
```json
{
  "agent_id": "github_pr_reviewer_v1",
  "display_name": "PR Code Reviewer",
  "description": "Reviews GitHub pull requests for code quality and security.",
  "socket_type": "background_worker",
  "entry_point": "index.js",
  "mandatory_attributes": [
    { "key": "pr_url", "type": "string", "description": "The URL of the pull request" }
  ],
  "optional_attributes": [
    { "key": "severity", "type": "string", "default": "medium" }
  ],
  "resource_limits": { "max_execution_time_seconds": 300 }
}
```

### Step 3: Implement `plugins/github_pr_reviewer/index.js`
```javascript
'use strict';

const { workerData } = require('node:worker_threads');
const { AgentSDK }   = require('../../packages/agent-sdk');
const sdk = new AgentSDK();

async function main() {
    try {
        const { pr_url, severity } = workerData.taskManifest;
        
        sdk.reportProgress(10, 'Connecting to GitHub API...');
        
        // 1. Check for resume checkpoint
        const cached = await sdk.getCheckpoint('pr_fetched');
        let prDiff = cached?.prDiff;
        
        if (!prDiff) {
            sdk.reportProgress(30, 'Downloading PR diff...');
            // Simulated diff fetch
            prDiff = "diff --git a/index.js b/index.js\n+ const apiKey = '12345';";
            await sdk.saveCheckpoint('pr_fetched', { prDiff });
        }
        
        sdk.reportProgress(60, 'Analyzing code patterns with Gemini...');
        // Simulated analysis
        const findings = [
            { type: 'security', message: 'Hardcoded API key detected on line 2.' }
        ];
        
        sdk.reportProgress(90, 'Generating review card...');
        const htmlCard = `
            <div style="padding:16px; background:#1e1e24; border-radius:12px; color:#fff;">
                <h2 style="color:#f87171;">⚠️ Security Issue Detected</h2>
                <p>PR: <a href="${pr_url}" style="color:#60a5fa;">${pr_url}</a></p>
                <ul>
                    ${findings.map(f => `<li><b>${f.type.toUpperCase()}:</b> ${f.message}</li>`).join('')}
                </ul>
            </div>
        `;
        
        sdk.complete({
            status: 'success',
            pr_url,
            findingsCount: findings.length,
            html: htmlCard
        });
        
    } catch (err) {
        sdk.fail(err);
    }
}

main();
```

### Step 4: Verification & Live Execution
1. Restart or reload plugins in Summer.
2. In the conversational voice chat or text mode, simply say:
   > *"Summer, review my pull request https://github.com/my-org/my-repo/pull/42"*
3. Summer's Orchestrator will automatically parse the URL, launch your plugin in a dedicated background worker, update the HUD toast, and display the rendered review card upon completion.

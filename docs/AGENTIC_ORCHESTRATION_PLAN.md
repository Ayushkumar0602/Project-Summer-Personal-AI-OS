# Summer Agentic Orchestration Plan

## Executive Summary

Summer already has an impressive capability layer: voice, wake word, memory graph, Google integrations, browser control, OS control, app control, visual memory, and modular skills. The weakness is that these capabilities are currently exposed to one live assistant session as direct tools. That makes Summer powerful, but not truly agentic.

A world-class agentic Summer needs an orchestration layer that can understand the user's demand, decide whether a simple response is enough, initiate an agent mode when needed, route work to the right domain agent, supervise tool use, run safe parallel tasks, verify completion, preserve memory, and hand the result back to the user in a calm conversational interface.

The target architecture is:

```text
User voice/text
  -> Intent Router
  -> Orchestrator / Chief of Staff Agent
  -> Domain Agents
  -> Tool Gateway
  -> Verifier / Critic
  -> Memory + Audit + User Response
```

This turns Summer from "one assistant with many tools" into "one assistant personality coordinating many specialized agents."

## Current State

The current codebase has these strengths:

- `src/index.js` starts a Gemini Live session and passes one large `agentTools` declaration list to the model.
- `src/knowledge/graph-context.js` builds a context-rich system instruction from persistent memory, diary, environment, and Google context.
- `src/skills/skill-loader.js` injects on-demand skill instructions into tool responses.
- `src/tools/` contains real execution power: web, OS, app control, Google Workspace, UI, browser, clipboard, Finder, WhatsApp, music, and more.
- `src/settings/permissions-store.js` and tool audit logs already provide the beginning of a security layer.
- The wake-word and HUD create a strong "living assistant" interaction model.

The missing agentic capabilities:

- No explicit task planner.
- No persistent task state machine.
- No domain agent registry.
- No agent selection or handoff protocol.
- No parallel research/execution workers.
- No verifier that checks whether the outcome is actually done.
- No budget manager for time, tokens, tool calls, or risk.
- No structured "ask user before proceeding" policy beyond some tool confirmations.
- No reusable agent traces for learning from past workflows.
- No separation between conversation personality and task execution.

Today, the same live model decides, plans, acts, speaks, remembers, and recovers from errors. That is flexible but fragile. The orchestration layer should divide those responsibilities.

## Product Vision

Summer should feel like a single premium personal AI, not a menu of bots. Internally, however, Summer should operate like a team:

- A Chief of Staff agent understands the user and coordinates everything.
- Domain agents perform specialized work.
- A Tool Gateway safely executes real-world actions.
- A Verifier checks quality and completion.
- Memory stores durable learning.

The user should be able to say:

- "Summer, plan my day around my meetings and deep work."
- "Research the best AI agent architecture and make a doc."
- "Clean my inbox and only keep important university emails."
- "Debug why this app is slow."
- "Book the cheapest good flight for this date range."
- "Make my Mac focus-ready for coding."

Summer should respond by entering the right agent mode automatically, without the user needing to know which agent exists.

## Core Principle

Do not build many disconnected chatbots. Build one Summer personality with many internal execution agents.

The front-facing assistant remains Summer. Domain agents are internal workers with scoped responsibilities, tool permissions, and output contracts.

## Target Architecture

### 1. Intent Router

The Intent Router classifies every user request before execution.

It decides:

- Is this a normal chat response?
- Is this a single-tool action?
- Is this a multi-step task?
- Does it require agent mode?
- Which domain is involved?
- What is the risk level?
- Does the user need to confirm anything before work begins?

Example output:

```json
{
  "mode": "agentic",
  "domains": ["calendar", "email", "memory"],
  "primaryAgent": "productivity_agent",
  "risk": "medium",
  "needsUserConfirmation": false,
  "estimatedSteps": 6,
  "successCriteria": [
    "Fetch today's meetings",
    "Find pending tasks",
    "Create a prioritized schedule",
    "Ask before modifying calendar"
  ]
}
```

### 2. Orchestrator Agent

The Orchestrator is Summer's internal Chief of Staff. It does not directly do everything. It decomposes, delegates, monitors, and synthesizes.

Responsibilities:

- Convert intent into a task plan.
- Select domain agents.
- Assign subtasks.
- Track task state.
- Decide when agents can work in parallel.
- Decide when to ask the user for clarification.
- Enforce safety policy.
- Request verification before final response.
- Write useful memory after completion.

The Orchestrator should own the task ledger:

```json
{
  "taskId": "task_2026_05_15_001",
  "userGoal": "Plan my day",
  "status": "running",
  "activeAgents": ["calendar_agent", "task_agent"],
  "steps": [
    { "id": "s1", "owner": "calendar_agent", "status": "done" },
    { "id": "s2", "owner": "task_agent", "status": "running" }
  ],
  "riskLevel": "medium",
  "requiresApprovalBefore": ["create_calendar_event", "send_email"]
}
```

### 3. Domain Agent Registry

Create a registry of agents. Each agent has a name, domain, tools, system prompt, risk permissions, and output contract.

Proposed initial agents:

| Agent | Role | Tools |
| --- | --- | --- |
| `memory_agent` | Retrieve and update user context | `query_memory`, graph APIs, diary |
| `research_agent` | Search, scrape, compare, cite | `search_web`, `scrape_webpage`, `get_news` |
| `browser_agent` | Visible web navigation and forms | `browser_*`, `toggle_browser` |
| `calendar_agent` | Scheduling and time planning | Google Calendar tools |
| `email_agent` | Inbox triage, drafting, cleanup | Gmail tools |
| `drive_agent` | Google Drive search and document work | Drive tools |
| `os_agent` | Mac control, diagnostics, focus mode | OS tools |
| `app_control_agent` | App UI automation | screenshot, analyze, click, type |
| `communication_agent` | WhatsApp/messages/email sending | WhatsApp and mail tools |
| `creative_agent` | Writing, diagrams, visual presentation | HUD, Mermaid, docs |
| `code_agent` | Repo analysis, implementation planning | terminal/file tools if added later |
| `verifier_agent` | Check completion and quality | read-only tools, task ledger |

Start with fewer agents and expand. The first production set should be:

- `orchestrator_agent`
- `memory_agent`
- `research_agent`
- `productivity_agent`
- `browser_agent`
- `os_agent`
- `verifier_agent`

### 4. Tool Gateway

All real-world actions should pass through a Tool Gateway instead of agents calling tools directly.

The Tool Gateway should handle:

- Tool allowlists per agent.
- User permission checks.
- Risk classification.
- Audit logging.
- Rate limits.
- Timeout and retry policy.
- Result normalization.
- Secret redaction.
- Dry-run mode for dangerous workflows.

Example policy:

```json
{
  "tool": "google_send_email",
  "risk": "high",
  "allowedAgents": ["email_agent", "communication_agent"],
  "requiresUserApproval": true,
  "requiresPreview": true,
  "audit": true
}
```

### 5. Agent Mode Initiation

Summer should automatically initiate agent mode when the request has any of these traits:

- Multi-step goal.
- Requires searching, comparing, or synthesizing.
- Requires acting across two or more tools.
- Requires waiting, retrying, or monitoring.
- Has ambiguous state that must be inspected.
- Has durable consequences like sending, deleting, scheduling, buying, moving files, or changing system settings.

Examples:

```text
"What is my next meeting?" -> simple tool mode
"Plan my day around my meetings" -> agent mode
"Search latest AI agent frameworks" -> research agent mode
"Compare them and make a recommendation" -> orchestrated research mode
"Clean my inbox" -> email agent mode with approval gates
"Make my laptop faster" -> OS diagnostic agent mode
```

### 6. Planning Model

Use a structured plan object, not hidden free-form reasoning.

The model should produce visible machine-readable plans:

```json
{
  "goal": "Clean inbox",
  "steps": [
    {
      "id": "inspect",
      "agent": "email_agent",
      "action": "List recent unread emails",
      "tools": ["google_search_email"],
      "approval": "not_required"
    },
    {
      "id": "classify",
      "agent": "email_agent",
      "action": "Classify emails into important, archive, delete candidates",
      "tools": [],
      "approval": "not_required"
    },
    {
      "id": "confirm",
      "agent": "orchestrator_agent",
      "action": "Show user preview before destructive actions",
      "approval": "required"
    }
  ]
}
```

The Orchestrator can revise plans as new information appears.

### 7. Memory Integration

Summer's memory should become agent-aware.

Store:

- User preferences.
- Successful workflows.
- Failed workflow traces.
- Agent performance summaries.
- Frequently used apps, people, projects, and constraints.
- User approval preferences.

Memory should answer:

- "How does Ayush like mornings planned?"
- "Which emails are usually important?"
- "What does Ayush consider distracting during focus mode?"
- "Which research sources does Ayush trust?"

Add memory write policy:

- Store durable preferences automatically when confidence is high.
- Ask before storing sensitive personal facts.
- Never store secrets, passwords, tokens, or private message contents unless explicitly requested.
- Summarize task outcomes, not raw private data.

### 8. Human-in-the-Loop Safety

Use four action classes:

| Class | Examples | Policy |
| --- | --- | --- |
| Read-only | search, read calendar, inspect apps | Allowed with audit |
| Reversible | draft email, create local note, open app | Usually allowed |
| Sensitive | read inbox, read clipboard, inspect files | Permission required |
| Consequential | send email, delete files, buy, book, schedule, message | Explicit approval required |

Before consequential actions, Summer should show:

- What it will do.
- Why it will do it.
- Exact target.
- Reversal option if available.
- "Allow once" and "Always allow for this type" options.

This extends the existing confirmation dialog model into a complete agent safety system.

### 9. Verification Layer

Every agentic task should end with verification.

Verifier checks:

- Did the task satisfy the original user goal?
- Were all promised steps completed?
- Did any tool return errors?
- Are there unresolved assumptions?
- Did the action require approval that was skipped?
- Should memory be updated?
- Is the final answer concise and useful?

Verifier output:

```json
{
  "status": "pass",
  "confidence": 0.91,
  "remainingRisks": [],
  "userSummary": "Your schedule was planned around 3 meetings and 2 high-priority tasks."
}
```

### 10. UI Experience

The UI should show agent mode without exposing too much internal complexity.

Recommended HUD states:

- `Listening`
- `Thinking`
- `Planning`
- `Researching`
- `Acting`
- `Waiting for approval`
- `Verifying`
- `Done`

For complex tasks, show a compact task panel:

```text
Planning your day
✓ Read calendar
✓ Checked tasks
• Building schedule
• Waiting before calendar edits
```

Do not show raw chain-of-thought. Show user-safe progress summaries.

## Proposed File Structure

Add a new orchestration layer:

```text
src/
  orchestration/
    agent-registry.js
    agent-runtime.js
    intent-router.js
    orchestrator.js
    task-ledger.js
    tool-gateway.js
    risk-policy.js
    verifier.js
    schemas.js
    prompts/
      orchestrator.md
      research-agent.md
      productivity-agent.md
      os-agent.md
      verifier.md
```

Recommended integration points:

- `src/index.js`: keep Live WebSocket and IPC, but delegate tool orchestration to `orchestration/orchestrator.js`.
- `src/skills/skill-loader.js`: keep as contextual instructions, but let the registry map skills to domain agents.
- `src/settings/permissions-store.js`: extend into policy-backed approvals.
- `src/knowledge/graph-context.js`: expose memory context to the Orchestrator and memory agent, not only the live assistant prompt.

## Runtime Flow

### Normal Chat

```text
User asks simple question
  -> Intent Router: conversational
  -> Summer answers directly
```

### Single Tool

```text
User: "Set volume to 30"
  -> Intent Router: single_tool
  -> Tool Gateway: os_set_volume
  -> Summer confirms
```

### Agentic Task

```text
User: "Plan my day"
  -> Intent Router: agentic/productivity
  -> Orchestrator creates plan
  -> calendar_agent reads events
  -> memory_agent retrieves preferences
  -> task_agent reads pending tasks
  -> orchestrator synthesizes plan
  -> verifier checks criteria
  -> Summer responds
```

### Consequential Task

```text
User: "Clear junk from my inbox"
  -> Intent Router: high-risk agentic
  -> email_agent reads inbox
  -> email_agent classifies candidates
  -> orchestrator shows deletion/archive preview
  -> user approves
  -> Tool Gateway executes
  -> verifier confirms
  -> memory stores preference summary
```

## Implementation Roadmap

### Phase 1: Foundation

Goal: Introduce orchestration without breaking the current assistant.

Build:

- `intent-router.js`
- `agent-registry.js`
- `task-ledger.js`
- `risk-policy.js`
- `tool-gateway.js`

Deliverable:

- Summer can classify requests into `chat`, `single_tool`, and `agentic`.
- Existing tools still work.
- Tool calls are routed through a central gateway.

### Phase 2: First Agent Mode

Goal: Add the first real orchestrated domain.

Build:

- `orchestrator.js`
- `productivity_agent`
- `memory_agent`
- `verifier.js`

Deliverable:

- "Plan my day" uses calendar, tasks, weather/context, memory, and verifier.
- HUD shows task progress.
- Final answer includes a clear plan and unresolved constraints.

### Phase 3: Research Agent

Goal: Make Summer excellent at information work.

Build:

- `research_agent`
- source reliability scoring
- citation capture
- parallel search/scrape execution
- report/document generation flow

Deliverable:

- "Research X and make a recommendation" produces a structured, sourced answer.

### Phase 4: Email and Communication Agents

Goal: Make Summer useful but safe with user communication.

Build:

- `email_agent`
- `communication_agent`
- preview-before-send policy
- inbox classification
- draft-only mode

Deliverable:

- Summer can triage, draft, summarize, and clean inbox with approval gates.

### Phase 5: OS and App Autonomy

Goal: Make Summer operate the computer reliably.

Build:

- `os_agent`
- `app_control_agent`
- UI state verification after each action
- recovery from failed clicks or stale screenshots

Deliverable:

- Summer can perform workflows across apps while showing progress and asking before sensitive actions.

### Phase 6: Learning Loop

Goal: Make Summer improve from use.

Build:

- workflow memory summaries
- user preference extraction
- agent success metrics
- failed-task analysis
- regression task suite

Deliverable:

- Summer gets better at Ayush-specific workflows over time.

## Agent Quality Bar

Summer becomes world-class when it scores highly on:

- Task completion rate.
- Number of user corrections needed.
- Safe handling of sensitive actions.
- Recovery from tool failures.
- Latency for simple tasks.
- Depth and reliability for complex tasks.
- Memory usefulness without creepiness.
- Clear progress visibility.
- Low hallucination rate.
- Ability to say "I need approval" at the right time.

## Evaluation Suite

Create a local benchmark with tasks like:

- "What is on my calendar today?"
- "Plan my day around meetings and coding."
- "Find the latest news on a topic and summarize."
- "Open Chrome and search for X."
- "Draft an email but do not send."
- "Clean my inbox after showing me the candidates."
- "My Mac is slow, diagnose it."
- "Create a task from this conversation."
- "Recall what you know about my current project."
- "Show me a photo from my memory."

Each test should track:

- Correct route.
- Correct agent selection.
- Correct tools.
- Safety policy compliance.
- Final task success.
- Time taken.
- Errors recovered.

## Near-Term Technical Design

### Agent Registry Shape

```js
const agents = {
  productivity_agent: {
    domain: 'productivity',
    description: 'Calendar, tasks, daily planning, reminders',
    tools: ['google_list_calendar_events', 'google_create_task', 'query_memory'],
    riskBudget: 'medium',
    prompt: 'You are Summer productivity agent...',
    outputSchema: 'AgentResult'
  }
};
```

### Task Ledger Shape

```js
{
  id: 'task_...',
  userGoal: '...',
  mode: 'agentic',
  status: 'running',
  plan: [],
  events: [],
  artifacts: [],
  approvals: [],
  finalResult: null
}
```

### Tool Gateway Shape

```js
async function executeTool({ agentName, toolName, args, taskId }) {
  const policy = getToolPolicy(toolName);
  assertAgentAllowed(agentName, toolName, policy);
  await requireApprovalIfNeeded(policy, args);
  const result = await runExistingTool(toolName, args);
  audit(taskId, agentName, toolName, args, result);
  return normalizeToolResult(result);
}
```

## Key Design Decisions

### Keep One Front-Facing Summer

Users should not feel like they are talking to many agents. Summer can say "I’ll handle that" while internally activating the right workers.

### Separate Planning From Speaking

The voice model should stay responsive. Long-running tasks should be managed by the Orchestrator, with Summer giving progress updates.

### Use Structured State Everywhere

Plans, task status, approvals, tool calls, and verifier results should be JSON objects. This makes the system debuggable.

### Start With Read-Only Excellence

Research, planning, summarization, diagnosis, and drafting should become excellent before high-risk autonomous actions.

### Approval Is a Feature

World-class agents do not blindly act. They know when to pause.

## Risks

- Over-orchestration could make simple requests slow.
- Too many agents could become hard to debug.
- Tool failures could cascade if the Orchestrator trusts bad outputs.
- Memory writes could store noisy or sensitive data.
- UI automation can be brittle without verification.
- Parallel agents can conflict if they share tools or mutate the same state.

Mitigations:

- Fast path for simple chat and single-tool actions.
- Start with a small agent registry.
- Use strict schemas and verifier checks.
- Centralize all writes through the Tool Gateway.
- Require approval for consequential actions.
- Add task-level locks for shared resources like email, calendar, browser, and OS state.

## Final North Star

Summer should become a personal AI operating system:

- Conversational enough to feel natural.
- Structured enough to be reliable.
- Memory-aware enough to be personal.
- Tool-capable enough to act in the real world.
- Safe enough to trust.
- Agentic enough to take a goal, break it down, execute it, verify it, and learn from it.

The winning version is not the one with the most tools. It is the one that knows when to use which tool, which agent should own the work, when to ask the user, and how to prove the job is done.

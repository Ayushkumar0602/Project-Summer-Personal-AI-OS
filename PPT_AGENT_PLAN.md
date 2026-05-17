# PPT Editor Agent: Design & Implementation Plan

**Agent ID:** `ppt_editor_v1` | **Runtime:** Node.js | **Status:** DRAFT

---

## 1. Overview

The PPT Editor is Summer's first Domain Agent plug-in — the architectural proof-of-concept for the entire Socket & Plug system. It is a **blind specialist**: it receives a structured JSON payload from Tier 2, produces a `.pptx` file, and reports progress via the AgentSDK. It has zero awareness of the user or Summer's conversation.

If this works end-to-end (Tier 1 → Tier 2 → `skill.json` read → `searchMemory()` graph traversal → gathering loop → socket execution → heartbeats → HUD progress → delivery), every future agent follows the same pattern.

---

## 2. Directory Structure

```
plugins/
└── ppt_editor/
    ├── skill.json              # Manifest (read by Tier 2)
    ├── index.js                # Entry point (loaded by Agent Socket)
    ├── lib/
    │   ├── slide-planner.js    # LLM-powered slide structure planning
    │   ├── content-writer.js   # LLM-powered per-slide content
    │   ├── asset-handler.js    # Image sourcing and embedding
    │   ├── layout-engine.js    # Template-based formatting
    │   └── pptx-builder.js     # Final .pptx assembly
    ├── templates/
    │   ├── modern-dark.json
    │   ├── corporate-clean.json
    │   └── academic-simple.json
    └── tests/
```

---

## 3. Skill Document (`skill.json`)

```json
{
  "$schema": "https://summer.ai/skill-schema/v1",
  "agent_id": "ppt_editor_v1",
  "version": "1.0.0",
  "display_name": "PPT Editor",
  "description": "Generates PowerPoint presentations from topic, audience, and content data.",
  "socket_type": "background_worker",
  "entry_point": "index.js",
  "runtime": "node",
  "mandatory_attributes": [
    { "key": "topic", "type": "string", "description": "Main subject of the presentation." },
    { "key": "slide_count", "type": "number", "description": "Target number of slides." },
    { "key": "target_audience", "type": "string", "description": "Who the presentation is for." },
    { "key": "context_data", "type": "string", "description": "All relevant background info gathered from graph memory." }
  ],
  "optional_attributes": [
    { "key": "color_theme", "type": "string", "default": "modern-dark" },
    { "key": "tone", "type": "string", "default": "professional" },
    { "key": "include_images", "type": "boolean", "default": true },
    { "key": "reference_files", "type": "array" },
    { "key": "output_path", "type": "file_path", "default": "~/Desktop/" }
  ],
  "output_schema": { "type": "file_path", "description": "Path to the generated .pptx file." },
  "resource_limits": { "max_memory_mb": 512, "max_execution_time_seconds": 300, "requires_network": true },
  "permissions": ["fs.write.scoped", "network.http"]
}
```

**How Tier 2 uses this:** When Tier 1 detects a PPT intent, Tier 2 reads this manifest, calls `searchMemory(topic)` from the existing `graph-search.js` to gather `context_data` (1-hop neighbourhood traversal, decay-weighted), then checks which mandatory attributes are still missing and asks the user.

---

## 4. Internal Pipeline (5 Stages)

```mermaid
graph LR
    Input[Task Manifest] --> S1[Slide Planner]
    S1 --> S2[Content Writer]
    S2 --> S3[Asset Handler]
    S3 --> S4[Layout Engine]
    S4 --> S5[PPTX Builder]
    S5 --> Output[.pptx File]
```

| Stage | Module | Input | Output | Progress |
|---|---|---|---|---|
| 1. Planner | `slide-planner.js` | topic, count, audience | JSON slide outline | 10% |
| 2. Writer | `content-writer.js` | outline + context_data | Enriched slides with full text | 10-60% |
| 3. Assets | `asset-handler.js` | slides needing images | Slides with resolved image paths | 60-75% |
| 4. Layout | `layout-engine.js` | complete slides + theme | Layout-ready data structure | 75-90% |
| 5. Builder | `pptx-builder.js` | layout data | `.pptx` file on disk | 100% |

---

## 5. Entry Point (`index.js`)

```javascript
const { AgentSDK } = require('@summer/agent-sdk');
const { planSlides } = require('./lib/slide-planner');
const { writeContent } = require('./lib/content-writer');
const { handleAssets } = require('./lib/asset-handler');
const { applyLayout } = require('./lib/layout-engine');
const { buildPPTX } = require('./lib/pptx-builder');

async function main(taskManifest, sdk) {
  try {
    sdk.reportProgress(5, 'Planning slide structure...');
    const plan = await planSlides(taskManifest);
    sdk.reportProgress(10, `Planned ${plan.slides.length} slides`);

    const enriched = await writeContent(plan, taskManifest.context_data, (cur, total) => {
      sdk.reportProgress(10 + Math.round((cur / total) * 50), `Writing slide ${cur}/${total}`);
    });

    sdk.reportProgress(62, 'Gathering images...');
    const withAssets = await handleAssets(enriched, taskManifest);
    sdk.reportProgress(75, 'Assets ready');

    sdk.reportProgress(78, 'Applying layout...');
    const layoutReady = await applyLayout(withAssets, taskManifest.color_theme || 'modern-dark');

    sdk.reportProgress(90, 'Building .pptx file...');
    const outputPath = await buildPPTX(layoutReady, taskManifest.output_path);

    sdk.complete({ file_path: outputPath });
  } catch (error) {
    sdk.fail({ error: error.message, stage: error.stage || 'unknown' });
  }
}

module.exports = { main };
```

---

## 6. Error Handling

| Scenario | Agent Behavior | Tier 2 Behavior |
|---|---|---|
| LLM API fails at planning | Retry 2x with backoff → `sdk.fail()` | Notify user: "Retry?" |
| LLM returns malformed JSON | Retry with stricter JSON mode → `sdk.fail()` | Log and retry agent |
| Image search returns nothing | Skip image, use color placeholder | Agent handles gracefully |
| `pptxgenjs` crashes on build | `sdk.fail()` with error + partial path | Offer retry or partial delivery |
| Agent exceeds timeout | Tier 2 force-kills via `TASK_KILL` | Notify user: "Timed out" |
| User says "Cancel" | Tier 2 sends `TASK_KILL`, agent shuts down | HUD shows "Cancelled", temp files cleaned |

---

## 7. End-to-End Test Scenarios

**Test 1 — Happy Path:** User says "Make a 10-slide PPT about Whizan AI for college" → all mandatory attrs found via prompt + `searchMemory()` → agent runs → `.pptx` delivered.

**Test 2 — Missing Data:** User says "Make a PPT about ML" → `slide_count` and `target_audience` missing → Tier 2 asks user → user answers → agent runs.

**Test 3 — Agent Failure:** LLM fails at Stage 2 → retries → `sdk.fail()` → Tier 2 offers retry.

**Test 4 — Cancellation:** Agent running at 35% → user says "cancel" → `TASK_KILL` → clean shutdown.

**Test 5 — Mid-Run Resource Request:** Agent at Stage 2 needs more architecture details → `sdk.requestResource()` → Tier 2 searches graph memory → feeds data back → agent resumes.

---

## 8. Dependencies

| Package | Purpose |
|---|---|
| `pptxgenjs` | Programmatic .pptx generation |
| `@google/generative-ai` | LLM calls for planning/writing |
| `sharp` | Image resizing |
| `node-fetch` | Image downloading |

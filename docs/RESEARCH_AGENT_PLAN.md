# Deep Research Agent (`research_analyst`) - Native Gemini Implementation Plan

**System:** Summer AI Assistant - Modular Agent Ecosystem
**Core Technology:** Google Gemini Interactions API (`deep-research-preview-04-2026`)
**Role:** Background worker that leverages Google's native Deep Research API to autonomously plan, search, read, and synthesize comprehensive reports without manual web scraping.

---

## 1. Vision & Objectives
By switching to Google's official Gemini Deep Research API, we eliminate the need to build and maintain custom web scrapers, rate-limit handlers, and complex context-window managers. The API handles the multi-step reasoning, Google Search integration, and code execution natively.

Our implementation will focus entirely on **Orchestration & User Experience**: translating the API's asynchronous flow into a beautiful, collaborative experience in the Summer HUD.

---

## 2. Agent Architecture (`skill.json`)

The agent will be housed in `/plugins/research_analyst/`.

```json
{
  "agent_id": "research_analyst_v2",
  "display_name": "Deep Research Analyst",
  "description": "Performs recursive, deep web research using Gemini's native Interactions API.",
  "socket_type": "background_worker",
  "entry_point": "index.js",
  "mandatory_attributes": [
    { "key": "topic", "type": "string", "description": "The exact subject or question to research." },
    { "key": "collaborative", "type": "boolean", "description": "True to propose a plan first, False to execute immediately." }
  ],
  "optional_attributes": [
    { "key": "visualizations", "type": "boolean", "default": true, "description": "Whether to auto-generate charts and graphs." }
  ],
  "resource_limits": { "max_execution_time_seconds": 1800 } 
}
```

---

## 3. The Execution Flow & Code Examples

When the user asks: *"Summer, do a deep research on the future of Solid State Batteries and ask me before starting."* 
Tier 2 resolves the attributes (`topic` = "Solid State Batteries", `collaborative` = true) and passes them to the isolated worker thread running `index.js`.

Here is the exact step-by-step flow implemented in your `index.js`:

### Phase 1: Collaborative Planning (Generating the Blueprint)
Because `collaborative` is true, the agent asks Gemini for a **plan** instead of doing the work immediately.

```javascript
import { GoogleGenAI } from '@google/genai';
import { parentPort, workerData } from 'node:worker_threads';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const { topic, visualizations } = workerData.taskManifest;

async function generatePlan() {
    parentPort.postMessage({ type: 'progress', percent: 10, message: 'Drafting research plan...' });

    // 1. Send the initial request in planning mode
    const planInteraction = await client.interactions.create({
        agent: 'deep-research-preview-04-2026',
        input: `Create a deep research report on: ${topic}. ${visualizations ? 'Include charts.' : ''}`,
        agent_config: { 
            type: 'deep-research', 
            collaborative_planning: true, // MUST BE TRUE
            visualization: visualizations ? 'auto' : 'none'
        },
        background: true
    });

    // 2. Poll until the plan is ready (usually fast)
    let result;
    while (true) {
        result = await client.interactions.get(planInteraction.id);
        if (result.status === 'completed' || result.status === 'failed') break;
        await new Promise(r => setTimeout(r, 2000));
    }

    const proposedPlan = result.steps.at(-1).content[0].text;
    
    // 3. Pause worker and ask Summer to show the plan to the user for approval
    parentPort.postMessage({ 
        type: 'resource_request', // Pauses and talks to Orchestrator
        request: {
            action: 'ask_user_approval',
            question: `Here is the proposed research plan:\n\n${proposedPlan}\n\nShall I proceed or modify it?`,
            interactionId: planInteraction.id // Store this to resume later
        }
    });
}
```

### Phase 2: User Approval (Handled by Tier 1 & HUD)
The worker thread pauses. Summer's HUD displays the `proposedPlan` text.
* **User says:** *"Looks good, proceed."* 
* Summer passes this approval back into the worker thread.

### Phase 3: Execution & Polling (The Long Wait)
The worker thread resumes, using the `interactionId` from Phase 1, but this time turning `collaborative_planning` to `false` to pull the trigger.

```javascript
async function executeResearch(approvalText, previousInteractionId) {
    parentPort.postMessage({ type: 'progress', percent: 20, message: 'Initiating deep research protocol...' });

    // 1. Send the approval and turn off planning mode
    const finalReport = await client.interactions.create({
        agent: 'deep-research-max-preview-04-2026', // Use the MAX model for the actual work
        input: approvalText, // e.g., "Looks good, proceed."
        agent_config: { 
            type: 'deep-research', 
            collaborative_planning: false // TRIGGERS THE RESEARCH
        },
        previous_interaction_id: previousInteractionId,
        background: true
    });

    // 2. The Long Polling Loop (Can take up to 15 minutes)
    let result;
    let percent = 20;
    
    while (true) {
        result = await client.interactions.get(finalReport.id);
        
        if (result.status === 'completed') {
            parentPort.postMessage({ type: 'progress', percent: 100, message: 'Research complete! Formatting document...' });
            break;
        } else if (result.status === 'failed') {
            throw new Error(`Research failed: ${result.error}`);
        }
        
        // Artificial progress bump for UX
        percent = Math.min(percent + 5, 95); 
        parentPort.postMessage({ type: 'progress', percent, message: 'Synthesizing sources...' });
        
        // Wait 10 seconds before polling again
        await new Promise(r => setTimeout(r, 10000));
    }
    
    return result.steps; // Contains the final text and any base64 images
}
```

### Phase 4: Document Formatting
Once the loop breaks, we format the output. If visualizations were generated, they come back as `base64` image data in the `result.steps` array.

```javascript
import fs from 'node:fs/promises';
import path from 'node:path';

async function formatAndSave(steps, topic) {
    let markdownContent = `# Deep Research: ${topic}\n\n`;
    let imageCounter = 1;

    for (const step of steps) {
        if (step.type === 'model_output') {
            for (const item of step.content) {
                if (item.type === 'text') {
                    markdownContent += `${item.text}\n\n`;
                } else if (item.type === 'image' && item.data) {
                    // It generated a chart! Save it locally.
                    const imgName = `chart_${imageCounter}.png`;
                    const imgPath = path.join(process.env.HOME, 'Desktop', imgName);
                    await fs.writeFile(imgPath, Buffer.from(item.data, 'base64'));
                    
                    // Embed the local image into the markdown
                    markdownContent += `![Generated Chart](${imgPath})\n\n`;
                    imageCounter++;
                }
            }
        }
    }

    const docPath = path.join(process.env.HOME, 'Desktop', `${topic.replace(/ /g, '_')}_Report.md`);
    await fs.writeFile(docPath, markdownContent);
    
    // Terminate worker and report success to Orchestrator
    parentPort.postMessage({ type: 'complete', result: { filePath: docPath } });
}
```

---

## 4. Key Takeaways for Summer
1. **Simplified Architecture:** You are writing ~100 lines of code in `index.js` instead of thousands of lines of scraping logic.
2. **Interactive UI:** The HUD isn't just a loading bar; it's a collaborative tool. It stops and asks the user to review the *Proposed Plan* before spending 10 minutes processing.
3. **Rich Outputs:** Because the agent natively generates visual charts, Summer's outputs will look like professional analyst reports with actual data visualizations.

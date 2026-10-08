# Summer 2.0: Two-Tier Architecture & Modular Skill Socket System

**Document Type:** Strategic Architecture Proposal
**Status:** DRAFT
**System:** Summer AI Assistant
**Objective:** Evolve Summer into a two-tier orchestration platform featuring a "Socket & Plug" modular agent ecosystem, driven by strict Agent Skill Documents.

---

## 1. Vision: The Socket & Plug Modular Ecosystem

Summer will operate as an advanced, extensible motherboard. Instead of hardcoding complex capabilities into the core system, Summer will feature a **Modular Skill Socket System**. 

Specialized agents (e.g., `PPT_Editor`, `Code_Writer`, `Research_Analyst`) will be developed entirely separately as standalone "Plugs." Summer's Upper Layer will dynamically load these plugs into its "Sockets" at runtime. The bridge between Summer and these independent plugs is the **Agent Skill Document**—a strict manifest detailing exactly what the agent does and what data it requires to function.

---

## 2. The Two-Tier Architecture Design

We divide Summer's intelligence into two distinct layers:

### Tier 1: Initial Brain + Hub (The Conversational Front-Line)
*   **Role:** The primary conversationalist, intent router, and memory manager.
*   **Functionality:** Handles immediate queries, retrieves context, and detects when a user's request maps to an available Agent Plug-in. It does not execute complex logic; it merely routes the intent to Tier 2.

### Tier 2: Upper Layer Orchestrator (The Socket Manager)
*   **Role:** The supervisor, dependency resolver, and execution engine.
*   **Functionality:** Triggered by Tier 1. It reads the specific **Agent Skill Document**, determines what mandatory data is missing, orchestrates the information gathering, and finally plugs the agent into the socket for background execution.

### System Flow
```mermaid
graph TD
    User([User Request]) --> InitialBrain[Tier 1: Initial Brain + Hub]
    
    InitialBrain -->|Immediate Task| SimpleExecution[Direct Tool Execution]
    SimpleExecution --> User
    
    InitialBrain -->|Intent Maps to Agent| UpperLayer[Tier 2: Upper Layer Orchestrator]
    
    UpperLayer -->|1. Read Manifest| SkillDoc[(Agent Skill Document)]
    UpperLayer -->|2. Identify Missing Data| InitialBrain
    InitialBrain -->|Clarification Questions| User
    
    UpperLayer -->|3. All Data Gathered| Socket[Agent Socket (Isolated Thread)]
    Socket -->|Plug In & Start| Agent[Domain Agent: PPT Maker]
    
    Agent -->|4. Periodic Heartbeat| UpperLayer
    UpperLayer -->|Update HUD Toast| User
    
    Agent -->|5. Output Artifact| UpperLayer
    UpperLayer -->|Final Presentation Synthesis| InitialBrain
    InitialBrain --> User
```

---

## 3. The Agent Skill Document (The Manifest)

Every modular agent developed for Summer must include a Skill Document (e.g., `skill.json`). This is the only way Tier 2 knows how to interact with the agent. 

**Example: `ppt_editor/skill.json`**
```json
{
  "agent_id": "ppt_editor_v1",
  "description": "Generates a structured .pptx presentation based on research or text.",
  "socket_type": "background_worker",
  "mandatory_attributes": [
    {
      "key": "topic",
      "description": "The main subject of the presentation."
    },
    {
      "key": "slide_count",
      "description": "The exact number of slides requested."
    },
    {
      "key": "target_audience",
      "description": "Who the presentation is for (e.g., College, Corporate, General)."
    }
  ],
  "optional_attributes": ["color_theme", "reference_files"]
}
```

---

## 4. Scenario Walkthrough: The College Presentation

To illustrate the Socket & Plug system, consider the following interaction:

**User:** *"Summer, make a PPT for my college regarding my project on Whizan AI."*

### Phase 1: Intent Detection & Skill Reading
1.  **Detection:** Tier 1 (Initial Brain) detects the intent matches the `ppt_editor` plug-in. It hands the request to Tier 2.
2.  **Reading the Skill Document:** Tier 2 immediately opens `ppt_editor/skill.json` and reads the `mandatory_attributes` array.
3.  **Context Matching & Graph Memory Search:** Tier 2 parses the user's prompt and then performs a deep traversal of Summer's **Graph Memory** to gather all related context—past conversations about Whizan AI, code snippets, notes, related entities, and user preferences. It then maps the gathered data against the mandatory attributes:
    *   `topic`: Found via graph memory ("Whizan AI project" — linked to codebase, past discussions, tech stack details).
    *   `target_audience`: Found from prompt ("College").
    *   `slide_count`: **MISSING** — no related data found in memory.

### Phase 2: The Gathering Loop
1.  **Dependency Resolution:** Because a mandatory attribute is missing, Tier 2 cannot plug the agent into the socket. It pauses and instructs Tier 1 to gather the missing data.
2.  **User Prompt:** Tier 1 asks the user: *"I can prepare the Whizan AI presentation for your college. However, the PPT module requires a specific slide count. How many slides would you like?"*
3.  **Completion:** The user replies *"Make it 10 slides."* Tier 1 passes this back to Tier 2.

### Phase 3: Socket Integration & Execution
1.  **Plugging In:** Tier 2 verifies that all `mandatory_attributes` are now fulfilled. It constructs a final JSON payload and plugs the `PPT_Editor` agent into an isolated background worker thread (the socket).
2.  **Execution & Supervision:** The agent runs independently, completely unaware of the user. It simply processes the JSON payload into a `.pptx` file. 
3.  **Heartbeats:** The agent sends periodic progress updates back through the socket to Tier 2 (e.g., `[Status: Generating Slide 3 of 10]`). Tier 2 pushes these updates to the holographic HUD toast notifications.

### Phase 4: Unplugging and Delivery
1.  **Completion:** The agent finishes the file, returns the file path through the socket, and terminates. Tier 2 unplugs the agent, freeing system resources.
2.  **Synthesis:** Tier 2 hands the success state to Tier 1. Summer speaks: *"Sir, the Whizan AI presentation is complete and saved to your desktop. Would you like me to open it?"*

---

## 5. Benefits of the Socket & Plug Architecture

1. **Independent Scaling:** Developers can build the `Code_Writing` agent in Python and the `PPT_Editor` in Node.js. As long as they adhere to the Skill Document JSON schema, Summer can socket them.
2. **Zero Hallucination on Requirements:** Because Tier 2 strictly enforces the `mandatory_attributes` list from the Skill Document, agents will never crash or hallucinate due to missing initial data.
3. **Safety & Isolation:** Agents are treated as untrusted third-party plugs. They operate in a sandboxed thread, and Tier 2 controls their timeout and kill-switches.
4. **Infinite Expandability:** Adding a new capability to Summer no longer requires modifying Summer's core brain. You simply drop a new folder (containing the agent logic and `skill.json`) into Summer's `/plugins` directory.

---

## 6. Phased Implementation Strategy

**Phase 1: Establishing the Core Socket Manager (Tier 2)**
*   Refactor the routing layer so Tier 1 can hand off "Intents" to Tier 2.
*   Build the Tier 2 JSON parser that reads `skill.json` files from a local `/plugins` directory.

**Phase 2: The Dependency Resolution Loop**
*   Implement the logic in Tier 2 to cross-reference extracted prompt entities against `mandatory_attributes`.
*   Establish the communication bridge for Tier 2 to command Tier 1 to ask clarification questions.

**Phase 3: The Worker Thread Socket**
*   Build the Node.js `Worker_Threads` sandbox that securely loads and runs an agent script.
*   Implement the IPC (Inter-Process Communication) channel for heartbeats, progress updates, and graceful termination.

**Phase 4: Developing the First Plugs**
*   Develop the `PPT_Editor` and `Code_Writer` as the first two independent plug-ins to prove the architecture.

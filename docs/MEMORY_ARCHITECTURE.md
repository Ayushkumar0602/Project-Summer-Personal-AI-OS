# Project Summer: Detailed Memory Architecture

**Document Type:** Technical Architecture Deep Dive
**System:** Summer AI Assistant
**Focus:** Memory Engine, Knowledge Graph, and Future Roadmap

---

## 1. Vision: The Ego-Aware Persistent Brain
Traditional Large Language Models (LLMs) suffer from contextual amnesia; their "memory" is strictly limited to the tokens within their current context window. Summer transcends this limitation using an **Ego-Aware Knowledge Graph**. 

Instead of dumping raw chat transcripts into a vector database, Summer dissects, classifies, and interlinks information hierarchically. The system differentiates between universal world knowledge, procedural habits, and the core identity of the user (the "Ego").

---

## 2. Core Architecture: The Ego-Aware Knowledge Graph

The memory system is built on a directed acyclic graph structure backed by a hybrid database approach (local cache + Supabase cloud syncing via `pgvector`).

### 2.1 The "User Self" Node (Ego-Aware Center)
At the center of the entire memory graph sits the `user_self` node. All personal information branches out from this central hub. This prevents the AI from confusing external facts with personal attributes.
- **Identity & Demographics**: Name, location, life stage.
- **Skills & Expertise**: Technical stack (e.g., Node.js, Swift), hobbies.
- **Projects**: Links to `Project` nodes (e.g., "Whizan AI", "Summer Daemon").
- **Preferences**: Aesthetic choices, communication style, formatting rules.

### 2.2 Memory Classifications
The graph categorizes nodes into three primary cognitive types:
1.  **Episodic Memory (Time-Series):** Conversations, decisions made, specific events, and milestones. Managed by the **Session Diary** (`session-diary.js`) which generates end-of-session logs to maintain continuity across days.
2.  **Semantic Memory (Knowledge Base):** Facts, concepts, relationships, and domain-specific knowledge extracted from PDFs, web pages, and user inputs.
3.  **Procedural Memory (Behavioral):** Workflow patterns, how-to guides, and automation scripts. Tracked by `procedural-memory.js` to learn the user's repetitive actions.

### 2.3 Importance-Based Context & Pinning
Not all memories are equal. Every node features an **Importance Score (0.0 to 1.0)**.
*   **Peripheral Nodes (0.1 - 0.6):** Stored quietly in the database. Retrieved only when semantically relevant to the current prompt via vector search.
*   **Core Nodes (0.7 - 0.9):** Injected into the context window frequently.
*   **Pinned Nodes (★ 5/5):** Critical facts (e.g., severe allergies, primary project focus) are "pinned" and injected directly into Summer's unchangeable System Prompt payload.

---

## 3. Technical Implementation & Data Flow

### 3.1 Storage & Retrieval
*   **Database:** Supabase handles the `memory_nodes` and `memory_edges` tables.
*   **Embeddings:** Every node's content is transformed into high-dimensional vector embeddings using an embedding model.
*   **Vector Search:** `pgvector` executes cosine similarity searches to retrieve the most semantically relevant nodes based on the user's current intent.

### 3.2 Ingestion & Semantic Chunking
When a user uploads a document or speaks:
1.  **Chunking:** The document is broken down intelligently by semantic boundaries (paragraphs/sections), not arbitrary character counts.
2.  **Extraction:** Summer extracts entities and relationships.
3.  **Multimodal Ingestion:**
    *   **Images:** Processed by Gemini Vision, tagged descriptively, and stored as visual memory nodes.
    *   **Audio:** Voice logs are transcribed and contextualized.
    *   **Text/Drive:** PDFs and Docs are silently parsed via headless browser/extractors.

### 3.3 The Subconscious Maintenance Loop (Cortex Engine)
When Summer is idle, the **Autonomous Cortex Engine** triggers background optimization:
*   **Memory Consolidator (`memory-consolidator.js`):** Scans the graph for duplicate or highly similar nodes and merges them. It also auto-connects disparate memory "islands" to form new logical deductions.
*   **Gap Detector:** Analyzes failure nodes to figure out what skills or knowledge Summer is missing, triggering the Skill Forge.

---

## 4. Visualizing Memory
*   **Temporal Timeline (`memory-timeline.js`):** Constructs chronological views of events, allowing Summer to understand *when* things happened in relation to each other.
*   **Visual HUD:** The iOS Swift client (`MemoryGraphView.swift`) and the desktop overlay render the graph nodes visually, allowing the user to literally see their data structure and connections.

---

## 5. Future Plans & Roadmap

While the foundation is solid, the memory architecture is continuously evolving. The following are targeted future enhancements:

### 5.1 Emotional Intelligence & Sentiment Mapping
*   **Goal:** Track the user's mood, stress levels, and emotional responses over long periods.
*   **Implementation:** Introduce `Sentiment` weights to edges in the graph. If a specific topic (Node A) consistently produces a stressed response (Negative Edge), Summer will dynamically alter her communication style when discussing it.

### 5.2 Multi-Agent Shared Context Partitions
*   **Goal:** Provide secure, partitioned memory spaces for Tier 2 plugins.
*   **Implementation:** While the `user_self` node is globally readable, specific agents (e.g., Business Strategy Agent) will have private, encrypted "scratchpad" sub-graphs to store intermediate logic that doesn't pollute the main user timeline.

### 5.3 Proactive Graph-Based Reasoning
*   **Goal:** Move from *retrieving* memory to *predicting* needs.
*   **Implementation:** The background Cortex Engine will perform continuous graph traversal. If it identifies that a user is repeating a procedural memory node daily (e.g., compiling a report at 9 AM), Summer will proactively ask, "Would you like me to automate the 9 AM report generation?"

### 5.4 Federated Learning & Device Sync
*   **Goal:** Complete, seamless transition between the Desktop Daemon, iOS client, and future web interfaces without lag.
*   **Implementation:** Implement offline-first local caching using SQLite, which performs delta-syncs with the Supabase master graph whenever a network connection is established, ensuring memory availability regardless of connectivity.

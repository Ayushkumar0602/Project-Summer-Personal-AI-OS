const { GoogleGenAI } = require('@google/genai');
const { withMemoryApiKey } = require('./memory-api-key');

// ── Standard extraction prompt (for conversation transcripts) ──
const EXTRACTION_PROMPT = `
You are an advanced knowledge graph extraction engine.
Analyze the following text and extract all meaningful entities and relationships.

CRITICAL EGO NODE RULE:
If the text contains personal statements ("I", "my", "me", "Ayush", "Ayush Jaiswal"), you MUST map those to exactly one canonical node ID: "user_self". This node represents the user. All other entities (collaborators, companies, projects) get normal IDs.

CRITICAL RELEVANCE & HALLUCINATION RULE:
1. ONLY extract meaningful, permanent facts (e.g., skills, relationships, locations, projects, organizations).
2. DO NOT extract conversational filler, pleasantries, or temporary actions (e.g., "said", "hello", "is talking").
3. DO NOT hallucinate facts that are not explicitly stated in the text.

IMPORTANCE SCORING:
Every node must have an "importance" field (0.0 to 1.0):
- 1.0 = Core identity facts (user_self, their name, job, location, key relationships)
- 0.8 = Major projects, primary skills, frequent collaborators
- 0.6 = Secondary skills, organizations, notable concepts
- 0.4 = Minor details, one-time mentions
- 0.2 = Peripheral context, background info

Output ONLY valid JSON in this exact format:
{
  "nodes": [
    { "id": "unique_lowercase_id", "label": "Human Readable Label", "type": "Person|Project|Skill|Organization|Concept|Location|Other", "description": "A clear 1-2 sentence description of what this entity is and why it matters.", "importance": 0.8 }
  ],
  "edges": [
    { "from": "node_id_1", "to": "node_id_2", "label": "relationship_verb", "confidence": 0.95 }
  ],
  "contradictions": [
    { "from": "node_id", "to": "node_id", "oldLabel": "old_verb", "newLabel": "new_verb" }
  ]
}

Rules:
1. Node IDs must be lowercase, underscore-separated, and canonicalized.
2. The user is ALWAYS "user_self" with importance: 1.0.
3. Edge labels must be simple verbs (e.g., "built", "works_at", "lives_in", "uses", "has_contributor").
4. Include a confidence score (0.0 to 1.0) for every edge. Only output edges with > 0.8 confidence.
5. Every node MUST have a "description" field and an "importance" field.
`;

// ── Deep document extraction prompt (for file uploads) ──
const DOCUMENT_EXTRACTION_PROMPT = `
You are a HYPER-EXHAUSTIVE KNOWLEDGE GRAPH EXTRACTION ENGINE for a personal AI assistant.
You will be given a document section. Your ONLY job is to extract EVERY meaningful piece of information into graph nodes and edges.

FAILURE MODE TO AVOID: Outputting summaries or merged nodes. Every distinct fact = its own node.

## MANDATORY EXTRACTION CHECKLIST
Before finishing, verify you have extracted ALL of the following that appear in the text:

### FOR RESUMES / CVs:
✅ 1 Document node (type: Document) — with full summary as description
✅ 1 Person node (type: Person) for the candidate — ALWAYS map to "user_self" if it's the app owner ("I", "my", "Ayush")
✅ 1 node PER job/internship (type: Organization or Project) — with company name, role title, duration, location in description
✅ 1 node PER bullet point under each job — what was BUILT, ACHIEVED, or CONTRIBUTED
✅ 1 node PER project listed — with tech stack, purpose, outcome in description
✅ 1 node PER technology/tool/language mentioned (type: Tool or Skill) — even if mentioned only once
✅ 1 node PER skill category (type: Skill) — with all sub-skills listed in description
✅ 1 node PER certification/award/achievement (type: Event or Concept)
✅ 1 node PER educational institution (type: Organization) — with degree, GPA, duration in description
✅ 1 node PER quantified achievement (e.g., "reduced latency by 40%") — embed the metric in description

### FOR TECHNICAL DOCS / READMEs:
✅ 1 Document node — with project name, purpose, tech stack summary
✅ 1 node PER feature described (type: Concept or Method)
✅ 1 node PER API endpoint or function described (type: Method)
✅ 1 node PER dependency/library/framework (type: Tool)
✅ 1 node PER configuration option or environment variable (type: Concept)
✅ 1 node PER architectural component (type: Concept or Method)
✅ 1 node PER algorithm, formula, or design pattern (type: Method or Formula)
✅ 1 node PER code example or test scenario (type: Example)

### FOR STUDY MATERIAL / BOOKS / NOTES:
✅ 1 node PER chapter/section heading (type: Section or Chapter)
✅ 1 node PER defined term or concept (type: Definition or Concept) — include the full definition in description
✅ 1 node PER formula or algorithm (type: Formula) — include the formula itself in description
✅ 1 node PER theorem, law, or principle (type: Concept)
✅ 1 node PER worked example (type: Example) — summarize the problem and solution
✅ 1 node PER comparison or table (type: Concept) — list all compared items in description

## NODE REQUIREMENTS:
Every node MUST include ALL these fields:
- "id": STABLE lowercase_underscore_id. Use the SAME id every time this entity appears across chunks.
  Examples: "user_self" (always for Ayush), "skill_react", "org_glitch_muj", "project_whizan_ai", "tool_docker"
- "label": Human Readable Name (title case)
- "type": Person | Project | Skill | Organization | Concept | Topic | Method | Tool | Formula | Definition | Chapter | Section | Example | Location | Event | Document | Other
- "description": DETAILED 2-5 sentence description. Must contain the key facts, metrics, definitions, or formulas from the source text. Do NOT write generic descriptions.
- "importance": 0.0–1.0
  - 1.0 = Core subject/person of document
  - 0.9 = Document node itself
  - 0.8 = Primary concepts, major projects, direct skills of the person
  - 0.6 = Supporting tools, secondary topics, work experience entries
  - 0.4 = Individual features, bullet points, minor tools
  - 0.2 = Background context

## EDGE REQUIREMENTS:
For EVERY node you create, you MUST create at least 1 edge connecting it to something.
- "from" / "to": node IDs
- "label": relationship verb: "covers"|"defines"|"uses"|"is_part_of"|"contains"|"built_with"|"achieved"|"led_to"|"requires"|"authored_by"|"worked_at"|"developed"|"has_skill"|"studied_at"|"resulted_in"|"prerequisite_of"|"same_as"
- "confidence": 0.0–1.0 (only output edges ≥ 0.8)

## EGO NODE RULE (CRITICAL):
If the document is a resume or personal document:
- The PERSON is ALWAYS mapped to node id "user_self"
- EVERY job, project, skill, and achievement must have an edge connecting to "user_self"
- DO NOT create a separate person node for Ayush — use "user_self" directly

## ID CANONICALIZATION (CRITICAL):
Use stable, predictable IDs so the same entity is never duplicated:
- Skills: skill_python, skill_react, skill_docker, skill_system_design
- Organizations: org_glitch_muj, org_jpmorgan, org_manipal_university
- Projects: project_whizan_ai, project_leetcode_orchestration, project_summer
- Tools: tool_docker, tool_kafka, tool_firebase, tool_spring_boot
- Concepts: concept_acid, concept_rag, concept_event_driven_architecture
- The document: doc_[filename_without_extension]

## OUTPUT FORMAT (STRICTLY VALID JSON):
{
  "nodes": [
    { "id": "user_self", "label": "Ayush Kumar", "type": "Person", "description": "...", "importance": 1.0 },
    { "id": "doc_ayush_cv", "label": "Ayush Kumar Resume", "type": "Document", "description": "...", "importance": 0.9 }
  ],
  "edges": [
    { "from": "doc_ayush_cv", "to": "user_self", "label": "authored_by", "confidence": 0.99 }
  ],
  "contradictions": []
}

CRITICAL FINAL RULES:
1. Aim for 40-80 nodes per chunk. More is ALWAYS better than fewer.
2. NEVER merge two distinct facts into one node. Each fact = its own node.
3. NEVER skip a bullet point, tool, or metric. If it's in the text, it gets a node.
4. ALL edges must have confidence ≥ 0.8 (no weak guesses).
5. Every node MUST have at least 1 edge. Isolated nodes are failures.
6. Return ONLY the JSON object. No markdown, no explanation, no code fences.
`;

/**
 * Calls the Gemini API to extract a knowledge graph from text content.
 * @param {string} textContent - The raw text to extract from
 * @param {string} apiKey - The Gemini API key
 * @param {Object} existingGraph - The current graph (used for context)
 * @param {Object} options - { isDocument: boolean, fileName: string, chunkIndex: number, totalChunks: number }
 * @returns {Promise<{nodes: Array, edges: Array}>}
 */
async function extractGraphFromText(textContent, apiKey, existingGraph = { nodes: [] }, options = {}) {
    const isDocument = options.isDocument || false;

    // Choose the right prompt based on source type
    let basePrompt = isDocument ? DOCUMENT_EXTRACTION_PROMPT : EXTRACTION_PROMPT;
    
    // Add chunk context for documents
    if (isDocument && options.totalChunks > 1) {
        basePrompt += `\n\nCONTEXT: This is chunk ${options.chunkIndex + 1} of ${options.totalChunks} from the file "${options.fileName}". Extract all concepts from this section. Reference the document node ID "${(options.fileName || 'document').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}" for edges.`;
    }
    
    // Build context block for known entities
    let contextBlock = "\n\nEXISTING KNOWN ENTITIES AND EDGES:\n";
    if (existingGraph.nodes.length > 0) {
        contextBlock += "1. NODE MATCHING: If the text mentions something that sounds phonetically similar or is a slight misspelling, you MUST use the exact ID and Label of the existing entity below:\n";
        const knownList = existingGraph.nodes.slice(-50).map(n => `- ID: "${n.id}", Label: "${n.label}", Type: "${n.type}"`).join("\n");
        contextBlock += knownList + "\n\n";

        contextBlock += "2. CONTRADICTION RULE: If the new text CONTRADICTS an existing edge (e.g. existing says 'studies', text says 'dropped'), DO NOT output it in 'edges'. Put it in the 'contradictions' array.\n";
        const keyEdges = existingGraph.edges.filter(e => e.from === 'user_self' || e.to === 'user_self').slice(-30);
        contextBlock += "Key Existing Edges:\n" + keyEdges.map(e => `- ${e.from} --${e.label}--> ${e.to}`).join("\n");
    } else {
        contextBlock += "No existing entities yet.";
    }

    const maxChars = isDocument ? 16000 : 15000;
    const finalPrompt = basePrompt + contextBlock + "\n\nText to analyze:\n" + textContent.slice(0, maxChars);

    try {
        // Use the dedicated memory key pool (auto-fallback on quota errors)
        const parsed = await withMemoryApiKey(async (key) => {
            const ai = new GoogleGenAI({ apiKey: key });
            const response = await ai.models.generateContent({
                model: 'gemini-3.1-flash-lite-preview',
                contents: [{ parts: [{ text: finalPrompt }] }],
                generationConfig: {
                    temperature: isDocument ? 0.0 : 0.1,
                    responseMimeType: 'application/json',
                    maxOutputTokens: isDocument ? 16384 : 4096
                }
            });

            const rawText = response.candidates[0].content.parts[0].text.trim();
            const cleaned = rawText.replace(/^```json\n?/g, '').replace(/^```\n?/g, '').replace(/\n?```$/g, '').trim();
            try {
                return JSON.parse(cleaned);
            } catch (jsonErr) {
                // Try to find the JSON object within the response (model sometimes prepends text)
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
                }
                console.warn(`[GraphExtractor] JSON parse failed on AI response. Returning empty.`);
                return { nodes: [], edges: [], contradictions: [] };
            }
        });

        // Validate structure
        if (!parsed.nodes || !Array.isArray(parsed.nodes)) parsed.nodes = [];
        if (!parsed.edges || !Array.isArray(parsed.edges)) parsed.edges = [];

        // Ensure every node has description and importance
        for (const node of parsed.nodes) {
            if (!node.description) {
                node.description = `${node.label} (${node.type})`;
            }
            // Default importance based on type if AI didn't provide one
            if (node.importance === undefined || node.importance === null) {
                if (node.id === 'user_self') node.importance = 1.0;
                else if (['Project', 'Skill', 'Person'].includes(node.type)) node.importance = 0.7;
                else if (node.type === 'Document') node.importance = 0.9;
                else node.importance = 0.5;
            }
            // Clamp to [0, 1]
            node.importance = Math.max(0, Math.min(1, node.importance));
        }

        const mode = isDocument ? '📄 Document' : '💬 Conversation';
        console.log(`[${mode}] Extracted: ${parsed.nodes.length} nodes, ${parsed.edges.length} edges (importance range: ${parsed.nodes.length ? Math.min(...parsed.nodes.map(n=>n.importance)).toFixed(1) + '-' + Math.max(...parsed.nodes.map(n=>n.importance)).toFixed(1) : 'n/a'})`);
        return parsed;

    } catch (e) {
        console.error('[GraphExtractor] Extraction failed entirely:', e.message);
        return { nodes: [], edges: [], contradictions: [] };
    }
}

module.exports = { extractGraphFromText };

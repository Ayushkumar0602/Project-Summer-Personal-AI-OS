const fs = require('fs');
const path = require('path');
const Paths = require('../core/utils/paths');
const { GoogleGenAI, Type } = require('@google/genai');
const { loadGraph, saveGraph } = require('./graph-store');
const { getMemoryApiKey } = require('./memory-api-key');

const GRAPH_PATH  = path.join(Paths.userData(), 'knowledge-graph.json');
const BACKUP_PATH = path.join(Paths.userData(), 'knowledge-graph.bak.json');

/**
 * Finds all nodes connected to a root node (usually 'user_self')
 */
function getConnectedComponent(graph, rootId) {
    const visited = new Set();
    const queue = [rootId];
    
    // Build adjacency list for undirected traversal
    const adj = {};
    graph.nodes.forEach(n => adj[n.id] = []);
    graph.edges.forEach(e => {
        if (adj[e.from]) adj[e.from].push(e.to);
        if (adj[e.to]) adj[e.to].push(e.from);
    });

    if (!adj[rootId]) return visited;

    while (queue.length > 0) {
        const current = queue.shift();
        if (!visited.has(current)) {
            visited.add(current);
            const neighbors = adj[current] || [];
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    queue.push(neighbor);
                }
            }
        }
    }
    return visited;
}

/**
 * AI function to figure out where isolated nodes belong.
 */
async function autoConnectIslands() {
    const graph = loadGraph();
    
    // 1. Identify isolated nodes
    const mainComponent = getConnectedComponent(graph, 'user_self');
    const isolatedNodes = graph.nodes.filter(n => !mainComponent.has(n.id));
    
    if (isolatedNodes.length === 0) {
        return { success: true, newEdges: [], message: "Graph is already fully connected." };
    }

    // 2. Prepare context of the main graph (High importance nodes + some context)
    const mainNodesContext = graph.nodes
        .filter(n => mainComponent.has(n.id) && (n.importance >= 0.5 || n.id === 'user_self'))
        .map(n => `[${n.id}] ${n.label}: ${n.description}`)
        .join('\n');

    const isolatedNodesContext = isolatedNodes
        .map(n => `[${n.id}] ${n.label}: ${n.description}`)
        .join('\n');

    // 3. Ask Gemini for edge connections
    const prompt = `You are a Knowledge Graph Architect. The following knowledge graph has "isolated islands" (nodes disconnected from the main graph).
Your job is to figure out the logical relationship between these isolated nodes and the main graph nodes, so that all nodes ultimately connect back to the main graph.

MAIN GRAPH NODES (Potential Parents/Targets):
${mainNodesContext}

ISOLATED NODES (Need to be connected):
${isolatedNodesContext}

Analyze the semantics and descriptions. Return a list of edges linking isolated nodes to main graph nodes. 
Try to connect each isolated node to the most logical main node using a descriptive relationship label (e.g. 'part_of', 'works_at', 'related_to', 'knows_about', 'uses').
Ensure every isolated node gets at least one edge connecting it to a main node.`;

    const apiKey = getMemoryApiKey();
    if (!apiKey) throw new Error("API Key missing");

    const ai = new GoogleGenAI({ apiKey });

    console.log(`[Optimizer] Analyzing ${isolatedNodes.length} isolated nodes...`);
    
    const result = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: prompt,
        config: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        from: { type: Type.STRING },
                        to: { type: Type.STRING },
                        label: { type: Type.STRING }
                    },
                    required: ["from", "to", "label"]
                }
            }
        }
    });

    const newEdges = JSON.parse(result.text);

    if (newEdges.length === 0) {
        return { success: true, newEdges: [], message: "AI could not find logical connections." };
    }

    // 4. Create Backup
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(graph, null, 2), 'utf-8');
    console.log(`[Optimizer] Backup created at ${BACKUP_PATH}`);

    // 5. Apply Edges
    let addedCount = 0;
    for (const edge of newEdges) {
        // Validate nodes exist
        if (graph.nodes.find(n => n.id === edge.from) && graph.nodes.find(n => n.id === edge.to)) {
            // Check for duplicates
            const exists = graph.edges.some(e => e.from === edge.from && e.to === edge.to && e.label === edge.label);
            if (!exists) {
                graph.edges.push({
                    from: edge.from,
                    to: edge.to,
                    label: edge.label.replace(/\s+/g, '_').toLowerCase(),
                    source: 'ai_optimizer',
                    confidence: 0.9,
                    updatedAt: Date.now()
                });
                addedCount++;
            }
        }
    }

    saveGraph(graph);
    return { success: true, addedCount, message: `Successfully connected ${addedCount} isolated edges.` };
}

function revertGraph() {
    if (!fs.existsSync(BACKUP_PATH)) {
        return { success: false, message: "No backup available to revert to." };
    }
    
    try {
        const backupData = fs.readFileSync(BACKUP_PATH, 'utf-8');
        fs.writeFileSync(GRAPH_PATH, backupData, 'utf-8');
        fs.unlinkSync(BACKUP_PATH); // Delete backup after reverting
        return { success: true, message: "Graph reverted to previous state." };
    } catch (err) {
        return { success: false, message: err.message };
    }
}

function checkBackupExists() {
    return fs.existsSync(BACKUP_PATH);
}

async function runMemoryCommand(commandText) {
    const graph = loadGraph();
    
    const nodesCtx = graph.nodes.map(n => `[ID: ${n.id}] ${n.label}: ${n.description || ''}`).join('\n');
    
    const prompt = `You are a Knowledge Graph AI Administrator. 
The user wants to perform an operation on their memory graph.
USER COMMAND: "${commandText}"

CURRENT NODES (For Reference):
${nodesCtx}

Generate a JSON array of operations to execute. Supported actions:
- {"action": "delete_node", "id": "node_id"}
- {"action": "add_edge", "from": "node_id", "to": "node_id", "label": "relationship_name"}
- {"action": "delete_edge", "from": "node_id", "to": "node_id"}

Return ONLY a valid JSON array of operations. Return empty array if the command is invalid or no changes are needed.`;

    const apiKey = getMemoryApiKey();
    if (!apiKey) throw new Error("API Key missing");
    const ai = new GoogleGenAI({ apiKey });

    console.log(`[Optimizer] Running memory command: "${commandText}"...`);
    
    const result = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: prompt,
        config: {
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        action: { type: Type.STRING },
                        id: { type: Type.STRING },
                        from: { type: Type.STRING },
                        to: { type: Type.STRING },
                        label: { type: Type.STRING }
                    },
                    required: ["action"]
                }
            }
        }
    });

    const operations = JSON.parse(result.text);

    if (operations.length === 0) {
        return { success: true, message: "No changes needed or command not understood." };
    }

    fs.writeFileSync(BACKUP_PATH, JSON.stringify(graph, null, 2), 'utf-8');

    let appliedCount = 0;
    for (const op of operations) {
        if (op.action === 'delete_node' && op.id) {
            graph.nodes = graph.nodes.filter(n => n.id !== op.id);
            graph.edges = graph.edges.filter(e => e.from !== op.id && e.to !== op.id);
            appliedCount++;
        } else if (op.action === 'add_edge' && op.from && op.to && op.label) {
            if (graph.nodes.find(n => n.id === op.from) && graph.nodes.find(n => n.id === op.to)) {
                graph.edges.push({
                    from: op.from,
                    to: op.to,
                    label: op.label.replace(/\s+/g, '_').toLowerCase(),
                    source: 'ai_optimizer',
                    confidence: 1.0,
                    updatedAt: Date.now()
                });
                appliedCount++;
            }
        } else if (op.action === 'delete_edge' && op.from && op.to) {
            const before = graph.edges.length;
            graph.edges = graph.edges.filter(e => !(e.from === op.from && e.to === op.to));
            if (graph.edges.length < before) appliedCount++;
        }
    }

    saveGraph(graph);
    return { success: true, message: `Successfully executed ${appliedCount} operations based on your command.` };
}

module.exports = { autoConnectIslands, revertGraph, checkBackupExists, runMemoryCommand };

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Store graph in the app's user data directory so it persists across sessions
const GRAPH_PATH = path.join(app.getPath('userData'), 'knowledge-graph.json');

const EMPTY_GRAPH = { nodes: [], edges: [] };

// Decay constants
const DECAY_HALF_LIFE_DAYS = 30; // node relevance halves every 30 days
const MS_PER_DAY = 86400000;

function loadGraph() {
    try {
        if (fs.existsSync(GRAPH_PATH)) {
            const raw = fs.readFileSync(GRAPH_PATH, 'utf-8');
            const parsed = JSON.parse(raw);
            // Ensure nodes and edges arrays always exist
            if (!parsed.nodes) parsed.nodes = [];
            if (!parsed.edges) parsed.edges = [];
            return parsed;
        }
    } catch (e) {
        console.error('Failed to load graph:', e);
    }
    return JSON.parse(JSON.stringify(EMPTY_GRAPH));
}

function saveGraph(graph) {
    try {
        fs.writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save graph:', e);
    }
}

const { isSameEntity } = require('./entity-resolution');

// Mutually exclusive edge labels that should overwrite instead of append
const EXCLUSIVE_EDGES = new Set(['lives_in', 'current_job', 'born_in', 'is_a']);

/**
 * Merges a partial graph into the existing full graph.
 * Uses entity resolution to map aliases to canonical nodes,
 * and handles edge overwriting for exclusive facts.
 */
function mergeGraph(existingGraph, newGraph) {
    const merged = {
        nodes: [...(existingGraph.nodes || [])],
        edges: [...(existingGraph.edges || [])]
    };

    // ID mapping table (e.g. "Ayush_Jaiswal" -> "user_self")
    const aliasMap = {};

    for (const newNode of (newGraph.nodes || [])) {
        // Find if this entity already exists
        const existingNode = merged.nodes.find(n => isSameEntity(n, newNode));
        
        if (existingNode) {
            aliasMap[newNode.id] = existingNode.id;
            // Merge description if existing one is empty
            if (!existingNode.description && newNode.description) {
                existingNode.description = newNode.description;
            }
            // Merge tags
            if (newNode.tags && newNode.tags.length) {
                existingNode.tags = [...new Set([...(existingNode.tags || []), ...newNode.tags])];
            }
        } else {
            aliasMap[newNode.id] = newNode.id;
            // Stamp creation time on new nodes
            if (!newNode.createdAt) newNode.createdAt = Date.now();
            if (!newNode.tags) newNode.tags = [];
            merged.nodes.push(newNode);
        }
    }

    const timestamp = Date.now();

    for (const edge of (newGraph.edges || [])) {
        // Map from/to IDs to their canonical resolved IDs
        const canonicalFrom = aliasMap[edge.from] || edge.from;
        const canonicalTo = aliasMap[edge.to] || edge.to;
        
        // Prevent self-loops
        if (canonicalFrom === canonicalTo) continue;

        // Check if we have an exclusive edge conflict (e.g., [user_self] -> lives_in -> [somewhere_else])
        if (EXCLUSIVE_EDGES.has(edge.label)) {
            // Remove any existing edge with the same FROM and LABEL
            merged.edges = merged.edges.filter(e => !(e.from === canonicalFrom && e.label === edge.label));
        }

        // Check for exact duplicates
        const isDuplicate = merged.edges.some(e => 
            e.from === canonicalFrom && e.to === canonicalTo && e.label === edge.label
        );

        if (!isDuplicate) {
            merged.edges.push({
                from: canonicalFrom,
                to: canonicalTo,
                label: edge.label,
                confidence: edge.confidence || 1.0,
                updatedAt: timestamp
            });
        }
    }

    return merged;
}

function clearGraph() {
    saveGraph(JSON.parse(JSON.stringify(EMPTY_GRAPH)));
}

/**
 * Records that a node was accessed right now (for decay scoring).
 * @param {string} nodeId
 */
function touchNodeAccess(nodeId) {
    try {
        const graph = loadGraph();
        const node = graph.nodes.find(n => n.id === nodeId);
        if (node) {
            node.lastAccessedAt = Date.now();
            saveGraph(graph);
        }
    } catch (e) {
        // Non-critical — don't crash on access tracking failure
    }
}

/**
 * Returns a decay multiplier [0.1 → 1.0] for a node based on how recently it was accessed.
 * Nodes accessed today = 1.0, nodes not accessed in 30 days ≈ 0.5
 */
function getDecayScore(node) {
    const lastAccess = node.lastAccessedAt || node.createdAt || Date.now();
    const daysSince = (Date.now() - lastAccess) / MS_PER_DAY;
    // Exponential decay: score = 0.9^daysSince, floored at 0.1
    return Math.max(0.1, Math.pow(0.9, daysSince / (DECAY_HALF_LIFE_DAYS / 23)));
}

module.exports = { loadGraph, saveGraph, mergeGraph, clearGraph, touchNodeAccess, getDecayScore, GRAPH_PATH };

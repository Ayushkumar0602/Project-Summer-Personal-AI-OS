const fs = require('fs');
const path = require('path');
const { supabase } = require('../services/supabase-client');

// Use platform-agnostic path resolver (works in daemon AND Electron)
const Paths = require('../core/utils/paths');

// Store graph in the app's user data directory so it persists across sessions
const GRAPH_PATH = path.join(Paths.userData(), 'knowledge-graph.json');

const EMPTY_GRAPH = { nodes: [], edges: [] };
let memoryGraphCache = null; // In-memory cache for synchronous reads

// Supabase table names
const TABLE_NODES = 'memory_nodes';
const TABLE_EDGES = 'memory_edges';

// Decay constants
const DECAY_HALF_LIFE_DAYS = 30; // node relevance halves every 30 days
const MS_PER_DAY = 86400000;

async function initGraphStore() {
    if (memoryGraphCache) return memoryGraphCache;

    if (supabase) {
        try {
            console.log('[GraphStore] Fetching graph from Supabase...');
            const [{ data: nodes }, { data: edges }] = await Promise.all([
                supabase.from(TABLE_NODES).select('*'),
                supabase.from(TABLE_EDGES).select('*')
            ]);
            
            memoryGraphCache = { 
                nodes: nodes || [], 
                edges: edges || [] 
            };
            
            // If Supabase is empty, this might be the first migration. Push local to cloud instead of wiping local!
            if (memoryGraphCache.nodes.length === 0 && fs.existsSync(GRAPH_PATH)) {
                try {
                    const raw = fs.readFileSync(GRAPH_PATH, 'utf-8');
                    const parsed = JSON.parse(raw);
                    if (parsed.nodes && parsed.nodes.length > 0) {
                        console.log('[GraphStore] Cloud is empty but local has data. Pushing local to cloud...');
                        memoryGraphCache = parsed;
                        await _syncToSupabase(memoryGraphCache);
                    }
                } catch(err) {
                    console.error('[GraphStore] Failed to read local backup for migration', err);
                }
            }
            
            // Sync local backup
            fs.writeFileSync(GRAPH_PATH, JSON.stringify(memoryGraphCache, null, 2), 'utf-8');
            console.log(`[GraphStore] Supabase sync complete. Nodes: ${memoryGraphCache.nodes.length}, Edges: ${memoryGraphCache.edges.length}`);
            
            // Watch local file for changes made by other processes (e.g. Electron UI uploads)
            fs.watch(GRAPH_PATH, async (eventType) => {
                if (eventType === 'change') {
                    console.log('[GraphStore] Local graph file changed. Reloading cache...');
                    try {
                        const raw = fs.readFileSync(GRAPH_PATH, 'utf-8');
                        memoryGraphCache = JSON.parse(raw);
                    } catch(e) {}
                }
            });

            // Subscribe to realtime changes (if enabled in Supabase)
            supabase.channel('schema-db-changes')
              .on('postgres_changes', { event: '*', schema: 'public', table: 'memory_nodes' }, async (payload) => {
                  console.log('[GraphStore] Realtime update detected on nodes. Refreshing cache...');
                  await _fetchFromSupabase();
              })
              .on('postgres_changes', { event: '*', schema: 'public', table: 'memory_edges' }, async (payload) => {
                  console.log('[GraphStore] Realtime update detected on edges. Refreshing cache...');
                  await _fetchFromSupabase();
              })
              .subscribe();

            return memoryGraphCache;
        } catch (e) {
            console.error('[GraphStore] Supabase fetch failed. Falling back to local disk:', e.message);
        }
    }

    // Fallback to local
    try {
        if (fs.existsSync(GRAPH_PATH)) {
            const raw = fs.readFileSync(GRAPH_PATH, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!parsed.nodes) parsed.nodes = [];
            if (!parsed.edges) parsed.edges = [];
            memoryGraphCache = parsed;
        } else {
            memoryGraphCache = JSON.parse(JSON.stringify(EMPTY_GRAPH));
        }
    } catch (e) {
        console.error('Failed to load graph:', e);
        memoryGraphCache = JSON.parse(JSON.stringify(EMPTY_GRAPH));
    }

    try {
        fs.watch(GRAPH_PATH, (eventType) => {
            if (eventType === 'change') {
                console.log('[GraphStore] Local graph file changed. Reloading cache...');
                try {
                    const raw = fs.readFileSync(GRAPH_PATH, 'utf-8');
                    memoryGraphCache = JSON.parse(raw);
                } catch(e) {}
            }
        });
    } catch(e) {}

    return memoryGraphCache;
}

function loadGraph() {
    // If cache is null (init not called yet), do a blocking read from local disk
    if (!memoryGraphCache) {
        try {
            if (fs.existsSync(GRAPH_PATH)) {
                const raw = fs.readFileSync(GRAPH_PATH, 'utf-8');
                const parsed = JSON.parse(raw);
                if (!parsed.nodes) parsed.nodes = [];
                if (!parsed.edges) parsed.edges = [];
                memoryGraphCache = parsed;
            } else {
                memoryGraphCache = JSON.parse(JSON.stringify(EMPTY_GRAPH));
            }
        } catch(e) {
            memoryGraphCache = JSON.parse(JSON.stringify(EMPTY_GRAPH));
        }
    }
    return memoryGraphCache;
}

function saveGraph(graph) {
    memoryGraphCache = graph;
    
    // 1. Sync to local disk synchronously (failsafe)
    try {
        fs.writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save graph locally:', e);
    }

    // 2. Sync to Supabase asynchronously
    if (supabase) {
        _syncToSupabase(graph).catch(err => {
            console.error('[GraphStore] Background sync to Supabase failed:', err.message);
        });
    }
}

let syncTimeout = null;
async function _syncToSupabase(graph) {
    if (!supabase) return;
    try {
        if (graph.nodes.length > 0) {
            const nodesToInsert = graph.nodes.map(n => ({
                id: n.id, type: n.type, label: n.label, description: n.description,
                imagePath: n.imagePath, publicUrl: n.publicUrl, imageHash: n.imageHash,
                entities: n.entities, faceIds: n.faceIds, tags: n.tags,
                pinned: !!n.pinned, importance: n.importance || 0.5,
                updatedAt: n.updatedAt, source: n.source
            }));
            for (let i = 0; i < nodesToInsert.length; i += 100) {
                await supabase.from(TABLE_NODES).upsert(nodesToInsert.slice(i, i + 100));
            }
        }
        if (graph.edges.length > 0) {
            const edgesToInsert = graph.edges.map(e => ({
                from: e.from, to: e.to, label: e.label,
                confidence: e.confidence || 1.0, source: e.source, updatedAt: e.updatedAt
            }));
            for (let i = 0; i < edgesToInsert.length; i += 100) {
                await supabase.from(TABLE_EDGES).upsert(edgesToInsert.slice(i, i + 100), { onConflict: 'from,to,label' });
            }
        }
        console.log('[GraphStore] Synced to Supabase.');
    } catch (e) {
        console.error('[GraphStore] Supabase sync error:', e.message);
    }
}

async function _fetchFromSupabase() {
    if (!supabase) return;
    try {
        const [{ data: nodes }, { data: edges }] = await Promise.all([
            supabase.from(TABLE_NODES).select('*'),
            supabase.from(TABLE_EDGES).select('*')
        ]);
        memoryGraphCache = { nodes: nodes || [], edges: edges || [] };
        fs.writeFileSync(GRAPH_PATH, JSON.stringify(memoryGraphCache, null, 2), 'utf-8');
    } catch (e) {
        console.error('[GraphStore] Background fetch failed:', e.message);
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

module.exports = { initGraphStore, loadGraph, saveGraph, mergeGraph, clearGraph, touchNodeAccess, getDecayScore, GRAPH_PATH };

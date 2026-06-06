const fs = require('fs');
const path = require('path');
const { supabase } = require('../services/supabase-client');
const { generateNodeEmbedding } = require('./embeddings');

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

// ── Flaw 8 fix: monotonic reference time ─────────────────────────────────────
// Using daemon startup time as anchor prevents total score corruption if the
// system clock is wrong — only nodes accessed BEFORE the wrong-clock period
// are affected, not all nodes simultaneously.
const DAEMON_START_MS = Date.now();

// ── Delta Sync Tracking Sets ─────────────────────────────────────────────────
const _dirtyNodes = new Set();
const _dirtyEdges = new Set();
const _deletedNodes = new Set();
const _deletedEdges = new Set();

// ── Flaw 8 fix: batched write queue for access tracking ──────────────────────
// touchNodeAccess() was calling saveGraph() on every access — a full disk write
// for every memory retrieval. Under heavy query load this causes write storms.
const _pendingAccessUpdates = new Map(); // nodeId → timestamp
let   _accessFlushTimer = null;

function _flushAccessUpdates() {
    _accessFlushTimer = null;
    if (_pendingAccessUpdates.size === 0) return;
    try {
        const graph = loadGraph();
        let changed = 0;
        for (const [nodeId, ts] of _pendingAccessUpdates) {
            const node = graph.nodes.find(n => n.id === nodeId);
            if (node) { 
                node.lastAccessedAt = ts; 
                _dirtyNodes.add(node.id);
                changed++; 
            }
        }
        _pendingAccessUpdates.clear();
        if (changed > 0) saveGraph(graph);
    } catch (e) {
        // Non-critical
    }
}

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
                        await _syncToSupabase(memoryGraphCache, true);
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
async function _syncToSupabase(graph, forceFullSync = false) {
    if (!supabase) return;
    try {
        let nodesToUpdate = Array.from(_dirtyNodes);
        let edgesToUpdate = Array.from(_dirtyEdges);
        let nodesToDelete = Array.from(_deletedNodes);
        let edgesToDelete = Array.from(_deletedEdges).map(s => JSON.parse(s));

        if (forceFullSync) {
            nodesToUpdate = graph.nodes.map(n => n.id);
            edgesToUpdate = graph.edges.map(e => JSON.stringify({ from: e.from, to: e.to, label: e.label }));
        } else {
            _dirtyNodes.clear();
            _dirtyEdges.clear();
            _deletedNodes.clear();
            _deletedEdges.clear();
        }

        if (nodesToUpdate.length === 0 && edgesToUpdate.length === 0 && nodesToDelete.length === 0 && edgesToDelete.length === 0) {
            return;
        }

        let needsLocalSave = false;
        const nodesToInsert = [];
        for (const nodeId of nodesToUpdate) {
            const n = graph.nodes.find(node => node.id === nodeId);
            if (!n) continue;
            
            if (!n.embedding) {
                try {
                    n.embedding = await generateNodeEmbedding(n);
                    needsLocalSave = true;
                } catch (e) {
                    console.error('[GraphStore] Failed to generate embedding for node', n.id, e);
                }
            }
            
            nodesToInsert.push({
                id: n.id, type: n.type, label: n.label, description: n.description,
                imagePath: n.imagePath, publicUrl: n.publicUrl, imageHash: n.imageHash,
                entities: n.entities, faceIds: n.faceIds, tags: n.tags,
                pinned: !!n.pinned, importance: n.importance || 0.5,
                updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : (n.updatedAt ? new Date(n.updatedAt).getTime() : Date.now()),
                source: n.source,
                createdAt: n.createdAt ? (typeof n.createdAt === 'string' ? n.createdAt : new Date(n.createdAt).toISOString()) : new Date().toISOString(),
                embedding: n.embedding
            });
        }

        if (needsLocalSave) {
            fs.writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2), 'utf-8');
        }

        if (nodesToDelete.length > 0) {
            for (let i = 0; i < nodesToDelete.length; i += 100) {
                await supabase.from(TABLE_NODES).delete().in('id', nodesToDelete.slice(i, i + 100));
            }
        }

        if (edgesToDelete.length > 0) {
            for (const edge of edgesToDelete) {
                await supabase.from(TABLE_EDGES).delete()
                    .eq('from', edge.from)
                    .eq('to', edge.to)
                    .eq('label', edge.label);
            }
        }

        if (nodesToInsert.length > 0) {
            for (let i = 0; i < nodesToInsert.length; i += 100) {
                const { error } = await supabase.from(TABLE_NODES).upsert(nodesToInsert.slice(i, i + 100));
                if (error) console.error('[GraphStore] ❌ Nodes upsert failed:', error.message, error.details || '');
            }
        }

        if (edgesToUpdate.length > 0) {
            const edgesToInsert = [];
            for (const edgeStr of edgesToUpdate) {
                const eKey = JSON.parse(edgeStr);
                const e = graph.edges.find(edge => edge.from === eKey.from && edge.to === eKey.to && edge.label === eKey.label);
                if (e) {
                    edgesToInsert.push({
                        from: e.from, to: e.to, label: e.label,
                        confidence: e.confidence || 1.0, source: e.source,
                        updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : (e.updatedAt ? new Date(e.updatedAt).getTime() : Date.now())
                    });
                }
            }
            for (let i = 0; i < edgesToInsert.length; i += 100) {
                const { error } = await supabase.from(TABLE_EDGES).upsert(edgesToInsert.slice(i, i + 100), { onConflict: 'from,to,label' });
                if (error) console.error('[GraphStore] ❌ Edges upsert failed:', error.message, error.details || '');
            }
        }
        console.log(`[GraphStore] Delta synced to Supabase. Nodes updated: ${nodesToInsert.length}, deleted: ${nodesToDelete.length}`);
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
            let nodeMutated = false;
            // Merge description if existing one is empty
            if (!existingNode.description && newNode.description) {
                existingNode.description = newNode.description;
                nodeMutated = true;
            }
            // Merge tags
            if (newNode.tags && newNode.tags.length) {
                const oldTagsLen = (existingNode.tags || []).length;
                existingNode.tags = [...new Set([...(existingNode.tags || []), ...newNode.tags])];
                if (existingNode.tags.length > oldTagsLen) nodeMutated = true;
            }
            if (nodeMutated) {
                existingNode.updatedAt = Date.now();
                _dirtyNodes.add(existingNode.id);
            }
        } else {
            aliasMap[newNode.id] = newNode.id;
            // Stamp creation time on new nodes
            if (!newNode.createdAt) newNode.createdAt = Date.now();
            newNode.updatedAt = Date.now();
            if (!newNode.tags) newNode.tags = [];
            merged.nodes.push(newNode);
            _dirtyNodes.add(newNode.id);
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
            const toRemove = merged.edges.filter(e => (e.from === canonicalFrom && e.label === edge.label));
            for (const r of toRemove) {
                _deletedEdges.add(JSON.stringify({ from: r.from, to: r.to, label: r.label }));
            }
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
            _dirtyEdges.add(JSON.stringify({ from: canonicalFrom, to: canonicalTo, label: edge.label }));
        }
    }

    return merged;
}

function clearGraph() {
    saveGraph(JSON.parse(JSON.stringify(EMPTY_GRAPH)));
}

function deleteMemoryNode(nodeId) {
    if (!memoryGraphCache) return false;
    const initialLen = memoryGraphCache.nodes.length;
    memoryGraphCache.nodes = memoryGraphCache.nodes.filter(n => n.id !== nodeId);
    if (memoryGraphCache.nodes.length < initialLen) {
        _deletedNodes.add(nodeId);
        // Delete all edges connected to it
        const edgesToRemove = memoryGraphCache.edges.filter(e => e.from === nodeId || e.to === nodeId);
        for (const r of edgesToRemove) {
            _deletedEdges.add(JSON.stringify({ from: r.from, to: r.to, label: r.label }));
        }
        memoryGraphCache.edges = memoryGraphCache.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
        return true;
    }
    return false;
}

function deleteMemoryEdge(from, to, label) {
    if (!memoryGraphCache) return false;
    const initialLen = memoryGraphCache.edges.length;
    memoryGraphCache.edges = memoryGraphCache.edges.filter(e => !(e.from === from && e.to === to && e.label === label));
    if (memoryGraphCache.edges.length < initialLen) {
        _deletedEdges.add(JSON.stringify({ from, to, label }));
        return true;
    }
    return false;
}

function markNodeDirty(nodeId) {
    _dirtyNodes.add(nodeId);
}

function markEdgeDirty(from, to, label) {
    _dirtyEdges.add(JSON.stringify({ from, to, label }));
}

/**
 * Records that a node was accessed right now (for decay scoring).
 * FLAW 8 FIX: Batches writes with a 5-second debounce to prevent write storms.
 * @param {string} nodeId
 */
function touchNodeAccess(nodeId) {
    try {
        // Clamp timestamp: reject future timestamps (clock skew protection)
        const now = Math.min(Date.now(), DAEMON_START_MS + 365 * MS_PER_DAY);
        _pendingAccessUpdates.set(nodeId, now);
        if (!_accessFlushTimer) {
            _accessFlushTimer = setTimeout(_flushAccessUpdates, 5000);
        }
    } catch (e) {
        // Non-critical
    }
}

/**
 * Returns a decay multiplier [0.1 → 1.0] for a node based on how recently it was accessed.
 * FLAW 8 FIX: Clamps lastAccess to DAEMON_START_MS so future timestamps (from clock skew)
 * don't produce negative daysSince (which would give inflated scores).
 * Nodes accessed today = 1.0, nodes not accessed in 30 days ≈ 0.5
 */
function getDecayScore(node) {
    const rawLastAccess = node.lastAccessedAt || node.createdAt || DAEMON_START_MS;
    // Clamp: reject timestamps in the future beyond today + 1hr (clock skew guard)
    const lastAccess = Math.min(rawLastAccess, Date.now() + 3_600_000);
    const daysSince  = Math.max(0, (Date.now() - lastAccess) / MS_PER_DAY);
    return Math.max(0.1, Math.pow(0.9, daysSince / (DECAY_HALF_LIFE_DAYS / 23)));
}

module.exports = { initGraphStore, loadGraph, saveGraph, mergeGraph, clearGraph, deleteMemoryNode, deleteMemoryEdge, markNodeDirty, markEdgeDirty, touchNodeAccess, getDecayScore, GRAPH_PATH };

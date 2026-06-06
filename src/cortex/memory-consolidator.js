/**
 * cortex/memory-consolidator.js
 *
 * Performs graph maintenance during idle time.
 * This is the safest Cortex module — most operations need zero LLM calls.
 *
 * Operations (in priority order):
 *   1. Decay Pruning    — Archive nodes with decayScore < 0.15
 *   2. Deduplication    — Merge duplicate entities using existing entity-resolution
 *   3. Island Bridging  — Connect isolated nodes using existing autoConnectIslands()
 *   4. Stats            — Return consolidation report for the Self-Reflector
 *
 * Integration points (all existing code):
 *   - graph-store.js:   loadGraph(), saveGraph(), getDecayScore()
 *   - entity-resolution.js: isSameEntity()
 *   - graph-optimizer.js:   autoConnectIslands()
 */

'use strict';

const { createLogger } = require('../core/utils/logger');
const { loadGraph, saveGraph, getDecayScore } = require('../knowledge/graph-store');
const { isSameEntity } = require('../knowledge/entity-resolution');
const { logEvolution, ACTIONS } = require('./evolution-log');

const log = createLogger('MemoryConsolidator');

// ── Configuration ────────────────────────────────────────────────────────────

const DECAY_PRUNE_THRESHOLD = 0.15;  // Nodes below this score get archived
const MAX_PRUNE_PER_CYCLE   = 20;    // Don't prune too many at once
const PROTECTED_NODE_IDS    = new Set(['user_self']); // Never prune these
const PROTECTED_NODE_TYPES  = new Set(['ImageMemory', 'CapabilityGap', 'EvolutionJournal']); // Never prune these types

// ── Archived knowledge store ─────────────────────────────────────────────────

const fs   = require('node:fs');
const path = require('node:path');
const Paths = require('../core/utils/paths');

const ARCHIVE_PATH = path.join(Paths.cortexData(), 'archived-knowledge.json');

function _loadArchive() {
    try {
        if (fs.existsSync(ARCHIVE_PATH)) {
            return JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf-8'));
        }
    } catch {}
    return { nodes: [], archivedAt: [] };
}

function _saveArchive(archive) {
    try {
        const dir = path.dirname(ARCHIVE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(archive, null, 2), 'utf-8');
    } catch (e) {
        log.warn(`Failed to save archive: ${e.message}`);
    }
}

// ── Operations ───────────────────────────────────────────────────────────────

/**
 * Prune nodes with very low decay scores.
 * Moves them to an archive file (recoverable) rather than deleting.
 *
 * @returns {{ prunedCount: number, archivedNodes: string[] }}
 */
function pruneDecayedNodes() {
    const graph = loadGraph();
    const toPrune = [];

    for (const node of graph.nodes) {
        // Skip protected nodes
        if (PROTECTED_NODE_IDS.has(node.id)) continue;
        if (PROTECTED_NODE_TYPES.has(node.type)) continue;
        if (node.pinned === true) continue;
        if ((node.importance || 0.5) >= 0.8) continue; // Don't prune high-importance

        const score = getDecayScore(node);
        if (score < DECAY_PRUNE_THRESHOLD) {
            toPrune.push({ node, score });
        }
    }

    if (toPrune.length === 0) {
        log.info('Decay pruning: 0 nodes below threshold.');
        return { prunedCount: 0, archivedNodes: [] };
    }

    // Sort by lowest score first, limit per cycle
    toPrune.sort((a, b) => a.score - b.score);
    const batch = toPrune.slice(0, MAX_PRUNE_PER_CYCLE);

    // Archive before removing
    const archive = _loadArchive();
    const prunedIds = new Set();

    for (const { node, score } of batch) {
        archive.nodes.push({
            ...node,
            _archivedAt: Date.now(),
            _decayScoreAtArchive: score,
        });
        archive.archivedAt.push(Date.now());
        prunedIds.add(node.id);
    }

    // Cap archive at 500 nodes
    if (archive.nodes.length > 500) {
        archive.nodes = archive.nodes.slice(-500);
    }
    _saveArchive(archive);

    // Remove from graph
    graph.nodes = graph.nodes.filter(n => !prunedIds.has(n.id));
    // Remove orphaned edges
    graph.edges = graph.edges.filter(e => !prunedIds.has(e.from) && !prunedIds.has(e.to));
    saveGraph(graph);

    const archivedLabels = batch.map(b => b.node.label);
    log.info(`Decay pruning: archived ${batch.length} nodes: [${archivedLabels.join(', ')}]`);

    logEvolution(ACTIONS.NODES_PRUNED, {
        count: batch.length,
        nodes: archivedLabels,
    });

    return { prunedCount: batch.length, archivedNodes: archivedLabels };
}

/**
 * Find and merge duplicate entities in the graph.
 * Uses the existing isSameEntity() from entity-resolution.js.
 *
 * @returns {{ mergedCount: number, mergedPairs: Array<[string, string]> }}
 */
function deduplicateNodes() {
    const graph = loadGraph();
    const mergedPairs = [];
    const removed = new Set();

    // O(n²) but graphs are typically < 500 nodes, and we cap at 10 merges per cycle
    for (let i = 0; i < graph.nodes.length && mergedPairs.length < 10; i++) {
        const nodeA = graph.nodes[i];
        if (removed.has(nodeA.id)) continue;
        if (PROTECTED_NODE_IDS.has(nodeA.id)) continue;

        for (let j = i + 1; j < graph.nodes.length && mergedPairs.length < 10; j++) {
            const nodeB = graph.nodes[j];
            if (removed.has(nodeB.id)) continue;
            if (PROTECTED_NODE_IDS.has(nodeB.id)) continue;

            if (isSameEntity(nodeA, nodeB)) {
                // Keep the node with more description / higher importance
                const keepNode = (nodeA.description?.length || 0) >= (nodeB.description?.length || 0) ? nodeA : nodeB;
                const removeNode = keepNode === nodeA ? nodeB : nodeA;

                // Merge descriptions if different
                if (removeNode.description && removeNode.description !== keepNode.description) {
                    keepNode.description = `${keepNode.description} ${removeNode.description}`.trim();
                }

                // Merge tags
                if (removeNode.tags?.length) {
                    keepNode.tags = [...new Set([...(keepNode.tags || []), ...removeNode.tags])];
                }

                // Keep higher importance
                keepNode.importance = Math.max(
                    keepNode.importance || 0.5,
                    removeNode.importance || 0.5
                );

                // Redirect edges pointing to/from removed node
                for (const edge of graph.edges) {
                    if (edge.from === removeNode.id) edge.from = keepNode.id;
                    if (edge.to === removeNode.id) edge.to = keepNode.id;
                }

                // Remove self-loops created by merge
                graph.edges = graph.edges.filter(e => e.from !== e.to);

                // Remove duplicate edges (same from, to, label)
                const edgeKeys = new Set();
                graph.edges = graph.edges.filter(e => {
                    const key = `${e.from}→${e.to}:${e.label}`;
                    if (edgeKeys.has(key)) return false;
                    edgeKeys.add(key);
                    return true;
                });

                removed.add(removeNode.id);
                mergedPairs.push([keepNode.label, removeNode.label]);

                log.info(`Dedup: merged "${removeNode.label}" into "${keepNode.label}"`);
            }
        }
    }

    if (mergedPairs.length > 0) {
        // Remove merged nodes
        graph.nodes = graph.nodes.filter(n => !removed.has(n.id));
        saveGraph(graph);

        logEvolution(ACTIONS.NODES_DEDUPED, {
            count: mergedPairs.length,
            pairs: mergedPairs,
        });
    } else {
        log.info('Deduplication: no duplicates found.');
    }

    return { mergedCount: mergedPairs.length, mergedPairs };
}

/**
 * Bridge isolated nodes using the existing autoConnectIslands().
 * This IS an LLM call, so it should be called less frequently.
 *
 * @returns {{ connected: boolean, addedCount: number, message: string }}
 */
async function bridgeIslands() {
    try {
        const { autoConnectIslands } = require('../knowledge/graph-optimizer');
        const result = await autoConnectIslands();

        if (result.addedCount > 0) {
            logEvolution(ACTIONS.ISLANDS_CONNECTED, {
                addedCount: result.addedCount,
            });
        }

        log.info(`Island bridging: ${result.message}`);
        return {
            connected: result.addedCount > 0,
            addedCount: result.addedCount || 0,
            message: result.message,
        };
    } catch (e) {
        log.warn(`Island bridging failed: ${e.message}`);
        return { connected: false, addedCount: 0, message: e.message };
    }
}

/**
 * Run the full consolidation suite (called by CortexEngine each cycle).
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.skipIslands=false] - Skip island bridging (requires LLM)
 * @returns {Object} Consolidation report
 */
async function runConsolidation(opts = {}) {
    log.info('Starting memory consolidation...');
    const startMs = Date.now();

    // 1. Prune (no LLM)
    const pruneResult = pruneDecayedNodes();

    // 2. Dedup (no LLM)
    const dedupResult = deduplicateNodes();

    // 3. Bridge islands (LLM call — optional)
    let islandResult = { connected: false, addedCount: 0, message: 'skipped' };
    if (!opts.skipIslands) {
        islandResult = await bridgeIslands();
    }

    const elapsedMs = Date.now() - startMs;
    const graph = loadGraph();

    const report = {
        module: 'memory-consolidator',
        durationMs: elapsedMs,
        graphStats: {
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
        },
        prune: pruneResult,
        dedup: dedupResult,
        islands: islandResult,
    };

    log.info(`Consolidation complete in ${elapsedMs}ms. Nodes: ${graph.nodes.length}, Edges: ${graph.edges.length}`);
    return report;
}

module.exports = {
    runConsolidation,
    pruneDecayedNodes,
    deduplicateNodes,
    bridgeIslands,
};

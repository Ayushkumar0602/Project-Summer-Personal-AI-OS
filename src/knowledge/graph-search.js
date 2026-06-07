const { loadGraph, touchNodeAccess, getDecayScore } = require('./graph-store');
const { normalizeId, levenshteinDistance } = require('./entity-resolution');
const { generateEmbedding } = require('./embeddings');
const { supabase } = require('../services/supabase-client');

/**
 * Searches the knowledge graph for nodes and edges matching the query.
 * Scoring factors:
 *   - Exact / partial label match
 *   - Word-by-word match in label & description
 *   - Fuzzy Levenshtein similarity
 *   - Tag match (if filterTag provided)
 *   - Decay penalty for nodes not accessed recently
 *
 * @param {string} query        - The search query string
 * @param {number} maxResults   - Max nodes to return (default: 10)
 * @param {string} filterTag    - Optional tag to restrict results (e.g. '#work')
 * @returns {{ nodes: Array, edges: Array, summary: string }}
 */
async function searchMemory(query, maxResults = 10, filterTag = null) {
    const graph = loadGraph();
    if (!graph || graph.nodes.length === 0) {
        return { nodes: [], edges: [], summary: 'No memory graph available.' };
    }

    const queryNorm = normalizeId(query);
    const queryWords = queryNorm.split(/\s+/).filter(Boolean);

    let topNodes = [];

    // Attempt Vector Search via Supabase if available
    let vectorSearchSuccess = false;
    if (supabase) {
        try {
            const queryEmbedding = await generateEmbedding(queryNorm);
            if (queryEmbedding) {
                const { data, error } = await supabase.rpc('match_memory_nodes', {
                    query_embedding: queryEmbedding,
                    match_threshold: 0.3,
                    match_count: maxResults,
                    filter_tag: filterTag ? filterTag.replace(/^#/, '') : null
                });

                if (!error && data) {
                    const matchedIds = data.map(row => row.id);
                    topNodes = matchedIds
                        .map(id => graph.nodes.find(n => n.id === id))
                        .filter(Boolean);
                    vectorSearchSuccess = true;
                } else if (error) {
                    console.warn('[GraphSearch] Vector search failed:', error.message);
                }
            }
        } catch (e) {
            console.warn('[GraphSearch] Vector search exception:', e.message);
        }
    }

    // Fallback to local fuzzy search if vector search didn't run or failed
    if (!vectorSearchSuccess) {
        // ── Tag pre-filter ──
        let candidateNodes = graph.nodes;
        if (filterTag) {
            const tag = filterTag.toLowerCase().replace(/^#/, '');
            candidateNodes = graph.nodes.filter(n =>
                Array.isArray(n.tags) && n.tags.some(t => t.toLowerCase().replace(/^#/, '') === tag)
            );
        }

        // ── Score each candidate ──
        const scoredNodes = candidateNodes.map(node => {
            const labelNorm = normalizeId(node.label);
            const descNorm = normalizeId(node.description || '');
            const typeNorm = normalizeId(node.type || '');
            const tagsNorm = (node.tags || []).map(t => normalizeId(t)).join(' ');

            let score = 0;

            if (node.id === queryNorm) score += 100;
            if (labelNorm === queryNorm) score += 80;
            if (labelNorm.includes(queryNorm)) score += 60;
            if (queryNorm.includes(labelNorm)) score += 40;

            for (const word of queryWords) {
                if (word.length < 3) continue;
                if (labelNorm.includes(word)) score += 20;
                if (descNorm.includes(word)) score += 10;
                if (typeNorm.includes(word)) score += 5;
                if (tagsNorm.includes(word)) score += 15;
                // AudioMemory: search transcript and keyFacts
                if (node.transcript && normalizeId(node.transcript).includes(word)) score += 15;
                if (Array.isArray(node.keyFacts) && node.keyFacts.some(f => normalizeId(f).includes(word))) score += 15;
                // ImageMemory: search scene and entities
                if (node.scene && normalizeId(node.scene).includes(word)) score += 8;
                if (Array.isArray(node.entities) && node.entities.some(e => normalizeId(e).includes(word))) score += 12;
            }

            const dist = levenshteinDistance(queryNorm, labelNorm);
            const maxLen = Math.max(queryNorm.length, labelNorm.length);
            if (maxLen > 0) {
                const similarity = 1 - dist / maxLen;
                if (similarity > 0.7) score += similarity * 30;
            }

            if (score > 0) {
                score *= getDecayScore(node);
            }

            return { node, score };
        });

        topNodes = scoredNodes
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults)
            .map(s => s.node);
    }

    if (topNodes.length === 0) {
        return {
            nodes: [], edges: [],
            summary: filterTag
                ? `No memory found with tag "${filterTag}" matching "${query}".`
                : `No memory found matching "${query}".`
        };
    }

    // ── Touch access timestamps for top results ──
    // Fire-and-forget; don't await to keep search synchronous
    for (const node of topNodes.slice(0, 5)) {
        touchNodeAccess(node.id);
    }

    // ── Collect edges + 1-hop neighbourhood ──
    const matchedIds = new Set(topNodes.map(n => n.id));
    const relatedEdges = graph.edges.filter(
        e => matchedIds.has(e.from) || matchedIds.has(e.to)
    );

    const connectedNodeIds = new Set();
    for (const edge of relatedEdges) {
        connectedNodeIds.add(edge.from);
        connectedNodeIds.add(edge.to);
    }
    const allRelevantNodes = graph.nodes.filter(n => connectedNodeIds.has(n.id));

    // ── Build text summary for the AI ──
    const summaryLines = [];
    for (const node of allRelevantNodes) {
        const age = node.lastAccessedAt
            ? `last accessed ${Math.round((Date.now() - node.lastAccessedAt) / 86400000)}d ago`
            : node.createdAt
                ? `created ${Math.round((Date.now() - node.createdAt) / 86400000)}d ago`
                : '';
        const tagStr = node.tags && node.tags.length ? ` [${node.tags.join(', ')}]` : '';
        summaryLines.push(`## ${node.label} (${node.type})${tagStr}${age ? ' — ' + age : ''}`);
        if (node.description) summaryLines.push(`  Description: ${node.description}`);

        const nodeEdges = relatedEdges.filter(e => e.from === node.id);
        for (const edge of nodeEdges) {
            const toNode = allRelevantNodes.find(n => n.id === edge.to);
            if (toNode) {
                summaryLines.push(`  - [${node.label}] --${edge.label}--> [${toNode.label}]`);
            }
        }
    }

    return {
        nodes: allRelevantNodes,
        edges: relatedEdges,
        summary: summaryLines.join('\n')
    };
}

/**
 * Returns all unique tags across the entire graph.
 * @returns {string[]}
 */
function getAllTags() {
    const graph = loadGraph();
    const tagSet = new Set();
    for (const node of graph.nodes) {
        for (const tag of (node.tags || [])) {
            tagSet.add(tag.toLowerCase().startsWith('#') ? tag : `#${tag}`);
        }
    }
    return [...tagSet].sort();
}

module.exports = { searchMemory, getAllTags };

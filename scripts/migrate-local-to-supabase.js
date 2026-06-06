/**
 * One-time migration: Push ALL local graph data to Supabase.
 * 
 * Schema (from supabase_schema.sql):
 *   memory_nodes.updatedAt → BIGINT (epoch ms)
 *   memory_nodes.createdAt → TIMESTAMPTZ (ISO string)
 *   memory_edges.updatedAt → BIGINT (epoch ms)
 *   memory_edges.createdAt → TIMESTAMPTZ (auto-default, not sent)
 */
require('dotenv').config();
const { supabase } = require('../src/services/supabase-client');
const fs = require('fs');
const path = require('path');

const GRAPH_PATH = path.join(
    process.env.HOME, 'Library', 'Application Support', 'Summer', 'knowledge-graph.json'
);

/** Convert any timestamp format to epoch ms (BIGINT) */
function toBigint(val) {
    if (!val) return Date.now();
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? Date.now() : d.getTime();
    }
    return Date.now();
}

/** Convert any timestamp format to ISO string (TIMESTAMPTZ) */
function toISO(val) {
    if (!val) return new Date().toISOString();
    if (typeof val === 'number') return new Date(val).toISOString();
    if (typeof val === 'string') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
    return new Date().toISOString();
}

async function migrate() {
    if (!supabase) { console.error('No Supabase client'); process.exit(1); }

    const raw = fs.readFileSync(GRAPH_PATH, 'utf-8');
    const graph = JSON.parse(raw);
    console.log(`📂 Local graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

    // ── Step 1: Fetch current Supabase counts ─────────────────────────────────
    const [{ count: cloudNodeCount }, { count: cloudEdgeCount }] = await Promise.all([
        supabase.from('memory_nodes').select('*', { count: 'exact', head: true }),
        supabase.from('memory_edges').select('*', { count: 'exact', head: true })
    ]);
    console.log(`☁️  Supabase currently has: ${cloudNodeCount} nodes, ${cloudEdgeCount} edges`);

    // ── Step 2: Prepare nodes (updatedAt=BIGINT, createdAt=TIMESTAMPTZ) ───────
    const nodeRows = graph.nodes.map(n => ({
        id:          n.id,
        type:        n.type || null,
        label:       n.label || null,
        description: n.description || null,
        imagePath:   n.imagePath || null,
        publicUrl:   n.publicUrl || null,
        imageHash:   n.imageHash || null,
        entities:    n.entities || null,
        faceIds:     n.faceIds || null,
        tags:        n.tags || null,
        pinned:      !!n.pinned,
        importance:  n.importance || 0.5,
        updatedAt:   toBigint(n.updatedAt),       // BIGINT
        source:      n.source || null,
        createdAt:   toISO(n.createdAt),           // TIMESTAMPTZ
        embedding:   n.embedding || null
    }));

    // ── Step 3: Upsert nodes in batches of 50 ────────────────────────────────
    let nodesOk = 0, nodesFail = 0;
    for (let i = 0; i < nodeRows.length; i += 50) {
        const batch = nodeRows.slice(i, i + 50);
        const { error } = await supabase.from('memory_nodes').upsert(batch);
        if (error) {
            console.error(`❌ Nodes batch ${i}-${i+batch.length} FAILED:`, error.message, error.details || '');
            nodesFail += batch.length;
        } else {
            nodesOk += batch.length;
            process.stdout.write(`\r✅ Nodes upserted: ${nodesOk}/${nodeRows.length}`);
        }
    }
    console.log(`\n📊 Nodes result: ${nodesOk} ok, ${nodesFail} failed`);

    // ── Step 4: Prepare edges (updatedAt=BIGINT, createdAt=auto) ─────────────
    const edgeRows = graph.edges
        .filter(e => e.from && e.to && e.label)
        .map(e => ({
            from:       e.from,
            to:         e.to,
            label:      e.label,
            confidence: e.confidence || 1.0,
            source:     e.source || null,
            updatedAt:  toBigint(e.updatedAt)      // BIGINT
            // createdAt is auto-defaulted by DB
        }));

    // ── Step 5: Upsert edges in batches of 50 ───────────────────────────────
    let edgesOk = 0, edgesFail = 0;
    for (let i = 0; i < edgeRows.length; i += 50) {
        const batch = edgeRows.slice(i, i + 50);
        const { error } = await supabase.from('memory_edges').upsert(batch, { onConflict: 'from,to,label' });
        if (error) {
            console.error(`❌ Edges batch ${i}-${i+batch.length} FAILED:`, error.message, error.details || '');
            edgesFail += batch.length;
        } else {
            edgesOk += batch.length;
            process.stdout.write(`\r✅ Edges upserted: ${edgesOk}/${edgeRows.length}`);
        }
    }
    console.log(`\n📊 Edges result: ${edgesOk} ok, ${edgesFail} failed`);

    // ── Step 6: Verify ──────────────────────────────────────────────────────
    const [{ count: finalNodes }, { count: finalEdges }] = await Promise.all([
        supabase.from('memory_nodes').select('*', { count: 'exact', head: true }),
        supabase.from('memory_edges').select('*', { count: 'exact', head: true })
    ]);
    console.log(`\n🔍 FINAL VERIFICATION:`);
    console.log(`   Local:    ${graph.nodes.length} nodes, ${edgeRows.length} edges`);
    console.log(`   Supabase: ${finalNodes} nodes, ${finalEdges} edges`);
    console.log(finalNodes >= graph.nodes.length
        ? '✅ LOCAL ↔ SUPABASE IN SYNC!'
        : '⚠️  Counts differ — check failed batches above.');
}

migrate().catch(e => { console.error('Migration crashed:', e); process.exit(1); });

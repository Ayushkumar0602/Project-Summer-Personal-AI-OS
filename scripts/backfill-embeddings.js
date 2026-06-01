'use strict';

require('dotenv').config();
const { supabase } = require('../src/services/supabase-client');
const { generateNodeEmbedding } = require('../src/knowledge/embeddings');
const fs = require('fs');
const path = require('path');
const Paths = require('../src/core/utils/paths');

const GRAPH_PATH = path.join(Paths.userData(), 'knowledge-graph.json');

async function backfillEmbeddings() {
    console.log('================================================');
    console.log('🧠 Summer AI - Memory Embeddings Backfill Script');
    console.log('================================================\n');

    if (!supabase) {
        console.error('❌ Supabase client not initialized. Check your .env file.');
        process.exit(1);
    }

    console.log('⏳ Fetching all nodes from Supabase...');
    const { data: nodes, error } = await supabase.from('memory_nodes').select('*');

    if (error) {
        console.error('❌ Failed to fetch nodes:', error.message);
        process.exit(1);
    }

    if (!nodes || nodes.length === 0) {
        console.log('✅ No nodes found in the database. Nothing to backfill.');
        process.exit(0);
    }

    console.log(`📊 Found ${nodes.length} total nodes.`);

    // Filter nodes that lack an embedding
    // Note: The Supabase client might return the embedding as a string or array, or null if empty.
    const nodesToProcess = nodes.filter(n => !n.embedding);

    if (nodesToProcess.length === 0) {
        console.log('✅ All nodes already have embeddings. Backfill complete!');
        process.exit(0);
    }

    console.log(`🚀 Generating embeddings for ${nodesToProcess.length} nodes...\n`);

    let successCount = 0;
    let failCount = 0;
    const batchSize = 100; // upsert batch size

    // We process sequentially or in small batches to not overwhelm the local CPU / memory
    for (let i = 0; i < nodesToProcess.length; i++) {
        const node = nodesToProcess[i];
        process.stdout.write(`\r⚙️  Processing node ${i + 1}/${nodesToProcess.length} (ID: ${node.id})...`);

        try {
            const embedding = await generateNodeEmbedding(node);
            node.embedding = embedding;
            successCount++;
        } catch (e) {
            failCount++;
            console.error(`\n❌ Failed to generate embedding for ${node.id}:`, e.message);
        }

        // Upsert in batches or at the end
        if ((i + 1) % batchSize === 0 || i === nodesToProcess.length - 1) {
            const batch = nodesToProcess.slice(Math.floor(i / batchSize) * batchSize, i + 1);

            // Format payload to only update the embedding (and primary key)
            // But Supabase upsert requires all NOT NULL fields if it's an insert. 
            // Since it's an update, we can just upsert the whole node we fetched.
            const payload = batch.map(n => ({
                id: n.id, type: n.type, label: n.label, description: n.description,
                imagePath: n.imagePath, publicUrl: n.publicUrl, imageHash: n.imageHash,
                entities: n.entities, faceIds: n.faceIds, tags: n.tags,
                pinned: !!n.pinned, importance: n.importance || 0.5,
                updatedAt: n.updatedAt, source: n.source, createdAt: n.createdAt,
                embedding: n.embedding
            }));

            const { error: upsertError } = await supabase.from('memory_nodes').upsert(payload);
            if (upsertError) {
                console.error(`\n❌ Failed to sync batch to Supabase:`, upsertError.message);
            }
        }
    }

    console.log(`\n\n🎉 Backfill Complete!`);
    console.log(`✅ Successfully generated: ${successCount}`);
    if (failCount > 0) console.log(`❌ Failed: ${failCount}`);

    // Update local cache so we don't have to re-download everything on next boot
    try {
        if (fs.existsSync(GRAPH_PATH)) {
            const raw = fs.readFileSync(GRAPH_PATH, 'utf-8');
            const localGraph = JSON.parse(raw);

            let updatedLocal = 0;
            for (const localNode of localGraph.nodes) {
                const dbNode = nodesToProcess.find(n => n.id === localNode.id);
                if (dbNode && dbNode.embedding) {
                    localNode.embedding = dbNode.embedding;
                    updatedLocal++;
                }
            }

            if (updatedLocal > 0) {
                fs.writeFileSync(GRAPH_PATH, JSON.stringify(localGraph, null, 2), 'utf-8');
                console.log(`💾 Synced ${updatedLocal} embeddings to local knowledge-graph.json`);
            }
        }
    } catch (e) {
        console.warn('⚠️ Could not update local JSON cache:', e.message);
    }

    process.exit(0);
}

backfillEmbeddings();

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing Supabase credentials in .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

const GRAPH_PATHS = [
    '/Users/ayushjaiswal/Library/Application Support/project-summer/knowledge-graph.json',
    '/Users/ayushjaiswal/Library/Application Support/Summer/knowledge-graph.json'
];

const IMAGE_STORE_DIR = '/Users/ayushjaiswal/Library/Application Support/Summer/image-store';
const BUCKET_NAME = 'summer-memories';

async function migrate() {
    console.log("Starting full cloud migration...");

    // 1. Clear existing Supabase data
    console.log("Clearing existing Supabase data...");
    await supabase.from('memory_edges').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('memory_nodes').delete().neq('id', 'non_existent_id');
    console.log("Supabase tables cleared.");

    // 2. Load and merge graphs
    let mergedNodes = new Map();
    let mergedEdges = new Map();

    for (const p of GRAPH_PATHS) {
        if (fs.existsSync(p)) {
            const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
            for (const n of (data.nodes || [])) {
                mergedNodes.set(n.id, n);
            }
            for (const e of (data.edges || [])) {
                const key = `${e.from}_${e.to}_${e.label}`;
                mergedEdges.set(key, e);
            }
        }
    }

    const allNodes = Array.from(mergedNodes.values());
    const allEdges = Array.from(mergedEdges.values());

    console.log(`Merged Graph: ${allNodes.length} nodes, ${allEdges.length} edges.`);

    // 3. Process images
    for (const node of allNodes) {
        if (node.type === 'ImageMemory' && node.imagePath) {
            const localImgPath = path.join(IMAGE_STORE_DIR, node.imagePath);
            if (fs.existsSync(localImgPath) && !node.publicUrl) {
                console.log(`Uploading image: ${node.imagePath}...`);
                const mime = localImgPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
                const buffer = fs.readFileSync(localImgPath);
                
                const { error } = await supabase.storage.from(BUCKET_NAME).upload(node.imagePath, buffer, {
                    contentType: mime,
                    upsert: true
                });

                if (error) {
                    console.error(`Failed to upload ${node.imagePath}:`, error.message);
                } else {
                    const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(node.imagePath);
                    node.publicUrl = data.publicUrl;
                    console.log(`Uploaded -> ${node.publicUrl}`);
                }
            }
        }
    }

    // 4. Push to Supabase
    console.log("Pushing nodes to Supabase...");
    
    // Sanitize nodes to exactly match schema
    const nodesToInsert = allNodes.map(n => ({
        id: n.id,
        type: n.type,
        label: n.label,
        description: n.description,
        imagePath: n.imagePath,
        publicUrl: n.publicUrl,
        imageHash: n.imageHash,
        entities: n.entities,
        faceIds: n.faceIds,
        tags: n.tags,
        pinned: !!n.pinned,
        importance: n.importance || 0.5,
        updatedAt: n.updatedAt,
        source: n.source
        // Dropping createdAt so Supabase uses DEFAULT NOW()
        // Dropping lastAccessedAt because it is not in schema
    }));

    // Chunk nodes (just in case there are many)
    for (let i = 0; i < nodesToInsert.length; i += 100) {
        const chunk = nodesToInsert.slice(i, i + 100);
        const { error } = await supabase.from('memory_nodes').upsert(chunk);
        if (error) console.error("Error upserting nodes:", error.message);
    }

    console.log("Pushing edges to Supabase...");
    // Edges need to be cleaned up (no duplicate UUIDs, map to schema)
    const edgesToInsert = allEdges.map(e => ({
        from: e.from,
        to: e.to,
        label: e.label,
        confidence: e.confidence || 1.0,
        source: e.source,
        updatedAt: e.updatedAt
    }));

    for (let i = 0; i < edgesToInsert.length; i += 100) {
        const chunk = edgesToInsert.slice(i, i + 100);
        const { error } = await supabase.from('memory_edges').upsert(chunk, { onConflict: 'from,to,label' });
        if (error) console.error("Error upserting edges:", error.message);
    }

    console.log("Migration complete!");
}

migrate().catch(console.error);

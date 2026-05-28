/**
 * File upload and URL ingestion into the knowledge graph.
 */

const pdfParse = require('pdf-parse');
const { loadGraph, saveGraph, mergeGraph } = require('./graph-store');
const { extractGraphFromText } = require('./graph-extractor');
const { semanticChunk } = require('./graph-chunker');
const { analyzeAndStoreImage, isImageFile } = require('./image-analyzer');
const { analyzeAndStoreAudio } = require('./audio-analyzer');
const { isAudioFile } = require('./audio-store');
const { scrapeWebpage } = require('../tools/web-tools');

async function processUploadedFiles(event, fileDataArray) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { error: 'GEMINI_API_KEY missing in .env' };

    let combinedGraph = { nodes: [], edges: [] };

    console.log(`\n📂 Processing ${fileDataArray.length} file(s)...`);

    for (let i = 0; i < fileDataArray.length; i++) {
        const file = fileDataArray[i];
        console.log(`\n[${i + 1}/${fileDataArray.length}] Reading: ${file.name}`);
        event.sender.send('extraction-progress', `Reading: ${file.name} (${i + 1}/${fileDataArray.length})`);

        try {
            if (isImageFile(file)) {
                console.log(`  🖼️  Image detected — routing to Visual Memory pipeline...`);
                event.sender.send('extraction-progress', `Analyzing image: ${file.name} with Gemini Vision...`);
                try {
                    const { node, edges, deduplicated } = await analyzeAndStoreImage(file);
                    if (!deduplicated) {
                        console.log(`  ✅ ImageMemory node: "${node.label}" | Tags: ${node.tags.join(', ')}`);
                        combinedGraph.nodes.push(node);
                        if (edges && edges.length) combinedGraph.edges.push(...edges);
                    } else {
                        console.log(`  ⚡ Skipped (duplicate image already in memory)`);
                    }
                } catch (imgErr) {
                    console.error(`  ❌ Image analysis failed for ${file.name}:`, imgErr.message);
                }
                continue;
            }

            if (isAudioFile(file)) {
                console.log(`  🎵 Audio detected — routing to Audio Memory pipeline...`);
                event.sender.send('extraction-progress', `Transcribing audio: ${file.name} with Gemini...`);
                try {
                    const { node, edges, deduplicated } = await analyzeAndStoreAudio(file);
                    if (!deduplicated) {
                        console.log(`  ✅ AudioMemory node: "${node.label}" | Tags: ${node.tags.join(', ')}`);
                        combinedGraph.nodes.push(node);
                        if (edges && edges.length) combinedGraph.edges.push(...edges);
                    } else {
                        console.log(`  ⚡ Skipped (duplicate audio already in memory)`);
                    }
                } catch (audioErr) {
                    console.error(`  ❌ Audio analysis failed for ${file.name}:`, audioErr.message);
                }
                continue;
            }

            let textContent = '';
            const buffer = Buffer.from(file.buffer);

            if (file.name.endsWith('.pdf')) {
                console.log(`  📄 Parsing PDF...`);
                const parsed = await pdfParse(buffer);
                textContent = parsed.text;
                console.log(`  ✅ PDF parsed: ${textContent.length} chars extracted`);
            } else {
                textContent = buffer.toString('utf-8');
                console.log(`  ✅ Text read: ${textContent.length} chars`);
            }

            if (!textContent.trim()) {
                console.log(`  ⚠️  No text found in ${file.name}, skipping`);
                continue;
            }

            console.log(`  Sending to Gemini AI for deep document analysis...`);
            const chunks = semanticChunk(textContent, file.name);
            let allContradictions = [];

            for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
                const chunkText = chunks[chunkIdx];
                console.log(`  🔄 Processing chunk ${chunkIdx + 1}/${chunks.length} (${chunkText.length} chars)...`);
                event.sender.send('extraction-progress', `AI deep-analyzing: ${file.name} (Part ${chunkIdx + 1}/${chunks.length})...`);

                const currentContext = mergeGraph(loadGraph(), combinedGraph);

                const extracted = await extractGraphFromText(chunkText, apiKey, currentContext, {
                    isDocument: true,
                    fileName: file.name,
                    chunkIndex: chunkIdx,
                    totalChunks: chunks.length
                });
                console.log(`  ✅ Deep extracted: ${extracted.nodes.length} nodes, ${extracted.edges.length} edges`);
                if (extracted.nodes.length > 0) {
                    console.log(`  Nodes: ${extracted.nodes.map(n => `${n.label} (${n.type})`).join(', ')}`);
                }
                if (extracted.contradictions && extracted.contradictions.length > 0) {
                    allContradictions.push(...extracted.contradictions);
                }

                combinedGraph = mergeGraph(combinedGraph, extracted);
            }

            if (allContradictions.length > 0) {
                event.sender.send('memory-conflict', allContradictions);
            }

        } catch (err) {
            console.error(`  ❌ Failed to process ${file.name}:`, err.message);
        }
    }

    const existing = loadGraph();
    const finalGraph = mergeGraph(existing, combinedGraph);
    saveGraph(finalGraph);

    console.log(`\n💾 Graph saved! Total: ${finalGraph.nodes.length} nodes, ${finalGraph.edges.length} edges`);
    console.log(`📍 Saved to: ${require('./graph-store').GRAPH_PATH}`);

    event.sender.send('extraction-done', finalGraph);
    return { graph: finalGraph };
}

async function ingestUrl(event, url) {
    console.log(`\n🕸️  Web Ingestion Started: ${url}`);
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is missing in .env");

        event.sender.send('extraction-progress', 'Scraping webpage...');
        const scrapeResult = await scrapeWebpage(url);
        if (scrapeResult.startsWith("Error")) {
            throw new Error(scrapeResult);
        }

        const textContent = scrapeResult.replace(/^Content from [^:]+:\n\n/, '');

        console.log(`  Sending to Gemini AI for deep URL analysis...`);
        const chunks = semanticChunk(textContent, url);
        let combinedGraph = { nodes: [], edges: [] };
        let allContradictions = [];

        for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
            const chunkText = chunks[chunkIdx];
            event.sender.send('extraction-progress', `AI deep-analyzing web page (Part ${chunkIdx + 1}/${chunks.length})...`);

            const currentContext = mergeGraph(loadGraph(), combinedGraph);
            const extracted = await extractGraphFromText(chunkText, apiKey, currentContext, {
                isDocument: true,
                fileName: url,
                chunkIndex: chunkIdx,
                totalChunks: chunks.length
            });
            if (extracted.contradictions && extracted.contradictions.length > 0) {
                allContradictions.push(...extracted.contradictions);
            }
            combinedGraph = mergeGraph(combinedGraph, extracted);
        }

        if (allContradictions.length > 0) {
            event.sender.send('memory-conflict', allContradictions);
        }

        const existing = loadGraph();
        const finalGraph = mergeGraph(existing, combinedGraph);
        saveGraph(finalGraph);

        console.log(`\n💾 Web Graph saved! Total: ${finalGraph.nodes.length} nodes, ${finalGraph.edges.length} edges`);
        event.sender.send('extraction-done', finalGraph);
        return { success: true, graph: finalGraph };

    } catch (err) {
        console.error(`  ❌ Failed to ingest URL:`, err.message);
        event.sender.send('extraction-error', err.message);
        return { success: false, message: err.message };
    }
}

module.exports = { processUploadedFiles, ingestUrl };

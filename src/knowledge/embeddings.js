'use strict';

const { pipeline, env } = require('@xenova/transformers');
const path = require('path');

// Disable downloading models to global cache, use local models directory if possible
// We will store models in a generic 'models' folder if needed, but for now we let transformers handle it
// We can configure it to be local to the project
env.localModelPath = path.join(__dirname, '..', 'models');
env.allowRemoteModels = true; // allow fetching the first time

let extractor = null;

/**
 * Initializes the embedding pipeline.
 * This should be called early to start downloading/loading the model in the background.
 */
async function initEmbeddings() {
    if (extractor) return extractor;
    try {
        console.log('[Embeddings] Initializing vector extraction pipeline...');
        // all-MiniLM-L6-v2 is small and fast for semantic search
        extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('[Embeddings] Pipeline ready.');
        return extractor;
    } catch (error) {
        console.error('[Embeddings] Failed to initialize pipeline:', error);
        throw error;
    }
}

/**
 * Generates an embedding for a given text.
 * @param {string} text 
 * @returns {Promise<number[]>} Array of 384 floats
 */
async function generateEmbedding(text) {
    if (!text) return null;
    if (!extractor) {
        await initEmbeddings();
    }
    
    try {
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        // output.data is a Float32Array, convert to standard array for JSON/Supabase
        return Array.from(output.data);
    } catch (error) {
        console.error('[Embeddings] Error generating embedding:', error);
        return null;
    }
}

/**
 * Generates a unified embedding for a memory node by combining its label, description, and tags.
 * @param {Object} node 
 * @returns {Promise<number[]>}
 */
async function generateNodeEmbedding(node) {
    const parts = [node.label];
    if (node.description) parts.push(node.description);
    if (node.tags && node.tags.length > 0) parts.push(node.tags.join(' '));
    
    const textToEmbed = parts.join('. ');
    return generateEmbedding(textToEmbed);
}

module.exports = {
    initEmbeddings,
    generateEmbedding,
    generateNodeEmbedding
};

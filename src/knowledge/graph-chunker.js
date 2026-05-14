/**
 * graph-chunker.js
 * Smart semantic chunking for documents.
 *
 * Instead of blindly slicing every N characters, this module:
 * 1. Detects Markdown / plain-text section headers
 * 2. Splits on double-newlines (paragraph boundaries)
 * 3. Merges small paragraphs so each chunk is close to TARGET_CHARS
 * 4. Never cuts mid-sentence (falls back to sentence boundary)
 *
 * Result: each chunk is a semantically coherent unit → cleaner graph nodes.
 */

const TARGET_CHARS    = 12000; // ideal chunk size — smaller = more thorough per chunk
const MAX_CHARS       = 16000; // hard ceiling per chunk
const MIN_CHUNK_CHARS = 200;   // don't create tiny orphan chunks
const OVERLAP_CHARS   = 400;   // overlap between chunks to avoid cutting mid-context

// Patterns that indicate a section boundary
const HEADER_RE = /^(#{1,6}\s+.+|={3,}|-{3,}|\*{3,}|[A-Z][A-Z\s]{4,}:?\s*$)/m;

/**
 * Split text into semantic chunks.
 * @param {string} text
 * @param {string} [fileName] - used only for logging
 * @returns {string[]} Array of chunk strings
 */
function semanticChunk(text, fileName = 'document') {
    if (!text || text.length <= TARGET_CHARS) {
        // Short enough to send as a single chunk
        return [text];
    }

    // ── Step 1: Split on paragraph / header boundaries ──
    const rawParagraphs = splitOnBoundaries(text);

    // ── Step 2: Merge small paragraphs into target-size chunks ──
    const chunks = [];
    let current = '';

    for (const para of rawParagraphs) {
        // If adding this paragraph would exceed the hard ceiling, flush first
        if (current.length + para.length > MAX_CHARS && current.length > 0) {
            chunks.push(current.trim());
            current = '';
        }

        // If a single paragraph itself exceeds max, split it on sentences
        if (para.length > MAX_CHARS) {
            const sentences = splitOnSentences(para);
            for (const sentence of sentences) {
                if (current.length + sentence.length > MAX_CHARS && current.length > 0) {
                    chunks.push(current.trim());
                    current = '';
                }
                current += sentence + ' ';
            }
        } else {
            current += para + '\n\n';
        }

        // If we've hit the target size, flush
        if (current.length >= TARGET_CHARS) {
            chunks.push(current.trim());
            current = '';
        }
    }

    // Flush remainder
    if (current.trim().length > MIN_CHUNK_CHARS) {
        chunks.push(current.trim());
    } else if (current.trim().length > 0 && chunks.length > 0) {
        // Append tiny tail to last chunk rather than create orphan
        chunks[chunks.length - 1] += '\n\n' + current.trim();
    }

    // Safety: filter empty
    const raw = chunks.filter(c => c.trim().length > MIN_CHUNK_CHARS);

    // Apply overlap: prepend the last OVERLAP_CHARS of the previous chunk to the next
    // This ensures context at chunk boundaries is never split mid-sentence
    const result = raw.map((chunk, i) => {
        if (i === 0 || OVERLAP_CHARS === 0) return chunk;
        const prev = raw[i - 1];
        const overlap = prev.slice(-OVERLAP_CHARS).trimStart();
        // Only add overlap if it doesn't push the chunk way over MAX_CHARS
        if (chunk.length + overlap.length < MAX_CHARS * 1.1) {
            return `[...continued from previous section]\n${overlap}\n\n${chunk}`;
        }
        return chunk;
    });

    console.log(`[Chunker] "${fileName}": ${text.length} chars → ${result.length} semantic chunks (avg ${Math.round(result.reduce((a, c) => a + c.length, 0) / result.length)} chars/chunk)`);
    return result.length > 0 ? result : [text.slice(0, MAX_CHARS)];
}

/**
 * Split on double-newlines and detected section headers.
 */
function splitOnBoundaries(text) {
    // Normalise line endings
    const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split on blank lines (paragraph boundaries)
    const paragraphs = normalised.split(/\n{2,}/);

    const result = [];
    let pendingHeader = '';

    for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed) continue;

        // If the paragraph looks like a header, treat it as a boundary marker
        // and prepend it to the next content paragraph
        if (HEADER_RE.test(trimmed) && trimmed.length < 200) {
            if (pendingHeader) result.push(pendingHeader);
            pendingHeader = trimmed;
        } else {
            result.push(pendingHeader ? pendingHeader + '\n' + trimmed : trimmed);
            pendingHeader = '';
        }
    }
    if (pendingHeader) result.push(pendingHeader);

    return result;
}

/**
 * Split a long paragraph on sentence boundaries.
 */
function splitOnSentences(text) {
    // Match sentence endings: . ! ? followed by whitespace + capital letter (or end)
    const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)/g) || [text];
    return sentences.map(s => s.trim()).filter(Boolean);
}

module.exports = { semanticChunk };

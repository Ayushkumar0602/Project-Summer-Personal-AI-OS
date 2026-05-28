/**
 * audio-store.js — Summer's Audio File Storage Manager
 *
 * Manages the audio-store/ directory for voice notes, uploaded audio files,
 * and recorded conversation clips. Mirrors the image-store pattern from
 * image-analyzer.js for consistency.
 *
 * Responsibilities:
 *   - Directory creation and management
 *   - Audio format normalization (m4a/ogg/mp3 → compatible format)
 *   - SHA-256 hash-based deduplication
 *   - Supabase Storage upload for cloud sync
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const Paths = require('../core/utils/paths');
const { supabase } = require('../services/supabase-client');

// Audio memories stored in Summer's userData directory
const AUDIO_STORE = path.join(Paths.userData(), 'audio-store');

// Supported audio MIME types
const AUDIO_MIME_TYPES = new Set([
    'audio/webm', 'audio/ogg', 'audio/mp3', 'audio/mpeg',
    'audio/wav', 'audio/x-wav', 'audio/m4a', 'audio/mp4',
    'audio/aac', 'audio/flac', 'audio/x-flac'
]);

/**
 * Check if a file is an audio file by MIME type or extension.
 */
function isAudioFile(file) {
    return AUDIO_MIME_TYPES.has((file.type || '').toLowerCase()) ||
        /\.(webm|ogg|mp3|wav|m4a|aac|flac|opus|wma)$/i.test(file.name || '');
}

/**
 * Ensure the audio-store directory exists.
 */
function ensureAudioStore() {
    if (!fs.existsSync(AUDIO_STORE)) {
        fs.mkdirSync(AUDIO_STORE, { recursive: true });
        console.log(`[AudioStore] Created audio-store at: ${AUDIO_STORE}`);
    }
}

/**
 * Compute a SHA-256 hash of raw audio data (first 16 hex chars) for dedup.
 */
function computeAudioHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

/**
 * Convert audio to a web-compatible format using macOS afconvert.
 * Falls back to original if conversion fails (non-critical).
 *
 * @param {string} srcPath - Path to source audio file
 * @param {string} targetExt - Target extension (e.g., '.m4a')
 * @returns {string} Path to the converted (or original) file
 */
function convertAudioFormat(srcPath, targetExt = '.m4a') {
    const ext = path.extname(srcPath).toLowerCase();

    // Already in a compatible format — skip conversion
    if (['.mp3', '.m4a', '.wav', '.webm', '.ogg'].includes(ext)) {
        return srcPath;
    }

    const outPath = srcPath.replace(new RegExp(`\\${ext}$`, 'i'), targetExt);
    try {
        // macOS afconvert: universal audio conversion tool (no npm dependencies)
        execSync(`afconvert -f m4af -d aac "${srcPath}" "${outPath}"`, { timeout: 60000 });
        fs.unlinkSync(srcPath); // remove original after conversion
        console.log(`[AudioStore] Converted ${ext} → ${targetExt}: ${path.basename(outPath)}`);
        return outPath;
    } catch (e) {
        console.warn(`[AudioStore] Audio conversion failed (keeping original): ${e.message}`);
        return srcPath; // fallback to original
    }
}

/**
 * Upload audio file to Supabase Storage (if available).
 * Returns the public URL or null.
 *
 * @param {string} filename - The filename in audio-store
 * @param {string} filePath - Full path to the audio file
 * @returns {Promise<string|null>} Public URL or null
 */
async function uploadToCloud(filename, filePath) {
    if (!supabase) return null;

    try {
        const ext = path.extname(filename).toLowerCase();
        const mimeMap = {
            '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
            '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.aac': 'audio/aac',
            '.flac': 'audio/flac', '.opus': 'audio/opus'
        };
        const contentType = mimeMap[ext] || 'audio/mpeg';

        console.log(`[AudioStore] Uploading to Supabase Storage: ${filename}...`);
        const { error } = await supabase.storage
            .from('summer-memories')
            .upload(`audio/${filename}`, fs.readFileSync(filePath), {
                contentType,
                upsert: true
            });

        if (error) throw error;

        const { data } = supabase.storage.from('summer-memories').getPublicUrl(`audio/${filename}`);
        console.log(`[AudioStore] Uploaded: ${data.publicUrl}`);
        return data.publicUrl;
    } catch (e) {
        console.error('[AudioStore] Supabase upload failed:', e.message);
        return null;
    }
}

/**
 * Get the MIME type for an audio file by extension.
 */
function getAudioMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeMap = {
        '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
        '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.aac': 'audio/aac',
        '.flac': 'audio/flac', '.opus': 'audio/opus'
    };
    return mimeMap[ext] || 'audio/mpeg';
}

module.exports = {
    AUDIO_STORE,
    isAudioFile,
    ensureAudioStore,
    computeAudioHash,
    convertAudioFormat,
    uploadToCloud,
    getAudioMimeType
};

/**
 * AgentSDK — progress/completion bridge for Summer domain agents running in worker threads.
 *
 * FLAW 9 FIX — Checkpoint System:
 *   Added saveCheckpoint(data) and getCheckpoint() methods.
 *   Checkpoints are persisted to {userData}/agent-checkpoints/{agentId}_{checkpointKey}.json
 *   via the parentPort resource_request mechanism (the main thread has fs access; workers do not).
 *
 *   Usage in a plugin:
 *
 *     // At start of main(), check if work was already partially done:
 *     const cp = await sdk.getCheckpoint('after_research');
 *     if (cp) {
 *       sdk.reportProgress(85, 'Resuming from checkpoint...');
 *       return formatAndSave(cp.researchResult, cp.topic, sdk);
 *     }
 *
 *     // ...do expensive work...
 *     await sdk.saveCheckpoint('after_research', { researchResult, topic });
 *
 *   Checkpoints are cleared automatically on task completion or failure.
 *
 * Uses parentPort when inside a Worker; no-ops in main-thread tests.
 */

'use strict';

const { parentPort } = require('node:worker_threads');

class AgentSDK {
    // ── Core progress/lifecycle methods ──────────────────────────────────────

    reportProgress(percent, message) {
        this._post({ type: 'progress', percent: Math.min(100, Math.max(0, percent)), message });
    }

    complete(result) {
        // Clear checkpoint on clean completion so it doesn't replay on next run
        this._clearAllCheckpoints();
        this._post({ type: 'complete', result });
    }

    fail(error) {
        // Do NOT clear checkpoints on failure — allow resume on next attempt
        this._post({ type: 'fail', error: typeof error === 'string' ? { error } : error });
    }

    requestResource(request) {
        this._post({ type: 'resource_request', request });
    }

    // ── Flaw 9: Checkpoint system ─────────────────────────────────────────────

    /**
     * Save a checkpoint for the current task stage.
     * The main thread persists this to disk; the worker doesn't need fs access.
     *
     * @param {string} key   - Stage identifier (e.g. 'after_research', 'after_outline')
     * @param {object} data  - Serializable data to checkpoint (avoid large buffers)
     * @returns {Promise<void>} Resolves when the main thread confirms the save
     */
    saveCheckpoint(key, data) {
        return new Promise((resolve) => {
            if (!parentPort) { resolve(); return; }
            const requestId = `cp_save_${Date.now()}`;
            this._post({ type: 'resource_request', request: { action: 'checkpoint_save', requestId, key, data } });
            // Listen for the ack from main thread
            const onMsg = (msg) => {
                if (msg.type === 'resource_response' && msg.requestId === requestId) {
                    parentPort.removeListener('message', onMsg);
                    resolve();
                }
            };
            parentPort.on('message', onMsg);
            // Auto-resolve after 5s if main thread doesn't respond (non-critical)
            setTimeout(() => { parentPort.removeListener('message', onMsg); resolve(); }, 5000);
        });
    }

    /**
     * Retrieve a previously saved checkpoint for this task.
     *
     * @param {string} key  - Stage identifier matching a previous saveCheckpoint() call
     * @returns {Promise<object|null>} The checkpoint data, or null if not found
     */
    getCheckpoint(key) {
        return new Promise((resolve) => {
            if (!parentPort) { resolve(null); return; }
            const requestId = `cp_get_${Date.now()}`;
            this._post({ type: 'resource_request', request: { action: 'checkpoint_get', requestId, key } });
            const onMsg = (msg) => {
                if (msg.type === 'resource_response' && msg.requestId === requestId) {
                    parentPort.removeListener('message', onMsg);
                    resolve(msg.data || null);
                }
            };
            parentPort.on('message', onMsg);
            setTimeout(() => { parentPort.removeListener('message', onMsg); resolve(null); }, 5000);
        });
    }

    /**
     * Manually clear a specific checkpoint stage.
     * Automatically called on complete() for all stages.
     */
    clearCheckpoint(key) {
        this._post({ type: 'resource_request', request: { action: 'checkpoint_clear', key } });
    }

    _clearAllCheckpoints() {
        this._post({ type: 'resource_request', request: { action: 'checkpoint_clear_all' } });
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _post(payload) {
        if (parentPort) {
            parentPort.postMessage(payload);
        }
    }
}

module.exports = { AgentSDK };

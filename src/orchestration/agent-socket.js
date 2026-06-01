/**
 * agent-socket.js
 *
 * Runs a domain agent in an isolated worker thread with:
 *   - Timeout and kill support
 *   - Flaw 5 fix: environment isolation via plugin-env-policy.js
 *   - Flaw 9 fix: checkpoint I/O handler (main thread proxies disk access for workers)
 */

'use strict';

const { Worker }         = require('node:worker_threads');
const fs                 = require('node:fs');
const path               = require('node:path');
const { buildPluginEnv } = require('./plugin-env-policy');
const Paths              = require('../core/utils/paths');

const CHECKPOINT_DIR = path.join(Paths.userData(), 'agent-checkpoints');

class AgentSocket {
    constructor(manifest, entryPath, taskManifest, callbacks = {}) {
        this.manifest     = manifest;
        this.entryPath    = entryPath;
        this.taskManifest = taskManifest;
        this.callbacks    = callbacks;
        this.worker       = null;
        this.killed       = false;
        this.timeoutMs    = (manifest.resource_limits?.max_execution_time_seconds || 300) * 1000;
        this._agentId     = manifest.agent_id || 'unknown';
    }

    start() {
        const workerPath = path.join(__dirname, 'agent-worker.js');

        // ── Flaw 5: Build filtered env for this plugin ────────────────────────
        const pluginEnv = buildPluginEnv(this.manifest);

        this.worker = new Worker(workerPath, {
            workerData: {
                entryPath:    this.entryPath,
                taskManifest: this.taskManifest,
            },
            env: pluginEnv,
        });

        this._timeout = setTimeout(() => this.kill('timeout'), this.timeoutMs);

        this.worker.on('message', (msg) => {
            if (this.killed) return;
            switch (msg.type) {
                case 'progress':
                    this.callbacks.onProgress?.(msg.percent, msg.message);
                    break;
                case 'complete':
                    this._cleanup();
                    this.callbacks.onComplete?.(msg.result);
                    break;
                case 'fail':
                    this._cleanup();
                    this.callbacks.onFail?.(msg.error);
                    break;
                case 'resource_request':
                    // ── Flaw 9: Handle checkpoint I/O on behalf of the worker ──
                    this._handleResourceRequest(msg.request);
                    break;
                default:
                    break;
            }
        });

        this.worker.on('error', (err) => {
            this._cleanup();
            if (!this.killed) this.callbacks.onFail?.({ error: err.message, stage: 'worker_error' });
        });

        this.worker.on('exit', (code) => {
            if (!this.killed && code !== 0) {
                this.callbacks.onFail?.({ error: `Agent exited with code ${code}`, stage: 'exit' });
            }
        });
    }

    // ── Flaw 9: Checkpoint I/O proxy ──────────────────────────────────────────

    _cpFile(key) {
        const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(CHECKPOINT_DIR, `${this._agentId}_${safe}.json`);
    }

    _handleResourceRequest(req) {
        if (!req || !this.worker) return;

        switch (req.action) {
            case 'checkpoint_save': {
                try {
                    if (!fs.existsSync(CHECKPOINT_DIR)) fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
                    fs.writeFileSync(this._cpFile(req.key), JSON.stringify({ data: req.data }), 'utf-8');
                } catch (e) {
                    console.warn(`[AgentSocket] Checkpoint save failed: ${e.message}`);
                }
                // Always send ack so the worker's Promise resolves
                this.worker.postMessage({ type: 'resource_response', requestId: req.requestId });
                break;
            }

            case 'checkpoint_get': {
                let data = null;
                try {
                    const file = this._cpFile(req.key);
                    if (fs.existsSync(file)) {
                        data = JSON.parse(fs.readFileSync(file, 'utf-8')).data;
                    }
                } catch (e) {
                    console.warn(`[AgentSocket] Checkpoint read failed: ${e.message}`);
                }
                this.worker.postMessage({ type: 'resource_response', requestId: req.requestId, data });
                break;
            }

            case 'checkpoint_clear': {
                try {
                    const file = this._cpFile(req.key);
                    if (fs.existsSync(file)) fs.unlinkSync(file);
                } catch {}
                break;
            }

            case 'checkpoint_clear_all': {
                try {
                    if (fs.existsSync(CHECKPOINT_DIR)) {
                        const prefix = `${this._agentId}_`;
                        for (const f of fs.readdirSync(CHECKPOINT_DIR)) {
                            if (f.startsWith(prefix)) {
                                fs.unlinkSync(path.join(CHECKPOINT_DIR, f));
                            }
                        }
                    }
                } catch {}
                break;
            }

            default:
                this.callbacks.onResourceRequest?.(req);
                break;
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    kill(reason = 'cancelled') {
        if (this.killed) return;
        this.killed = true;
        this._cleanup();
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.callbacks.onKilled?.(reason);
    }

    _cleanup() {
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
    }
}

module.exports = { AgentSocket };

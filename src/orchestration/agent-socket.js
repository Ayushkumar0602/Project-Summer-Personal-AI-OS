const { Worker } = require('node:worker_threads');
const path = require('node:path');

/**
 * Runs a domain agent in an isolated worker thread with timeout and kill support.
 */
class AgentSocket {
  constructor(manifest, entryPath, taskManifest, callbacks = {}) {
    this.manifest = manifest;
    this.entryPath = entryPath;
    this.taskManifest = taskManifest;
    this.callbacks = callbacks;
    this.worker = null;
    this.killed = false;
    this.timeoutMs = (manifest.resource_limits?.max_execution_time_seconds || 300) * 1000;
  }

  start() {
    const workerPath = path.join(__dirname, 'agent-worker.js');
    this.worker = new Worker(workerPath, {
      workerData: {
        entryPath: this.entryPath,
        taskManifest: this.taskManifest
      }
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
          this.callbacks.onResourceRequest?.(msg.request);
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

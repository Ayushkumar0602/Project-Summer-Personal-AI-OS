/**
 * AgentSDK — progress/completion bridge for Summer domain agents running in worker threads.
 * Uses parentPort when inside a Worker; no-ops in main-thread tests.
 */
const { parentPort } = require('node:worker_threads');

class AgentSDK {
  reportProgress(percent, message) {
    this._post({ type: 'progress', percent: Math.min(100, Math.max(0, percent)), message });
  }

  complete(result) {
    this._post({ type: 'complete', result });
  }

  fail(error) {
    this._post({ type: 'fail', error: typeof error === 'string' ? { error } : error });
  }

  requestResource(request) {
    this._post({ type: 'resource_request', request });
  }

  _post(payload) {
    if (parentPort) {
      parentPort.postMessage(payload);
    }
  }
}

module.exports = { AgentSDK };

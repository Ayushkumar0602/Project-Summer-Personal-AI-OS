const { parentPort, workerData } = require('node:worker_threads');
const { AgentSDK } = require('@summer/agent-sdk');

const { entryPath, taskManifest } = workerData;

async function run() {
  const sdk = new AgentSDK();
  try {
    const plugin = require(entryPath);
    if (typeof plugin.main !== 'function') {
      throw new Error(`Plugin entry ${entryPath} must export { main }`);
    }
    await plugin.main(taskManifest, sdk);
  } catch (err) {
    sdk.fail({ error: err.message, stage: err.stage || 'worker' });
  }
}

run();

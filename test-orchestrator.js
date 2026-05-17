require('dotenv').config();
const path = require('path');
const os = require('os');

// Mock electron before requiring local modules
const mockElectron = {
  app: {
    getPath: (name) => {
      if (name === 'userData') return path.join(os.homedir(), 'Library', 'Application Support', 'project-summer');
      return '/tmp';
    }
  }
};
require('module').prototype.require = new Proxy(require('module').prototype.require, {
  apply(target, thisArg, argumentsList) {
    if (argumentsList[0] === 'electron') return mockElectron;
    return Reflect.apply(target, thisArg, argumentsList);
  }
});

const { handleDelegateRequest } = require('./src/orchestration/orchestrator.js');
const { searchMemory } = require('./src/knowledge/graph-search.js');

async function test() {
  console.log("Checking Graph Memory directly for 'Whizan AI'...");
  const mem = searchMemory("Whizan AI", 8);
  console.log("Memory Search Result Summary:", mem.summary);

  console.log("\nStarting Tier 2 Orchestrator test...");
  
  const request = {
    agent_id: 'research_analyst_v2',
    user_request: 'Research Apple Inc briefly. Provide a short 2-paragraph overview and include 1 chart showing their revenue over the last 3 years.',
    gathered_attributes: {
      topic: 'Apple Inc',
      visualizations: true
    }
  };

  const result = await handleDelegateRequest(request, (event, data) => {
    console.log(`[Event: ${event}]`, data);
  });

  console.log("Orchestrator returned:", result);
}

test().catch(console.error);

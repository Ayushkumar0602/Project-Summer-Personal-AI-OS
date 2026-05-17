const { loadPluginManifests, getPluginEntryPath, listPluginSummaries } = require('./plugin-registry');
const { resolveAttributes, buildClarificationMessage } = require('./attribute-resolver');
const { matchAgentIntent } = require('./intent-matcher');
const { AgentSocket } = require('./agent-socket');

let manifests = loadPluginManifests();
const activeSessions = new Map();
let sessionCounter = 0;

function reloadPlugins() {
  manifests = loadPluginManifests();
  return manifests;
}

function getManifest(agentId) {
  return manifests.get(agentId) || null;
}

function getPluginsPromptSection() {
  if (manifests.size === 0) return '';
  return `\n\n### Domain Agent Plugs (Tier 2)\nFor presentation/PPT requests, call \`delegate_domain_agent\` instead of improvising slides yourself.\nAvailable plugs:\n${listPluginSummaries(manifests).join('\n')}`;
}

/**
 * Tier 2 entry: resolve attributes, gather missing data, or start worker.
 */
async function handleDelegateRequest({ agent_id, user_request, gathered_attributes }, emit) {
  const manifest = getManifest(agent_id);
  if (!manifest) {
    return { status: 'error', message: `Unknown agent plug: ${agent_id}` };
  }

  let prior = gathered_attributes || {};
  for (const [sid, session] of activeSessions) {
    if (session.phase === 'gathering' && session.agent_id === agent_id) {
      prior = { ...session.filled, ...prior };
      activeSessions.delete(sid);
      break;
    }
  }
  prior._lastUserText = user_request;
  const { filled, missing, ready } = resolveAttributes(manifest, user_request, prior);

  if (!ready) {
    const sessionId = `gather_${++sessionCounter}`;
    activeSessions.set(sessionId, { phase: 'gathering', agent_id, filled, manifest });
    const clarification = buildClarificationMessage(manifest, missing, filled);
    emit?.('agent-gathering', { sessionId, ...clarification });
    return {
      status: 'gathering',
      sessionId,
      ...clarification,
      filled_attributes: filled,
      instruction: 'Ask the user for the missing fields, then call delegate_domain_agent again with gathered_attributes containing the new values.'
    };
  }

  const sessionId = `run_${++sessionCounter}`;
  const taskManifest = { ...filled, agent_id };
  const entryPath = getPluginEntryPath(manifest);

  emit?.('agent-started', { sessionId, agent_id, display_name: manifest.display_name });

  const socket = new AgentSocket(manifest, entryPath, taskManifest, {
    onProgress: (percent, message) => {
      emit?.('agent-progress', { sessionId, agent_id, percent, message });
    },
    onComplete: (result) => {
      activeSessions.delete(sessionId);
      emit?.('agent-complete', { sessionId, agent_id, result });
    },
    onFail: (error) => {
      activeSessions.delete(sessionId);
      emit?.('agent-fail', { sessionId, agent_id, error });
    },
    onKilled: (reason) => {
      activeSessions.delete(sessionId);
      emit?.('agent-killed', { sessionId, agent_id, reason });
    }
  });

  activeSessions.set(sessionId, { phase: 'running', socket, agent_id });
  socket.start();

  return {
    status: 'running',
    sessionId,
    message: `${manifest.display_name || agent_id} started in background. Progress will appear on the HUD.`,
    task_manifest: taskManifest
  };
}

function detectAndDelegate(userText, emit) {
  const agentId = matchAgentIntent(userText, manifests);
  if (!agentId) return null;
  return handleDelegateRequest({ agent_id: agentId, user_request: userText }, emit);
}

function cancelActiveAgents(reason = 'user_cancel') {
  let count = 0;
  for (const [, session] of activeSessions) {
    if (session.socket) {
      session.socket.kill(reason);
      count++;
    }
  }
  return count;
}

function cancelIfUserSaysStop(text) {
  if (!/\b(cancel|stop|abort)\b/i.test(text)) return false;
  const n = cancelActiveAgents('user_cancel');
  return n > 0;
}

function detectAgentIntent(userText) {
  return matchAgentIntent(userText, manifests);
}

module.exports = {
  reloadPlugins,
  getManifest,
  getPluginsPromptSection,
  handleDelegateRequest,
  detectAndDelegate,
  cancelActiveAgents,
  cancelIfUserSaysStop,
  matchAgentIntent: detectAgentIntent
};

const PPT_PATTERNS = [
  /\b(ppt|powerpoint|presentation|slides?)\b/i,
  /\bmake\s+(a\s+)?deck\b/i,
  /\bcreate\s+(a\s+)?presentation\b/i
];

const AGENT_KEYWORDS = {
  ppt_editor_v1: PPT_PATTERNS
};

/**
 * @returns {string|null} agent_id if user text matches a plug-in intent
 */
function matchAgentIntent(userText, manifests) {
  if (!userText || !manifests?.size) return null;
  for (const [agentId, patterns] of Object.entries(AGENT_KEYWORDS)) {
    if (!manifests.has(agentId)) continue;
    if (patterns.some(p => p.test(userText))) return agentId;
  }
  return null;
}

module.exports = { matchAgentIntent };

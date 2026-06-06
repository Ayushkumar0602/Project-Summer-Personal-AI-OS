const PPT_PATTERNS = [
  /\b(ppt|powerpoint|presentation|slides?)\b/i,
  /\bmake\s+(a\s+)?deck\b/i,
  /\bcreate\s+(a\s+)?presentation\b/i
];

const NEWS_PATTERNS = [
  /\b(news|latest updates|monitor)\b/i
];

const FACT_PATTERNS = [
  /\b(fact check|verify|is it true)\b/i
];

const TREND_PATTERNS = [
  /\b(trend|analyze trends?|market shifts?)\b/i
];

const AGENT_KEYWORDS = {
  ppt_editor_v1: PPT_PATTERNS,
  news_monitor_v1: NEWS_PATTERNS,
  fact_checker_v1: FACT_PATTERNS,
  trend_analyzer_v1: TREND_PATTERNS
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

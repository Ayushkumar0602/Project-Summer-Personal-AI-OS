const os = require('node:os');
const path = require('node:path');
const { searchMemory } = require('../knowledge/graph-search');

const AUDIENCE_KEYWORDS = {
  college: /\b(college|university|campus|academic|student)\b/i,
  corporate: /\b(corporate|business|executive|board|stakeholder)\b/i,
  general: /\b(general|public|everyone)\b/i
};

function extractSlideCount(text) {
  const patterns = [
    /\b(\d{1,2})\s*[- ]?\s*slides?\b/i,
    /\bslide\s*count[:\s]+(\d+)/i,
    /\bmake\s+it\s+(\d+)\s+slides?\b/i,
    /\b(\d+)\s+slide\s+presentation\b/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function extractAudience(text) {
  for (const [audience, re] of Object.entries(AUDIENCE_KEYWORDS)) {
    if (re.test(text)) return audience;
  }
  return null;
}

function extractTopic(text) {
  const patterns = [
    /(?:research|report|study|paper|overview|summary|presentation|ppt|deck)\s+(?:titled|named|called)\s+['"]?([^"'.]+)['"]?/i,
    /(?:research|report|study|paper|overview|summary|presentation|ppt|deck).{0,30}?\b(?:on|about|for|regarding|into)\s+['"]?([^"'.]+)['"]?/i,
    /(?:make|create|build|generate|conduct).{0,30}?\b(?:on|about|for|regarding|into)\s+['"]?([^"'.]+)['"]?/i,
    /(?:on|about|regarding)\s+['"]?([^"'.]+)['"]?\s+(?:for\s+)?(?:college|corporate|my)/i,
    /research\s+['"]?([^"'.]+)['"]?\s+(?:briefly|deeply|thoroughly)/i,
    /(?:research|investigate|explore)\s+['"]?([^"'.]+)['"]?/i,
    // ── News / monitor / trend / fact-check patterns ──────────────────────
    /(?:news|updates?|headlines?|monitor|track|check|analyze)\s+(?:on|about|for|regarding|related\s+to|of)\s+['"]?(.+?)['"]?(?:\s+in\s+the\s+|\s*$)/i,
    /(?:gather|get|fetch|find|show)\s+(?:all\s+)?(?:the\s+)?(?:news|info|information|updates?|data)\s+(?:on|about|for|regarding|related\s+to|of)\s+['"]?(.+?)['"]?(?:\s+in\s+the\s+|\s*$)/i,
    /(?:latest|recent)\s+(?:news|updates?|releases?|info)\s+(?:on|about|for|from|regarding)\s+['"]?(.+?)['"]?$/i,
    /(?:fact[- ]?check|verify|is\s+it\s+true)\s+(?:that\s+)?['"]?(.+?)['"]?$/i,
    /(?:trend|trends?|analyze\s+trends?)\s+(?:in|on|about|for|regarding)\s+['"]?(.+?)['"]?$/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) {
      return m[1].trim().replace(/\s+for\s+my\s+college.*/i, '').trim();
    }
  }
  return null;
}

function expandPath(p) {
  if (!p) return path.join(os.homedir(), 'Desktop');
  return p.replace(/^~(?=\/|$)/, os.homedir());
}

function extractReportDepth(text) {
  const depthKeywords = [
    { key: 'comprehensive deep dive', match: /\b(deep|comprehensive|extensive|detailed|full|exhaustive)\b/i },
    { key: 'brief overview', match: /\b(brief|short|quick|overview|summary)\b/i },
    { key: 'executive summary', match: /\b(executive|high[- ]level)\b/i }
  ];
  for (const { key, match } of depthKeywords) {
    if (match.test(text)) return key;
  }
  return null;
}

/**
 * Resolve mandatory/optional attributes from prompt, prior state, and graph memory.
 */
async function resolveAttributes(manifest, userText, prior = {}) {
  const filled = { ...prior };
  const text = [userText, prior._lastUserText].filter(Boolean).join(' ');

  if (!filled.topic) {
    filled.topic = extractTopic(text) || prior.topic || null;
  }
  // Fallback: if topic is still null but user clearly asked about something,
  // use the full user request as the topic (common for news/trend/fact queries)
  if (!filled.topic && userText && userText.length > 10) {
    filled.topic = userText;
  }

  // ── Map topic to agent-specific mandatory attribute names ──────────────
  // fact_checker_v1 needs "claim", trend_analyzer_v1 needs "industry_or_topic"
  if (!filled.claim) {
    filled.claim = filled.topic || (userText?.length > 10 ? userText : null);
  }
  if (!filled.industry_or_topic) {
    filled.industry_or_topic = filled.topic || (userText?.length > 10 ? userText : null);
  }
  if (!filled.slide_count) {
    const n = extractSlideCount(text);
    if (n) filled.slide_count = n;
  }
  if (!filled.target_audience) {
    filled.target_audience = extractAudience(text) || prior.target_audience || null;
  }
  if (!filled.report_depth) {
    filled.report_depth = extractReportDepth(text) || prior.report_depth || null;
  }

  // Respect the agent's graph memory usage preference
  const usesMemory = manifest.uses_graph_memory !== false;

  if (usesMemory) {
    if (!filled.context_data && filled.topic) {
      const mem = await searchMemory(filled.topic, 40);
      filled.context_data = mem.summary || 'No additional context in memory.';
    } else if (!filled.context_data) {
      filled.context_data = prior.context_data || '';
    }
  } else {
    filled.context_data = 'Graph memory extraction explicitly disabled for this agent.';
  }

  for (const opt of manifest.optional_attributes || []) {
    const key = opt.key;
    if (filled[key] !== undefined) continue;
    if (opt.default !== undefined) filled[key] = opt.default;
  }

  if (filled.output_path) {
    filled.output_path = expandPath(filled.output_path);
  }

  const mandatory = manifest.mandatory_attributes || [];
  const missing = mandatory
    .filter(a => {
      const v = filled[a.key];
      return v === undefined || v === null || v === '';
    })
    .map(a => ({ key: a.key, description: a.description }));

  return { filled, missing, ready: missing.length === 0 };
}

function buildClarificationMessage(manifest, missing, filled) {
  const names = missing.map(m => m.key.replace(/_/g, ' ')).join(', ');
  const topic = filled.topic ? ` for "${filled.topic}"` : '';
  return {
    status: 'gathering',
    agent_id: manifest.agent_id,
    display_name: manifest.display_name || manifest.agent_id,
    missing,
    message: `The ${manifest.display_name || 'agent'} needs: ${names}.${topic ? ` I have the topic and memory context ready.` : ''} Please provide the missing details.`
  };
}

module.exports = {
  resolveAttributes,
  buildClarificationMessage,
  extractSlideCount,
  extractAudience,
  extractTopic
};

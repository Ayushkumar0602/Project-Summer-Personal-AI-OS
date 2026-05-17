function extractTopic(text) {
  const patterns = [
    /(?:research|report|study|paper)\s+(?:on|about|for|regarding|titled)\s+['"]?([^'",.]+?)['"]?(?:\.|,|$|\bfor\b|\bwith\b|\band\b)/i,
    /(?:ppt|presentation|powerpoint|deck|slides?)\s+(?:on|about|for|regarding|titled)\s+['"]?([^'",.]+?)['"]?(?:\.|,|$|\bfor\b|\bwith\b|\band\b)/i,
    /(?:make|create|build|generate)\s+(?:a\s+)?(?:ppt|presentation|powerpoint|deck|paper|report)\s+(?:on|about|for|regarding|titled)\s+['"]?([^'",.]+?)['"]?(?:\.|,|$|\bfor\b)/i,
    /(?:on|about|titled)\s+['"]?([^'",.]+?)['"]?\s+(?:for\s+)?(?:college|corporate|my)/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) {
      return m[1].trim().replace(/\s+for\s+my\s+college.*/i, '').trim();
    }
  }
  return null;
}

const prompts = [
  "Conduct deep research and produce a comprehensive research paper titled 'A Full Overview of AI: Past, Present, and Future'. The paper must cover early milestones (Turing test), current LLM technologies (Gemini, Claude), key players (OpenAI), financial implications, and future directions like advanced reasoning and emotional AI.",
  "Create a detailed PowerPoint presentation on the evolution of AI. Cover the past (Turing test to expert systems), the present (OpenAI, Gemini and Claude internals, financial aspects), and the future (advanced reasoning, emotional AI, human-like behavior).",
  "Research Apple Inc briefly. Provide a short 2-paragraph overview and include 1 chart showing their revenue over the last 3 years.",
  "I want a full research paper based thing on humanoid robots."
];

prompts.forEach((p, i) => {
  console.log(`Prompt ${i}: ${extractTopic(p)}`);
});

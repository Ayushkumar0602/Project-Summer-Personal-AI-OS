const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_LAYOUTS = `
## AVAILABLE LAYOUTS
Choose ONE different layout for each slide (use these exact XML tags so our parser recognizes them):

1. COLUMNS: For comparisons
\`\`\`xml
<COLUMNS>
  <DIV><H3>First Concept</H3><P>Description</P></DIV>
  <DIV><H3>Second Concept</H3><P>Description</P></DIV>
</COLUMNS>
\`\`\`

2. BULLETS: For key points
\`\`\`xml
<BULLETS>
  <DIV><H3>Main Point 1 </H3><P>Description</P></DIV>
  <DIV><H3>Main Point 2 </H3><P>Second point with details</P></DIV>
</BULLETS>
\`\`\`

3. ICONS: For concepts with symbols
\`\`\`xml
<ICONS>
  <DIV icon="rocket"><H3>Innovation</H3><P>Description</P></DIV>
  <DIV icon="shield"><H3>Security</H3><P>Description</P></DIV>
</ICONS>
\`\`\`

4. CYCLE: For processes and workflows
\`\`\`xml
<CYCLE>
  <DIV><H3>Research</H3><P>Initial exploration phase</P></DIV>
  <DIV><H3>Design</H3><P>Solution creation phase</P></DIV>
  <DIV><H3>Implement</H3><P>Execution phase</P></DIV>
  <DIV><H3>Evaluate</H3><P>Assessment phase</P></DIV>
</CYCLE>
\`\`\`

5. ARROWS: For cause-effect or flows
\`\`\`xml
<ARROWS>
  <DIV><H3>Challenge</H3><P>Current market problem</P></DIV>
  <DIV><H3>Solution</H3><P>Our innovative approach</P></DIV>
  <DIV><H3>Result</H3><P>Measurable outcomes</P></DIV>
</ARROWS>
\`\`\`

6. BOXES: For simple information tiles
\`\`\`xml
<BOXES boxType="outline|solid">
  <DIV><H3>Speed</H3><P>Faster delivery cycles.</P></DIV>
  <DIV><H3>Quality</H3><P>Automated testing & reviews.</P></DIV>
  <DIV><H3>Security</H3><P>Shift-left security practices.</P></DIV>
</BOXES>
\`\`\`
`;

async function writeContent(plan, manifest) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

  const outlineFormatted = plan.slides.map(s => `# ${s.title}\n${s.points.map(p => `- ${p}`).join('\n')}`).join('\n\n');

  const prompt = `You are an expert presentation designer. Create an engaging presentation in XML format.

# PRESENTATION CONTEXT

- **Title**: ${plan.title}
- **Request**: ${manifest.topic}
- **Language**: ${manifest.language || 'English (US)'}
- **Tone**: ${manifest.tone || 'professional'}
- **Total Slides**: ${plan.slides.length}
- **Target Audience**: ${manifest.target_audience || 'General'}

## Outline Reference
\`\`\`md
${outlineFormatted}
\`\`\`

# OUTPUT FORMAT

Return ONLY valid XML without markdown formatting. Do not wrap in \`\`\`xml.

<PRESENTATION>
  <TITLE_SLIDE>
    <H1>${plan.title}</H1>
    <P>${manifest.topic}</P>
  </TITLE_SLIDE>

  <!--Every slide must follow this structure (layout determines where the image appears) -->
  <SECTION layout="left|right|vertical">
    <!-- Required: include ONE layout component per slide -->
    <!-- Required: include at least one detailed image query -->
  </SECTION>
  <!-- More SECTION tags... -->
</PRESENTATION>

**SECTION Layout Attribute:**
- \`layout="left"\` - Image on left side
- \`layout="right"\` - Image on right side  
- \`layout="vertical"\` - Image at top

Vary layouts throughout for visual interest.

---

${DEFAULT_LAYOUTS}

---

# IMAGE QUERIES

**STOCK IMAGE SEARCH**: Use SHORT keyword queries (1-4 words).
Important: Every \`<IMG query="...">\` value for stock image search MUST be written in English.
\`\`\`xml
<IMG query="smart city skyline" />
<IMG query="team collaboration" />
\`\`\`

# CRITICAL RULES

1. Generate **EXACTLY ${plan.slides.length} slides** inside <SECTION> tags, after the <TITLE_SLIDE>.
2. Use DIFFERENT layouts for consecutive slides - never repeat.
3. Expand outline content - do NOT copy verbatim.
4. Include detailed image queries on most slides using <IMG query="..." />.
5. Vary SECTION layout attribute (left/right/vertical) throughout.
6. Use ONLY layout tags from AVAILABLE LAYOUTS.

Now generate the complete XML presentation.`;

  const result = await model.generateContent(prompt);
  let text = result.response.text();
  
  // Clean up markdown wrapping if present
  if (text.includes('\`\`\`xml')) {
    text = text.replace(/\`\`\`xml\\s*/g, '').replace(/\`\`\`/g, '');
  }

  return text;
}

module.exports = { writeContent };

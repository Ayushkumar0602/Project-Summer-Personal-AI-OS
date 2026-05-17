const { GoogleGenerativeAI } = require('@google/generative-ai');
const { tavily } = require('@tavily/core');

async function planSlides(manifest) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

  const {
    topic,
    slide_count = 10,
    language = "English (US)",
    target_audience = "General",
    tone = "professional",
    web_search = false,
    context_data = ""
  } = manifest;

  let researchStep = "Use existing knowledge and provided memory context";
  let webSearchGuidelines = "- Web search is disabled for this request. Rely on memory context and base knowledge.";
  let finalInstruction = "Generate the outline directly using the provided memory context.";
  let searchResultsContext = "";
  
  const memoryWordCount = context_data ? context_data.split(/\s+/).length : 0;
  const hasMemoryContext = context_data && !context_data.includes('No additional context in memory.') && memoryWordCount > 10;
  
  if (hasMemoryContext) {
      searchResultsContext += `
## Graph Memory Context (${memoryWordCount} words):
${context_data}
`;
  }

  // Force web search if memory has fewer than 500 words, or if explicitly requested
  const shouldWebSearch = web_search || !hasMemoryContext || memoryWordCount < 500;

  if (shouldWebSearch && process.env.TAVILY_API_KEY) {
    try {
      const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
      // Use search depth advanced and ask for more results to hit the ~500 words target
      const searchResponse = await tvly.search(topic, {
        searchDepth: "advanced",
        includeAnswer: true,
        maxResults: 6
      });
      
      searchResultsContext += `
## Web Search Context:
${searchResponse.answer || "No direct answer found."}

Recent Results:
${searchResponse.results.slice(0, 5).map(r => `- ${r.title}: ${r.content}`).join('\n')}
`;
      researchStep = "Research provided context (memory + web search) before writing the outline";
      webSearchGuidelines = "- Use the provided Web Search Context and Graph Memory Context for current facts, recent developments, and accurate details";
      finalInstruction = "Generate the outline based on the provided Graph Memory and Web Search context.";
    } catch (e) {
      console.warn("Tavily search failed, falling back to base knowledge:", e);
    }
  }

  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const prompt = `You are an expert presentation outline generator. Your task is to create a comprehensive and engaging presentation outline based on the user's topic: "${topic}".

Current Date: ${currentDate}

## Presentation Customization:
- Tone: ${tone}
- Target Audience: ${target_audience}

## Your Process:
1. Analyze the topic
2. ${researchStep}
3. Generate the outline

${searchResultsContext}

## Context Guidelines:
${webSearchGuidelines}

## Outline Requirements:
- First generate an appropriate title for the presentation enclosed in <TITLE> tags.
- Generate exactly ${slide_count} main topics
- Each topic should be a clear, engaging heading
- Include 2-3 bullet points per topic
- Use ${language} language
- Tailor language for the requested tone and audience
- ALWAYS use bullet points formatted as "- point text"
- Do not use bold, italic, or underline

## Output Format:
Start with the title in XML tags, then generate markdown with each topic as a heading followed by bullet points.

Example:
<TITLE>Your Generated Presentation Title Here</TITLE>

# First Main Topic
- Key point
- Another point

# Second Main Topic
- Key point
- Another point

Remember: ${finalInstruction}`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  
  return parseOutlineResponse(responseText);
}

function parseOutlineResponse(text) {
  const lines = text.split('\n');
  const slides = [];
  let currentSlide = null;
  let title = "Presentation";
  
  const titleMatch = text.match(/<TITLE>(.*?)<\/TITLE>/i);
  if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim();
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase().startsWith('<title>')) continue;

    if (trimmed.startsWith('#')) {
      if (currentSlide) {
        slides.push(currentSlide);
      }
      currentSlide = {
        title: trimmed.replace(/^#+\s*/, ''),
        points: []
      };
    } else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
      if (currentSlide) {
        currentSlide.points.push(trimmed.replace(/^[-*]\s*/, ''));
      }
    }
  }

  if (currentSlide) {
    slides.push(currentSlide);
  }

  return { title, slides };
}

module.exports = { planSlides };

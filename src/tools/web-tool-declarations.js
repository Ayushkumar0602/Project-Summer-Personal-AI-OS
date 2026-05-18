/**
 * Gemini function declarations for web search & news tools.
 */

const webToolDeclarations = [
    {
        name: "search_web",
        description: "Search the internet for current events, facts, or general knowledge.",
        parameters: {
            type: "OBJECT",
            properties: { query: { type: "STRING", description: "The search query" } },
            required: ["query"]
        }
    },
    {
        name: "scrape_webpage",
        description: "Read the textual content of a specific URL in the background.",
        parameters: {
            type: "OBJECT",
            properties: { url: { type: "STRING", description: "The exact URL to scrape" } },
            required: ["url"]
        }
    },
    {
        name: "get_news",
        description: "Get the latest news headlines from NewsAPI.org. You can optionally specify a topic.",
        parameters: {
            type: "OBJECT",
            properties: { topic: { type: "STRING", description: "Optional topic to search news for. If empty, gets top headlines." } },
            required: []
        }
    },
    {
        name: "search_images",
        description: "Search the internet for relevant images and DISPLAY them visually on screen as a HUD gallery. Use this when the user asks to SEE something — a place, person, product, concept, or event. This is your eyes for the internet. Always use this when you want to visually show something.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "What to search images of. Be specific for best results." },
                count: { type: "NUMBER", description: "Number of images to show (default 4, max 8)" }
            },
            required: ["query"]
        }
    }
];

module.exports = { webToolDeclarations };

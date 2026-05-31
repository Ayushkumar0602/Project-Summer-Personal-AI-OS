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
        description: "Search the internet for highly relevant images and DISPLAY them visually on screen. Use this to visually show the user a place, person, product, concept, or event. Provide highly specific, descriptive search queries to ensure relevance (e.g. 'Apple Vision Pro headset' instead of just 'Apple', or 'Eiffel Tower at night' instead of 'tower').",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "Highly specific, descriptive query to find exactly what the user wants to see." },
                count: { type: "NUMBER", description: "Number of images to show (default 4, max 8)" }
            },
            required: ["query"]
        }
    }
];

module.exports = { webToolDeclarations };

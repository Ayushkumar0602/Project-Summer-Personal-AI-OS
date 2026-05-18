/**
 * Gemini function declarations for knowledge graph & visual memory tools.
 */

const memoryToolDeclarations = [
    {
        name: "show_visual_memory",
        description: "Search and DISPLAY images from the user's personal visual memory on the HUD screen. Use this when the user says 'show me my photo', 'show a picture of me', 'display my image', or refers to any photo they have uploaded. This searches stored personal photos by keyword and shows them on screen. Always use this FIRST before saying you cannot display personal images.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "What to search for in the user's personal photo library. E.g. 'ayush portrait', 'me', 'photo', 'graduation'" },
                count: { type: "NUMBER", description: "Max number of photos to show (default 4)" }
            },
            required: ["query"]
        }
    },
    {
        name: "query_memory",
        description: "Search your persistent knowledge graph memory for facts about the user, their projects, skills, relationships, or any topic you've learned. Call this whenever the user asks about something personal, or when you need context you might have stored. Returns a structured summary of matching nodes and their connections.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "What to search for in memory. Be specific — e.g. 'user skills', 'Ayush projects', 'machine learning concepts'" },
                maxResults: { type: "NUMBER", description: "Max number of matching entities to return. Default 5, max 10." },
                filterTag: { type: "STRING", description: "Optional tag to restrict results, e.g. '#work', '#study', '#personal'" }
            },
            required: ["query"]
        }
    }
];

module.exports = { memoryToolDeclarations };

const { GoogleGenAI } = require('@google/genai');

async function test() {
    if (!process.env.GEMINI_API_KEY) {
        console.log("No API key");
        return;
    }
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    try {
        const finalReport = await client.interactions.create({
            agent: 'deep-research-max-preview-04-2026',
            input: 'test input',
            agent_config: { 
                type: 'deep-research', 
                collaborative_planning: false,
                visualization: 'off'
            },
            background: true
        });
        console.log("Created", finalReport);
        const finalResult = await client.interactions.get(finalReport.id);
        console.log("Got", finalResult);
    } catch (e) {
        console.error(e);
    }
}
test();

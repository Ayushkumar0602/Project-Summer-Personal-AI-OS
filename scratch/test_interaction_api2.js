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
            input: 'Create a tiny report on apples, just 1 paragraph, with 1 image.',
            agent_config: { 
                type: 'deep-research', 
                collaborative_planning: false,
                visualization: 'auto'
            },
            background: true
        });
        
        let result;
        while (true) {
            result = await client.interactions.get(finalReport.id);
            if (result.status === 'completed' || result.status === 'failed') break;
            await new Promise(r => setTimeout(r, 2000));
        }
        
        console.log(JSON.stringify(result.steps, null, 2));
    } catch (e) {
        console.error(e);
    }
}
test();

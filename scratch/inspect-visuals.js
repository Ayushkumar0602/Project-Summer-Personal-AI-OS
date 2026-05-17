require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function test() {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.log("Triggering quick research with visuals...");
    const interaction = await client.interactions.create({
        agent: 'deep-research-preview-04-2026',
        input: 'Research Apple Inc briefly. Provide 2 paragraphs and at least 1 chart showing their revenue over the last 3 years.',
        agent_config: { 
            type: 'deep-research', 
            collaborative_planning: false,
            visualization: 'auto'
        },
        background: true
    });

    console.log("Research started:", interaction.id);
    while (true) {
        const result = await client.interactions.get(interaction.id); 
        console.log("Status:", result.status);
        if (result.status === 'completed') {
            console.log("Outputs length:", result.outputs?.length);
            result.outputs?.forEach((out, idx) => {
                console.log(`\n--- Output #${idx} ---`);
                console.log(`type:`, out.type);
                if (out.type === 'text') {
                    console.log(`text length:`, out.text?.length);
                } else if (out.type === 'image') {
                    console.log(`image keys:`, Object.keys(out));
                    console.log(`mime_type:`, out.mime_type);
                    console.log(`data length:`, out.data?.length);
                } else {
                    console.log(`keys:`, Object.keys(out));
                }
            });
            break;
        } else if (result.status === 'failed') {
            console.error("Failed:", result.error);
            break;
        }
        await new Promise(r => setTimeout(r, 5000));
    }
}

test().catch(console.error);

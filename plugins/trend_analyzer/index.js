const { GoogleGenAI } = require('@google/genai');
const { withMemoryApiKey } = require('../../src/knowledge/memory-api-key');

async function main(taskManifest, sdk) {
    try {
        const { industry_or_topic, period = 'last 30 days' } = taskManifest;

        sdk.reportProgress(10, `Initializing Trend Analyzer for "${industry_or_topic}"...`);
        sdk.reportProgress(30, 'Gathering historical and recent data...');

        const prompt = `
        Analyze the industry or topic: "${industry_or_topic}" over the ${period}.
        Your goal is to output ONLY a beautifully styled, modern HTML snippet that can be directly injected into a HUD.
        Use a dark mode theme, glassmorphism effects, and a sleek grid layout.
        Make it look extremely premium, like a futuristic dashboard widget.
        The HTML should have inline CSS or a <style> block.
        Do NOT wrap the output in markdown \`\`\`html blocks, just raw HTML.

        REQUIREMENTS:
        1. Include a high-level strategic summary at the top.
        2. Identify 3-4 emerging keywords or sub-trends and display them as stylized tags or cards.
        3. Create a visually impressive section that simulates a chart. You can use CSS flexbox/grids to create a bar chart or include a Chart.js script if you can write the JS inline. Alternatively, just use sleek CSS progress bars to show "Trend Momentum" for the top keywords.
        4. Detail a "Strategic Recommendation" at the bottom.
        `;

        sdk.reportProgress(60, 'Identifying momentum shifts and emerging keywords...');

        const htmlContentRaw = await withMemoryApiKey(async (apiKey) => {
            const client = new GoogleGenAI({ apiKey });
            const response = await client.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    tools: [{ googleSearch: {} }]
                }
            });
            return response.text;
        }, { caller: 'TrendAnalyzer' });

        sdk.reportProgress(85, 'Generating interactive trend visualizations...');

        let htmlContent = htmlContentRaw;
        
        if (htmlContent.startsWith('```html')) {
            htmlContent = htmlContent.replace(/^```html\n/, '').replace(/\n```$/, '');
        }

        sdk.reportProgress(100, 'Trend analysis complete. Projecting dashboard on HUD.');

        const spokenMessage = `I've analyzed the trends for ${industry_or_topic} over the ${period}. I'm projecting the strategic dashboard and momentum visualizations onto your HUD now.`;

        sdk.complete({ 
            html: htmlContent, 
            message: spokenMessage,
            instruction_for_summer: `Call the 'show_hologram_widget' tool with type="custom_html", and pass the 'html' field from this result into data[0].html. Then speak the 'message' to the user.`
        });

    } catch (error) {
        console.error('Trend Analyzer Agent failed:', error);
        sdk.fail({ error: error.message });
    }
}

module.exports = { main };

const { GoogleGenAI } = require('@google/genai');
const { withMemoryApiKey } = require('../../src/knowledge/memory-api-key');

async function main(taskManifest, sdk) {
    try {
        const { topic, timeframe = 'last 24 hours' } = taskManifest;

        sdk.reportProgress(10, `Initializing news gathering for "${topic}"...`);
        sdk.reportProgress(30, 'Scanning multiple news sources and aggregating data...');

        const prompt = `
        Gather the latest news, headlines, and data regarding the topic: "${topic}" over the ${timeframe}.
        Your goal is to output ONLY a beautifully styled, modern HTML snippet that can be directly injected into a HUD.
        Use a dark mode theme, glassmorphism effects, and a sleek grid layout for news cards.
        
        CRITICAL INSTRUCTION FOR IMAGES: 
        For every news card, you must include an <img> tag. You MUST add a custom attribute called 'data-article-url' containing the EXACT URL of the news article. 
        Example: <img src="" data-article-url="https://www.theverge.com/article-link-here" alt="Headline">
        The system will post-process this HTML to extract the real lead image from that URL.

        Make it look extremely premium, like a futuristic dashboard widget.
        The HTML should have inline CSS or a <style> block.
        Do NOT wrap the output in markdown \`\`\`html blocks, just raw HTML.
        Include a summary section at the top, then a grid of at least 3-4 top news articles with their headlines, source, short description, and a stylized "Sentiment" tag (Positive/Neutral/Negative).
        `;

        sdk.reportProgress(50, 'Analyzing sentiment and extracting key highlights...');

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
        }, { caller: 'NewsMonitor' });

        sdk.reportProgress(75, 'Scraping real lead images from article sources...');

        let htmlContent = htmlContentRaw;
        
        // Strip markdown code blocks if Gemini accidentally includes them
        if (htmlContent.startsWith('```html')) {
            htmlContent = htmlContent.replace(/^```html\n/, '').replace(/\n```$/, '');
        }

        const cheerio = require('cheerio');
        let $ = cheerio.load(htmlContent);
        
        const imgTags = $('img').toArray();
        for (const img of imgTags) {
            const articleUrl = $(img).attr('data-article-url');
            if (articleUrl) {
                try {
                    const res = await fetch(articleUrl, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
                    });
                    const html = await res.text();
                    const article$ = cheerio.load(html);
                    let ogImage = article$('meta[property="og:image"]').attr('content') || article$('meta[name="twitter:image"]').attr('content');
                    
                    if (ogImage) {
                        $(img).attr('src', ogImage);
                    } else {
                        $(img).attr('src', 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=400&auto=format&fit=crop'); // fallback space grid
                    }
                } catch (e) {
                    console.error("Failed to fetch og:image for", articleUrl, e.message);
                    $(img).attr('src', 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=400&auto=format&fit=crop');
                }
            }
        }
        
        // Remove html/head/body wrappers if cheerio added them to snippet
        htmlContent = $('body').html() || $.html();

        sdk.reportProgress(100, 'News Monitor complete. Rendering on HUD.');

        // For the instruction to Summer:
        const spokenMessage = `I've gathered the latest news on ${topic}. I am projecting the visual digest onto your HUD now.`;

        // The background worker returns this result object to orchestrator, which passes it to Tier 1 agent.
        // We will include an explicit instruction so the Tier 1 agent knows to use show_hologram_widget.
        sdk.complete({ 
            html: htmlContent, 
            message: spokenMessage,
            instruction_for_summer: `Call the 'show_hologram_widget' tool with type="custom_html", and pass the 'html' field from this result into data[0].html. Then speak the 'message' to the user.`
        });

    } catch (error) {
        console.error('News Monitor Agent failed:', error);
        sdk.fail({ error: error.message });
    }
}

module.exports = { main };

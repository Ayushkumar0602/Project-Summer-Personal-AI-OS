const { GoogleGenAI } = require('@google/genai');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { marked } = require('marked');
const { chromium } = require('playwright');
const driveService = require('../../src/services/drive-service');
const { isAuthenticated } = require('../../src/auth/google-auth');

async function formatAndSave(outputs, topic, sdk) {
    sdk.reportProgress(86, 'Parsing research outputs...');
    let markdownContent = `# Deep Research Report: ${topic}\n\n`;
    let imageCounter = 1;

    // Collect base64 images for direct HTML embedding (not file:// paths)
    const embeddedImages = [];

    if (outputs && Array.isArray(outputs)) {
        for (const out of outputs) {
            if (out.type === 'text' && out.text) {
                markdownContent += `${out.text}\n\n`;
            } else if (out.type === 'image' && out.data) {
                const imgTag = `__EMBEDDED_IMG_${imageCounter}__`;
                const mimeType = out.mime_type || 'image/png';
                
                // Save image file to temp directory
                const imgName = `${topic.replace(/[^a-zA-Z0-9]/g, '_')}_chart_${imageCounter}.png`;
                const imgPath = path.join(os.tmpdir(), imgName);
                await fs.writeFile(imgPath, Buffer.from(out.data, 'base64'));
                sdk.reportProgress(87, `Saved chart ${imageCounter}: ${imgName}`);

                // Store base64 for direct HTML embedding
                embeddedImages.push({
                    tag: imgTag,
                    dataUri: `data:${mimeType};base64,${out.data}`
                });

                // Use placeholder in markdown (will be replaced in HTML)
                markdownContent += `![Chart ${imageCounter}](${imgTag})\n\n`;
                imageCounter++;
            }
        }
    } else {
        throw new Error("No structured output found in the research results.");
    }

    const docName = `${topic.replace(/[^a-zA-Z0-9]/g, '_')}_Report`;
    const mdPath = path.join(os.tmpdir(), `${docName}.md`);
    const pdfPath = path.join(os.tmpdir(), `${docName}.pdf`);
    
    // Save Markdown (with file:// paths for local viewing)
    let mdForFile = markdownContent;
    for (const img of embeddedImages) {
        const chartNum = img.tag.match(/__EMBEDDED_IMG_(\d+)__/)[1];
        const imgName = `${topic.replace(/[^a-zA-Z0-9]/g, '_')}_chart_${chartNum}.png`;
        const imgPath = path.join(os.tmpdir(), imgName);
        mdForFile = mdForFile.replace(img.tag, `file://${imgPath}`);
    }
    await fs.writeFile(mdPath, mdForFile);
    sdk.reportProgress(89, 'Markdown report saved.');

    // Convert to HTML
    sdk.reportProgress(90, 'Converting to styled HTML...');
    let htmlContent = marked.parse(markdownContent);

    // Replace placeholder image tags with inline base64 data URIs
    for (const img of embeddedImages) {
        htmlContent = htmlContent.replaceAll(img.tag, img.dataUri);
    }

    const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 40px; }
                h1 { color: #1a1a1a; margin-top: 0; padding-bottom: 10px; border-bottom: 1px solid #eaeaea; }
                h2, h3 { color: #2c3e50; margin-top: 1.5em; }
                p { margin-bottom: 1.2em; }
                img { max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 6px; padding: 5px; margin: 20px 0; display: block; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                table { border-collapse: collapse; width: 100%; margin: 20px 0; }
                th, td { text-align: left; padding: 12px 8px; border-bottom: 1px solid #ddd; }
                th { background-color: #f8f9fa; font-weight: 600; }
                a { color: #0366d6; text-decoration: none; }
                code { background-color: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; font-family: monospace; }
                blockquote { border-left: 4px solid #dfe2e5; color: #6a737d; padding: 0 1em; margin-left: 0; }
            </style>
        </head>
        <body>
            ${htmlContent}
        </body>
        </html>
    `;
    
    // Generate PDF
    sdk.reportProgress(92, 'Launching PDF renderer...');
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        sdk.reportProgress(94, 'Rendering document layout...');
        // Use 'domcontentloaded' — images are inline base64, no network fetch needed
        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' });
        sdk.reportProgress(96, 'Generating PDF pages...');
        await page.pdf({ 
            path: pdfPath, 
            format: 'A4', 
            margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
            printBackground: true
        });
        sdk.reportProgress(98, 'PDF generated successfully.');
    } finally {
        await browser.close();
    }
    
    return pdfPath;
}

async function main(taskManifest, sdk) {
    try {
        const { topic, visualizations = true, report_depth = 'comprehensive deep dive' } = taskManifest;

        if (!process.env.GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY is not set in environment.");
        }

        const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const executionInput = `Create a ${report_depth} research report on: ${topic}. ${visualizations ? 'Include charts and diagrams showing relevant data wherever appropriate.' : ''}`;
        
        sdk.reportProgress(5, `Preparing research prompt for "${topic}"...`);
        sdk.reportProgress(8, `Depth: ${report_depth} | Visuals: ${visualizations ? 'enabled' : 'disabled'}`);

        sdk.reportProgress(10, 'Submitting to Gemini Deep Research engine...');

        const finalReport = await client.interactions.create({
            agent: 'deep-research-max-preview-04-2026',
            input: executionInput,
            agent_config: { 
                type: 'deep-research', 
                collaborative_planning: false,
                visualization: visualizations ? 'auto' : 'off'
            },
            background: true
        });

        sdk.reportProgress(12, `Research task created (ID: ...${finalReport.id.slice(-8)})`);

        let pollCount = 0;
        let finalResult;
        
        // Descriptive phase messages that cycle to show the agent is alive
        const phaseMessages = [
            'Searching the web for sources...',
            'Reading and analyzing documents...',
            'Cross-referencing data points...',
            'Extracting key insights...',
            'Synthesizing information...',
            'Building narrative structure...',
            'Verifying facts and citations...',
            'Compiling final analysis...'
        ];

        while (true) {
            finalResult = await client.interactions.get(finalReport.id);
            pollCount++;
            
            if (finalResult.status === 'completed') {
                const outputCount = finalResult.outputs?.length || 0;
                const imageCount = finalResult.outputs?.filter(o => o.type === 'image').length || 0;
                const textCount = finalResult.outputs?.filter(o => o.type === 'text').length || 0;
                sdk.reportProgress(85, `Research complete! ${outputCount} blocks (${textCount} text, ${imageCount} charts)`);
                break;
            } else if (finalResult.status === 'failed') {
                throw new Error(`Deep Research failed: ${finalResult.error}`);
            }
            
            // Smooth progress from 12% to 84%, cycling through descriptive messages
            const percent = Math.min(12 + Math.floor(pollCount * 2.5), 84);
            const phaseIdx = Math.floor(pollCount / 3) % phaseMessages.length;
            sdk.reportProgress(percent, phaseMessages[phaseIdx]);
            
            await new Promise(r => setTimeout(r, 10000));
        }
        
        // Pass sdk to formatAndSave so it can report granular progress (86-98%)
        const docPath = await formatAndSave(finalResult.outputs, topic, sdk);
        
        // Cloud Architecture: Problem C Solution -> Upload to Google Drive
        if (await isAuthenticated()) {
            sdk.reportProgress(99, 'Uploading report to Google Drive...');
            const driveResult = await driveService.uploadFile(docPath, 'application/pdf', true);
            sdk.complete({ 
                message: `Deep Research Report generated and saved to Google Drive.`,
                file_path: docPath,
                drive_url: driveResult.url 
            });
        } else {
            sdk.complete({ file_path: docPath, message: "Saved locally (Google Drive not connected)." });
        }

    } catch (error) {
        console.error('Research Agent failed:', error);
        sdk.fail({ error: error.message, stage: error.stage || 'unknown' });
    }
}

module.exports = { main };

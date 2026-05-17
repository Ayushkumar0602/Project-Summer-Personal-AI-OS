const { marked } = require('marked');
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');

async function convertToPdf(markdown, docPath) {
    const html = marked.parse(markdown);
    
    // Minimal styling for PDF
    const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
                h1, h2, h3 { color: #2c3e50; margin-top: 1.5em; }
                p { margin-bottom: 1em; }
                img { max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px; padding: 5px; margin: 15px 0; }
                table { border-collapse: collapse; width: 100%; margin: 15px 0; }
                th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
                th { background-color: #f2f2f2; }
            </style>
        </head>
        <body>
            ${html}
        </body>
        </html>
    `;
    
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle' });
    
    const pdfPath = docPath.replace('.md', '.pdf');
    await page.pdf({ path: pdfPath, format: 'A4', margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }, printBackground: true });
    await browser.close();
    
    console.log("PDF Created at:", pdfPath);
    return pdfPath;
}

async function test() {
    const md = "# Test \n\n This is a test \n\n ![alt text](file:///Users/ayushjaiswal/Desktop/chart_1.png)";
    await convertToPdf(md, path.join(os.homedir(), 'Desktop', 'Test_Doc.md'));
}

test().catch(console.error);

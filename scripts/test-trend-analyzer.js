require('dotenv').config({ path: '/Users/ayushjaiswal/Desktop/project-summer copy 2/.env' });
const { main } = require('/Users/ayushjaiswal/Desktop/project-summer copy 2/plugins/trend_analyzer/index.js');
const path = require('path');
const fs = require('fs');

const mockSdk = {
    reportProgress: (percent, message) => {
        console.log(`[PROGRESS] ${percent}% - ${message}`);
    },
    complete: (result) => {
        console.log(`\n[COMPLETE] Task finished successfully.`);
        console.log(`Message for Summer: ${result.message}`);
        console.log(`Instruction for Summer: ${result.instruction_for_summer}`);
        console.log(`HTML Output length: ${result.html ? result.html.length : 0} characters`);
        
        const outputPath = path.join(__dirname, 'test-trend-output.html');
        fs.writeFileSync(outputPath, result.html || '');
        console.log(`HTML saved to ${outputPath} for inspection.`);
    },
    fail: (error) => {
        console.error(`\n[FAIL] Task failed:`, error);
    }
};

const manifest = {
    industry_or_topic: 'AI Agents in Software Engineering',
    period: 'last 3 months'
};

console.log('Starting Trend Analyzer Test...\n');
main(manifest, mockSdk).then(() => {
    console.log('\nTest execution completed.');
});

require('dotenv').config({ path: '/Users/ayushjaiswal/Desktop/project-summer copy 2/.env' });
const { main } = require('/Users/ayushjaiswal/Desktop/project-summer copy 2/plugins/fact_checker/index.js');
const path = require('path');

const mockSdk = {
    reportProgress: (percent, message) => {
        console.log(`[PROGRESS] ${percent}% - ${message}`);
    },
    complete: (result) => {
        console.log(`\n[COMPLETE] Task finished successfully.`);
        console.log(`Message for Summer: ${result.message}`);
        console.log(`Saved PDF Path: ${result.file_path}`);
    },
    fail: (error) => {
        console.error(`\n[FAIL] Task failed:`, error);
    }
};

const manifest = {
    claim: 'Eating carrots gives you night vision like a cat',
    context: ''
};

console.log('Starting Fact Checker Test...\n');
main(manifest, mockSdk).then(() => {
    console.log('\nTest execution completed.');
});

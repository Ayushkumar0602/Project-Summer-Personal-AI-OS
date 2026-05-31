const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

async function testAudioModelWithKey(modelName, apiKey) {
    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const storeDir = '/Users/ayushjaiswal/Library/Application Support/Summer/audio-store';
        const files = fs.readdirSync(storeDir);
        const audioFile = files.find(f => f.endsWith('.wav') || f.endsWith('.m4a'));
        if (!audioFile) {
            console.log('No audio file found');
            return;
        }
        console.log(`Testing model ${modelName} with new key on ${audioFile}...`);
        const destPath = path.join(storeDir, audioFile);
        const base64 = fs.readFileSync(destPath).toString('base64');
        const mimeType = audioFile.endsWith('.wav') ? 'audio/wav' : 'audio/mp4';

        const response = await ai.models.generateContent({
            model: modelName,
            contents: [{
                parts: [
                    { inlineData: { mimeType, data: base64 } },
                    { text: 'Transcribe this audio.' }
                ]
            }]
        });
        console.log(`${modelName} SUCCESS:`, response.candidates[0].content.parts[0].text.substring(0, 100));
    } catch (e) {
        console.log(`${modelName} ERROR:`, e.message);
    }
}

async function run() {
    const newKey = 'AQ.Ab8RN6L9-XemzkQCqjiZWCbeEMrJEGtdvCffsD4nk9Y5SEGKEQ';
    await testAudioModelWithKey('gemini-2.0-flash', newKey);
    await testAudioModelWithKey('gemini-2.0-flash-lite', newKey);
}
run();

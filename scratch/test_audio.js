const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function testAudioModel(modelName) {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        // find an audio file in the store
        const storeDir = '/Users/ayushjaiswal/Library/Application Support/Summer/audio-store';
        const files = fs.readdirSync(storeDir);
        const audioFile = files.find(f => f.endsWith('.wav') || f.endsWith('.m4a'));
        if (!audioFile) {
            console.log('No audio file found');
            return;
        }
        console.log(`Testing model ${modelName} on ${audioFile}...`);
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
        console.log(`${modelName} SUCCESS:`, response.candidates[0].content.parts[0].text.substring(0, 50));
    } catch (e) {
        console.log(`${modelName} ERROR:`, e.message);
    }
}

async function run() {
    await testAudioModel('gemini-2.0-flash');
    await testAudioModel('gemini-2.0-flash-lite');
    await testAudioModel('gemini-2.5-pro');
}
run();

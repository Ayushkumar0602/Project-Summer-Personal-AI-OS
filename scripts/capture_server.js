const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3005;

app.use(cors());
// Increase payload limit for audio files
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../src/wake-word/capture')));

const DATASET_DIR = path.join(__dirname, '../src/wake-word/dataset');

app.post('/save-audio', (req, res) => {
    try {
        const { type, word, audioBase64 } = req.body;
        
        if (!type || !word || !audioBase64) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const targetDir = path.join(DATASET_DIR, type);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const buffer = Buffer.from(audioBase64, 'base64');
        const filename = `${word.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.wav`;
        const filepath = path.join(targetDir, filename);

        fs.writeFileSync(filepath, buffer);
        console.log(`✅ Saved ${type} sample: ${filename}`);

        res.json({ success: true, filename });
    } catch (err) {
        console.error('Failed to save audio:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`\n🎙️  Wake Word Data Capture Server running!`);
    console.log(`➡️  Open your browser to: http://localhost:${port}/capture-panel.html\n`);
});

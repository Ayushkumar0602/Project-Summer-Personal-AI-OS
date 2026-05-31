require('dotenv').config();

async function listModels() {
    try {
        const key = process.env.GEMINI_API_KEY;
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        const data = await res.json();
        const models = data.models.map(m => m.name);
        console.log(models);
    } catch (e) {
        console.error(e);
    }
}
listModels();

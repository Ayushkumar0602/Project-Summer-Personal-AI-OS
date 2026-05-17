require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function test() {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const completedId = "v1_ChdVbXdKYXZUZEtkQ0RxZmtQeGJDX3VRSRIXVW13SmF2VGRLZENEcWZrUHhiQ191UUk";
    console.log("Fetching completed research ID:", completedId);
    
    const result = await client.interactions.get(completedId);
    console.log("Status:", result.status);
    result.outputs.forEach((out, idx) => {
        console.log(`\n--- Output #${idx} ---`);
        console.log(`type:`, out.type);
        if (out.type === 'text') {
            console.log(`text length:`, out.text?.length);
            console.log(`text snippet:`, out.text?.substring(0, 300));
        } else {
            console.log(`keys:`, Object.keys(out));
        }
    });
}

test().catch(console.error);

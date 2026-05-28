const WebSocket = require('ws');
require('dotenv').config();

const url = process.env.REMOTE_DAEMON_URL || 'wss://summer-brain.onrender.com';
const token = process.env.REMOTE_DAEMON_TOKEN || 'Ayush_mac_token_9122';

console.log(`Connecting to remote daemon at: ${url}...`);

const ws = new WebSocket(url, {
    headers: {
        'x-pairing-token': token
    }
});

let timeout = setTimeout(() => {
    console.error('Connection timed out after 5 seconds.');
    ws.terminate();
    process.exit(1);
}, 5000);

ws.on('open', () => {
    clearTimeout(timeout);
    console.log('✅ Success! WebSocket connection opened successfully to remote daemon.');
    ws.close();
    process.exit(0);
});

ws.on('error', (err) => {
    clearTimeout(timeout);
    console.error('❌ Connection error:', err.message);
    process.exit(1);
});

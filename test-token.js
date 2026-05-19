require('dotenv').config();
const token = process.env.REMOTE_DAEMON_TOKEN ? process.env.REMOTE_DAEMON_TOKEN.replace(/^["']|["']$/g, '') : 'NONE';
console.log('Client token:', token);

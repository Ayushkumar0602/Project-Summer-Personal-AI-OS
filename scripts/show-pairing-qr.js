/**
 * scripts/show-pairing-qr.js
 *
 * Prints a QR code in the terminal containing the daemon IP + pairing token.
 * Scan with iPhone camera → SetupView auto-fills both fields.
 *
 * Usage:
 *   node scripts/show-pairing-qr.js
 *
 * Requires: npm install -g qrcode-terminal
 *   (or: npx qrcode-terminal)
 */

'use strict';

const os   = require('os');
const fs   = require('fs');
const path = require('path');

// ── Load pairing token ────────────────────────────────────────────────────────
const tokenPath = path.join(
    process.env.HOME || process.env.USERPROFILE || '~',
    '.summer',
    'pairing-token'
);

let token = process.env.DAEMON_TOKEN || process.env.REMOTE_DAEMON_TOKEN || '';

if (!token && fs.existsSync(tokenPath)) {
    token = fs.readFileSync(tokenPath, 'utf8').trim();
}

if (!token) {
    console.error('\n❌ No pairing token found.');
    console.error('Run the daemon first: node summer-daemon.js');
    console.error('It will generate a token at:', tokenPath);
    process.exit(1);
}

// ── Detect local network IP ───────────────────────────────────────────────────
function getLocalIP() {
    const nets = os.networkInterfaces();
    for (const ifaceName of Object.keys(nets)) {
        for (const iface of nets[ifaceName]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const ip   = getLocalIP();
const port = parseInt(process.env.PORT || '8765');

// ── Build QR payload ──────────────────────────────────────────────────────────
// SetupView on iOS reads this JSON to auto-fill the fields
const payload = JSON.stringify({ ip, token, port });

// ── Print ─────────────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════╗');
console.log('║         SUMMER iOS PAIRING QR CODE           ║');
console.log('╚══════════════════════════════════════════════╝\n');

// Try qrcode-terminal (install with: npm install -g qrcode-terminal)
try {
    const qrcode = require('qrcode-terminal');
    qrcode.generate(payload, { small: true }, (qr) => {
        console.log(qr);
        printManual(ip, token, port);
    });
} catch {
    // Fallback: just print text if qrcode-terminal not installed
    console.log('⚠️  qrcode-terminal not installed. Run:');
    console.log('   npm install -g qrcode-terminal\n');
    printManual(ip, token, port);
}

function printManual(ip, token, port) {
    console.log('──────────────────────────────────────────────');
    console.log('  Manual entry (if camera scan fails):');
    console.log('──────────────────────────────────────────────');
    console.log(`  IP Address : ${ip}`);
    console.log(`  Port       : ${port}`);
    console.log(`  Token      : ${token.slice(0, 8)}...${token.slice(-8)}`);
    console.log('──────────────────────────────────────────────');
    console.log('  In the Summer iOS app → Setup screen:');
    console.log('    1. Enter IP Address:', ip);
    console.log('    2. Paste full token (shown in daemon console on first run)');
    console.log('    3. Tap "Connect to Summer"');
    console.log('──────────────────────────────────────────────\n');
    console.log('  Make sure your Mac and iPhone are on the same Wi-Fi!\n');
}

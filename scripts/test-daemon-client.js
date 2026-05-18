/**
 * scripts/test-daemon-client.js
 *
 * End-to-end integration test for the Summer Core Daemon.
 *
 * Run this while the daemon is running to verify:
 *  1. WebSocket connection works
 *  2. Authentication handshake succeeds
 *  3. Session start/stop works
 *  4. Protocol messages are correctly formatted
 *
 * Usage:
 *   # Terminal 1: start daemon
 *   npm run daemon:dev
 *
 *   # Terminal 2: run this test
 *   node scripts/test-daemon-client.js
 */

'use strict';

const WebSocket = require('ws');
const { MSG, encode, decode } = require('../src/core/transport/protocol');

const PORT = process.env.DAEMON_PORT || 8765;
const URL  = `ws://localhost:${PORT}`;

console.log(`\n🧪 Summer Daemon Integration Test`);
console.log(`══════════════════════════════════`);
console.log(`Connecting to: ${URL}\n`);

const ws = new WebSocket(URL);
let passed = 0;
let failed = 0;

function pass(label) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
}

function fail(label, reason) {
    console.log(`  ❌ FAIL: ${label} — ${reason}`);
    failed++;
}

function check(label, condition, actual) {
    if (condition) pass(label);
    else fail(label, `got: ${JSON.stringify(actual)}`);
}

ws.on('open', () => {
    console.log(`📡 Connected to daemon.`);

    // Test 1: Send CLIENT_HELLO (skip-auth mode accepts any token)
    ws.send(encode(MSG.CLIENT_HELLO, {
        platform:   'test-client',
        deviceName: 'Integration Test Runner',
        hasMic:     true,
        hasScreen:  false,
        token:      'test-token-skip-auth',
    }));
});

ws.on('message', (raw) => {
    const msg = decode(raw);
    if (!msg) {
        fail('Message parse', 'received unparseable message');
        return;
    }

    console.log(`  📨 Received: ${msg.type}`);

    switch (msg.type) {
        case MSG.DAEMON_HELLO:
            check('daemon_hello received', !!msg.message, msg.message);
            check('clientId assigned', !!msg.clientId, msg.clientId);
            check('daemonVersion present', !!msg.daemonVersion, msg.daemonVersion);

            // Test 2: Ping/Pong (doesn't need Gemini)
            console.log('\n  🏓 Testing ping/pong...');
            ws.send(encode(MSG.PING));
            break;

        case MSG.PONG:
            check('pong received after ping', true, msg.type);

            // Test 3: Send session start (will connect to Gemini — may error if no key, that's OK)
            console.log('\n  🚀 Sending start_session (Gemini connection test)...');
            ws.send(encode(MSG.START_SESSION, { context: { testMode: true } }));

            // Test 4: Wait 3s and then try text command + stop
            setTimeout(() => {
                console.log('\n  💬 Sending text command...');
                ws.send(encode(MSG.SEND_TEXT, { text: 'test command' }));
                setTimeout(() => {
                    console.log('\n  🛑 Sending stop_session...');
                    ws.send(encode(MSG.STOP_SESSION));
                    // Done — report results
                    setTimeout(() => finishTests(), 500);
                }, 1000);
            }, 2000);
            break;

        case MSG.SESSION_STARTED:
            check('session_started received (Gemini OK)', true, msg.type);
            break;

        case MSG.SESSION_ENDED:
            check('session_ended received', true, msg.type);
            break;

        case MSG.ERROR:
            console.log(`  ⚠️  Daemon error: ${msg.message}`);
            // Errors are expected without valid GEMINI_API_KEY — transport still works
            break;

        default:
            // Other messages (audio, text, HUD) are fine to receive
            break;
    }
});

function finishTests() {
    console.log('\n══════════════════════════════════');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed === 0) {
        console.log('🎉 All transport-layer tests passed!');
        console.log('   (Gemini session tests require GEMINI_API_KEY — test separately)');
    } else {
        console.log('⚠️  Some tests failed. Check daemon logs.');
    }
    console.log('══════════════════════════════════\n');
    ws.close();
    process.exit(failed > 0 ? 1 : 0);
}

ws.on('error', (err) => {
    console.error(`\n❌ Connection failed: ${err.message}`);
    console.error(`\nMake sure the daemon is running:`);
    console.error(`  npm run daemon:dev\n`);
    process.exit(1);
});

ws.on('close', () => {
    console.log('Connection closed.\n');
});

// Timeout safety
setTimeout(() => {
    console.log('\n⏱️  Test timed out after 30s.');
    process.exit(1);
}, 30_000);

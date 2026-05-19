__cjsRegister('renderer/ui/wake-word-ui.js', function (module, exports, require) {
let _deps = {};

function initWakeWord(deps) {
    _deps = deps;

    // ── Wake Word: Auto-connect on detection ──
    window.liveAPI.onWakeWordDetected(async ({ score }) => {
        if (_deps.getIsConnected() || _deps.getIsConnecting()) return; // Already in an active session or connecting

        console.log(`🎤 Wake word detected in renderer! Score: ${score.toFixed(4)}`);
        _deps.setIsConnecting(true);

        // Activation feedback: chime + orb pulse
        playWakeChime();
        const orbContainer = document.querySelector('.orb-container');
        if (orbContainer) {
            orbContainer.classList.add('wake-pulse');
            setTimeout(() => orbContainer.classList.remove('wake-pulse'), 800);
        }

        // Update indicator
        setWakeWordIndicator('paused');

        _deps.setUserDisconnected(false);
        _deps.setOrbState('thinking', 'Waking up...');
        _deps.clearAllText();

        // Build context (same pipeline as orb click)
        const contextPayload = await _deps.buildContextPayload() || {};

        _deps.setOrbState('thinking', 'Connecting to Gemini...');
        _deps.setLastContextPayload(contextPayload);
        window.liveAPI.startSession(contextPayload);

        // Reset connecting state after a safe margin if connection fails
        setTimeout(() => { _deps.setIsConnecting(false); }, 5000);
    });
}

// ── Wake Word: Activation Chime (Custom MP3) ──
function playWakeChime() {
    try {
        const audio = new Audio('../47313572-startup-sound-variation-6-316850.mp3');
        audio.volume = 0.5;
        audio.play().catch(e => console.error('Failed to play wake sound:', e));
    } catch (e) {
        console.error('Wake chime error:', e);
    }
}

// ── Wake Word: Indicator Dot State Management ──
function setWakeWordIndicator(state) {
    const dot = document.getElementById('wakeWordIndicator');
    if (!dot) return;
    if (state === 'listening') {
        dot.classList.remove('paused');
        dot.title = 'Wake Word: Listening';
    } else if (state === 'paused') {
        dot.classList.add('paused');
        dot.title = 'Wake Word: Paused (session active)';
    } else if (state === 'hidden') {
        dot.style.display = 'none';
    }
}

module.exports = { playWakeChime, setWakeWordIndicator, initWakeWord };
});

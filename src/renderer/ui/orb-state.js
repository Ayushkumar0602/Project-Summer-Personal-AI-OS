__cjsRegister('renderer/ui/orb-state.js', function (module, exports, require) {
// --- 2. UI State Management ---
const orb = document.getElementById('orb');
const statusText = document.getElementById('statusText');
const subtitleText = document.getElementById('subtitleText');
const userTextElement = document.getElementById('userText');
let isConnected = false;
let userDisconnected = false;
let autoReconnectTimer = null;
let pendingTextTimeouts = [];

let _audioQueue = null;

function initOrbStateDeps(deps) {
    _audioQueue = deps.audioQueue;
}

function setOrbState(state, text) {
    if (orb) orb.className = `state-${state}`; // Removed 'orb' class since we changed HTML
    if (text && statusText) statusText.innerText = text;
    if (window.visualizer) {
        window.visualizer.setState(state);
    }
}

function updateSubtitle(text) {
    if (subtitleText) {
        const delay = (_audioQueue.nextStartTime - _audioQueue.audioCtx.currentTime) * 1000;
        const displayDelay = Math.max(0, delay);
        
        const timeout = setTimeout(() => {
            subtitleText.innerText += text;
            subtitleText.scrollTop = subtitleText.scrollHeight;
        }, displayDelay);
        
        pendingTextTimeouts.push(timeout);
    }
}

function updateUserSubtitle(text) {
    if (userTextElement) {
        userTextElement.innerText += text;
        userTextElement.scrollTop = userTextElement.scrollHeight;
    }
}

function clearPendingTimeouts() {
    pendingTextTimeouts.forEach(clearTimeout);
    pendingTextTimeouts = [];
}

function clearAllText() {
    if (subtitleText) subtitleText.innerText = "";
    if (userTextElement) userTextElement.innerText = "";
    const floatingTool = document.getElementById('floatingToolStatus');
    if (floatingTool) {
        floatingTool.innerText = '';
        floatingTool.style.display = 'none';
        floatingTool.classList.remove('dissolve-out');
    }
    clearPendingTimeouts();
}

function getIsConnected() { return isConnected; }
function setIsConnected(val) { isConnected = val; }
function getUserDisconnected() { return userDisconnected; }
function setUserDisconnected(val) { userDisconnected = val; }
function getAutoReconnectTimer() { return autoReconnectTimer; }
function setAutoReconnectTimer(val) { autoReconnectTimer = val; }

module.exports = {
    setOrbState,
    updateSubtitle,
    updateUserSubtitle,
    clearPendingTimeouts,
    clearAllText,
    getIsConnected,
    setIsConnected,
    getUserDisconnected,
    setUserDisconnected,
    getAutoReconnectTimer,
    setAutoReconnectTimer,
    initOrbStateDeps,
};
});

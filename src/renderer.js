// --- 1. Audio Queue Manager (for playing Gemini's voice) ---
class AudioQueue {
    constructor() {
        this.queue = [];
        this.isPlaying = false;
        // Gemini returns 24kHz PCM audio
        this.sampleRate = 24000;
        this.audioCtx = null;
        this.nextStartTime = 0;
        this.activeSources = [];
    }

    init() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.sampleRate });
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.connect(this.audioCtx.destination);
            
            // Loop to send data to visualizer
            const updateVisuals = () => {
                requestAnimationFrame(updateVisuals);
                if (this.isPlaying && window.visualizer) {
                    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                    this.analyser.getByteFrequencyData(dataArray);
                    window.visualizer.updateAudioData(dataArray);
                }
            };
            updateVisuals();
        }
    }

    addAudioData(base64String) {
        this.init();
        try {
            // Decode base64 to Int16Array
            const binaryString = window.atob(base64String);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const int16Array = new Int16Array(bytes.buffer);
            
            // Convert Int16Array to Float32Array for AudioBuffer
            const float32Array = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                float32Array[i] = int16Array[i] / 32768.0;
            }

            const audioBuffer = this.audioCtx.createBuffer(1, float32Array.length, this.sampleRate);
            audioBuffer.getChannelData(0).set(float32Array);
            
            this.queue.push(audioBuffer);
            this.playNext();
        } catch (e) {
            console.error("Audio decode error:", e);
        }
    }

    playNext() {
        if (this.queue.length === 0) return;

        if (!this.isPlaying) {
            this.isPlaying = true;
            setOrbState('speaking', 'Agent is Speaking...');
            this.nextStartTime = this.audioCtx.currentTime; // Start scheduling from now
        }

        // Dequeue and schedule all available buffers
        while (this.queue.length > 0) {
            const audioBuffer = this.queue.shift();
            const source = this.audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.analyser);
            
            // If nextStartTime fell behind due to lag, reset it to now
            if (this.nextStartTime < this.audioCtx.currentTime) {
                this.nextStartTime = this.audioCtx.currentTime;
            }

            source.start(this.nextStartTime);
            this.nextStartTime += audioBuffer.duration;
            this.activeSources.push(source);

            // Only hook up onended for the LAST chunk currently scheduled to know when we are done
            source.onended = () => {
                const idx = this.activeSources.indexOf(source);
                if (idx > -1) this.activeSources.splice(idx, 1);

                // If this source ended and it was the last one (time passed nextStartTime), we are done speaking
                if (this.audioCtx.currentTime >= this.nextStartTime - 0.05) {
                    this.isPlaying = false;
                    if (isConnected) setOrbState('listening', 'Listening...');
                }
            };
        }
    }

    clear() {
        this.queue = [];
        this.isPlaying = false;
        this.nextStartTime = 0;
        
        // Correctly stop all currently scheduled audio sources
        for (const source of this.activeSources) {
            try { source.stop(); } catch (e) {}
        }
        this.activeSources = [];
    }
}
const audioQueue = new AudioQueue();

// --- 2. UI State Management ---
const orb = document.getElementById('orb');
const statusText = document.getElementById('statusText');
const subtitleText = document.getElementById('subtitleText');
const userTextElement = document.getElementById('userText');
let isConnected = false;
let userDisconnected = false;
let autoReconnectTimer = null;
let lastContextPayload = null;
let pendingTextTimeouts = [];

function setOrbState(state, text) {
    if (orb) orb.className = `state-${state}`; // Removed 'orb' class since we changed HTML
    if (text && statusText) statusText.innerText = text;
    if (window.visualizer) {
        window.visualizer.setState(state);
    }
}

function updateSubtitle(text) {
    if (subtitleText) {
        const delay = (audioQueue.nextStartTime - audioQueue.audioCtx.currentTime) * 1000;
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

let selectedContinueDiary = null;

// Shared context builder used by both orb-click and wake-word activation
async function buildContextPayload() {
    let contextPayload = null;
    try {
        setOrbState('thinking', 'Locating...');
        const ipRes = await fetch('http://ip-api.com/json/');
        const ipData = await ipRes.json();
        const lat = ipData.lat;
        const lon = ipData.lon;
        const city = ipData.city;
        
        if (lat && lon) {
            setOrbState('thinking', 'Checking weather...');
            const apiKey = 'AIzaSyCfF0iZYvUiF_rB6DSKHAKwW0XYF5D3umQ';
            const res = await fetch(`https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=${lat}&location.longitude=${lon}&key=${apiKey}`);
            const data = await res.json();
            
            if (data.weatherCondition) {
                const temp = data.temperature?.degrees;
                const condition = data.weatherCondition?.description?.text;
                const time = new Date().toLocaleString();
                contextPayload = {
                    weatherContext: `User Location: ${city} (${lat}, ${lon})\nCurrent Local Time: ${time}\nCurrent Weather: ${temp}°C, ${condition}`
                };
            }
        }
    } catch (err) {
        console.error("Failed to fetch context:", err);
    }
    if (selectedContinueDiary) {
        if (!contextPayload) contextPayload = {};
        contextPayload.continueDiary = selectedContinueDiary;
        console.log("Continuing past session:", selectedContinueDiary.date);
    }

    setOrbState('thinking', 'Checking Google schedule...');
    try {
        const googleCtx = await window.liveAPI.getGoogleContext();
        if (googleCtx) {
            if (!contextPayload) contextPayload = {};
            contextPayload.googleContext = googleCtx;
        }
    } catch (e) {
        console.error("Failed to fetch Google context:", e);
    }

    return contextPayload;
}

// Click orb to toggle session
document.querySelector('.orb-container').addEventListener('click', async () => {
    if (isConnected) {
        userDisconnected = true;
        if (autoReconnectTimer) clearTimeout(autoReconnectTimer);
        window.liveAPI.stopSession();
        stopRecording();
        isConnected = false;
        setOrbState('idle', 'Click Orb to Connect');
        clearAllText();
        selectedContinueDiary = null; // reset on stop
        setWakeWordIndicator('listening');
    } else {
        userDisconnected = false;
        setOrbState('thinking', 'Connecting to Gemini...');
        clearAllText();
        
        const contextPayload = await buildContextPayload();

        setOrbState('thinking', 'Connecting to Gemini...');
        lastContextPayload = contextPayload;
        window.liveAPI.startSession(contextPayload);
    }
});

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

// ── Wake Word: Auto-connect on detection ──
window.liveAPI.onWakeWordDetected(async ({ score }) => {
    if (isConnected) return; // Already in an active session

    console.log(`🎤 Wake word detected in renderer! Score: ${score.toFixed(4)}`);
    
    // Activation feedback: chime + orb pulse
    playWakeChime();
    const orbContainer = document.querySelector('.orb-container');
    if (orbContainer) {
        orbContainer.classList.add('wake-pulse');
        setTimeout(() => orbContainer.classList.remove('wake-pulse'), 800);
    }

    // Update indicator
    setWakeWordIndicator('paused');

    userDisconnected = false;
    setOrbState('thinking', 'Waking up...');
    clearAllText();

    // Build context (same pipeline as orb click)
    const contextPayload = await buildContextPayload() || {};

    setOrbState('thinking', 'Connecting to Gemini...');
    lastContextPayload = contextPayload;
    window.liveAPI.startSession(contextPayload);
});


// --- 3. Microphone Recording & VAD ---
let stream = null;
let inputAudioCtx = null;
let processor = null;

let silenceTimer = null;
let isSpeakingToAgent = false;
let consecutiveVoiceBuffers = 0;

// ── Enhanced VAD: Adaptive noise floor & ZCR for music rejection ──
let vadNoiseFloor = 0.01;
const VAD_ALPHA = 0.02; // Slow noise floor adaptation

function updateVadNoiseFloor(rms) {
    if (rms < vadNoiseFloor * 3 && rms > 0.0001) {
        vadNoiseFloor = VAD_ALPHA * rms + (1 - VAD_ALPHA) * vadNoiseFloor;
    }
    vadNoiseFloor = Math.max(0.002, Math.min(0.05, vadNoiseFloor));
}

function zeroCrossingRate(samples) {
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
        if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings++;
    }
    return crossings / samples.length;
}

async function startRecording() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
            } 
        });
        
        // Gemini expects 16kHz audio
        inputAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const source = inputAudioCtx.createMediaStreamSource(stream);
        
        processor = inputAudioCtx.createScriptProcessor(4096, 1, 1);
        
        processor.onaudioprocess = (e) => {
            if (!isConnected) return;
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Convert Float32 to Int16 and calculate RMS
            const pcm16 = new Int16Array(inputData.length);
            let sumSquares = 0;
            
            for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                sumSquares += s * s;
            }
            
            const rms = Math.sqrt(sumSquares / inputData.length);
            updateVadNoiseFloor(rms);

            // ── Enhanced VAD: Energy + ZCR check ──
            // Energy must be well above adaptive noise floor
            const energyOk = rms > vadNoiseFloor * 4;
            // ZCR must be in speech range (0.02–0.18) to reject music/pure tones
            const zcr = zeroCrossingRate(inputData);
            const zcrOk = zcr > 0.02 && zcr < 0.18;
            // Combined: only treat as voice if both energy AND ZCR indicate speech
            const hasVoice = energyOk && zcrOk;
            
            // Feed mic data to visualizer if listening
            if (window.visualizer && !audioQueue.isPlaying) {
                // Map the float array to 0-255 uint8 format for visualizer
                const dataArray = new Uint8Array(inputData.length / 32); // Sample down
                for(let i=0; i<dataArray.length; i++) {
                    dataArray[i] = Math.abs(inputData[i*32]) * 255 * 5; // boost slightly
                }
                window.visualizer.updateAudioData(dataArray);
            }
            
            // --- Voice Activity Detection (VAD) Logic ---
            if (hasVoice) {
                consecutiveVoiceBuffers++;
                isSpeakingToAgent = true;
                if (silenceTimer) clearTimeout(silenceTimer);
                
                // Barge-in: if they speak while agent is playing, stop agent
                // Only interrupt if they've spoken for at least 2 consecutive buffers (~500ms at 16kHz)
                // or if it's exceptionally loud (RMS > 0.15)
                if (audioQueue.isPlaying && (consecutiveVoiceBuffers > 1 || rms > 0.15)) {
                    audioQueue.clear();
                    clearPendingTimeouts();
                    setOrbState('listening', 'Listening...');
                }
            } else {
                consecutiveVoiceBuffers = 0;
                if (isSpeakingToAgent) {
                    // If they were speaking but now silent, start 1s timer to send turnComplete
                    if (!silenceTimer) {
                        silenceTimer = setTimeout(() => {
                            isSpeakingToAgent = false;
                            window.liveAPI.sendTurnComplete();
                            setOrbState('thinking', 'Thinking...');
                            silenceTimer = null;
                        }, 1000); // 1 second of silence triggers generation
                    }
                }
            }

            // Convert Int16Array to Base64
            const uint8Array = new Uint8Array(pcm16.buffer);
            let binary = '';
            for (let i = 0; i < uint8Array.byteLength; i++) {
                binary += String.fromCharCode(uint8Array[i]);
            }
            const base64Audio = window.btoa(binary);
            
            window.liveAPI.sendAudioChunk(base64Audio);
        };

        source.connect(processor);
        processor.connect(inputAudioCtx.destination);
    } catch (err) {
        console.error("Mic error:", err);
        setOrbState('idle', 'Microphone Error');
        isConnected = false;
    }
}

function stopRecording() {
    if (processor) processor.disconnect();
    if (inputAudioCtx && inputAudioCtx.state !== 'closed') inputAudioCtx.close();
    if (stream) stream.getTracks().forEach(t => t.stop());
}

// --- 4. Incoming IPC from Main (Gemini Voice) ---
window.liveAPI.onSessionStarted(() => {
    isConnected = true;
    setOrbState('listening', 'Listening...');
    startRecording();

    // The Good Morning / Startup Choreography
    setTimeout(() => {
        if (hudManager) {
            hudManager.showWidget('welcome', { message: 'SYSTEM ONLINE: Awaiting commands...' }, false);
            
            if (lastContextPayload) {
                setTimeout(() => {
                    if (lastContextPayload.weatherContext) {
                        hudManager.showWidget('weather', {
                            temp: lastContextPayload.weatherContext.match(/(-?\d+(?:\.\d+)?)°C/)?.[1] || '--',
                            condition: lastContextPayload.weatherContext.match(/°C, (.*)/)?.[1] || 'Unknown',
                            location: lastContextPayload.weatherContext.match(/User Location: ([^\(]+)/)?.[1] || 'Unknown'
                        }, true); // Append
                    }
                }, 1500);

                setTimeout(() => {
                    if (lastContextPayload.googleContext) {
                        // Just show a generic schedule widget if google context exists for now
                        hudManager.showWidget('calendar', [{ summary: 'Synced with Google', timeStr: 'Active' }], true);
                    }
                }, 3000);
            }
        }
    }, 500);
});

window.liveAPI.onSessionEnded(() => {
    if (userDisconnected) {
        isConnected = false;
        setOrbState('idle', 'Click Orb to Connect');
        stopRecording();
        audioQueue.clear();
        setWakeWordIndicator('listening');
    } else {
        console.log("Session disconnected unexpectedly. Auto-reconnecting...");
        setOrbState('thinking', 'Reconnecting...');
        stopRecording();
        audioQueue.clear();
        autoReconnectTimer = setTimeout(() => {
            const reconnectPayload = lastContextPayload ? { ...lastContextPayload, isAutoReconnect: true } : { isAutoReconnect: true };
            window.liveAPI.startSession(reconnectPayload);
        }, 1500);
    }
});

window.liveAPI.onAgentAudio((base64Audio) => {
    audioQueue.addAudioData(base64Audio);
});

window.liveAPI.onAgentText((text) => {
    updateSubtitle(text);
});

window.liveAPI.onUserText((text) => {
    updateUserSubtitle(text);
});

window.liveAPI.onAgentTurnComplete(() => {
    console.log("Agent finished turn.");
});

window.liveAPI.onAgentInterrupted(() => {
    audioQueue.clear();
    setOrbState('listening', 'Listening...');
});

window.liveAPI.onError((err) => {
    console.error("Agent Error:", err);
    setOrbState('idle', 'Error Connecting');
    isConnected = false;
    stopRecording();
});




// Initial Setup
setOrbState('idle', 'Click to Activate');

// ========== Mini Browser Controls ==========
let webview = document.getElementById('miniBrowser');
const browserViewport = document.getElementById('browserViewport');
const browserTabsBar = document.getElementById('browserTabsBar');
const urlInput      = document.getElementById('browserUrlInput');
const goBtn         = document.getElementById('browserGoBtn');
const backBtn       = document.getElementById('browserBackBtn');
const reloadBtn     = document.getElementById('browserReloadBtn');
const browserStatus = document.getElementById('browserStatus');
const browserOverlay = document.getElementById('browserOverlay');

let tabs = [{ id: 'tab-1', wv: webview, title: 'Main' }];
let activeTabId = 'tab-1';
let tabCounter = 1;

function updateTabsUI() {
    browserTabsBar.innerHTML = '';
    tabs.forEach(tab => {
        const t = document.createElement('div');
        t.className = 'browser-tab' + (tab.id === activeTabId ? ' active' : '');
        t.innerHTML = `<span class="tab-title">${tab.title}</span><span class="tab-close">×</span>`;
        
        t.querySelector('.tab-title').addEventListener('click', () => switchTab(tab.id));
        t.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tab.id);
        });
        browserTabsBar.appendChild(t);
    });
}

function switchTab(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    // Hide all webviews
    tabs.forEach(t => { t.wv.style.display = 'none'; });
    
    // Show active
    tab.wv.style.display = 'flex';
    webview = tab.wv;
    activeTabId = tabId;
    
    try { urlInput.value = typeof webview.getURL === 'function' ? webview.getURL() : ''; } catch(e) { urlInput.value = ''; }
    try { browserStatus.textContent = typeof webview.getTitle === 'function' ? webview.getTitle() : 'Ready'; } catch(e) { browserStatus.textContent = 'Ready'; }
    updateTabsUI();
}

function closeTab(tabId) {
    if (tabs.length === 1) {
        navigateBrowser('about:blank');
        return;
    }
    
    const index = tabs.findIndex(t => t.id === tabId);
    const tab = tabs[index];
    tab.wv.remove();
    tabs.splice(index, 1);
    
    if (activeTabId === tabId) {
        switchTab(tabs[Math.max(0, index - 1)].id);
    } else {
        updateTabsUI();
    }
}

function attachWebviewEvents(wv, tabId) {
    wv.addEventListener('did-start-loading',  () => { if(activeTabId===tabId) browserStatus.textContent = 'Loading...'; });
    wv.addEventListener('did-stop-loading',   () => { if(activeTabId===tabId) browserStatus.textContent = 'Ready'; });
    wv.addEventListener('did-navigate',       (e) => { if (e.isMainFrame && activeTabId===tabId) urlInput.value = e.url; });
    wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame && activeTabId===tabId) urlInput.value = e.url; });
    wv.addEventListener('page-title-updated', (e) => { 
        const tab = tabs.find(t => t.id === tabId);
        if (tab) { tab.title = e.title; updateTabsUI(); }
        if (activeTabId===tabId) browserStatus.textContent = e.title; 
    });
    wv.addEventListener('did-fail-load',      ()  => { if(activeTabId===tabId) browserStatus.textContent = 'Failed to load'; });
    
    wv.addEventListener('new-window', (e) => {
        e.preventDefault();
        const { newWv, newTabId } = createNewTab('Loading...');
        
        // This connects the window.opener correctly for Google Login/OAuth
        if (e.newGuest) {
            e.newGuest = newWv;
        } else {
            newWv.src = e.url;
        }
        
        switchTab(newTabId);
    });
}

function createNewTab(title = 'New Tab') {
    tabCounter++;
    const newTabId = 'tab-' + tabCounter;
    
    const newWv = document.createElement('webview');
    newWv.setAttribute('allowpopups', 'true');
    newWv.className = 'mini-browser-webview';
    newWv.style.display = 'none';
    newWv.src = 'about:blank';
    browserViewport.appendChild(newWv);
    
    tabs.push({ id: newTabId, wv: newWv, title: title });
    attachWebviewEvents(newWv, newTabId);
    
    return { newWv, newTabId };
}

// Attach to initial
webview.setAttribute('allowpopups', 'true');
attachWebviewEvents(webview, 'tab-1');
updateTabsUI();

function navigateBrowser(url) {
    if (!url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://') && url !== 'about:blank') {
        url = 'https://' + url;
    }
    urlInput.value = url;
    browserOverlay.classList.add('hidden');
    webview.src = url;
    if (activeTabId === 'tab-1') browserStatus.textContent = 'Loading...';
}

goBtn.addEventListener('click', () => navigateBrowser(urlInput.value.trim()));
urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigateBrowser(urlInput.value.trim());
});
backBtn.addEventListener('click',   () => webview.canGoBack()    && webview.goBack());
reloadBtn.addEventListener('click', () => webview.reload());

// Full browser control execution — coordinate-based, no selector guessing
window.liveAPI.onBrowserControl(async (payload) => {
    const { id, action, args } = payload;
    let result = null;
    let error = null;

    try {
        // Helper to wait for DOM to settle after a click or type
        const waitForDOMSettle = async () => {
            const waitScript = `
                new Promise(resolve => {
                    let timeout = setTimeout(resolve, 800); // base wait
                    let maxWait = setTimeout(resolve, 3500); // hard max
                    const observer = new MutationObserver(() => {
                        clearTimeout(timeout);
                        timeout = setTimeout(() => {
                            observer.disconnect();
                            resolve();
                        }, 500);
                    });
                    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
                })
            `;
            await webview.executeJavaScript(waitScript);
        };

        if (action === 'toggle_browser') {
            const layout = document.getElementById('appLayout');
            if (args.visible) {
                layout.classList.remove('browser-hidden');
            } else {
                layout.classList.add('browser-hidden');
            }
            result = { status: "success", visible: args.visible };
        }

        else if (action === 'browser_navigate') {
            setOrbState('researching', 'Navigating...');
            navigateBrowser(args.url);
            await new Promise((resolve) => {
                const onLoaded = () => { webview.removeEventListener('did-stop-loading', onLoaded); resolve(); };
                webview.addEventListener('did-stop-loading', onLoaded);
                setTimeout(resolve, 12000); // safety timeout
            });
            result = { status: "navigated", url: (typeof webview.getURL === 'function' ? webview.getURL() : webview.src) };
        }

        else if (action === 'browser_read') {
            setOrbState('researching', 'Scanning page...');
            updateSubtitle('[🔍 Scanning page elements...]');
            const readScript = `
                (() => {
                    // Clear old tags
                    document.querySelectorAll('[data-ai-id]').forEach(el => el.removeAttribute('data-ai-id'));
                    
                    let id = 0;
                    const selectors = 'a, button, input, textarea, select, [role="button"], [onclick], summary, details, label, [contenteditable="true"]';
                    const allEls = Array.from(document.querySelectorAll(selectors));
                    const items = [];
                    
                    for (const el of allEls) {
                        const rect = el.getBoundingClientRect();
                        // Skip completely invisible items
                        if (rect.width < 5 || rect.height < 5) continue;
                        
                        // Break if we hit max elements to prevent token bloat
                        if (items.length >= 120) break;
                        
                        id++;
                        el.setAttribute('data-ai-id', String(id));
                        
                        const tag = el.tagName.toLowerCase();
                        const type = el.type || '';
                        let label = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.title || '').trim();
                        label = label.replace(/\\n/g, ' ').substring(0, 60);
                        
                        let desc = '[' + id + '] ' + tag;
                        if (type) desc += '(' + type + ')';
                        if (label) desc += ' "' + label + '"';
                        if (el.href) desc += ' -> ' + el.href.substring(0, 80);
                        
                        // Add context if off-screen
                        if (rect.top > window.innerHeight || rect.bottom < 0) {
                            desc += ' (off-screen)';
                        }
                        
                        items.push(desc);
                    }
                    
                    const pageTitle = document.title || '';
                    const pageUrl = window.location.href;
                    const bodyText = document.body.innerText.substring(0, 3000).replace(/\\n{3,}/g, '\\n\\n');
                    
                    return JSON.stringify({
                        title: pageTitle,
                        url: pageUrl,
                        elements: items,
                        text: bodyText
                    });
                })();
            `;
            const raw = await webview.executeJavaScript(readScript);
            result = JSON.parse(raw);
            result.activeTabId = activeTabId;
            result.openTabs = tabs.map(t => ({ id: t.id, title: t.title }));
        }

        else if (action === 'browser_click') {
            const eid = String(args.elementId);
            setOrbState('researching', 'Clicking [' + eid + ']...');
            updateSubtitle('[🖱️ Clicking element ' + eid + ']');
            const clickScript = `
                (() => {
                    const el = document.querySelector('[data-ai-id="' + ${JSON.stringify(eid)} + '"]');
                    if (!el) return JSON.stringify({ error: 'Element [' + ${JSON.stringify(eid)} + '] not found. Call browser_read first.' });
                    
                    const rect = el.getBoundingClientRect();
                    const x = rect.left + rect.width / 2;
                    const y = rect.top + rect.height / 2;
                    
                    // Scroll into view if needed
                    el.scrollIntoView({ block: 'center', behavior: 'instant' });
                    
                    // Dispatch full mouse event sequence at exact coordinates
                    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
                    el.dispatchEvent(new MouseEvent('mouseover', opts));
                    el.dispatchEvent(new MouseEvent('mousedown', opts));
                    el.dispatchEvent(new MouseEvent('mouseup', opts));
                    el.dispatchEvent(new MouseEvent('click', opts));
                    
                    // Also try .click() as fallback for framework components
                    try { el.click(); } catch(e) {}
                    
                    const label = (el.innerText || el.value || '').trim().substring(0, 40);
                    return JSON.stringify({ status: 'clicked', element: label, tag: el.tagName });
                })();
            `;
            const raw = await webview.executeJavaScript(clickScript);
            result = JSON.parse(raw);
            if (result.error) throw new Error(result.error);
            
            // Wait for DOM to settle instead of static timeout
            await waitForDOMSettle();
        }

        else if (action === 'browser_hover') {
            const eid = String(args.elementId);
            setOrbState('researching', 'Hovering [' + eid + ']...');
            updateSubtitle('[🖱️ Hovering element ' + eid + ']');
            const hoverScript = `
                (() => {
                    const el = document.querySelector('[data-ai-id="' + ${JSON.stringify(eid)} + '"]');
                    if (!el) return JSON.stringify({ error: 'Element [' + ${JSON.stringify(eid)} + '] not found. Call browser_read first.' });
                    
                    const rect = el.getBoundingClientRect();
                    const x = rect.left + rect.width / 2;
                    const y = rect.top + rect.height / 2;
                    
                    el.scrollIntoView({ block: 'center', behavior: 'instant' });
                    
                    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
                    el.dispatchEvent(new MouseEvent('mouseover', opts));
                    el.dispatchEvent(new MouseEvent('mouseenter', opts));
                    el.dispatchEvent(new MouseEvent('mousemove', opts));
                    
                    return JSON.stringify({ status: 'hovered', tag: el.tagName });
                })();
            `;
            const raw = await webview.executeJavaScript(hoverScript);
            result = JSON.parse(raw);
            if (result.error) throw new Error(result.error);
            
            await waitForDOMSettle();
        }

        else if (action === 'browser_type') {
            const eid = String(args.elementId);
            const text = args.text || '';
            setOrbState('researching', 'Typing...');
            updateSubtitle('[⌨️ Typing into element ' + eid + ']');
            const typeScript = `
                (() => {
                    const el = document.querySelector('[data-ai-id="' + ${JSON.stringify(eid)} + '"]');
                    if (!el) return JSON.stringify({ error: 'Element [' + ${JSON.stringify(eid)} + '] not found. Call browser_read first.' });
                    
                    el.scrollIntoView({ block: 'center', behavior: 'instant' });
                    el.focus();
                    
                    const isContentEditable = el.isContentEditable || el.hasAttribute('contenteditable');
                    const shouldAppend = ${args.append === true};
                    
                    // Clear existing value if not appending
                    if (!shouldAppend) {
                        if (isContentEditable) el.innerText = '';
                        else el.value = '';
                    }
                    
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    
                    // Type character by character for maximum compatibility
                    const text = ${JSON.stringify(text)};
                    for (const ch of text) {
                        if (isContentEditable) el.innerText += ch;
                        else el.value += ch;
                        
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
                        el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
                        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
                    }
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    return JSON.stringify({ status: 'typed', text: text, tag: el.tagName });
                })();
            `;
            const raw = await webview.executeJavaScript(typeScript);
            result = JSON.parse(raw);
            if (result.error) throw new Error(result.error);
            await waitForDOMSettle();
        }

        else if (action === 'browser_submit') {
            const eid = String(args.elementId);
            setOrbState('researching', 'Submitting...');
            updateSubtitle('[⏎ Pressing Enter on element ' + eid + ']');
            const submitScript = `
                (() => {
                    const el = document.querySelector('[data-ai-id="' + ${JSON.stringify(eid)} + '"]');
                    if (!el) return JSON.stringify({ error: 'Element not found' });
                    
                    el.focus();
                    const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                    el.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
                    el.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
                    el.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
                    
                    // Also try submitting parent form
                    const form = el.closest('form');
                    if (form) { try { form.submit(); } catch(e) {} }
                    
                    return JSON.stringify({ status: 'submitted' });
                })();
            `;
            const raw = await webview.executeJavaScript(submitScript);
            result = JSON.parse(raw);
            if (result.error) throw new Error(result.error);
            
            await waitForDOMSettle();
        }

        else if (action === 'browser_scroll') {
            setOrbState('researching', 'Scrolling ' + args.direction + '...');
            const pixels = args.pixels || 600;
            const dirMultiplier = args.direction === 'down' ? 1 : -1;
            await webview.executeJavaScript(`
                window.scrollBy({ top: ${pixels} * ${dirMultiplier}, behavior: 'smooth' });
            `);
            result = { status: "scrolled", direction: args.direction, pixels: pixels };
            await waitForDOMSettle();
        }

        else if (action === 'browser_switch_tab') {
            setOrbState('researching', 'Switching tab...');
            switchTab(args.tabId);
            result = { status: "tab_switched", activeTab: activeTabId };
        }

        else if (action === 'browser_open_tab') {
            setOrbState('researching', 'Opening new tab...');
            const { newTabId } = createNewTab('New Tab');
            switchTab(newTabId);
            if (args.url) {
                navigateBrowser(args.url);
                await new Promise((resolve) => {
                    const onLoaded = () => { webview.removeEventListener('did-stop-loading', onLoaded); resolve(); };
                    webview.addEventListener('did-stop-loading', onLoaded);
                    setTimeout(resolve, 12000); // safety timeout
                });
                result = { status: "tab_opened", activeTab: activeTabId, url: (typeof webview.getURL === 'function' ? webview.getURL() : webview.src) };
            } else {
                result = { status: "tab_opened", activeTab: activeTabId };
            }
        }

        else if (action === 'browser_close_tab') {
            setOrbState('researching', 'Closing tab...');
            closeTab(args.tabId);
            result = { status: "tab_closed", activeTab: activeTabId };
        }

    } catch (e) {
        error = e.message;
    }

    // Revert orb state
    if (!document.getElementById('orb').classList.contains('state-speaking')) {
        setOrbState('listening', 'Listening...');
    }

    window.liveAPI.sendBrowserReply({ id, result, error });
});

// --- Advanced Holographic HUD Engine ---
class WidgetManager {
    constructor() {
        this.zones = {
            'left': document.getElementById('hud-left-wing'),
            'right': document.getElementById('hud-right-wing'),
            'top': document.getElementById('hud-top'),
            'bottom': document.getElementById('hud-bottom-dock'),
            'weather': document.getElementById('hud-fixed-weather'),
            'schedule': document.getElementById('hud-fixed-schedule')
        };
        this.activeTimeouts = new Map();
    }

    drawNeuralLine(widget, color) {
        const svg = document.getElementById('neural-lines');
        if (!svg) return;
        
        // Slight delay to ensure widget is rendered and positioned
        setTimeout(() => {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const widgetRect = widget.getBoundingClientRect();
            
            // Start from center of screen (orb)
            const startX = window.innerWidth / 2;
            const startY = window.innerHeight / 2;
            
            // End at the edge of the widget
            const endX = widgetRect.left + (widgetRect.width / 2);
            const endY = widgetRect.top + (widgetRect.height / 2);
            
            // Create a techy bezier curve path instead of a straight line
            // C controlPoint1X controlPoint1Y, controlPoint2X controlPoint2Y, endX endY
            // We use the midpoint X for control points to create an elegant S-curve
            const midX = startX + (endX - startX) / 2;
            const d = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
            
            path.setAttribute('d', d);
            path.setAttribute('class', 'neural-path');
            path.setAttribute('stroke', color);
            path.id = `path-${widget.id}`;
            
            svg.appendChild(path);
        }, 50);
    }

    decryptText(element, finalString) {
        if (!finalString) return;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+<>?';
        let iterations = 0;
        
        const interval = setInterval(() => {
            element.innerText = finalString.split('').map((char, index) => {
                if (char === ' ') return ' ';
                if (index < iterations) return char;
                return chars[Math.floor(Math.random() * chars.length)];
            }).join('');
            
            iterations += 1/3; // Speed of decryption
            if (iterations >= finalString.length) {
                clearInterval(interval);
                element.innerText = finalString;
            }
        }, 20);
    }

    addTiltEffect(element) {
        element.addEventListener('mousemove', (e) => {
            const rect = element.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const rotateX = ((y - centerY) / centerY) * -10; // Max 10 deg
            const rotateY = ((x - centerX) / centerX) * 10;
            
            element.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
        });
        
        element.addEventListener('mouseleave', () => {
            element.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
        });
    }

    _buildAgentLogs(recentLogs, barColor) {
        let html = '';
        recentLogs.forEach((l, i) => {
            const isLast = i === recentLogs.length - 1;
            const opacity = isLast ? 1 : (0.3 + (i / recentLogs.length) * 0.4);
            const color = isLast ? '#ffffff' : '#94a3b8';
            const bullet = isLast ? `<span style="color:${barColor}; text-shadow: 0 0 8px ${barColor};">●</span>` : '○';
            html += `
                <div style="font-size: 13px; color: ${color}; opacity: ${opacity}; margin-bottom: 8px; display: flex; align-items: flex-start; gap: 10px; font-family: 'Inter', sans-serif; transition: all 0.3s ease;">
                    <div style="margin-top: 2px; font-size: 10px;">${bullet}</div>
                    <div style="line-height: 1.4; flex: 1;">${l.replace(/"/g, '&quot;')}</div>
                </div>
            `;
        });
        return html;
    }

    showWidget(type, data, append, width, height) {
        // Determine the spatial zone based on the widget type
        let zoneKey = 'right';
        if (type === 'welcome') zoneKey = 'top';
        else if (type === 'weather') zoneKey = 'weather';
        else if (type === 'calendar') zoneKey = 'schedule';
        else if (type === 'map' || type === 'sheet-data') zoneKey = 'right';
        else if (type === 'youtube') zoneKey = 'bottom';
        else if (type === 'mermaid' || type === 'image_gallery' || type === 'agent_progress') zoneKey = 'top';
        else if (type === 'news' || type === 'emails' || type === 'full-email') zoneKey = 'left';

        const container = this.zones[zoneKey];

        if (type === 'clear') {
            // Do NOT clear weather or schedule (persistent fixed widgets)
            ['left', 'right', 'top', 'bottom'].forEach(k => { if(this.zones[k]) this.zones[k].innerHTML = ''; });
            this.activeTimeouts.forEach(t => clearTimeout(t));
            this.activeTimeouts.clear();
            const svg = document.getElementById('neural-lines');
            if (svg) svg.innerHTML = '';
            return;
        }

        if (!append) {
            container.innerHTML = '';
        }

        const widgetId = 'widget-' + Date.now() + Math.random().toString(36).substr(2, 5);
        const widget = document.createElement('div');
        widget.className = 'hud-widget';
        widget.id = widgetId;
        
        if (width) widget.style.width = `${width}px`;
        if (height) widget.style.height = `${height}px`;

        let html = '';
        let headerText = '';

        if (type === 'calendar') {
            headerText = "📅 Today's Schedule";
            if (!data || data.length === 0) {
                html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="No events scheduled"></div></div>`;
            } else {
                data.forEach(ev => {
                    const title = ev.summary || 'Busy';
                    const time = ev.timeStr || 'All Day';
                    html += `
                    <div class="hud-item">
                        <div class="hud-item-title decrypt-target" data-text="${title.replace(/"/g, '&quot;')}"></div>
                        <div class="hud-item-meta decrypt-target" data-text="${time}"></div>
                    </div>`;
                });
            }
        } 
        else if (type === 'news') {
            headerText = "📰 Top Briefing";
            if (!data || data.length === 0) {
                html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="No news available"></div></div>`;
            } else {
                data.forEach(news => {
                    html += `
                    <div class="hud-item">
                        <div class="hud-item-title decrypt-target" data-text="${news.title.replace(/"/g, '&quot;')}"></div>
                        <div class="hud-item-meta decrypt-target" data-text="${news.source}"></div>
                    </div>`;
                });
            }
        }
        else if (type === 'weather') {
            headerText = "🌤️ Local Environment";
            html += `
            <div class="hud-item">
                <div class="hud-item-title decrypt-target" data-text="${data.temp || ''}°C - ${data.condition || ''}"></div>
                <div class="hud-item-meta decrypt-target" data-text="${data.location || ''}"></div>
            </div>`;
        }
        else if (type === 'welcome') {
             headerText = "SYSTEM ONLINE";
             html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="${data.message || 'Good morning, Sir.'}"></div></div>`;
        }
        else if (type === 'mermaid') {
            headerText = "📊 Workflow Diagram";
            
            // Generate HTML for each diagram in the data array
            const safeData = Array.isArray(data) ? data : (data ? [data] : []);
            html += `<div style="display: flex; flex-direction: row; flex-wrap: wrap; gap: 20px; justify-content: center; width: 100%;">`;
            safeData.forEach((item, index) => {
                const itemMermaidId = 'mermaid-' + widgetId + '-' + index;
                html += `
                <div class="hud-item" style="flex: 1 1 400px; background: rgba(255,255,255,0.05); min-height: 300px; display: flex; justify-content: center; align-items: center; overflow: auto; padding: 20px;">
                    <div id="${itemMermaidId}" style="width: 100%; height: 100%; display: flex; justify-content: center;"></div>
                </div>`;
            });
            html += `</div>`;
            
            // Render mermaid diagrams asynchronously
            setTimeout(async () => {
                mermaid.initialize({ startOnLoad: false, theme: 'dark' });
                for (let i = 0; i < safeData.length; i++) {
                    const item = safeData[i];
                    const itemMermaidId = 'mermaid-' + widgetId + '-' + i;
                    const mermaidEl = document.getElementById(itemMermaidId);
                    
                    let contentToRender = typeof item === 'string' ? item : (item.content || item.code || item.mermaid || '');
                    
                    // Strip markdown wrapping if the AI accidentally included it
                    if (contentToRender.includes('```')) {
                        contentToRender = contentToRender.replace(/```mermaid\n?/gi, '').replace(/```\n?/g, '').trim();
                    }

                    if (mermaidEl && contentToRender) {
                        try {
                            const { svg } = await mermaid.render('graph-' + widgetId + '-' + i, contentToRender);
                            mermaidEl.innerHTML = svg;
                        } catch (e) {
                            console.error('Mermaid render error:', e);
                            mermaidEl.innerHTML = `<div style="color:red; font-family: Inter, sans-serif;">Failed to render diagram</div>`;
                        }
                    }
                }
            }, 100);
        }
        else if (type === 'image_gallery') {
            headerText = data.title || '📸 Visual';
            zoneKey = 'top'; // Display in a wider top zone for slider
            const sliderId = 'slider-' + widgetId;
            const trackId = 'track-' + widgetId;
            const navId = 'nav-' + widgetId;
            
            html += `
            <div class="hud-image-slider" id="${sliderId}">
                <div class="hud-slider-track" id="${trackId}"></div>
                <div class="hud-slider-nav" id="${navId}"></div>
            </div>`;

            // Async load images after widget is in the DOM
            const loadImages = async () => {
                const track = document.getElementById(trackId);
                const nav = document.getElementById(navId);
                if (!track || !nav) return;
                
                let slideIndex = 0;
                let numSlides = 0;

                for (let i = 0; i < (data.images || []).length; i++) {
                    const img = data.images[i];
                    const slideEl = document.createElement('div');
                    slideEl.className = 'hud-slider-slide';
                    
                    const imgEl = document.createElement('img');
                    imgEl.className = 'hud-memory-thumb';
                    imgEl.title = img.label || '';
                    imgEl.alt = img.label || '';

                    if (img.source === 'memory' && img.filename) {
                        try {
                            const dataUrl = await window.liveAPI.readLocalImage(img.filename);
                            if (dataUrl) imgEl.src = dataUrl;
                        } catch (e) { /* silent */ }
                    } else if (img.url) {
                        imgEl.src = img.url;
                    }
                    
                    imgEl.onerror = () => {
                        imgEl.style.display = 'none';
                        const err = document.createElement('div');
                        err.style.color = '#ef4444';
                        err.style.padding = '20px';
                        err.style.textAlign = 'center';
                        err.style.fontSize = '12px';
                        err.textContent = '⚠️ Image unavailable (404)';
                        slideEl.insertBefore(err, imgEl);
                    };
                    
                    slideEl.appendChild(imgEl);

                    if (img.credit || img.label) {
                        const credit = document.createElement('div');
                        credit.className = 'hud-img-credit';
                        credit.textContent = img.credit || img.label;
                        slideEl.appendChild(credit);
                    }

                    // Click to expand fullscreen
                    imgEl.addEventListener('click', () => {
                        const overlay = document.getElementById('imgFullscreenOverlay');
                        const fullImg = document.getElementById('imgFullscreenEl');
                        if (overlay && fullImg) {
                            fullImg.src = img.fullUrl || img.url || imgEl.src;
                            overlay.style.display = 'flex';
                        }
                    });

                    track.appendChild(slideEl);
                    
                    // Add dot
                    const dot = document.createElement('div');
                    dot.className = i === 0 ? 'slider-dot active' : 'slider-dot';
                    dot.addEventListener('click', () => goToSlide(i));
                    nav.appendChild(dot);
                    numSlides++;
                }
                
                // Slider logic
                let slideInterval;
                const updateSlider = () => {
                    track.style.transform = `translateX(-${slideIndex * 100}%)`;
                    Array.from(nav.children).forEach((dot, idx) => {
                        dot.className = idx === slideIndex ? 'slider-dot active' : 'slider-dot';
                    });
                };
                
                const nextSlide = () => {
                    slideIndex = (slideIndex + 1) % numSlides;
                    updateSlider();
                };
                
                const goToSlide = (idx) => {
                    slideIndex = idx;
                    updateSlider();
                    resetInterval();
                };
                
                const resetInterval = () => {
                    clearInterval(slideInterval);
                    if (numSlides > 1) {
                        slideInterval = setInterval(nextSlide, 4500);
                    }
                };
                
                if (numSlides > 1) {
                    slideInterval = setInterval(nextSlide, 4500);
                    const slider = document.getElementById(sliderId);
                    if (slider) {
                        slider.addEventListener('mouseenter', () => clearInterval(slideInterval));
                        slider.addEventListener('mouseleave', () => resetInterval());
                    }
                }
            };
            setTimeout(loadImages, 150);
        }
        else if (type === 'emails') {
            headerText = "📩 Email Inbox";
            if (!data || data.length === 0) {
                html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="No new emails"></div></div>`;
            } else {
                data.forEach(email => {
                    const sender = email.from || 'Unknown Sender';
                    const subject = email.subject || 'No Subject';
                    html += `
                    <div class="hud-item">
                        <div class="hud-item-title decrypt-target" data-text="${sender.replace(/"/g, '&quot;')}"></div>
                        <div class="hud-item-meta decrypt-target" data-text="${subject.replace(/"/g, '&quot;')}"></div>
                    </div>`;
                });
            }
        }
        else if (type === 'agent_progress') {
            const sid = data.sessionId || 'default';
            if (!this.activeAgentLogs) this.activeAgentLogs = new Map();
            if (!this.activeAgentLogs.has(sid)) this.activeAgentLogs.set(sid, []);
            
            const logArr = this.activeAgentLogs.get(sid);
            const msg = data.message || 'Working...';
            if (logArr.length === 0 || logArr[logArr.length - 1] !== msg) {
                logArr.push(msg);
            }
            
            const recentLogs = logArr.slice(-5);
            const pct = data.percent ?? 0;
            const barColor = data.failed ? '#ef4444' : (data.done ? '#10b981' : '#c084fc');
            const glowColor = data.failed ? 'rgba(239, 68, 68, 0.6)' : (data.done ? 'rgba(16, 185, 129, 0.6)' : 'rgba(192, 132, 252, 0.6)');
            const isRunning = !data.done && !data.failed;

            // ─── In-place update: find existing widget and patch it ───
            const existingWidget = container.querySelector('.agent-progress-live');
            if (existingWidget) {
                // Update logs
                const logsEl = existingWidget.querySelector('.ap-logs');
                if (logsEl) logsEl.innerHTML = this._buildAgentLogs(recentLogs, barColor);
                // Update bar
                const barFill = existingWidget.querySelector('.ap-bar-fill');
                if (barFill) {
                    barFill.style.width = `${pct}%`;
                    barFill.style.background = `linear-gradient(90deg, ${barColor}aa, ${barColor})`;
                    barFill.style.boxShadow = `0 0 12px ${glowColor}, 0 0 4px ${glowColor}`;
                }
                // Update percent text
                const pctEl = existingWidget.querySelector('.ap-pct');
                if (pctEl) pctEl.textContent = `${pct}%`;
                // Update status label
                const statusEl = existingWidget.querySelector('.ap-status');
                if (statusEl) {
                    statusEl.textContent = data.failed ? 'TASK FAILED' : (data.done ? 'TASK COMPLETED' : 'PROCESSING...');
                    statusEl.style.color = barColor;
                    statusEl.style.textShadow = `0 0 10px ${glowColor}`;
                }
                // Update elapsed time
                if (!this._agentStartTime) this._agentStartTime = Date.now();
                const elapsed = Math.floor((Date.now() - this._agentStartTime) / 1000);
                const mins = Math.floor(elapsed / 60);
                const secs = elapsed % 60;
                const timeEl = existingWidget.querySelector('.ap-elapsed');
                if (timeEl) timeEl.textContent = `${mins}m ${secs}s`;
                // Show/hide abort button
                const abortBtn = existingWidget.querySelector('.ap-abort-btn');
                if (abortBtn) abortBtn.style.display = isRunning ? 'block' : 'none';
                return; // Skip the full widget rebuild below
            }

            // ─── First render: create the widget ───
            this._agentStartTime = Date.now();
            headerText = "⚡ " + (data.display_name || "Domain Agent");

            html += `
                <div class="agent-progress-live" style="min-width: 360px; max-width: 450px; background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(192, 132, 252, 0.2); padding: 18px; border-radius: 12px; backdrop-filter: blur(12px); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255,255,255,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <div>
                            <span class="ap-status" style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: ${barColor}; text-shadow: 0 0 10px ${glowColor};">
                                PROCESSING...
                            </span>
                            <span class="ap-elapsed" style="font-size: 10px; color: #64748b; margin-left: 10px; font-family: 'Inter', monospace;">0m 0s</span>
                        </div>
                        <button class="ap-abort-btn" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.5); color: #fca5a5; padding: 6px 14px; border-radius: 6px; font-size: 11px; font-family: 'Inter', sans-serif; cursor: pointer; transition: all 0.2s ease; text-transform: uppercase; font-weight: 700; letter-spacing: 1px; display: ${isRunning ? 'block' : 'none'};"
                            onmouseover="this.style.background='rgba(239, 68, 68, 0.3)'; this.style.boxShadow='0 0 12px rgba(239, 68, 68, 0.5)';"
                            onmouseout="this.style.background='rgba(239, 68, 68, 0.15)'; this.style.boxShadow='none';">
                            ✕ Abort
                        </button>
                    </div>
                    
                    <div class="ap-logs" style="margin-bottom: 16px; min-height: 60px;">
                        ${this._buildAgentLogs(recentLogs, barColor)}
                    </div>
                    
                    <div style="display: flex; justify-content: flex-end; align-items: flex-end; margin-bottom: 8px;">
                        <div class="ap-pct" style="font-size: 16px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
                            ${pct}%
                        </div>
                    </div>
                    
                    <div style="height: 6px; background: rgba(0,0,0,0.6); border-radius: 6px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.5); position: relative;">
                        <div class="ap-bar-fill" style="position: absolute; left: 0; top: 0; height: 100%; width: ${pct}%; background: linear-gradient(90deg, ${barColor}aa, ${barColor}); border-radius: 6px; transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); box-shadow: 0 0 12px ${glowColor}, 0 0 4px ${glowColor};"></div>
                    </div>
                </div>`;

            // Attach abort click listener after DOM insertion
            setTimeout(() => {
                const abortBtn = container.querySelector('.ap-abort-btn');
                if (abortBtn && !abortBtn._bound) {
                    abortBtn._bound = true;
                    abortBtn.addEventListener('click', async () => {
                        abortBtn.textContent = '⏳ Killing...';
                        abortBtn.style.opacity = '0.5';
                        abortBtn.style.pointerEvents = 'none';
                        if (window.liveAPI && window.liveAPI.cancelAgents) {
                            await window.liveAPI.cancelAgents();
                        }
                    });
                }
            }, 100);
        }
        else if (type === 'full-email') {
            headerText = "✉️ Email Content";
            if (!data) {
                html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="Email unavailable"></div></div>`;
            } else {
                html += `
                <div class="hud-item" style="max-height: 400px; overflow-y: auto; background: rgba(255,255,255,0.05);">
                    <div style="font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.5; color: #f8fafc;">${data}</div>
                </div>`;
            }
        }
        else {
             // Fallback for older types
             headerText = "💡 Information";
             html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="Data Received"></div></div>`;
        }

        // Apply dynamic colors based on zone/type
        let themeColor = '#06b6d4'; // default cyan
        if (zoneKey === 'left') themeColor = '#c084fc'; // Purple for memory/news
        if (zoneKey === 'right') themeColor = '#00e5ff'; // Bright cyan for environment
        if (zoneKey === 'bottom') themeColor = '#fbbf24'; // Gold for schedule
        if (zoneKey === 'top') themeColor = '#10b981'; // Emerald for status
        
        widget.style.setProperty('--theme-color', themeColor);

        widget.innerHTML = `
            <div class="hud-widget-header decrypt-target" data-text="${headerText}"></div>
            ${html}
        `;

        container.appendChild(widget);
        this.addTiltEffect(widget);
        this.drawNeuralLine(widget, themeColor);

        // Run decryption and kinetic staggering
        setTimeout(() => {
            const decryptTargets = widget.querySelectorAll('.decrypt-target');
            decryptTargets.forEach(el => {
                this.decryptText(el, el.getAttribute('data-text'));
            });
            
            // Apply animation stagger for kinetic flow
            const hudItems = widget.querySelectorAll('.hud-item');
            hudItems.forEach((item, idx) => {
                item.style.animationDelay = `${idx * 0.12}s`;
            });
            
            // Image load staggering
            const imgWrappers = widget.querySelectorAll('.hud-img-wrapper');
            imgWrappers.forEach((img, idx) => {
                img.style.animationDelay = `${idx * 0.15}s`;
            });
        }, 50);

        // Auto-hide
        let timeoutDuration = 25000;
        if (type === 'youtube') timeoutDuration = 180000;
        else if (type === 'mermaid') timeoutDuration = 300000; // 5 mins
        else if (type === 'agent_progress') timeoutDuration = data?.done || data?.failed ? 12000 : 600000;
        
        const timeout = setTimeout(() => {
            if(document.getElementById(widgetId)) {
                widget.style.opacity = '0';
                widget.style.transform = 'translateY(-20px) scale(0.9)';
                const path = document.getElementById(`path-${widgetId}`);
                if (path) path.style.opacity = '0';
                setTimeout(() => {
                    widget.remove();
                    if (path) path.remove();
                }, 500);
            }
        }, timeoutDuration);
        this.activeTimeouts.set(widgetId, timeout);
    }
}

const hudManager = new WidgetManager();

window.liveAPI.onShowHudWidget((payload) => {
    hudManager.showWidget(payload.type, payload.data, payload.append, payload.width, payload.height);
});

let toolDissolveTimeout = null;

if (window.liveAPI.onToolCall) {
    window.liveAPI.onToolCall(({ name, args }) => {
        const floatingTool = document.getElementById('floatingToolStatus');
        if (!floatingTool) return;
        
        // Clear any pending dissolve
        if (toolDissolveTimeout) clearTimeout(toolDissolveTimeout);
        floatingTool.classList.remove('dissolve-out');
        
        let argsStr = '';
        try {
            argsStr = JSON.stringify(args);
            if (argsStr.length > 50) argsStr = argsStr.substring(0, 47) + '...';
            if (argsStr === '{}') argsStr = '';
        } catch (e) {}

        floatingTool.style.display = 'block';
        floatingTool.textContent = `⚙️ ${name}${argsStr ? ` with args: ${argsStr}` : ''}`;
    });
}

if (window.liveAPI.onToolComplete) {
    window.liveAPI.onToolComplete(({ name }) => {
        const floatingTool = document.getElementById('floatingToolStatus');
        if (!floatingTool) return;

        // If the current text doesn't match this tool (because a new one started), do nothing
        if (!floatingTool.textContent.includes(name)) return;

        // Start dissolve countdown
        toolDissolveTimeout = setTimeout(() => {
            floatingTool.classList.add('dissolve-out');
            
            // Wait for transition to finish before hiding completely
            setTimeout(() => {
                if (floatingTool.classList.contains('dissolve-out')) {
                    floatingTool.style.display = 'none';
                    floatingTool.classList.remove('dissolve-out');
                }
            }, 1500); // 1.5s matches CSS transition duration
        }, 2000); // Stay visible for 2 seconds after processing finishes
    });
}

// ==============================================================================
// 7. COMMAND PALETTE (Cmd+K)
// ==============================================================================
const cmdOverlay = document.getElementById('cmdPaletteOverlay');
const cmdInput = document.getElementById('cmdInput');

document.addEventListener('keydown', (e) => {
    // Cmd+K or Ctrl+K
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        cmdOverlay.style.display = 'flex';
        cmdInput.value = '';
        cmdInput.focus();
    }
    
    // Close on ESC
    if (e.key === 'Escape' && cmdOverlay.style.display === 'flex') {
        cmdOverlay.style.display = 'none';
        cmdInput.blur();
    }
    
    // Submit on Enter
    if (e.key === 'Enter' && cmdOverlay.style.display === 'flex') {
        const text = cmdInput.value.trim();
        if (text && isConnected) {
            window.liveAPI.sendTextCommand(text);
            document.getElementById('userText').innerText = `Cmd: ${text}`;
            setOrbState('thinking', 'Processing Command...');
        } else if (text && !isConnected) {
            alert("Please connect to Summer first by clicking the orb.");
        }
        cmdOverlay.style.display = 'none';
        cmdInput.blur();
    }
});

// ==============================================================================
// 8. PAST SESSIONS MODAL
// ==============================================================================
async function openSessionsModal() {
    const modal = document.getElementById('sessionsModal');
    const list = document.getElementById('sessionsList');
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">Loading...</div>';
    modal.style.display = 'flex';
    
    try {
        const diary = await window.liveAPI.getDiary();
        if (!diary || diary.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">No past sessions found.</div>';
            return;
        }
        
        let html = '<div style="display:flex; flex-direction:column; gap:10px;">';
        diary.forEach(entry => {
            html += `
                <div style="background:rgba(255,255,255,0.05); padding:12px; border-radius:8px; border:1px solid rgba(6,182,212,0.2);">
                    <div style="font-size:10px; color:#06b6d4; margin-bottom:6px;">${entry.date}</div>
                    <div style="font-size:13px; line-height:1.4; color:#f1f5f9; margin-bottom:10px;">${entry.entry}</div>
                    <button onclick="continueSession(${entry.timestamp})" style="background:rgba(124, 58, 237, 0.2); border:1px solid #7c3aed; color:#c4b5fd; padding:6px 12px; border-radius:4px; font-size:12px; cursor:pointer;">Continue this Session</button>
                </div>
            `;
        });
        html += '</div>';
        list.innerHTML = html;
    } catch (e) {
        list.innerHTML = '<div style="color:#ef4444;">Error loading sessions.</div>';
    }
}

function closeSessionsModal() {
    document.getElementById('sessionsModal').style.display = 'none';
}

function continueSession(timestamp) {
    window.liveAPI.getDiary().then(diary => {
        const entry = diary.find(d => d.timestamp === timestamp);
        if (entry) {
            selectedContinueDiary = entry;
            closeSessionsModal();
            setOrbState('idle', 'Ready to continue session. Click to connect.');
            document.getElementById('subtitleText').innerText = `Queued context from ${entry.date}`;
        }
    });
}

// Attach listeners directly
const settingsBtn = document.getElementById('settingsBtn');
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        if (window.liveAPI) window.liveAPI.openSettingsWindow();
    });
}

const memoryBtn = document.getElementById('memoryBtn');
if (memoryBtn) {
    memoryBtn.addEventListener('click', () => {
        if (window.liveAPI) window.liveAPI.openMemoryWindow();
    });
}

const sessionsBtn = document.getElementById('sessionsBtn');
if (sessionsBtn) {
    sessionsBtn.addEventListener('click', () => {
        if (typeof openSessionsModal === 'function') openSessionsModal();
    });
}

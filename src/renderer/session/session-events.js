__cjsRegister('renderer/session/session-events.js', function (module, exports, require) {
let lastContextPayload = null;
let toolDissolveTimeout = null;
let recentReconnectCount = 0;
let reconnectResetTimer = null;

function getLastContextPayload() { return lastContextPayload; }
function setLastContextPayload(val) { lastContextPayload = val; }

function initSessionEvents(deps) {
    const {
        setOrbState,
        getIsConnected,
        setIsConnected,
        getUserDisconnected,
        setAutoReconnectTimer,
        getAutoReconnectTimer,
        clearAllText,
        updateSubtitle,
        updateUserSubtitle,
        audioQueue,
        startRecording,
        stopRecording,
        hudManager,
        setWakeWordIndicator,
        setIsConnecting,
    } = deps;

    window.liveAPI.onSessionStarted(() => {
        setIsConnected(true);
        if (setIsConnecting) setIsConnecting(false);
        if (window.liveAPI.setWakeWordEnabled) window.liveAPI.setWakeWordEnabled(false);
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
        if (setIsConnecting) setIsConnecting(false);
        if (window.liveAPI.setWakeWordEnabled) window.liveAPI.setWakeWordEnabled(true);
        if (getUserDisconnected()) {
            setIsConnected(false);
            setOrbState('idle', 'Click Orb to Connect');
            stopRecording();
            audioQueue.clear();
            setWakeWordIndicator('listening');
        } else {
            recentReconnectCount++;
            if (recentReconnectCount > 3) {
                console.error("Too many rapid disconnects. Giving up auto-reconnect.");
                if (deps.setUserDisconnected) deps.setUserDisconnected(true);
                setIsConnected(false);
                setOrbState('idle', 'Connection Failed');
                stopRecording();
                audioQueue.clear();
                return;
            }
            if (reconnectResetTimer) clearTimeout(reconnectResetTimer);
            reconnectResetTimer = setTimeout(() => { recentReconnectCount = 0; }, 10000);

            console.log(`Session disconnected unexpectedly. Auto-reconnecting... (Attempt ${recentReconnectCount})`);
            setOrbState('thinking', 'Reconnecting...');
            stopRecording();
            audioQueue.clear();
            const timer = setTimeout(() => {
                const reconnectPayload = lastContextPayload ? { ...lastContextPayload, isAutoReconnect: true } : { isAutoReconnect: true };
                window.liveAPI.startSession(reconnectPayload);
            }, 1500);
            setAutoReconnectTimer(timer);
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
        if (deps.setUserDisconnected) deps.setUserDisconnected(true); // Prevent auto-reconnect on error
        setOrbState('idle', 'Error Connecting');
        setIsConnected(false);
        if (setIsConnecting) setIsConnecting(false);
        if (window.liveAPI.setWakeWordEnabled) window.liveAPI.setWakeWordEnabled(true);
        stopRecording();
    });

    window.liveAPI.onShowHudWidget((payload) => {
        hudManager.showWidget(payload.type, payload.data, payload.append, payload.width, payload.height);
    });

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
}

module.exports = { initSessionEvents, getLastContextPayload, setLastContextPayload };
});

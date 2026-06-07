/**
 * Gemini Live WebSocket session manager.
 */

const WebSocket = require('ws');
const { loadGraph, saveGraph, mergeGraph } = require('../../knowledge/graph-store');
const { extractGraphFromText } = require('../../knowledge/graph-extractor');
const { buildSystemInstruction } = require('../../knowledge/graph-context');
const { searchMemory } = require('../../knowledge/graph-search');
const { summariseSession, appendDiaryEntry, getSessionLocation } = require('../../knowledge/session-diary');
const { extractProceduralPatterns } = require('../../knowledge/procedural-memory');
const { buildProceduralContext } = require('../../knowledge/context-injector');
const { findMatchingImageNodes, extractKeywordsFromText, hasVisualIntent } = require('../../knowledge/image-analyzer');
const { enhanceToolResponse, getSkillSummaries } = require('../../skills/skill-loader');
const orchestrator   = require('../../orchestration/orchestrator');
const statusTracker  = require('../../orchestration/agent-status-tracker');
const { getAgentTools, getSmartAgentTools, executeTool, buildToolContext } = require('../../tools/tool-registry');
const googleAuth          = require('../../auth/google-auth');
const { sendToRenderer }  = require('../../core/utils/renderer-bridge');
const pendingNotifications = require('../../core/pending-notifications');

// Event bus is optional — falls back to no-op if running before bus is initialized
let _bus = null;
function _getBus() {
    if (!_bus) {
        try { _bus = require('../../core/event-bus'); } catch { _bus = { EVENTS: {}, dispatch: () => {}, broadcast: () => {} }; }
    }
    return _bus;
}

class LiveSessionManager {
    constructor(deps) {
        this.deps = deps;
        this.ws = null;
        this.sessionTranscript = [];
        this.activeConversationTimestamp = null;
        this.activeConversationSummary = null;
        this.latestShadowContext = null;
        this.currentSessionContextPayload = null;
        this.lastShadowImagePushTime = 0;
        this.lastShadowImageIds = new Set();
        this._toolContext = null;
        this._inactivityTimer = null;

        // Listen to orchestrator milestone events (50%, 75%, complete, fail)
        // and queue them as priority shadow context for the NEXT turn.
        // Flaw 10 fix: Only process milestones for THIS client's session.
        this._milestoneHandler = ({ clientId, text }) => {
            // Accept if: no clientId scoping (null = broadcast) OR clientId matches ours
            const myClientId = this.deps.clientId || null;
            if (clientId !== null && myClientId !== null && clientId !== myClientId) return;

            if (text) {
                this.latestShadowContext = this.latestShadowContext
                    ? `${text}\n${this.latestShadowContext}`
                    : text;
            }
        };
        orchestrator.on('agent-milestone', this._milestoneHandler);
    }

    /** Clean up the milestone listener when session is torn down. */
    destroy() {
        orchestrator.removeListener('agent-milestone', this._milestoneHandler);
    }

    _startInactivityTimer() {
        this._clearInactivityTimer();
        this._inactivityTimer = setTimeout(() => {
            console.log('[LiveSession] Session inactive for 10 minutes — auto-closing.');
            this.stop();
        }, 10 * 60 * 1000);
    }

    _clearInactivityTimer() {
        if (this._inactivityTimer) {
            clearTimeout(this._inactivityTimer);
            this._inactivityTimer = null;
        }
    }

    _getMainWindow() {
        return this.deps.getMainWindow();
    }

    _getMemoryWindow() {
        return this.deps.getMemoryWindow();
    }

    _getWakeWordEngine() {
        return this.deps.getWakeWordEngine();
    }

    _resumeWakeWordAfterClose() {
        const wakeWordEngine = this._getWakeWordEngine();
        if (!wakeWordEngine) return;
        setTimeout(() => {
            if (wakeWordEngine && !this.ws) {
                wakeWordEngine.resume();
                console.log('[WakeWord] Resumed after WebSocket close (cooldown elapsed).');
            }
        }, wakeWordEngine.cooldownMs || 2000);
    }

    async start(event, contextPayload) {
        if (this.ws) {
            try { this.ws.close(); } catch {}
            this.ws = null;
            await new Promise(r => setTimeout(r, 100));
        }

        this._startInactivityTimer();

        this.currentSessionContextPayload = contextPayload || {};

        // Flaw 7 fix: Drain any pending notifications from tasks that completed
        // while the session was inactive. Inject as first-turn priority shadow context.
        const drained = pendingNotifications.drainForSession(this.deps.clientId || null);
        if (drained) {
            this.latestShadowContext = drained;
            console.log(`[LiveSession] 📥 Drained ${drained.split('\n').length} pending notification(s) into session start.`);
        }

        if (this.currentSessionContextPayload.isAutoReconnect) {
            console.log("Auto-reconnecting. Preserving session transcript and conversation ID.");
        } else {
            console.log("New manual session started. Resetting transcript.");
            this.sessionTranscript = [];
            if (this.currentSessionContextPayload.continueDiary) {
                this.activeConversationTimestamp = this.currentSessionContextPayload.continueDiary.timestamp;
                this.activeConversationSummary = this.currentSessionContextPayload.continueDiary.entry;
            } else {
                this.activeConversationTimestamp = Date.now();
                this.activeConversationSummary = null;
            }
        }

        this.lastShadowImagePushTime = 0;
        this.lastShadowImageIds = new Set();

        const wakeWordEngine = this._getWakeWordEngine();
        if (wakeWordEngine) wakeWordEngine.pause();

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return event.reply('agent-error', "GEMINI_API_KEY is missing in .env");
        }

        let systemInstruction = buildSystemInstruction('', this.currentSessionContextPayload);
        systemInstruction += getSkillSummaries();
        systemInstruction += orchestrator.getPluginsPromptSection();

        // Inject learned procedural rules (Phase 1: Procedural Memory)
        try {
            const proceduralCtx = buildProceduralContext();
            if (proceduralCtx) systemInstruction += proceduralCtx;
        } catch (e) {
            console.warn('[LiveSession] Procedural context injection skipped:', e.message);
        }
        if (contextPayload && contextPayload.weatherContext) {
            systemInstruction += `\n\nCURRENT CONTEXT:\n${contextPayload.weatherContext}`;
        }
        if (contextPayload && contextPayload.googleContext) {
            systemInstruction += contextPayload.googleContext;
        }

        if (this.currentSessionContextPayload.isAutoReconnect && this.sessionTranscript.length > 0) {
            const recentHistory = this.sessionTranscript.slice(-15).map(t => `${t.role}: ${t.text}`).join('\n');
            systemInstruction += `\n\n[SYSTEM NOTE: The connection was momentarily interrupted. Here is the recent conversation history so you don't lose context. Continue naturally:]\n${recentHistory}`;
        }

        console.log("System instruction built. Node count:", loadGraph().nodes.length);
        if (contextPayload) console.log("Injected environmental/Google context.");

        let googleAuthenticated = false;
        try {
            googleAuthenticated = await googleAuth.isAuthenticated();
        } catch (e) {
            console.warn('[LiveSession] Google auth check skipped:', e.message);
        }

        this._toolContext = buildToolContext({
            contextPayload: this.currentSessionContextPayload,
            googleAuthenticated,
        });

        const host = 'generativelanguage.googleapis.com';
        const model = process.env.GEMINI_LIVE_MODEL || 'models/gemini-3.1-flash-live-preview';
        const voiceName = process.env.GEMINI_VOICE_NAME || 'Callirrhoe';
        const url = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

        this.ws = new WebSocket(url);
        const ws = this.ws;

        ws.on('open', () => {
            console.log(`WebSocket connected. Voice: ${voiceName}`);
            ws.send(JSON.stringify({
                setup: {
                    model: model,
                    system_instruction: {
                        parts: [{ text: systemInstruction }]
                    },
                    tools: getSmartAgentTools(this._toolContext, contextPayload?.topic || contextPayload?.weatherContext || ''),
                    generationConfig: {
                        responseModalities: ["AUDIO"],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: voiceName
                                }
                            }
                        }
                    },
                    input_audio_transcription: {},
                    output_audio_transcription: {}
                }
            }));
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                this._startInactivityTimer();

                if (response.setupComplete) {
                    console.log("Setup complete received from Gemini.");
                    event.reply('session-started');
                }

                if (response.toolCall) {
                    const functionCalls = response.toolCall.functionCalls;
                    if (functionCalls && functionCalls.length > 0) {
                        for (const call of functionCalls) {
                            const { id: callId, name, args } = call;
                            console.log(`\n🛠️ Agent requested tool: ${name} with args:`, args);

                            const runToolCall = async () => {
                                event.reply('agent-tool-call', { name, args });
                                let result;
                                try {
                                    result = await executeTool(name, args, {
                                        mainWindow: this._getMainWindow(),
                                        callBrowser: this.deps.callBrowser,
                                        emitAgentEvent: this.deps.emitAgentEvent,
                                    });
                                } catch (e) {
                                    result = { error: e.message };
                                }
                                event.reply('agent-tool-complete', { name });
                                return result;
                            };

                            runToolCall().then(result => {
                                ws.send(JSON.stringify({
                                    toolResponse: {
                                        functionResponses: [{
                                            id: callId,
                                            name: name,
                                            response: { result: enhanceToolResponse(name, result) }
                                        }]
                                    }
                                }));
                            }).catch(err => {
                                event.reply('agent-tool-complete', { name });
                                console.error("Tool execution failed:", err);
                                ws.send(JSON.stringify({
                                    toolResponse: {
                                        functionResponses: [{
                                            id: callId,
                                            name: name,
                                            response: { error: err.message || "An unknown error occurred while trying to access the internet." }
                                        }]
                                    }
                                }));
                            });
                        }
                    }
                }

                if (response.serverContent) {
                    if (response.serverContent.modelTurn) {
                        const parts = response.serverContent.modelTurn.parts;
                        for (const part of parts) {
                            if (part.inlineData && part.inlineData.data) {
                                event.reply('agent-audio', part.inlineData.data);
                            }
                            if (part.text) {
                                event.reply('agent-text', part.text);
                            }
                        }
                    }

                    const inputTrans = response.serverContent.inputTranscription || response.serverContent.input_transcription;
                    if (inputTrans && inputTrans.text) {
                        const userText = inputTrans.text.trim();
                        event.reply('user-text', userText);
                        this.sessionTranscript.push({ role: 'user', text: userText });

                        if (orchestrator.cancelIfUserSaysStop(userText)) {
                            this.latestShadowContext = '[SYSTEM: Active background agents were cancelled per user request.]';
                            console.log('\n🛑 User cancelled domain agent(s).');
                        } else if (orchestrator.matchAgentIntent(userText)) {
                            const agentId = orchestrator.matchAgentIntent(userText);
                            const agentEmit = (ev, payload) => this.deps.emitAgentEvent(ev, payload);
                        orchestrator.handleDelegateRequest({
                                agent_id: agentId,
                                user_request: userText,
                                clientId: this.deps.clientId || null,  // Flaw 10
                            }, agentEmit).then(hint => {
                                if (hint.status === 'gathering') {
                                    this.latestShadowContext = `[DOMAIN AGENT ${agentId}: ${hint.message} Call delegate_domain_agent with gathered_attributes when the user answers.]`;
                                } else if (hint.status === 'running') {
                                    this.latestShadowContext = `[DOMAIN AGENT ${agentId} running in background: ${hint.message}]`;
                                }
                                console.log(`\n🔌 Tier 2 routed to ${agentId}: ${hint.status}`);
                            }).catch(err => console.error('[Orchestrator]', err.message));
                        }

                        if (userText.length > 15) {
                            searchMemory(userText, 3, null).then(searchResult => {
                                if (searchResult.nodes.length > 0) {
                                    const shadowFacts = searchResult.nodes.map(n => `Fact [${n.label}]: ${n.description}`).join(' | ');
                                    const prefix = this.latestShadowContext ? this.latestShadowContext + ' ' : '';
                                    this.latestShadowContext = `${prefix}[SYSTEM BACKGROUND CONTEXT: ${shadowFacts}]`;
                                    console.log(`\n🕵️‍♂️ Shadow Retrieval: Staged ${searchResult.nodes.length} nodes for next turn based on: "${userText.slice(0, 30)}..."`);
                                }
                            }).catch(err => {
                                console.error('Shadow retrieval error:', err);
                            });

                            try {
                                if (hasVisualIntent(userText)) {
                                    const SHADOW_IMG_COOLDOWN_MS = 30000;
                                    const now = Date.now();
                                    const cooldownPassed = (now - this.lastShadowImagePushTime) > SHADOW_IMG_COOLDOWN_MS;

                                    if (cooldownPassed) {
                                        const keywords = extractKeywordsFromText(userText);
                                        if (keywords.length > 0) {
                                            const graph = loadGraph();
                                            const matchingImages = findMatchingImageNodes(keywords, graph, 4);

                                            if (matchingImages.length > 0) {
                                                const newImageIds = matchingImages.map(n => n.id);
                                                const hasNewImages = newImageIds.some(id => !this.lastShadowImageIds.has(id));

                                                if (hasNewImages) {
                                                    console.log(`\n\ud83d\udcf8 Shadow Image Retrieval: ${matchingImages.length} image(s) matched for "${userText.slice(0, 35)}..."`);
                                                    const imagePayload = {
                                                        type: 'image_gallery',
                                                        data: {
                                                            title: '\ud83d\udcf8 Visual Memory',
                                                            images: matchingImages.map(n => ({
                                                                filename: n.imagePath,
                                                                publicUrl: n.publicUrl,
                                                                label: n.label,
                                                                description: n.description,
                                                                source: 'memory',
                                                            }))
                                                        }
                                                    };
                                                    sendToRenderer('show-hud-widget', imagePayload);
                                                    this.lastShadowImagePushTime = now;
                                                    this.lastShadowImageIds = new Set(newImageIds);
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (imgErr) {
                                // Non-critical
                            }

                            // ── Audio Memory Shadow Retrieval ──────────────────────
                            // Automatically surface AudioMemory nodes when the user
                            // mentions audio-related keywords (voice, recording, etc.)
                            try {
                                const AUDIO_INTENT_WORDS = new Set([
                                    'audio', 'voice', 'recording', 'record', 'listen',
                                    'conversation', 'transcript', 'dictation', 'note',
                                    'voicenote', 'memo', 'playback', 'play', 'heard',
                                    'said', 'spoke', 'talk', 'talked', 'speech'
                                ]);
                                const words = userText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
                                const hasAudioIntent = words.some(w => AUDIO_INTENT_WORDS.has(w));

                                if (hasAudioIntent) {
                                    const graph = loadGraph();
                                    const keywords = extractKeywordsFromText(userText);
                                    const audioNodes = (graph.nodes || []).filter(n => n.type === 'AudioMemory');

                                    if (audioNodes.length > 0 && keywords.length > 0) {
                                        // Score audio nodes by keyword relevance
                                        const scored = audioNodes.map(node => {
                                            let score = 0;
                                            for (const kw of keywords) {
                                                if ((node.label || '').toLowerCase().includes(kw)) score += 30;
                                                if ((node.transcript || '').toLowerCase().includes(kw)) score += 25;
                                                if ((node.description || '').toLowerCase().includes(kw)) score += 15;
                                                if ((node.tags || []).some(t => t.toLowerCase().includes(kw))) score += 20;
                                                if ((node.keyFacts || []).some(f => f.toLowerCase().includes(kw))) score += 20;
                                            }
                                            return { node, score };
                                        }).filter(s => s.score > 20).sort((a, b) => b.score - a.score).slice(0, 3);

                                        if (scored.length > 0) {
                                            // Inject audio context into shadow
                                            const audioFacts = scored.map(s => {
                                                const n = s.node;
                                                const transcript = n.transcript ? ` Transcript: "${n.transcript.slice(0, 200)}"` : '';
                                                const facts = (n.keyFacts || []).slice(0, 3).join('; ');
                                                return `AudioMemory [${n.label}]: ${n.description || ''}${transcript}${facts ? ` Key facts: ${facts}` : ''}`;
                                            }).join(' | ');

                                            const prefix = this.latestShadowContext ? this.latestShadowContext + ' ' : '';
                                            this.latestShadowContext = `${prefix}[AUDIO MEMORY CONTEXT: ${audioFacts}]`;
                                            console.log(`\n\ud83c\udfa7 Shadow Audio Retrieval: ${scored.length} audio memory node(s) matched for "${userText.slice(0, 35)}..."`);

                                            // Push audio player widget for the top match
                                            const topNode = scored[0].node;
                                            if (topNode.audioPath || topNode.publicUrl) {
                                                sendToRenderer('show-hud-widget', {
                                                    type: 'audio_player',
                                                    data: {
                                                        title: topNode.label || 'Voice Note',
                                                        path: topNode.audioPath,
                                                        publicUrl: topNode.publicUrl,
                                                    }
                                                });
                                            }
                                        }
                                    }
                                }
                            } catch (audioErr) {
                                // Non-critical
                            }
                        }
                    }

                    const outputTrans = response.serverContent.outputTranscription || response.serverContent.output_transcription;
                    if (outputTrans && outputTrans.text) {
                        event.reply('agent-text', outputTrans.text);
                        this.sessionTranscript.push({ role: 'agent', text: outputTrans.text });
                    }

                    if (response.serverContent.turnComplete) {
                        event.reply('agent-turn-complete');
                    }

                    if (response.serverContent.interrupted) {
                        event.reply('agent-interrupted');
                    }
                }

            } catch (e) {
                console.error("Error parsing WS message:", e);
            }
        });

        ws.on('error', (err) => {
            console.error("WebSocket error:", err);
            event.reply('agent-error', err.message);
        });

        ws.on('close', async (code, reason) => {
            console.log(`WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
            event.reply('session-ended');

            const transcriptText = this.sessionTranscript.map(t => `${t.role}: ${t.text}`).join('\n');
            if (transcriptText.length > 50) {
                console.log(`\n🧠 Auto-Memory: Analyzing session transcript (${transcriptText.length} chars)...`);

                await Promise.allSettled([
                    (async () => {
                        const existingSummary = this.activeConversationSummary;
                        const timestampToReplace = this.activeConversationTimestamp;

                        const result = await summariseSession(transcriptText, apiKey, existingSummary);

                        // Handle both old (string) and new ({ text, emotion }) return formats
                        const entry = typeof result === 'string' ? result : result.text;
                        const emotion = typeof result === 'object' ? result.emotion : null;

                        // Fetch location (non-blocking, returns null if unavailable)
                        let location = null;
                        try { location = await getSessionLocation(); } catch {}

                        if (!entry.includes('No significant facts learned')) {
                            appendDiaryEntry(entry, timestampToReplace, emotion, location);
                            this.activeConversationSummary = entry;
                            const moodLabel = emotion ? ` [mood: ${emotion}]` : '';
                            console.log(`📓 Diary${moodLabel}: "${entry.slice(0, 80)}..."`);
                        } else if (existingSummary && timestampToReplace) {
                            appendDiaryEntry(existingSummary, timestampToReplace);
                            console.log('📓 Diary: Kept previous summary, updated timestamp.');
                        } else {
                            console.log('📓 Diary: Nothing significant this session.');
                        }

                        // Fire-and-forget: extract procedural patterns from this session
                        extractProceduralPatterns(transcriptText).catch(err => {
                            console.warn('[ProceduralMemory] Background extraction failed (non-critical):', err.message);
                        });
                    })()
                ]);

                try {
                    const existing = loadGraph();
                    const extracted = await extractGraphFromText(transcriptText, apiKey, existing);
                    if (extracted.nodes && extracted.nodes.length > 0) {
                        extracted.nodes.forEach(n => n.source = 'agent');
                    }
                    if (extracted.contradictions && extracted.contradictions.length > 0) {
                        // Route via event.reply (handled by BrainBridge) AND direct window for backwards compat
                        event.reply('memory-conflict', extracted.contradictions);
                    }
                    if (extracted.nodes.length > 0 || extracted.edges.length > 0) {
                        const finalGraph = mergeGraph(existing, extracted);
                        saveGraph(finalGraph);
                        console.log(`💾 Auto-Memory: Graph updated! Added ${extracted.nodes.length} nodes, ${extracted.edges.length} edges.`);
                        // Notify via event bus (reaches ALL clients)
                        const bus = _getBus();
                        bus.dispatch(bus.EVENTS.MEMORY_UPDATED || 'memory:updated', {
                            nodeCount: finalGraph.nodes.length,
                            edgeCount: finalGraph.edges.length,
                        });
                        event.reply('extraction-done', finalGraph);
                        // Also try direct memory window for backwards compat
                        const memoryWindow = this._getMemoryWindow();
                        if (memoryWindow && !memoryWindow.isDestroyed()) {
                            memoryWindow.webContents.send('extraction-done', finalGraph);
                        }
                    } else {
                        console.log(`🧠 Auto-Memory: No new facts learned in this session.`);
                    }
                } catch (err) {
                    console.error(`❌ Auto-Memory failed:`, err.message);
                }
            }

            this._resumeWakeWordAfterClose();
            this._clearInactivityTimer();
        });
    }

    stop() {
        this._clearInactivityTimer();
        if (this.ws) {
            try { this.ws.close(); } catch {}
        }
        this.ws = null;
        this._resumeWakeWordAfterClose();
    }

    sendAudio(base64Audio) {
        this._startInactivityTimer();
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({
            realtimeInput: {
                audio: {
                    mimeType: "audio/pcm;rate=16000",
                    data: base64Audio
                }
            }
        }));
    }

    sendTurnComplete() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const payload = {
            clientContent: {
                turns: [],
                turnComplete: true
            }
        };

        // Build the final shadow context block:
        // 1. Start with passive running-task awareness (silent background info)
        const runningTasksSummary = statusTracker.getRunningStatusSummary();

        // 2. Combine with any milestone / memory context already queued
        let shadowBlock = null;
        if (runningTasksSummary && this.latestShadowContext) {
            // Running tasks are silent background awareness — append below priority milestones
            shadowBlock = `${this.latestShadowContext}\n${runningTasksSummary}`;
        } else if (this.latestShadowContext) {
            shadowBlock = this.latestShadowContext;
        } else if (runningTasksSummary) {
            shadowBlock = runningTasksSummary;
        }

        if (shadowBlock) {
            payload.clientContent.turns.push({
                role: "user",
                parts: [{ text: shadowBlock }]
            });
            console.log(`📤 Shadow Context: injected into turnComplete (milestone: ${!!this.latestShadowContext}, running: ${!!runningTasksSummary}).`);
            this.latestShadowContext = null;
        }

        this.ws.send(JSON.stringify(payload));
    }

    sendTextCommand(text) {
        this._startInactivityTimer();
        if (orchestrator.cancelIfUserSaysStop(text)) {
            this.deps.emitAgentEvent('agent-killed', { reason: 'user_cancel' });
        } else if (orchestrator.matchAgentIntent(text)) {
            const agentId = orchestrator.matchAgentIntent(text);
            const agentEmit = (ev, payload) => this.deps.emitAgentEvent(ev, payload);
            orchestrator.handleDelegateRequest({ agent_id: agentId, user_request: text }, agentEmit)
                .then(hint => console.log(`[Orchestrator] text command → ${agentId}: ${hint.status}`))
                .catch(err => console.error('[Orchestrator]', err.message));
        }
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({
            clientContent: {
                turns: [{
                    role: "user",
                    parts: [{ text: text }]
                }],
                turnComplete: true
            }
        }));
        this.sessionTranscript.push({ role: 'user', text: `[TEXT COMMAND]: ${text}` });
        console.log(`💬 User Text Command: ${text}`);
    }

    registerIpc(ipcMain) {
        ipcMain.on('start-session', (event, contextPayload) => this.start(event, contextPayload));
        ipcMain.on('realtime-audio', (event, base64Audio) => this.sendAudio(base64Audio));
        ipcMain.on('turn-complete', () => this.sendTurnComplete());
        ipcMain.on('send-text-command', (event, text) => this.sendTextCommand(text));
        ipcMain.on('stop-session', () => this.stop());
    }
}

module.exports = { LiveSessionManager };

/**
 * Gemini Live WebSocket session manager.
 */

const WebSocket = require('ws');
const { loadGraph, saveGraph, mergeGraph } = require('../../knowledge/graph-store');
const { extractGraphFromText } = require('../../knowledge/graph-extractor');
const { buildSystemInstruction } = require('../../knowledge/graph-context');
const { searchMemory } = require('../../knowledge/graph-search');
const { summariseSession, appendDiaryEntry } = require('../../knowledge/session-diary');
const { findMatchingImageNodes, extractKeywordsFromText, hasVisualIntent } = require('../../knowledge/image-analyzer');
const { enhanceToolResponse, getSkillSummaries } = require('../../skills/skill-loader');
const orchestrator = require('../../orchestration/orchestrator');
const { getAgentTools, executeTool, buildToolContext } = require('../../tools/tool-registry');
const googleAuth = require('../../auth/google-auth');
const { sendToRenderer } = require('../../core/utils/renderer-bridge');

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
        if (this.ws) this.ws.close();

        this.currentSessionContextPayload = contextPayload || {};

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
        const model = 'models/gemini-3.1-flash-live-preview';
        const url = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

        this.ws = new WebSocket(url);
        const ws = this.ws;

        ws.on('open', () => {
            console.log("WebSocket connected.");
            ws.send(JSON.stringify({
                setup: {
                    model: model,
                    system_instruction: {
                        parts: [{ text: systemInstruction }]
                    },
                    tools: getAgentTools(this._toolContext),
                    generationConfig: {
                        responseModalities: ["AUDIO"]
                    },
                    input_audio_transcription: {},
                    output_audio_transcription: {}
                }
            }));
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());

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
                                user_request: userText
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
                            const searchResult = searchMemory(userText, 3, null);
                            if (searchResult.nodes.length > 0) {
                                const shadowFacts = searchResult.nodes.map(n => `Fact [${n.label}]: ${n.description}`).join(' | ');
                                const prefix = this.latestShadowContext ? this.latestShadowContext + ' ' : '';
                                this.latestShadowContext = `${prefix}[SYSTEM BACKGROUND CONTEXT: ${shadowFacts}]`;
                                console.log(`\n🕵️‍♂️ Shadow Retrieval: Staged ${searchResult.nodes.length} nodes for next turn based on: "${userText.slice(0, 30)}..."`);
                            }

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

                        const entry = await summariseSession(transcriptText, apiKey, existingSummary);

                        if (!entry.includes('No significant facts learned')) {
                            appendDiaryEntry(entry, timestampToReplace);
                            this.activeConversationSummary = entry;
                            console.log(`📓 Diary: "${entry.slice(0, 80)}..."`);
                        } else if (existingSummary && timestampToReplace) {
                            appendDiaryEntry(existingSummary, timestampToReplace);
                            console.log('📓 Diary: Kept previous summary, updated timestamp.');
                        } else {
                            console.log('📓 Diary: Nothing significant this session.');
                        }
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
        });
    }

    stop() {
        if (this.ws) this.ws.close();
        this.ws = null;
        this._resumeWakeWordAfterClose();
    }

    sendAudio(base64Audio) {
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

        if (this.latestShadowContext) {
            payload.clientContent.turns.push({
                role: "user",
                parts: [{ text: this.latestShadowContext }]
            });
            console.log(`📤 Shadow Retrieval: Context injected into turnComplete.`);
            this.latestShadowContext = null;
        }

        this.ws.send(JSON.stringify(payload));
    }

    sendTextCommand(text) {
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

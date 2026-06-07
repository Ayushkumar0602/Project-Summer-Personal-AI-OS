/**
 * orchestrator.js
 *
 * Tier 2 Orchestrator — manages domain agent plugins.
 *
 * Changes from v1:
 *  - Now extends EventEmitter so summer-daemon.js can wire agent events
 *    to the WebSocket broadcast bus.
 *  - Integrates with agent-status-tracker.js to persist/sync background
 *    process state globally (local disk + Supabase app_settings).
 *  - Returns milestone notification objects from handleDelegateRequest
 *    so Tier 1 (LiveSessionManager) can inject them into shadow context
 *    at the right moment (50%, 75%, done) — not on every progress tick.
 */

'use strict';

const { EventEmitter }   = require('node:events');
const { loadPluginManifests, getPluginEntryPath, listPluginSummaries } = require('./plugin-registry');
const { resolveAttributes, buildClarificationMessage } = require('./attribute-resolver');
const { matchAgentIntent } = require('./intent-matcher');
const { AgentSocket }    = require('./agent-socket');
const statusTracker      = require('./agent-status-tracker');

// ── Singleton emitter (extends EventEmitter so daemon can wire listeners) ─────
class Orchestrator extends EventEmitter {
    constructor() {
        super();
        this.manifests      = loadPluginManifests();
        this.activeSessions = new Map();
        this.sessionCounter = 0;
    }

    reloadPlugins() {
        this.manifests = loadPluginManifests();
        return this.manifests;
    }

    getManifest(agentId) {
        return this.manifests.get(agentId) || null;
    }

    getPluginsPromptSection() {
        if (this.manifests.size === 0) return '';
        return `\n\n### Domain Agent Plugs (Tier 2)\nFor presentation/PPT requests, call \`delegate_domain_agent\` instead of improvising slides yourself.\nAvailable plugs:\n${listPluginSummaries(this.manifests).join('\n')}`;
    }

    /**
     * Tier 2 entry: resolve attributes, gather missing data, or start worker.
     *
     * @param {{ agent_id, user_request, gathered_attributes, clientId }} opts
     * @param {Function} [emit] - optional per-call emitter for HUD events
     * @returns {Promise<object>} hint object with status / sessionId / message
     */
    async handleDelegateRequest({ agent_id, user_request, gathered_attributes, clientId }, emit) {
        const manifest = this.getManifest(agent_id);
        if (!manifest) {
            return { status: 'error', message: `Unknown agent plug: ${agent_id}` };
        }

        let prior = gathered_attributes || {};
        for (const [sid, session] of this.activeSessions) {
            if (session.phase === 'gathering' && session.agent_id === agent_id) {
                prior = { ...session.filled, ...prior };
                this.activeSessions.delete(sid);
                break;
            }
        }
        prior._lastUserText = user_request;
        const { filled, missing, ready } = await resolveAttributes(manifest, user_request, prior);

        if (!ready) {
            const sessionId = `gather_${++this.sessionCounter}`;
            this.activeSessions.set(sessionId, { phase: 'gathering', agent_id, filled, manifest });
            const clarification = buildClarificationMessage(manifest, missing, filled);
            emit?.('agent-gathering', { sessionId, ...clarification });
            return {
                status: 'gathering',
                sessionId,
                ...clarification,
                filled_attributes: filled,
                instruction: 'Ask the user for the missing fields, then call delegate_domain_agent again with gathered_attributes containing the new values.',
            };
        }

        const sessionId  = `run_${++this.sessionCounter}`;
        const taskManifest = { ...filled, agent_id };
        const entryPath  = getPluginEntryPath(manifest);

        // Register task as started in status tracker (with clientId for Flaw 10 scoping)
        statusTracker.onAgentStarted(sessionId, agent_id, manifest.display_name, clientId || null);

        emit?.('agent-started', { sessionId, agent_id, display_name: manifest.display_name });
        this.emit('agent-started', { sessionId, agent_id, display_name: manifest.display_name });

        const socket = new AgentSocket(manifest, entryPath, taskManifest, {
            onProgress: (percent, message) => {
                // Always emit to HUD (UI toast updates)
                emit?.('agent-progress', { sessionId, agent_id, percent, message });
                this.emit('agent-progress', { sessionId, agent_id, percent, message });

                // Update the tracker and get milestone notification if threshold crossed
                const milestone = statusTracker.onAgentProgress(sessionId, percent, message);
                if (milestone?.shouldNotify) {
                    // Include clientId so LSM can filter to correct session (Flaw 10)
                    this.emit('agent-milestone', { sessionId, agent_id, clientId: clientId || null, text: milestone.text });
                }
            },
            onComplete: (result) => {
                this.activeSessions.delete(sessionId);
                const notification = statusTracker.onAgentComplete(sessionId, result);
                emit?.('agent-complete', { sessionId, agent_id, result });
                this.emit('agent-complete', { sessionId, agent_id, result });

                // ── Auto-render HTML results directly onto the HUD ──────────
                // If the agent result contains an 'html' field, push it to the
                // renderer immediately instead of waiting for Gemini to call
                // show_hologram_widget (which it often fails to do reliably).
                if (result?.html) {
                    try {
                        const { sendToRenderer } = require('../core/utils/renderer-bridge');
                        sendToRenderer('show-hud-widget', {
                            type: 'custom_html',
                            data: { html: result.html },
                            append: false,
                        });
                        console.log(`[Orchestrator] ✅ Auto-rendered HTML from ${agent_id} onto HUD`);
                    } catch (e) {
                        console.error(`[Orchestrator] Failed to auto-render HTML:`, e.message);
                    }
                }

                if (notification?.shouldNotify) {
                    this.emit('agent-milestone', { sessionId, agent_id, clientId: clientId || null, text: notification.text });
                }
            },
            onFail: (error) => {
                this.activeSessions.delete(sessionId);
                const notification = statusTracker.onAgentFail(sessionId, error);
                emit?.('agent-fail', { sessionId, agent_id, error });
                this.emit('agent-fail', { sessionId, agent_id, error });
                if (notification?.shouldNotify) {
                    this.emit('agent-milestone', { sessionId, agent_id, clientId: clientId || null, text: notification.text });
                }
            },
            onKilled: (reason) => {
                this.activeSessions.delete(sessionId);
                statusTracker.onAgentKilled(sessionId, reason);
                emit?.('agent-killed', { sessionId, agent_id, reason });
                this.emit('agent-killed', { sessionId, agent_id, reason });
            },
        });

        this.activeSessions.set(sessionId, { phase: 'running', socket, agent_id });
        socket.start();

        return {
            status: 'running',
            sessionId,
            message: `${manifest.display_name || agent_id} started in background. Progress will appear on the HUD.`,
            task_manifest: taskManifest,
        };
    }

    detectAndDelegate(userText, emit) {
        const agentId = matchAgentIntent(userText, this.manifests);
        if (!agentId) return null;
        return this.handleDelegateRequest({ agent_id: agentId, user_request: userText }, emit);
    }

    cancelActiveAgents(reason = 'user_cancel') {
        let count = 0;
        for (const [, session] of this.activeSessions) {
            if (session.socket) {
                session.socket.kill(reason);
                count++;
            }
        }
        return count;
    }

    cancelIfUserSaysStop(text) {
        if (!/\b(cancel|stop|abort)\b/i.test(text)) return false;
        const n = this.cancelActiveAgents('user_cancel');
        return n > 0;
    }

    matchAgentIntent(userText) {
        return matchAgentIntent(userText, this.manifests);
    }
}

// Export a singleton so all modules share the same EventEmitter instance.
// We export the instance directly — all class methods (handleDelegateRequest,
// getManifest, cancelActiveAgents, etc.) are accessible via the prototype.
// DO NOT add named proxy wrappers here: they would become own-properties on
// the instance, shadow the prototype methods, and cause infinite recursion.
const orchestrator = new Orchestrator();

module.exports = orchestrator;

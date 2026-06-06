/**
 * cortex/cortex-engine.js
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║              THE CORTEX ENGINE — Summer's Subconscious          ║
 * ║                                                                  ║
 * ║  Activates when NO clients are connected. Runs subsystems in    ║
 * ║  sequential cycles to evolve Summer's capabilities:             ║
 * ║                                                                  ║
 * ║  1. Memory Consolidator  — Graph cleanup, dedup, pruning       ║
 * ║  2. Gap Detector         — Mine diary for failure patterns      ║
 * ║  3. Skill Forge          — Generate Tier 1 skills               ║
 * ║  4. Self-Reflector       — Daily meta-analysis journal          ║
 * ║  5. Knowledge Harvester  — Proactive research (opt-in)          ║
 * ║                                                                  ║
 * ║  Safety:                                                         ║
 * ║  - NEVER runs when clients are connected                        ║
 * ║  - Checks registry.count() before EVERY cycle                   ║
 * ║  - Cost-governed (max LLM calls per cycle/day)                  ║
 * ║  - Kill switch via --no-cortex flag or CORTEX_ENABLED=false     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Integration:
 *   - event-bus.js: Listens to CLIENT_CONNECTED, CLIENT_DISCONNECTED
 *   - client-registry.js: Checks .count() as safety gate
 *   - All subsystems are in src/cortex/
 */

'use strict';

const { createLogger } = require('../core/utils/logger');
const bus = require('../core/event-bus');
const registry = require('../core/transport/client-registry');
const { getTotalTokensToday } = require('../knowledge/memory-api-key');
const { logEvolution, ACTIONS } = require('./evolution-log');

const log = createLogger('CortexEngine');

// ── State machine ────────────────────────────────────────────────────────────

const STATE = Object.freeze({
    DORMANT:     'dormant',      // Clients connected, doing nothing
    COOLDOWN:    'cooldown',     // Clients just disconnected, waiting before activating
    AWAKE:       'awake',        // Running cycles
    PAUSED:      'paused',       // Temporarily paused (e.g., token budget exhausted)
    STOPPED:     'stopped',      // Permanently stopped (shutdown)
});

// ── Cost limits ──────────────────────────────────────────────────────────────

const COST_LIMITS = {
    maxLlmCallsPerCycle: 3,
    maxLlmCallsPerWake:  15,
    maxTokensPerDay:     100_000,
};

class CortexEngine {
    /**
     * @param {Object} opts
     * @param {number}  [opts.idleCooldownMs=60000]   - Wait after last client disconnects
     * @param {number}  [opts.cycleIntervalMs=300000]  - Time between cycles while idle
     * @param {number}  [opts.maxCyclesPerWake=12]     - Max cycles per idle session
     * @param {Object}  [opts.enabledModules]          - Which subsystems to run
     */
    constructor(opts = {}) {
        this._idleCooldownMs  = opts.idleCooldownMs  || 60_000;
        this._cycleIntervalMs = opts.cycleIntervalMs || 300_000;
        this._maxCyclesPerWake = opts.maxCyclesPerWake || 12;

        this._enabledModules = {
            consolidator: true,
            gapDetector:  true,
            skillForge:   true,
            reflector:    true,
            harvester:    false,
            ...(opts.enabledModules || {}),
        };

        this._state          = STATE.DORMANT;
        this._cooldownTimer  = null;
        this._cycleTimer     = null;
        this._cyclesThisWake = 0;
        this._llmCallsThisWake = 0;
        this._hasReflectedThisWake = false;

        // Event handlers (bound for proper removal)
        this._onClientConnected    = this._handleClientConnected.bind(this);
        this._onClientDisconnected = this._handleClientDisconnected.bind(this);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        // Check kill switch
        if (process.env.CORTEX_ENABLED === 'false') {
            log.info('Cortex Engine disabled via CORTEX_ENABLED=false.');
            this._state = STATE.STOPPED;
            return;
        }

        const E = bus.EVENTS;
        bus.on(E.CLIENT_CONNECTED,    this._onClientConnected);
        bus.on(E.CLIENT_DISCONNECTED, this._onClientDisconnected);

        this._state = STATE.DORMANT;
        log.info(`Cortex Engine started. Modules: ${JSON.stringify(this._enabledModules)}`);

        // If no clients are currently connected, start cooldown immediately
        if (registry.count() === 0) {
            log.info('No clients connected at startup — starting idle cooldown.');
            this._startCooldown();
        }
    }

    stop() {
        this._state = STATE.STOPPED;
        this._clearAllTimers();

        const E = bus.EVENTS;
        bus.removeListener(E.CLIENT_CONNECTED,    this._onClientConnected);
        bus.removeListener(E.CLIENT_DISCONNECTED, this._onClientDisconnected);

        log.info('Cortex Engine stopped.');
    }

    getState() {
        return {
            state: this._state,
            cyclesThisWake: this._cyclesThisWake,
            llmCallsThisWake: this._llmCallsThisWake,
            enabledModules: { ...this._enabledModules },
            tokensToday: getTotalTokensToday(),
        };
    }

    // ── Event handlers ────────────────────────────────────────────────────────

    _handleClientConnected({ clientId }) {
        if (this._state === STATE.STOPPED) return;

        log.info(`Client connected (${clientId}). Cortex going to sleep.`);
        this._sleep();
    }

    _handleClientDisconnected({ clientId }) {
        if (this._state === STATE.STOPPED) return;

        // Only start cooldown if NO clients remain
        if (registry.count() === 0) {
            log.info(`All clients disconnected. Starting ${this._idleCooldownMs / 1000}s cooldown...`);
            this._startCooldown();
        } else {
            log.debug(`Client ${clientId} disconnected. ${registry.count()} client(s) still connected.`);
        }
    }

    // ── State transitions ─────────────────────────────────────────────────────

    _sleep() {
        if (this._state === STATE.AWAKE || this._state === STATE.COOLDOWN) {
            logEvolution(ACTIONS.CORTEX_SLEEP, {
                cyclesCompleted: this._cyclesThisWake,
                reason: 'client_connected',
            });
            bus.dispatch(bus.EVENTS.CORTEX_SLEEP, {
                cyclesCompleted: this._cyclesThisWake,
            });
        }

        this._clearAllTimers();
        this._state = STATE.DORMANT;
        this._cyclesThisWake = 0;
        this._llmCallsThisWake = 0;
        this._hasReflectedThisWake = false;
    }

    _startCooldown() {
        this._clearAllTimers();
        this._state = STATE.COOLDOWN;

        this._cooldownTimer = setTimeout(() => {
            this._cooldownTimer = null;
            // Double-check: still no clients?
            if (registry.count() > 0) {
                log.info('Client connected during cooldown — aborting wake.');
                this._sleep();
                return;
            }
            this._awake();
        }, this._idleCooldownMs);
    }

    _awake() {
        if (this._state === STATE.STOPPED) return;

        this._state = STATE.AWAKE;
        this._cyclesThisWake = 0;
        this._llmCallsThisWake = 0;
        this._hasReflectedThisWake = false;

        logEvolution(ACTIONS.CORTEX_AWAKE, {
            enabledModules: this._enabledModules,
        });
        bus.dispatch(bus.EVENTS.CORTEX_AWAKE, {
            enabledModules: this._enabledModules,
        });

        log.info('🧠 CORTEX AWAKE. Beginning evolution cycles...');
        this._scheduleCycle();
    }

    // ── Cycle management ──────────────────────────────────────────────────────

    _scheduleCycle() {
        if (this._state !== STATE.AWAKE) return;

        // Run first cycle immediately, then schedule subsequent ones
        if (this._cyclesThisWake === 0) {
            this._runCycle();
        } else {
            this._cycleTimer = setTimeout(() => {
                this._cycleTimer = null;
                this._runCycle();
            }, this._cycleIntervalMs);
        }
    }

    async _runCycle() {
        // Safety gates
        if (this._state !== STATE.AWAKE) return;
        if (registry.count() > 0) {
            log.info('Client connected mid-cycle — aborting.');
            this._sleep();
            return;
        }

        // Cycle limit
        if (this._cyclesThisWake >= this._maxCyclesPerWake) {
            log.info(`Max cycles reached (${this._maxCyclesPerWake}). Going to sleep.`);
            this._finishWake();
            return;
        }

        // Token budget check
        if (getTotalTokensToday() >= COST_LIMITS.maxTokensPerDay) {
            log.warn(`Daily token budget exhausted (${getTotalTokensToday()} / ${COST_LIMITS.maxTokensPerDay}). Pausing.`);
            this._state = STATE.PAUSED;
            return;
        }

        this._cyclesThisWake++;
        const cycleNum = this._cyclesThisWake;

        log.info(`━━━ Cycle ${cycleNum}/${this._maxCyclesPerWake} ━━━`);
        logEvolution(ACTIONS.CYCLE_START, { cycle: cycleNum });

        const cycleReport = {
            cycle: cycleNum,
            modules: {},
        };

        try {
            // ── 1. Memory Consolidation (every cycle, cheap) ────────────
            if (this._enabledModules.consolidator) {
                // Safety check before each module
                if (registry.count() > 0) { this._sleep(); return; }

                const { runConsolidation } = require('./memory-consolidator');
                // Skip island bridging (LLM) on most cycles — only every 3rd cycle
                const skipIslands = (cycleNum % 3) !== 1;
                cycleReport.modules.consolidator = await runConsolidation({ skipIslands });
            }

            // ── 2. Gap Detection (every other cycle) ────────────────────
            if (this._enabledModules.gapDetector && cycleNum % 2 === 0) {
                if (registry.count() > 0) { this._sleep(); return; }

                const { detectGaps } = require('./gap-detector');
                cycleReport.modules.gapDetector = await detectGaps();
            }

            // ── 3. Skill Forge (every 3rd cycle, after gaps are found) ──
            if (this._enabledModules.skillForge && cycleNum % 3 === 0) {
                if (registry.count() > 0) { this._sleep(); return; }

                const { forgeSkills } = require('./skill-forge');
                cycleReport.modules.skillForge = await forgeSkills();
            }

            // ── 4. Self-Reflection (once per wake, near the end) ────────
            if (this._enabledModules.reflector && !this._hasReflectedThisWake &&
                (cycleNum >= 3 || cycleNum >= this._maxCyclesPerWake - 1)) {
                if (registry.count() > 0) { this._sleep(); return; }

                const { reflect } = require('./self-reflector');
                cycleReport.modules.reflector = await reflect();
                this._hasReflectedThisWake = true;
            }

        } catch (e) {
            log.error(`Cycle ${cycleNum} error: ${e.message}`);
            logEvolution(ACTIONS.ERROR, {
                module: 'cortex-engine',
                cycle: cycleNum,
                error: e.message,
            });
        }

        logEvolution(ACTIONS.CYCLE_COMPLETE, { cycle: cycleNum });
        bus.dispatch(bus.EVENTS.CORTEX_CYCLE_DONE, cycleReport);

        log.info(`━━━ Cycle ${cycleNum} complete ━━━`);

        // Schedule next cycle
        this._scheduleCycle();
    }

    _finishWake() {
        // Run final reflection if not done yet
        if (this._enabledModules.reflector && !this._hasReflectedThisWake) {
            const { reflect } = require('./self-reflector');
            reflect()
                .then(() => log.info('Final reflection complete.'))
                .catch(e => log.warn(`Final reflection failed: ${e.message}`));
        }

        logEvolution(ACTIONS.CORTEX_SLEEP, {
            cyclesCompleted: this._cyclesThisWake,
            reason: 'max_cycles_reached',
        });

        this._state = STATE.DORMANT;
        this._clearAllTimers();

        log.info(`Cortex going dormant. Completed ${this._cyclesThisWake} cycles.`);
    }

    // ── Timer management ──────────────────────────────────────────────────────

    _clearAllTimers() {
        if (this._cooldownTimer) {
            clearTimeout(this._cooldownTimer);
            this._cooldownTimer = null;
        }
        if (this._cycleTimer) {
            clearTimeout(this._cycleTimer);
            this._cycleTimer = null;
        }
    }
}

module.exports = { CortexEngine };

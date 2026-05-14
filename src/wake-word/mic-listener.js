/**
 * mic-listener.js — Persistent Microphone Capture for Main Process
 * 
 * Spawns sox/rec as a child process to capture 16kHz, 16-bit, mono PCM audio.
 * This runs headlessly in the Electron main process — independent of any
 * renderer window state — ensuring wake-word detection works even when
 * the app is minimized or backgrounded.
 */

const { spawn, execSync } = require('child_process');
const EventEmitter = require('events');
const path = require('path');

class MicListener extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sampleRate = options.sampleRate || 16000;
    this.channels = options.channels || 1;
    this.bitDepth = options.bitDepth || 16;
    this.proc = null;
    this.isRunning = false;
    this._isPaused = false;

    // Detect the recording command available on this system
    this.recCommand = this._detectRecCommand();
  }

  /**
   * Detect whether `rec` (sox) or `arecord` is available.
   */
  _detectRecCommand() {
    try {
      execSync('which rec', { stdio: 'pipe' });
      return 'rec';
    } catch {
      try {
        execSync('which arecord', { stdio: 'pipe' });
        return 'arecord';
      } catch {
        return null;
      }
    }
  }

  /**
   * Build the command-line arguments for the recording process.
   */
  _buildArgs() {
    if (this.recCommand === 'rec') {
      return [
        '-q',                      // Quiet — no progress output
        '-r', String(this.sampleRate),
        '-e', 'signed-integer',
        '-b', String(this.bitDepth),
        '-c', String(this.channels),
        '-t', 'raw',               // Raw PCM to stdout
        '-L',                      // Little-endian
        '-'                        // Output to stdout
      ];
    } else if (this.recCommand === 'arecord') {
      return [
        '-q',
        '-r', String(this.sampleRate),
        '-f', `S${this.bitDepth}_LE`,
        '-c', String(this.channels),
        '-t', 'raw',
        '-'
      ];
    }
    return [];
  }

  /**
   * Start capturing microphone audio.
   * Emits 'audio' events with raw PCM Buffer chunks.
   */
  start() {
    if (this.isRunning) {
      console.warn('[MicListener] Already running.');
      return;
    }

    if (!this.recCommand) {
      console.error('[MicListener] Neither `rec` (sox) nor `arecord` found. Install sox: brew install sox');
      this.emit('error', new Error('No recording tool found. Install sox: brew install sox'));
      return;
    }

    const args = this._buildArgs();
    console.log(`[MicListener] Starting: ${this.recCommand} ${args.join(' ')}`);

    try {
      this.proc = spawn(this.recCommand, args, {
        stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr all piped
      });

      this.isRunning = true;
      this._isPaused = false;

      this.proc.stdout.on('data', (chunk) => {
        if (!this._isPaused) {
          this.emit('audio', chunk);
        }
      });

      this.proc.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('WARN')) {
          console.warn(`[MicListener] stderr: ${msg}`);
        }
      });

      this.proc.on('error', (err) => {
        console.error('[MicListener] Process error:', err.message);
        this.isRunning = false;
        this.emit('error', err);
      });

      this.proc.on('close', (code) => {
        console.log(`[MicListener] Process exited with code ${code}`);
        this.isRunning = false;
        this.emit('close', code);
      });

      this.emit('started');
      console.log('[MicListener] Microphone capture active.');

    } catch (err) {
      console.error('[MicListener] Failed to spawn recording process:', err.message);
      this.isRunning = false;
      this.emit('error', err);
    }
  }

  /**
   * Pause audio processing without killing the mic process.
   * The process keeps running (no mic re-acquisition delay on resume).
   */
  pause() {
    this._isPaused = true;
    console.log('[MicListener] Paused (mic still capturing, but audio is discarded).');
  }

  /**
   * Resume audio processing after a pause.
   */
  resume() {
    this._isPaused = false;
    console.log('[MicListener] Resumed.');
  }

  /**
   * Completely stop the microphone capture process.
   */
  stop() {
    if (this.proc) {
      try {
        this.proc.kill('SIGTERM');
      } catch (e) {
        // Process may already be dead
      }
      this.proc = null;
    }
    this.isRunning = false;
    this._isPaused = false;
    console.log('[MicListener] Stopped.');
  }

  /**
   * Check if sox/rec is available on this system.
   */
  static isAvailable() {
    try {
      execSync('which rec', { stdio: 'pipe' });
      return true;
    } catch {
      try {
        execSync('which arecord', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    }
  }
}

module.exports = { MicListener };

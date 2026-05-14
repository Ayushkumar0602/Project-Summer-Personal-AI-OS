/**
 * audio-gate.js — Lightweight Audio Gate for Speech Detection
 * 
 * Filters out silence and obvious noise before audio reaches the wake-word
 * ONNX pipeline. Keeps it simple and fast to avoid blocking real-time audio.
 * 
 * Layers:
 *   1. Adaptive Energy Gate — rejects below dynamic noise floor
 *   2. Zero-Crossing Rate — speech falls in a distinct ZCR band
 */

class AudioGate {
  constructor(options = {}) {
    // Layer 1: Energy gate
    this.noiseFloor = 0.005;
    this.noiseFloorAlpha = options.noiseFloorAlpha || 0.02;
    this.energyMultiplier = options.energyMultiplier || 3.0;

    // Layer 2: Zero-crossing rate
    this.zcrMin = options.zcrMin || 0.01;
    this.zcrMax = options.zcrMax || 0.25;

    // Smoothing
    this.consecutiveSpeechFrames = 0;
    this.minConsecutiveFrames = options.minConsecutiveFrames || 1;

    // Stats
    this.stats = { passed: 0, rejected: 0, lastRms: 0, lastZcr: 0 };
  }

  _updateNoiseFloor(rms) {
    if (rms < this.noiseFloor * 3 && rms > 0.0001) {
      this.noiseFloor = this.noiseFloorAlpha * rms + (1 - this.noiseFloorAlpha) * this.noiseFloor;
    }
    this.noiseFloor = Math.max(0.001, Math.min(0.05, this.noiseFloor));
  }

  _rms(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  _zeroCrossingRate(samples) {
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings++;
    }
    return crossings / samples.length;
  }

  /**
   * Is this audio chunk likely speech (or at least active audio worth analyzing)?
   * Intentionally permissive — the ONNX model does the real classification.
   */
  isSpeechLikely(samples) {
    if (!samples || samples.length < 64) return false;

    const rms = this._rms(samples);
    this._updateNoiseFloor(rms);
    this.stats.lastRms = rms;

    // Layer 1: Energy gate — must be above noise floor
    if (rms < this.noiseFloor * this.energyMultiplier) {
      this.consecutiveSpeechFrames = 0;
      this.stats.rejected++;
      return false;
    }

    // Layer 2: ZCR — reject pure tones and very high-frequency noise
    const zcr = this._zeroCrossingRate(samples);
    this.stats.lastZcr = zcr;
    if (zcr < this.zcrMin || zcr > this.zcrMax) {
      this.consecutiveSpeechFrames = 0;
      this.stats.rejected++;
      return false;
    }

    this.consecutiveSpeechFrames++;
    if (this.consecutiveSpeechFrames >= this.minConsecutiveFrames) {
      this.stats.passed++;
      return true;
    }
    return false;
  }

  reset() {
    this.consecutiveSpeechFrames = 0;
    this.noiseFloor = 0.005;
    this.stats = { passed: 0, rejected: 0, lastRms: 0, lastZcr: 0 };
  }

  getStats() {
    return {
      ...this.stats,
      noiseFloor: this.noiseFloor,
      consecutiveSpeechFrames: this.consecutiveSpeechFrames
    };
  }
}

module.exports = { AudioGate };

/**
 * Voice activity detection over 16 kHz mono Float32 frames.
 *
 * Replaces the fixed 3.5 s window that cut mid-word: segments now end when the speaker
 * stops, not when a clock ticks. The noise floor adapts, so a noisy room raises the bar
 * instead of transcribing hiss.
 *
 * Deliberately dependency-free — see docs/BUILD-PLAN.md Phase 3 for why a neural VAD
 * was not used. `createSegmenter` is the seam a Silero/ONNX backend would slot into.
 */

const DEFAULTS = {
  // Speech must sit this many times above the running noise floor.
  activationRatio: 2.6,
  // Falling back below this ratio starts the hangover countdown.
  releaseRatio: 1.6,
  // Absolute floor so a silent room cannot make any breath count as speech.
  minAbsoluteRms: 0.006,
  // Ignore blips shorter than this.
  minSpeechMs: 260,
  // Keep the segment open across natural pauses.
  hangoverMs: 700,
  // Force a cut on monologues so the transcript keeps flowing.
  maxSegmentMs: 15000,
  // How fast the noise floor tracks the room.
  noiseAdaptation: 0.02
};

function rmsOf(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

export function createSegmenter(options = {}) {
  const config = { ...DEFAULTS, ...options };

  let noiseFloor = config.minAbsoluteRms;
  let speaking = false;
  let speechStartedAt = 0;
  let lastLoudAt = 0;
  let elapsedMs = 0;

  return {
    /**
     * @param {Float32Array} frame one audio buffer
     * @param {number} frameMs its duration in milliseconds
     * @returns {'start'|'end'|null} boundary crossed by this frame, if any
     */
    push(frame, frameMs) {
      elapsedMs += frameMs;
      const rms = rmsOf(frame);

      // Adapt the floor only while nobody is talking.
      if (!speaking) {
        noiseFloor = noiseFloor * (1 - config.noiseAdaptation) + rms * config.noiseAdaptation;
        noiseFloor = Math.max(noiseFloor, config.minAbsoluteRms * 0.5);
      }

      const threshold = Math.max(config.minAbsoluteRms, noiseFloor * config.activationRatio);
      const release = Math.max(config.minAbsoluteRms * 0.8, noiseFloor * config.releaseRatio);

      if (!speaking) {
        if (rms >= threshold) {
          speaking = true;
          speechStartedAt = elapsedMs;
          lastLoudAt = elapsedMs;
          return 'start';
        }
        return null;
      }

      if (rms >= release) lastLoudAt = elapsedMs;

      const silentFor = elapsedMs - lastLoudAt;
      const spokenFor = elapsedMs - speechStartedAt;

      if (silentFor >= config.hangoverMs || spokenFor >= config.maxSegmentMs) {
        speaking = false;
        // Too short to be speech: withdraw the segment rather than transcribing a cough.
        if (spokenFor - silentFor < config.minSpeechMs && spokenFor < config.maxSegmentMs) {
          return 'abort';
        }
        return 'end';
      }
      return null;
    },

    isSpeaking() {
      return speaking;
    },

    /** Diagnostics for the settings UI. */
    levels() {
      return { noiseFloor, speaking };
    },

    reset() {
      speaking = false;
      noiseFloor = config.minAbsoluteRms;
      elapsedMs = 0;
    }
  };
}

export const VAD_DEFAULTS = DEFAULTS;

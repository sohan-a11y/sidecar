const Providers = require('../providers');
const RateLimiter = require('../RateLimiter');

/**
 * The pre-Phase-3 path, kept and selectable: buffer a speech segment, mux it to WAV,
 * post it to a provider's transcription endpoint. Now driven by VAD boundaries instead
 * of a 3.5 s clock, so it no longer cuts mid-word.
 */
module.exports = {
  id: 'batch',
  name: 'Batch (upload per utterance)',
  streaming: false,
  requiresKey: true,
  supportsCodeSwitching: true,

  /**
   * @param {Buffer} wav complete utterance
   * @returns {Promise<string>}
   */
  async transcribeSegment({ providerId, apiKey, baseUrl, model, language, wav }) {
    const adapter = Providers.get(providerId);
    if (!adapter.transcribe) throw new Error(`${adapter.name} cannot transcribe audio.`);

    return RateLimiter.schedule(providerId, { priority: 'user' }, () =>
      adapter.transcribe({ apiKey, baseUrl, model, language, wav })
    );
  }
};

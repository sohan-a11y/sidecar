const Providers = require('./providers');
const SettingsManager = require('./SettingsManager');
const RateLimiter = require('./RateLimiter');

// Cheap pre-gate so dead air never costs a request. Phase 3 replaces this with real VAD.
const SILENCE_RMS_THRESHOLD = 250;

/**
 * Turns raw 16 kHz mono Int16 PCM into text via whichever adapter the user configured
 * for speech-to-text. STT provider and key are independent of the chat provider
 * (BUILD-PLAN 0.4), so picking Anthropic for chat no longer kills transcription.
 */
class TranscriptionService {
  constructor() {
    this.onStatus = null;
  }

  status(message) {
    if (typeof this.onStatus === 'function') this.onStatus(message);
  }

  /** Which STT provider is configured, and can it actually run? */
  readiness() {
    const eff = SettingsManager.effective();
    const { provider, apiKey, baseUrl } = eff.stt;

    if (!Providers.has(provider)) {
      return { ready: false, reason: `Unknown transcription provider "${provider}". Pick one in Settings.` };
    }
    const adapter = Providers.get(provider);
    if (!adapter.capabilities.transcription || typeof adapter.transcribe !== 'function') {
      return { ready: false, reason: `${adapter.name} cannot transcribe audio. Choose another transcription provider in Settings.` };
    }
    if (!apiKey && provider !== 'custom') {
      return { ready: false, reason: `Transcription needs a ${adapter.name} API key. Add one in Settings.` };
    }
    if (adapter.requiresBaseUrl && !baseUrl) {
      return { ready: false, reason: `${adapter.name} transcription needs a base URL. Add one in Settings.` };
    }
    return { ready: true, provider, adapter, eff };
  }

  /**
   * @param {Buffer} pcmBuffer raw 16-bit little-endian mono PCM at 16 kHz
   * @param {'user'|'system'} sourceChannel which side of the call this came from
   * @returns {Promise<string>} transcript text, or '' when the chunk was silence
   */
  async transcribe(pcmBuffer, sourceChannel = 'unknown') {
    if (!pcmBuffer || pcmBuffer.length === 0) return '';

    const rms = this.calculateRms(pcmBuffer);
    if (rms < SILENCE_RMS_THRESHOLD) return '';

    const state = this.readiness();
    if (!state.ready) {
      const err = new Error(state.reason);
      err.code = 'STT_NOT_READY';
      throw err;
    }

    const { adapter, eff, provider } = state;
    const wav = this.pcmToWav(pcmBuffer, 16000);

    console.log(`[TranscriptionService] ${provider} <- ${sourceChannel} chunk, RMS ${rms.toFixed(0)}`);

    // Transcription is deliberate background work the user switched on, so it rides at
    // 'user' priority; Phase 4's auto-answers are the ones that must yield.
    return RateLimiter.schedule(
      provider,
      {
        priority: 'user',
        onRetry: ({ attempt, status }) => {
          this.status(`Transcription retry ${attempt} of 3 (${status || 'network error'}).`);
        }
      },
      () => adapter.transcribe({
        apiKey: eff.stt.apiKey,
        baseUrl: eff.stt.baseUrl,
        model: eff.stt.model,
        language: eff.stt.language,
        wav
      })
    );
  }

  calculateRms(buf) {
    let sum = 0;
    const samples = buf.length / 2;
    for (let i = 0; i < buf.length; i += 2) {
      if (i + 1 < buf.length) {
        const val = buf.readInt16LE(i);
        sum += val * val;
      }
    }
    return Math.sqrt(sum / samples);
  }

  /** Minimal 44-byte RIFF header + raw samples. Providers all accept this. */
  pcmToWav(pcmBuffer, sampleRate = 16000) {
    const wavHeader = Buffer.alloc(44);
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmBuffer.length;
    const fileSize = 36 + dataSize;

    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(fileSize, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(numChannels, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(byteRate, 28);
    wavHeader.writeUInt16LE(blockAlign, 32);
    wavHeader.writeUInt16LE(bitsPerSample, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(dataSize, 40);

    return Buffer.concat([wavHeader, pcmBuffer]);
  }
}

module.exports = new TranscriptionService();

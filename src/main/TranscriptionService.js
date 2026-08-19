const Providers = require('./providers');
const SttEngines = require('./stt');
const SettingsManager = require('./SettingsManager');

// Cheap pre-gate so dead air never costs a request, kept in front of the VAD.
const SILENCE_RMS_THRESHOLD = 250;
const CHANNELS = ['user', 'system'];

/**
 * Per-channel speech-to-text. Streaming engines hold one socket per channel so the two
 * speakers never bleed into each other; the batch engine buffers a VAD-delimited
 * utterance and uploads it.
 *
 * Emits { text, isFinal, channel, startMs, endMs, confidence } — no consumer assumes
 * fixed 3.5 s chunks or English (BUILD-PLAN 3 Contract).
 */
class TranscriptionService {
  constructor() {
    this.onResult = null;
    this.onStatus = null;
    this.sessions = { user: null, system: null };
    this.active = false;
    this.degraded = false;
  }

  status(message) {
    if (typeof this.onStatus === 'function') this.onStatus(message);
  }

  config() {
    const settings = SettingsManager.get();
    const eff = SettingsManager.effective();
    const engineId = this.degraded ? 'batch' : settings.stt.engine || 'batch';
    return {
      engineId,
      engine: SttEngines.has(engineId) ? SttEngines.get(engineId) : SttEngines.get('batch'),
      languages: settings.stt.languages || { user: 'auto', system: 'auto' },
      engineKeys: settings.stt.engineKeys || {},
      engineModels: settings.stt.engineModels || {},
      provider: eff.stt
    };
  }

  /** Whether transcription can run right now, and why not if it cannot. */
  readiness() {
    const { engineId, engine, engineKeys, provider } = this.config();

    if (engine.streaming) {
      if (!engineKeys[engineId]) {
        return {
          ready: false,
          reason: `${engine.name} needs an API key. Add one in Settings → Speech.`
        };
      }
      return { ready: true, streaming: true };
    }

    if (!Providers.has(provider.provider)) {
      return { ready: false, reason: `Unknown transcription provider "${provider.provider}".` };
    }
    const adapter = Providers.get(provider.provider);
    if (!adapter.capabilities.transcription || typeof adapter.transcribe !== 'function') {
      return {
        ready: false,
        reason: `${adapter.name} cannot transcribe audio. Choose another provider in Settings.`
      };
    }
    if (!provider.apiKey && provider.provider !== 'custom') {
      return {
        ready: false,
        reason: `Transcription needs a ${adapter.name} API key. Add one in Settings.`
      };
    }
    if (adapter.requiresBaseUrl && !provider.baseUrl) {
      return { ready: false, reason: `${adapter.name} transcription needs a base URL.` };
    }
    return { ready: true, streaming: false };
  }

  // ------------------------------------------------------------------- lifecycle

  start() {
    this.active = true;
    const { engine } = this.config();
    if (!engine.streaming) return;

    const state = this.readiness();
    if (!state.ready) {
      this.status(state.reason);
      return;
    }
    for (const channel of CHANNELS) this.openChannel(channel);
  }

  openChannel(channel) {
    const { engineId, engine, engineKeys, engineModels, languages } = this.config();
    if (!engine.streaming || this.sessions[channel]) return;

    this.sessions[channel] = engine.createSession(
      {
        apiKey: engineKeys[engineId],
        model: engineModels[engineId] || engine.defaultModel,
        language: languages[channel] || 'auto',
        sampleRate: 16000,
        channel
      },
      {
        onResult: (result) => {
          if (typeof this.onResult === 'function') {
            this.onResult({ ...result, channel });
          }
        },
        onError: (err) => {
          console.warn(`[TranscriptionService] ${engineId} ${channel} socket error:`, err.message);
        },
        onGiveUp: () => {
          // Repeated failures: drop to batch rather than silently transcribing nothing.
          if (this.degraded) return;
          this.degraded = true;
          this.closeAll();
          this.status(
            `${engine.name} kept dropping the connection — falling back to batch transcription.`
          );
        }
      }
    );
  }

  stop() {
    this.active = false;
    this.closeAll();
  }

  closeAll() {
    for (const channel of CHANNELS) {
      if (this.sessions[channel]) {
        this.sessions[channel].close();
        this.sessions[channel] = null;
      }
    }
  }

  /** Clear a runtime downgrade so a settings change gets a fresh attempt. */
  reset() {
    this.degraded = false;
    this.closeAll();
    if (this.active) this.start();
  }

  isStreaming() {
    return this.config().engine.streaming && !this.degraded;
  }

  // ----------------------------------------------------------------------- audio

  /** Continuous audio for streaming engines. Batch engines ignore this. */
  pushAudio(channel, pcm) {
    const session = this.sessions[channel];
    if (session) session.sendAudio(pcm);
  }

  /**
   * One complete utterance, delimited by VAD. Only used by the batch engine.
   * @returns {Promise<string>} '' when the segment was silence
   */
  async transcribeSegment(pcmBuffer, channel = 'unknown') {
    if (!pcmBuffer || pcmBuffer.length === 0) return '';

    const rms = this.calculateRms(pcmBuffer);
    if (rms < SILENCE_RMS_THRESHOLD) return '';

    const state = this.readiness();
    if (!state.ready) {
      const err = new Error(state.reason);
      err.code = 'STT_NOT_READY';
      throw err;
    }

    const { provider, languages } = this.config();
    const wav = this.pcmToWav(pcmBuffer, 16000);
    const batch = SttEngines.get('batch');

    return batch.transcribeSegment({
      providerId: provider.provider,
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
      language: languages[channel] || 'auto',
      wav
    });
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

    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + dataSize, 4);
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

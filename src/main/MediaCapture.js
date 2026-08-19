const { desktopCapturer, screen } = require('electron');
const SettingsManager = require('./SettingsManager');

// 16 kHz mono Int16 is 32 kB/s; cap a channel's buffer at 60 s so a VAD that never
// closes cannot grow without bound.
const MAX_CHANNEL_BYTES = 32000 * 60;

// Hamming distance below this counts as "the screen did not change".
const HASH_MATCH_THRESHOLD = 4;

class MediaCapture {
  constructor() {
    this.audioBuffers = { user: [], system: [] };
    this.isListening = false;
    this.lastHash = null;
  }

  // ---------------------------------------------------------------- capture target

  /** Screens and windows the user can pick from, with thumbnails for the picker. */
  async listSources() {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 240, height: 150 }
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL()
    }));
  }

  /**
   * Average-hash of the frame, for change detection. Downscales to 8x8 and compares each
   * pixel's luminance to the mean — an unchanged screen must not burn a request.
   */
  averageHash(image) {
    const small = image.resize({ width: 8, height: 8, quality: 'good' });
    const bitmap = small.toBitmap(); // BGRA
    const luma = [];
    for (let i = 0; i < bitmap.length; i += 4) {
      luma.push(0.114 * bitmap[i] + 0.587 * bitmap[i + 1] + 0.299 * bitmap[i + 2]);
    }
    const mean = luma.reduce((a, b) => a + b, 0) / (luma.length || 1);
    return luma.map((v) => (v >= mean ? '1' : '0')).join('');
  }

  hammingDistance(a, b) {
    if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
    let distance = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) distance += 1;
    return distance;
  }

  /**
   * Grab the configured screen or window, cropped to the saved region and downscaled.
   * @returns {Promise<{ dataUrl: string|null, unchanged: boolean, source: string }>}
   */
  async capture({ force = false } = {}) {
    const config = SettingsManager.get().capture || {};
    const maxWidth = config.maxWidth || 1280;

    // Ask for a thumbnail no larger than we intend to send: 1920x1080 PNG data URLs are
    // wasteful on both latency and tokens.
    const display = screen.getPrimaryDisplay();
    const aspect = display.size.height / display.size.width;
    const sources = await desktopCapturer.getSources({
      types:
        config.sourceId && config.sourceId.startsWith('window:')
          ? ['window']
          : ['screen', 'window'],
      thumbnailSize: { width: maxWidth, height: Math.round(maxWidth * aspect) }
    });

    if (!sources || sources.length === 0) throw new Error('No display capture source found.');

    const chosen = (config.sourceId && sources.find((s) => s.id === config.sourceId)) || sources[0];
    let image = chosen.thumbnail;
    if (image.isEmpty()) throw new Error('The selected capture source returned an empty frame.');

    const region = config.region;
    if (region && region.width > 0 && region.height > 0) {
      const size = image.getSize();
      // Region is stored as fractions so it survives a resolution change.
      const rect = {
        x: Math.round(region.x * size.width),
        y: Math.round(region.y * size.height),
        width: Math.round(region.width * size.width),
        height: Math.round(region.height * size.height)
      };
      if (rect.width > 8 && rect.height > 8) image = image.crop(rect);
    }

    const hash = this.averageHash(image);
    const unchanged =
      !force &&
      config.skipUnchanged !== false &&
      this.hammingDistance(hash, this.lastHash) <= HASH_MATCH_THRESHOLD;

    this.lastHash = hash;

    return {
      dataUrl: unchanged ? null : image.toDataURL(),
      unchanged,
      source: chosen.name
    };
  }

  /** Back-compat entry point: returns a data URL or throws. */
  async takeScreenshot() {
    const result = await this.capture({ force: true });
    return result.dataUrl;
  }

  resetChangeDetection() {
    this.lastHash = null;
  }

  // ------------------------------------------------------------------------- audio

  toggleListening(state) {
    this.isListening = state;
    if (!state) this.clearBuffers();
    return this.isListening;
  }

  /** @returns {Buffer|null} the chunk, so streaming engines can forward it as it arrives */
  appendAudioChunk(source, arrayBuffer) {
    if (!this.isListening) return null;
    if (source !== 'user' && source !== 'system') return null;

    const buffer = Buffer.from(arrayBuffer);
    this.audioBuffers[source].push(buffer);

    let total = 0;
    for (const chunk of this.audioBuffers[source]) total += chunk.length;
    while (total > MAX_CHANNEL_BYTES && this.audioBuffers[source].length > 1) {
      total -= this.audioBuffers[source].shift().length;
    }
    return buffer;
  }

  getAndFlushAudio(source) {
    const chunks = this.audioBuffers[source];
    if (!chunks || chunks.length === 0) return null;
    this.audioBuffers[source] = [];
    return Buffer.concat(chunks);
  }

  clearChannel(source) {
    if (this.audioBuffers[source]) this.audioBuffers[source] = [];
  }

  clearBuffers() {
    this.audioBuffers.user = [];
    this.audioBuffers.system = [];
  }
}

module.exports = new MediaCapture();

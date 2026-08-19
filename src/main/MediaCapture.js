const { desktopCapturer } = require('electron');

class MediaCapture {
  constructor() {
    this.audioBuffers = {
      user: [],
      system: []
    };
    this.isListening = false;
  }

  async takeScreenshot() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      });

      if (!sources || sources.length === 0) {
        throw new Error('No display capture source found.');
      }

      // Return the image data URL of the first screen
      return sources[0].thumbnail.toDataURL();
    } catch (e) {
      console.error('[MediaCapture] Failed to capture screen:', e);
      throw e;
    }
  }

  toggleListening(state) {
    this.isListening = state;
    if (!state) {
      this.clearBuffers();
    }
    return this.isListening;
  }

  /** @returns {Buffer|null} the chunk, so streaming engines can forward it as it arrives */
  appendAudioChunk(source, arrayBuffer) {
    if (!this.isListening) return null;
    if (source !== 'user' && source !== 'system') return null;
    const buffer = Buffer.from(arrayBuffer);
    this.audioBuffers[source].push(buffer);
    // Bound the buffer: a VAD that never fires 'end' must not eat memory.
    // 16 kHz mono Int16 = 32 kB/s, so 60 s is ~1.9 MB per channel.
    let total = 0;
    for (const chunk of this.audioBuffers[source]) total += chunk.length;
    while (total > 32000 * 60 && this.audioBuffers[source].length > 1) {
      total -= this.audioBuffers[source].shift().length;
    }
    return buffer;
  }

  clearChannel(source) {
    if (this.audioBuffers[source]) this.audioBuffers[source] = [];
  }

  getAndFlushAudio(source) {
    const chunks = this.audioBuffers[source];
    if (!chunks || chunks.length === 0) return null;
    
    this.audioBuffers[source] = [];
    return Buffer.concat(chunks);
  }

  clearBuffers() {
    this.audioBuffers.user = [];
    this.audioBuffers.system = [];
  }
}

module.exports = new MediaCapture();

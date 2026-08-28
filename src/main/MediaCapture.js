const { desktopCapturer, screen } = require("electron");
const settingsManager = require("./SettingsManager");

const MAX_BUFFER_BYTES = 32000 * 60;
const HASH_THRESHOLD = 4;

class MediaCapture {
  constructor() {
    this.audioBuffers = { user: [], system: [] };
    this.isListening = false;
    this.lastHash = null;
  }

  async listSources() {
    const displays = screen.getAllDisplays();
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 200 }
    });

    return sources.map((source, index) => {
      let label = source.name;
      const isScreen = source.id.startsWith("screen:");
      if (isScreen) {
        const displayIndex = sources.filter(s => s.id.startsWith("screen:")).indexOf(source);
        const display = displays[displayIndex] || displays[0];
        label = `Screen ${displayIndex + 1}${displayIndex === 0 ? " (Primary)" : ""} [${display.bounds.width}x${display.bounds.height}]`;
      }

      return {
        id: source.id,
        name: label,
        rawName: source.name,
        type: isScreen ? "screen" : "window",
        thumbnail: source.thumbnail.isEmpty() ? "" : source.thumbnail.toDataURL()
      };
    });
  }

  averageHash(image) {
    const bitmap = image.resize({ width: 8, height: 8, quality: "good" }).toBitmap();
    const grayscale = [];
    for (let i = 0; i < bitmap.length; i += 4) {
      grayscale.push(0.114 * bitmap[i] + 0.587 * bitmap[i + 1] + 0.299 * bitmap[i + 2]);
    }
    const avg = grayscale.reduce((acc, val) => acc + val, 0) / (grayscale.length || 1);
    return grayscale.map(val => (val >= avg ? "1" : "0")).join("");
  }

  hammingDistance(str1, str2) {
    if (!str1 || !str2 || str1.length !== str2.length) return Number.MAX_SAFE_INTEGER;
    let dist = 0;
    for (let i = 0; i < str1.length; i++) {
      if (str1[i] !== str2[i]) dist++;
    }
    return dist;
  }

  async capture({ force = false, sourceId = null } = {}) {
    const capSettings = settingsManager.get().capture || {};
    const maxWidth = capSettings.maxWidth || 1280;
    const targetSourceId = sourceId || capSettings.sourceId;

    const primary = screen.getPrimaryDisplay();
    const aspectRatio = primary.size.height / primary.size.width;

    const sources = await desktopCapturer.getSources({
      types: targetSourceId && targetSourceId.startsWith("window:") ? ["window"] : ["screen", "window"],
      thumbnailSize: { width: maxWidth, height: Math.round(maxWidth * aspectRatio) }
    });

    if (!sources || sources.length === 0) {
      throw new Error("No display capture sources found.");
    }

    const selectedSource = (targetSourceId && sources.find(s => s.id === targetSourceId)) || sources[0];
    let thumbnail = selectedSource.thumbnail;

    if (thumbnail.isEmpty()) {
      throw new Error("The selected capture source returned an empty frame.");
    }

    const region = capSettings.region;
    if (region && region.width > 0 && region.height > 0) {
      const size = thumbnail.getSize();
      const cropArea = {
        x: Math.round(region.x * size.width),
        y: Math.round(region.y * size.height),
        width: Math.round(region.width * size.width),
        height: Math.round(region.height * size.height)
      };
      if (cropArea.width > 8 && cropArea.height > 8) {
        thumbnail = thumbnail.crop(cropArea);
      }
    }

    const currentHash = this.averageHash(thumbnail);
    const unchanged = !force && capSettings.skipUnchanged !== false && this.hammingDistance(currentHash, this.lastHash) <= HASH_THRESHOLD;

    this.lastHash = currentHash;

    return {
      dataUrl: unchanged ? null : thumbnail.toDataURL(),
      unchanged,
      source: selectedSource.name,
      sourceId: selectedSource.id
    };
  }

  async takeScreenshot(sourceId = null) {
    const res = await this.capture({ force: true, sourceId });
    return res.dataUrl;
  }

  resetChangeDetection() {
    this.lastHash = null;
  }

  toggleListening(active) {
    this.isListening = active;
    if (!active) this.clearBuffers();
    return this.isListening;
  }

  appendAudioChunk(source, arrayBuffer) {
    if (!this.isListening || (source !== "user" && source !== "system")) return null;
    const buf = Buffer.from(arrayBuffer);
    this.audioBuffers[source].push(buf);

    let total = 0;
    for (const b of this.audioBuffers[source]) total += b.length;
    while (total > MAX_BUFFER_BYTES && this.audioBuffers[source].length > 1) {
      total -= this.audioBuffers[source].shift().length;
    }
    return buf;
  }

  getAndFlushAudio(source) {
    const bufs = this.audioBuffers[source];
    if (!bufs || bufs.length === 0) return null;
    this.audioBuffers[source] = [];
    return Buffer.concat(bufs);
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

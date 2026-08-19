const batch = require('./batchFallback');
const deepgram = require('./deepgram');
const assemblyai = require('./assemblyai');
const openaiRealtime = require('./openaiRealtime');

const ENGINES = { batch, deepgram, assemblyai, openaiRealtime };

function get(id) {
  const engine = ENGINES[id];
  if (!engine) throw new Error(`Unknown transcription engine: ${id}`);
  return engine;
}

function has(id) {
  return Object.prototype.hasOwnProperty.call(ENGINES, id);
}

/** Serialisable descriptors for the renderer. Never includes keys. */
function list() {
  return Object.values(ENGINES).map((e) => ({
    id: e.id,
    name: e.name,
    streaming: !!e.streaming,
    requiresKey: !!e.requiresKey,
    supportsCodeSwitching: !!e.supportsCodeSwitching,
    defaultModel: e.defaultModel || '',
    docsUrl: e.docsUrl || ''
  }));
}

module.exports = { get, has, list, ids: Object.keys(ENGINES) };

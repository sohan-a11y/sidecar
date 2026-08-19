const openai = require('./openai');
const anthropic = require('./anthropic');
const gemini = require('./gemini');
const { createOpenAiCompatible } = require('./openaiCompatible');

// Seeds only. The real list comes from GET /v1/models — see BUILD-PLAN 0.2.
const TOKENROUTER_SEEDS = [
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'qwen/qwen3.8-max-free'
];

const tokenrouter = createOpenAiCompatible({
  id: 'tokenrouter',
  name: 'TokenRouter',
  baseUrl: 'https://api.tokenrouter.com/v1',
  seedModels: TOKENROUTER_SEEDS,
  transcription: false
});

// No fixed base URL: the user supplies one (Ollama, LM Studio, vLLM, OpenRouter, ...).
// Transcription is offered because /audio/transcriptions is part of the OpenAI surface;
// endpoints that don't implement it fail loudly rather than silently.
const custom = createOpenAiCompatible({
  id: 'custom',
  name: 'Custom (OpenAI-compatible)',
  baseUrl: null,
  seedModels: [],
  transcription: true
});

const REGISTRY = { openai, anthropic, gemini, tokenrouter, custom };

/** Adapter by id. Throws on unknown ids so a bad setting surfaces immediately. */
function get(id) {
  const adapter = REGISTRY[id];
  if (!adapter) throw new Error(`Unsupported provider: ${id}`);
  return adapter;
}

function has(id) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, id);
}

/** Serialisable descriptors for the renderer. Never includes keys. */
function list() {
  return Object.values(REGISTRY).map((a) => ({
    id: a.id,
    name: a.name,
    capabilities: { ...a.capabilities },
    requiresBaseUrl: !!a.requiresBaseUrl,
    defaults: { ...a.defaults }
  }));
}

/** Providers that can actually do speech-to-text (BUILD-PLAN 0.4). */
function transcriptionProviders() {
  return list().filter((a) => a.capabilities.transcription);
}

module.exports = { get, has, list, transcriptionProviders, ids: Object.keys(REGISTRY) };

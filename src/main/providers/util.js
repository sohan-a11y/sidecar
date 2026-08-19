const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Shared helpers for provider adapters.
 * Nothing in here may log an API key.
 */

/** Split a `data:image/png;base64,...` URL into its parts. Returns null if malformed. */
function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

/**
 * Write a WAV buffer to a temp file, hand the path to `fn`, then always clean up.
 * Provider SDKs disagree about whether they want a path, a stream or a blob, so the
 * temp file is the common denominator.
 */
async function withTempWav(wav, fn) {
  const dir = (() => {
    try {
      return require('electron').app.getPath('temp');
    } catch (e) {
      return os.tmpdir();
    }
  })();
  const file = path.join(
    dir,
    `sidecar_stt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}.wav`
  );
  fs.writeFileSync(file, wav);
  try {
    return await fn(file);
  } finally {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      console.warn('[Providers] Failed to clean up temp wav:', err.message);
    }
  }
}

// Models that accept image input. Used only when the provider's model list carries no
// capability metadata of its own. Deliberately conservative: a false negative costs a
// text-only answer, a false positive costs a hard API error mid-call.
const VISION_PATTERNS = [
  /gpt-4o/i,
  /gpt-4\.1/i,
  /gpt-4-turbo/i,
  /gpt-4-vision/i,
  /gpt-5/i,
  /chatgpt-4o/i,
  /^o[34](-|$)/i,
  /\bo[34]-mini/i,
  /claude-3/i,
  /claude-4/i,
  /claude-opus/i,
  /claude-sonnet/i,
  /claude-haiku/i,
  /gemini/i,
  /llava/i,
  /pixtral/i,
  /internvl/i,
  /minicpm-v/i,
  /molmo/i,
  /idefics/i,
  /fuyu/i,
  /cogvlm/i,
  /glm-4v/i,
  /yi-vl/i,
  /deepseek-vl/i,
  /step-1v/i,
  /-vl\b/i,
  /vision/i,
  /omni/i,
  /llama-3\.2-\d+b-vision/i,
  /llama-4/i,
  /grok-.*vision/i
];

// Beats the allowlist. Claude 3.5 Haiku matches /claude-haiku/ but is text-only.
const TEXT_ONLY_PATTERNS = [
  /claude-3[.-]5-haiku/i,
  /embed/i,
  /whisper/i,
  /tts/i,
  /moderation/i,
  /rerank/i,
  /-audio(-|$)/i
];

/** Best-effort guess at whether a model id accepts images. */
function guessVision(modelId) {
  if (!modelId) return false;
  if (TEXT_ONLY_PATTERNS.some((re) => re.test(modelId))) return false;
  return VISION_PATTERNS.some((re) => re.test(modelId));
}

/**
 * Read vision support off a raw model record from a `/v1/models` style response.
 * Providers advertise this half a dozen different ways; check them all, fall back to
 * the id heuristic. Returns { vision, fromMetadata }.
 */
function visionFromModelRecord(record, modelId) {
  const candidates = [
    record && record.vision,
    record && record.capabilities && record.capabilities.vision,
    record && record.supports_vision,
    record && record.architecture && Array.isArray(record.architecture.input_modalities)
      ? record.architecture.input_modalities.includes('image')
      : undefined,
    record && record.architecture && typeof record.architecture.modality === 'string'
      ? record.architecture.modality.includes('image')
      : undefined,
    record && Array.isArray(record.input_modalities)
      ? record.input_modalities.includes('image')
      : undefined,
    record && Array.isArray(record.modalities) ? record.modalities.includes('image') : undefined
  ];
  for (const value of candidates) {
    if (typeof value === 'boolean') return { vision: value, fromMetadata: true };
  }
  return { vision: guessVision(modelId), fromMetadata: false };
}

/** Attach image data URLs to the final user message as OpenAI-style content parts. */
function attachImagesOpenAi(messages, images) {
  if (!images || images.length === 0) return messages;
  const out = messages.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i].role === 'user') {
      const text = typeof out[i].content === 'string' ? out[i].content : '';
      out[i] = {
        role: 'user',
        content: [
          { type: 'text', text },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } }))
        ]
      };
      return out;
    }
  }
  return out;
}

/**
 * A system prompt is either a plain string or an ordered list of blocks
 * ({ text, cacheable }). Providers without prompt caching just get the concatenation.
 */
function systemToText(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system
    .map((block) => (typeof block === 'string' ? block : block && block.text))
    .filter(Boolean)
    .join('\n\n');
}

/** Anthropic keeps the block structure so cacheable prefixes can be marked. */
function systemToAnthropicBlocks(system) {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  const blocks = system
    .filter((block) => block && block.text)
    .map((block) => ({
      type: 'text',
      text: block.text,
      ...(block.cacheable ? { cache_control: { type: 'ephemeral' } } : {})
    }));
  return blocks.length > 0 ? blocks : undefined;
}

/** Throw a tagged abort error so callers can tell cancellation from failure. */
function abortError() {
  const err = new Error('Request cancelled');
  err.name = 'AbortError';
  return err;
}

/** True when an error means "the caller cancelled", not "the request failed". */
function isAbort(err) {
  return !!err && (err.name === 'AbortError' || err.message === 'Request cancelled');
}

module.exports = {
  systemToText,
  systemToAnthropicBlocks,
  parseDataUrl,
  withTempWav,
  guessVision,
  visionFromModelRecord,
  attachImagesOpenAi,
  abortError,
  isAbort
};

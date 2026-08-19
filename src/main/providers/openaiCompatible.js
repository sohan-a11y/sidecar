const { OpenAI } = require('openai');
const fs = require('fs');
const { attachImagesOpenAi, visionFromModelRecord, withTempWav, systemToText } = require('./util');

/**
 * Generic OpenAI Chat-Completions adapter, parameterised by base URL.
 * Backs TokenRouter and the user-configurable "Custom (OpenAI-compatible)" provider,
 * which is what makes Ollama / LM Studio / vLLM / OpenRouter work with no further code.
 */

/** A model is "free" if its id says so or its pricing metadata is zero. */
function isFreeModel(record, id) {
  if (/(^|[:/\-_])free($|[:/\-_])/i.test(id)) return true;
  const pricing = record && record.pricing;
  if (pricing && typeof pricing === 'object') {
    const values = [pricing.prompt, pricing.completion, pricing.input, pricing.output]
      .filter((v) => v !== undefined && v !== null)
      .map((v) => Number(v));
    if (values.length > 0 && values.every((v) => v === 0)) return true;
  }
  return false;
}

function createOpenAiCompatible(config) {
  const {
    id,
    name,
    baseUrl: fixedBaseUrl,
    seedModels = [],
    transcription = false,
    defaultTranscriptionModel = 'whisper-1'
  } = config;

  const adapter = {
    id,
    name,
    // Vision is per-model here, not per-provider; the flag means "images are representable".
    capabilities: { vision: true, streaming: true, transcription },
    requiresBaseUrl: !fixedBaseUrl,
    defaults: {
      standard: seedModels[0] || '',
      advanced: seedModels[1] || seedModels[0] || '',
      vision: '',
      transcription: transcription ? defaultTranscriptionModel : null
    },

    baseUrlFor(overrideBaseUrl) {
      const url = fixedBaseUrl || overrideBaseUrl;
      if (!url) throw new Error(`${name} needs a base URL — set one in Settings.`);
      return url.replace(/\/+$/, '');
    },

    client(apiKey, overrideBaseUrl) {
      return new OpenAI({
        apiKey: apiKey || 'not-needed',
        baseURL: adapter.baseUrlFor(overrideBaseUrl)
      });
    },

    seedModelList() {
      return seedModels.map((modelId) => {
        const { vision } = visionFromModelRecord(null, modelId);
        return { id: modelId, label: modelId, vision, visionFromMetadata: false, free: isFreeModel(null, modelId) };
      });
    },

    async listModels(apiKey, opts = {}) {
      try {
        const res = await adapter.client(apiKey, opts.baseUrl).models.list();
        const records = res && Array.isArray(res.data) ? res.data : [];
        if (records.length === 0) throw new Error('empty model list');
        return records
          .map((m) => {
            const modelId = m.id;
            const { vision, fromMetadata } = visionFromModelRecord(m, modelId);
            return {
              id: modelId,
              label: m.name || m.display_name || modelId,
              vision,
              visionFromMetadata: fromMetadata,
              free: isFreeModel(m, modelId),
              contextWindow: m.context_length || m.context_window
            };
          })
          .sort((a, b) => a.id.localeCompare(b.id));
      } catch (e) {
        console.warn(`[Providers:${id}] Model list unavailable, using seeds:`, e.message);
        return adapter.seedModelList();
      }
    },

    async streamChat({ apiKey, model, system, messages, images, signal, baseUrl }, onToken) {
      const client = adapter.client(apiKey, baseUrl);
      const systemText = systemToText(system);
      const composed = [
        ...(systemText ? [{ role: 'system', content: systemText }] : []),
        ...attachImagesOpenAi(messages, images)
      ];

      const stream = await client.chat.completions.create(
        { model, messages: composed, stream: true },
        { signal }
      );

      for await (const chunk of stream) {
        const token = chunk.choices?.[0]?.delta?.content || '';
        if (token) onToken(token);
      }
    }
  };

  if (transcription) {
    adapter.transcribe = async ({ apiKey, model, wav, language, baseUrl }) =>
      withTempWav(wav, async (file) => {
        const client = adapter.client(apiKey, baseUrl);
        const params = {
          file: fs.createReadStream(file),
          model: model || defaultTranscriptionModel
        };
        if (language && language !== 'auto') params.language = language;
        const resp = await client.audio.transcriptions.create(params);
        return resp.text || '';
      });
  }

  return adapter;
}

module.exports = { createOpenAiCompatible, isFreeModel };

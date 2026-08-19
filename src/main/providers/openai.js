const { OpenAI, toFile } = require('openai');
const fs = require('fs');
const { attachImagesOpenAi, visionFromModelRecord, withTempWav, systemToText } = require('./util');

/**
 * OpenAI adapter. Behaviour of streamChat/transcribe is a straight lift of the pre-Phase-0
 * LlmService/TranscriptionService branches — this is a refactor, not a rewrite.
 */
const adapter = {
  id: 'openai',
  name: 'OpenAI',
  capabilities: { vision: true, streaming: true, transcription: true },
  defaults: {
    standard: 'gpt-4o-mini',
    advanced: 'gpt-4o',
    vision: 'gpt-4o-mini',
    transcription: 'whisper-1'
  },

  async listModels(apiKey) {
    if (!apiKey) return [];
    const client = new OpenAI({ apiKey });
    const res = await client.models.list();
    const records = res && Array.isArray(res.data) ? res.data : [];
    return records
      .filter((m) => !/^(whisper|tts|dall-e|text-embedding|omni-moderation)/.test(m.id))
      .map((m) => {
        const { vision, fromMetadata } = visionFromModelRecord(m, m.id);
        return { id: m.id, label: m.id, vision, visionFromMetadata: fromMetadata };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  },

  async streamChat({ apiKey, model, system, messages, images, signal }, onToken) {
    const client = new OpenAI({ apiKey });
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
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) onToken(token);
    }
  },

  async transcribe({ apiKey, model, wav, language }) {
    return withTempWav(wav, async (file) => {
      const client = new OpenAI({ apiKey });
      const params = {
        file: fs.createReadStream(file),
        model: model || adapter.defaults.transcription
      };
      // 'auto' means "let the provider detect it" — omit the field entirely.
      if (language && language !== 'auto') params.language = language;
      const resp = await client.audio.transcriptions.create(params);
      return resp.text || '';
    });
  }
};

module.exports = adapter;
// toFile is re-exported for adapters that cannot use a read stream.
module.exports._toFile = toFile;

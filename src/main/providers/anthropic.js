const { Anthropic } = require('@anthropic-ai/sdk');
const { parseDataUrl, guessVision } = require('./util');

// The installed SDK (0.32) has no models.list, so the model list comes from REST.
const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=100';
const API_VERSION = '2023-06-01';

// Used only when the REST call fails (offline, proxy, old key scope).
const SEED_MODELS = [
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-3-opus-latest'
];

const adapter = {
  id: 'anthropic',
  name: 'Anthropic',
  capabilities: { vision: true, streaming: true, transcription: false },
  defaults: {
    standard: 'claude-3-5-haiku-latest',
    advanced: 'claude-3-5-sonnet-latest',
    vision: 'claude-3-5-sonnet-latest',
    transcription: null
  },

  async listModels(apiKey) {
    if (!apiKey) return [];
    try {
      const res = await fetch(MODELS_URL, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': API_VERSION }
      });
      if (!res.ok) throw new Error(`models endpoint returned ${res.status}`);
      const data = await res.json();
      const records = Array.isArray(data.data) ? data.data : [];
      if (records.length === 0) throw new Error('empty model list');
      return records.map((m) => ({
        id: m.id,
        label: m.display_name || m.id,
        vision: guessVision(m.id),
        visionFromMetadata: false
      }));
    } catch (e) {
      console.warn('[Providers:anthropic] Falling back to seed model list:', e.message);
      return SEED_MODELS.map((id) => ({ id, label: id, vision: guessVision(id), visionFromMetadata: false }));
    }
  },

  async streamChat({ apiKey, model, system, messages, images, signal }, onToken) {
    const client = new Anthropic({ apiKey });

    const composed = messages.map((m) => ({ role: m.role, content: m.content }));
    if (images && images.length > 0) {
      for (let i = composed.length - 1; i >= 0; i -= 1) {
        if (composed[i].role !== 'user') continue;
        const blocks = [{ type: 'text', text: composed[i].content }];
        for (const url of images) {
          const parsed = parseDataUrl(url);
          if (!parsed) continue;
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: parsed.mediaType, data: parsed.base64 }
          });
        }
        composed[i] = { role: 'user', content: blocks };
        break;
      }
    }

    const stream = await client.messages.create(
      {
        model,
        max_tokens: 1024,
        ...(system ? { system } : {}),
        messages: composed,
        stream: true
      },
      { signal }
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        onToken(event.delta.text);
      }
    }
  }
};

module.exports = adapter;

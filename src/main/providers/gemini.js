const { GoogleGenAI } = require('@google/genai');
const { parseDataUrl, withTempWav, abortError, systemToText } = require('./util');

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
// '-latest' aliases: Gemini's /v1beta/models list can still return a pinned model id
// after Google has retired it for new callers -- generateContent then 404s even though
// the model was 'available'. Aliases redirect server-side and don't go stale.
const SEED_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-pro'];

/** Map a Gemini 404 / parse failure onto the message the UI already knows how to show. */
function normaliseGeminiError(err) {
  const msg = err.message || String(err);
  if (msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('exception parsing response')) {
    return new Error('Gemini model not found -- it may be deprecated, check Settings');
  }
  return err;
}

function client(apiKey) {
  return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });
}

const adapter = {
  id: 'gemini',
  name: 'Google Gemini',
  capabilities: { vision: true, streaming: true, transcription: true },
  defaults: {
    standard: 'gemini-flash-lite-latest',
    advanced: 'gemini-flash-latest',
    vision: 'gemini-flash-lite-latest',
    transcription: 'gemini-flash-latest'
  },

  async listModels(apiKey) {
    if (!apiKey) return [];
    try {
      // The key goes in the query string because that is the only auth this endpoint takes.
      const res = await fetch(`${MODELS_URL}?key=${encodeURIComponent(apiKey)}&pageSize=200`);
      if (!res.ok) throw new Error(`models endpoint returned ${res.status}`);
      const data = await res.json();
      const records = Array.isArray(data.models) ? data.models : [];
      const usable = records.filter(
        (m) => !Array.isArray(m.supportedGenerationMethods) ||
          m.supportedGenerationMethods.includes('generateContent')
      );
      if (usable.length === 0) throw new Error('empty model list');
      return usable.map((m) => {
        const id = String(m.name || '').replace('models/', '');
        return {
          id,
          label: m.displayName || id,
          // Every Gemini generateContent model takes image input.
          vision: true,
          visionFromMetadata: true,
          contextWindow: m.inputTokenLimit
        };
      });
    } catch (e) {
      console.warn('[Providers:gemini] Falling back to seed model list:', e.message);
      return SEED_MODELS.map((id) => ({ id, label: id, vision: true, visionFromMetadata: false }));
    }
  },

  async streamChat({ apiKey, model, system, messages, images, signal }, onToken) {
    try {
      const ai = client(apiKey);

      // Gemini takes a flat contents array; flatten the chat history into it.
      const contents = [];
      for (const m of messages) {
        const prefix = m.role === 'assistant' ? 'Assistant: ' : '';
        contents.push(`${prefix}${m.content}`);
      }
      for (const url of images || []) {
        const parsed = parseDataUrl(url);
        if (parsed) contents.push({ inlineData: { mimeType: parsed.mediaType, data: parsed.base64 } });
      }

      const systemText = systemToText(system);
      const responseStream = await ai.models.generateContentStream({
        model,
        contents,
        ...(systemText ? { config: { systemInstruction: systemText } } : {})
      });

      for await (const chunk of responseStream) {
        // The installed SDK exposes no request-level AbortSignal, so cancellation is
        // enforced by refusing to consume further chunks.
        if (signal && signal.aborted) throw abortError();
        const token = chunk.text || '';
        if (token) onToken(token);
      }
    } catch (err) {
      throw normaliseGeminiError(err);
    }
  },

  async transcribe({ apiKey, model, wav, language }) {
    return withTempWav(wav, async (file) => {
      const ai = client(apiKey);
      let uploaded;
      try {
        uploaded = await ai.files.upload({ file, mimeType: 'audio/wav' });
        const languageHint = language && language !== 'auto'
          ? ` The audio is in ${language}; transcribe it in that language.`
          : ' Transcribe in whatever language is spoken, including mixed-language speech.';
        const resp = await ai.models.generateContent({
          model: model || adapter.defaults.transcription,
          contents: [
            uploaded,
            {
              text: 'Transcribe this audio. Return ONLY the transcribed text, nothing else. '
                + `If there is no talking, return nothing.${languageHint}`
            }
          ]
        });
        return resp.text ? resp.text.trim() : '';
      } catch (err) {
        throw normaliseGeminiError(err);
      } finally {
        if (uploaded && uploaded.name) {
          try {
            await ai.files.delete({ name: uploaded.name });
          } catch (delError) {
            console.warn('[Providers:gemini] Failed to delete remote file:', delError.message);
          }
        }
      }
    });
  }
};

module.exports = adapter;

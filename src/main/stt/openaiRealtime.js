const { createStreamingSession } = require('./streamingBase');

/**
 * OpenAI realtime transcription. Audio goes up as base64 in JSON frames rather than
 * raw binary, and deltas arrive as transcription events.
 */
module.exports = {
  id: 'openaiRealtime',
  name: 'OpenAI Realtime',
  streaming: true,
  requiresKey: true,
  supportsCodeSwitching: true,
  defaultModel: 'gpt-4o-mini-transcribe',
  docsUrl: 'https://platform.openai.com/api-keys',

  createSession({ apiKey, model, language }, handlers) {
    const partials = new Map();

    return createStreamingSession({
      url: 'wss://api.openai.com/v1/realtime?intent=transcription',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      },
      onOpenMessage: () => ({
        type: 'transcription_session.update',
        session: {
          input_audio_format: 'pcm16',
          input_audio_transcription: {
            model: model || 'gpt-4o-mini-transcribe',
            ...(language && language !== 'auto' ? { language } : {})
          },
          turn_detection: { type: 'server_vad' }
        }
      }),
      encodeAudio: (pcm) => JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: pcm.toString('base64')
      }),
      parseMessage(payload) {
        const itemId = payload.item_id || 'current';
        if (payload.type === 'conversation.item.input_audio_transcription.delta') {
          const next = (partials.get(itemId) || '') + (payload.delta || '');
          partials.set(itemId, next);
          return [{ text: next, isFinal: false }];
        }
        if (payload.type === 'conversation.item.input_audio_transcription.completed') {
          partials.delete(itemId);
          return [{ text: payload.transcript || '', isFinal: true }];
        }
        if (payload.type === 'error') {
          throw new Error(payload.error ? payload.error.message : 'realtime error');
        }
        return [];
      }
    }, handlers);
  }
};

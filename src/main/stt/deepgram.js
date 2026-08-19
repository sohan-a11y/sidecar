const { createStreamingSession } = require('./streamingBase');

// 'multi' is Deepgram's code-switching mode — Hinglish and similar mixed speech.
const CODE_SWITCH_LANGUAGE = 'multi';

module.exports = {
  id: 'deepgram',
  name: 'Deepgram',
  streaming: true,
  requiresKey: true,
  supportsCodeSwitching: true,
  defaultModel: 'nova-3',
  docsUrl: 'https://console.deepgram.com',

  createSession({ apiKey, model, language, sampleRate = 16000 }, handlers) {
    const params = new URLSearchParams({
      encoding: 'linear16',
      sample_rate: String(sampleRate),
      channels: '1',
      interim_results: 'true',
      punctuate: 'true',
      smart_format: 'true',
      model: model || 'nova-3',
      language: !language || language === 'auto' ? CODE_SWITCH_LANGUAGE : language
    });

    return createStreamingSession({
      url: `wss://api.deepgram.com/v1/listen?${params.toString()}`,
      headers: { Authorization: `Token ${apiKey}` },
      parseMessage(payload) {
        if (payload.type && payload.type !== 'Results') return [];
        const alternative = payload.channel
          && payload.channel.alternatives
          && payload.channel.alternatives[0];
        if (!alternative || !alternative.transcript) return [];
        const startMs = Math.round((payload.start || 0) * 1000);
        return [{
          text: alternative.transcript,
          isFinal: !!payload.is_final,
          confidence: alternative.confidence,
          startMs,
          endMs: startMs + Math.round((payload.duration || 0) * 1000)
        }];
      }
    }, handlers);
  }
};

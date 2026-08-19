const { createStreamingSession } = require('./streamingBase');

module.exports = {
  id: 'assemblyai',
  name: 'AssemblyAI',
  streaming: true,
  requiresKey: true,
  // Universal-Streaming is English-first; mixed-language speech is better served by Deepgram.
  supportsCodeSwitching: false,
  defaultModel: 'universal-streaming',
  docsUrl: 'https://www.assemblyai.com/app',

  createSession({ apiKey, sampleRate = 16000 }, handlers) {
    const params = new URLSearchParams({
      sample_rate: String(sampleRate),
      encoding: 'pcm_s16le',
      format_turns: 'true'
    });

    return createStreamingSession({
      url: `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`,
      headers: { Authorization: apiKey },
      parseMessage(payload) {
        if (payload.type !== 'Turn' || !payload.transcript) return [];
        return [{
          text: payload.transcript,
          isFinal: !!payload.end_of_turn,
          confidence: payload.end_of_turn_confidence,
          startMs: payload.audio_start,
          endMs: payload.audio_end
        }];
      }
    }, handlers);
  }
};

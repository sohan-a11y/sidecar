import React from 'react';
import KeyField from './KeyField';

/**
 * Transcription transport, model, keys and per-channel language.
 * Streaming engines and the batch fallback need different fields, so the form swaps
 * rather than showing both.
 */
export default function SpeechTab({
  draft,
  view,
  engines,
  sttProviders,
  languages,
  keyPlaceholders,
  patchStt,
  keyDraftValue,
  setKeyDraft
}) {
  const activeEngine = engines.find((e) => e.id === draft.stt.engine);

  return (
    <>
      <div className="setting-group">
        <label className="setting-label">Transcription engine</label>
        <div className="provider-tabs">
          {engines.map((e) => (
            <button
              key={e.id}
              className={`provider-tab-btn ${draft.stt.engine === e.id ? 'active' : ''}`}
              onClick={() => patchStt({ engine: e.id })}
              title={
                e.streaming
                  ? 'Streaming — words appear as they are spoken'
                  : 'Uploads each utterance once you stop speaking'
              }
            >
              {e.id === 'batch' ? 'BATCH' : e.name.split(' ')[0].toUpperCase()}
            </button>
          ))}
        </div>
        {activeEngine && (
          <p className="setting-hint">
            {activeEngine.streaming
              ? 'Streams over a websocket, one connection per speaker. Interim words show greyed until confirmed.'
              : 'Records each utterance and uploads it when you stop speaking. Highest latency, fewest moving parts.'}
            {activeEngine.supportsCodeSwitching
              ? ' Handles mixed-language speech (Hinglish, Tamil-English and similar).'
              : ' Best with one language per channel.'}
          </p>
        )}
      </div>

      {activeEngine && activeEngine.streaming && (
        <div className="setting-group">
          <label className="setting-label">{activeEngine.name} model and key</label>
          <div className="input-field">
            <span className="field-prefix">Model</span>
            <input
              type="text"
              spellCheck="false"
              value={(draft.stt.engineModels || {})[draft.stt.engine] || ''}
              onChange={(e) =>
                patchStt({
                  engineModels: { ...draft.stt.engineModels, [draft.stt.engine]: e.target.value }
                })
              }
            />
          </div>
          <KeyField
            label={activeEngine.name.split(' ')[0]}
            placeholder="paste key"
            stored={!!(view.keyPresence.sttEngine || {})[draft.stt.engine]}
            value={keyDraftValue('sttEngine', draft.stt.engine)}
            onChange={(v) => setKeyDraft('sttEngine', draft.stt.engine, v)}
            onClear={() => setKeyDraft('sttEngine', draft.stt.engine, null)}
          />
          {activeEngine.docsUrl && (
            <p className="setting-hint">Get a key at {activeEngine.docsUrl}</p>
          )}
        </div>
      )}

      {activeEngine && !activeEngine.streaming && (
        <>
          <div className="setting-group">
            <label className="setting-label">Batch provider</label>
            <div className="provider-tabs">
              {sttProviders.map((p) => (
                <button
                  key={p.id}
                  className={`provider-tab-btn ${draft.stt.provider === p.id ? 'active' : ''}`}
                  onClick={() => patchStt({ provider: p.id })}
                >
                  {p.id === 'custom' ? 'CUSTOM' : p.name.split(' ')[0].toUpperCase()}
                </button>
              ))}
            </div>
            <div className="input-field">
              <span className="field-prefix">Model</span>
              <input
                type="text"
                spellCheck="false"
                value={draft.stt.models[draft.stt.provider] || ''}
                onChange={(e) =>
                  patchStt({
                    models: { ...draft.stt.models, [draft.stt.provider]: e.target.value }
                  })
                }
              />
            </div>
            {draft.stt.provider === 'custom' && (
              <div className="input-field">
                <span className="field-prefix">Base URL</span>
                <input
                  type="text"
                  spellCheck="false"
                  placeholder="http://localhost:8080/v1"
                  value={draft.stt.baseUrl}
                  onChange={(e) => patchStt({ baseUrl: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="setting-group">
            <label className="setting-label">Transcription API keys</label>
            {sttProviders.map((p) => (
              <KeyField
                key={p.id}
                label={p.name.split(' ')[0]}
                placeholder={keyPlaceholders[p.id] || ''}
                stored={!!(view.keyPresence.stt || {})[p.id]}
                value={keyDraftValue('stt', p.id)}
                onChange={(v) => setKeyDraft('stt', p.id, v)}
                onClear={() => setKeyDraft('stt', p.id, null)}
              />
            ))}
            <p className="setting-hint">
              Kept separate from the chat keys so you can use different accounts.
            </p>
          </div>
        </>
      )}

      <div className="setting-group">
        <label className="setting-label">Spoken language per channel</label>
        <div className="select-row">
          <label className="select-cell">
            <span>You (microphone)</span>
            <select
              className="setting-select"
              value={draft.stt.languages.user}
              onChange={(e) =>
                patchStt({ languages: { ...draft.stt.languages, user: e.target.value } })
              }
            >
              {languages.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="select-cell">
            <span>Them (system audio)</span>
            <select
              className="setting-select"
              value={draft.stt.languages.system}
              onChange={(e) =>
                patchStt({ languages: { ...draft.stt.languages, system: e.target.value } })
              }
            >
              {languages.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="setting-hint">
          Auto-detect is safest for mixed-language speech. The language answers come back in is set
          separately, under Context → This session.
        </p>
      </div>
    </>
  );
}

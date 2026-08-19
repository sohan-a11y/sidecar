import React, { useState, useEffect, useCallback } from 'react';
import ModelPicker from './settings/ModelPicker';
import KeyField from './settings/KeyField';
import ContextTab from './settings/ContextTab';
import SessionsTab from './settings/SessionsTab';
import SpeechTab from './settings/SpeechTab';
import CaptureTab from './settings/CaptureTab';

const KEY_PLACEHOLDERS = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  gemini: 'AIza...',
  tokenrouter: 'tr-...',
  custom: 'optional for local servers'
};

const LANGUAGES = [
  ['auto', 'Auto-detect'], ['en', 'English'], ['hi', 'Hindi'], ['te', 'Telugu'],
  ['ta', 'Tamil'], ['bn', 'Bengali'], ['mr', 'Marathi'], ['gu', 'Gujarati'],
  ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'], ['ur', 'Urdu'],
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'],
  ['it', 'Italian'], ['nl', 'Dutch'], ['ru', 'Russian'], ['ar', 'Arabic'],
  ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['tr', 'Turkish'],
  ['id', 'Indonesian'], ['vi', 'Vietnamese']
];

const TABS = [
  ['context', 'Context'],
  ['sessions', 'Sessions'],
  ['models', 'Models'],
  ['speech', 'Speech'],
  ['screen', 'Screen'],
  ['limits', 'Limits']
];

export default function SettingsModal({ isOpen, onClose, sidecar }) {
  const [view, setView] = useState(null);
  const [tab, setTab] = useState('context');
  const [context, setContext] = useState(null);
  const [progressStage, setProgressStage] = useState('');
  const [draft, setDraft] = useState(null);
  const [keyDrafts, setKeyDrafts] = useState({});
  const [modelLists, setModelLists] = useState({});
  const [sttEngines, setSttEngines] = useState([]);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    if (isOpen) loadSettings();
  }, [isOpen]);

  // Subscribed once: the preload bridge has no listener-removal API, so re-subscribing
  // on every open would stack duplicate handlers.
  useEffect(() => {
    sidecar.on('context:changed', (next) => setContext(next));
    sidecar.on('context:progress', ({ stage }) => setProgressStage(stage || ''));
  }, []);

  const loadSettings = async () => {
    try {
      const [data, contextData] = await Promise.all([
        sidecar.getSettings(),
        sidecar.context.get()
      ]);
      setView(data);
      setContext(contextData);
      setSttEngines(await sidecar.listSttEngines());
      setDraft({
        llm: JSON.parse(JSON.stringify(data.llm)),
        stt: JSON.parse(JSON.stringify(data.stt)),
        rateLimits: JSON.parse(JSON.stringify(data.rateLimits)),
        autoAnswer: JSON.parse(JSON.stringify(data.autoAnswer)),
        capture: JSON.parse(JSON.stringify(data.capture)),
        overlay: JSON.parse(JSON.stringify(data.overlay)),
        sessions: JSON.parse(JSON.stringify(data.sessions)),
        transcript: JSON.parse(JSON.stringify(data.transcript))
      });
      setKeyDrafts({});
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };

  const fetchModels = useCallback(async (providerId, refresh = false) => {
    setModelLists((prev) => ({ ...prev, [providerId]: { ...(prev[providerId] || {}), loading: true } }));
    try {
      const res = await sidecar.listModels(providerId, { refresh });
      setModelLists((prev) => ({
        ...prev,
        [providerId]: { models: res.models || [], loading: false, error: res.ok ? '' : res.error || '' }
      }));
    } catch (e) {
      setModelLists((prev) => ({ ...prev, [providerId]: { models: [], loading: false, error: e.message } }));
    }
  }, [sidecar]);

  const llmProvider = draft?.llm.provider;
  useEffect(() => {
    if (isOpen && llmProvider && !modelLists[llmProvider]) fetchModels(llmProvider);
  }, [isOpen, llmProvider, modelLists, fetchModels]);

  if (!isOpen || !draft || !view) return null;

  const providers = view.providers || [];
  const providerMeta = providers.find((p) => p.id === draft.llm.provider) || {};
  const sttProviders = providers.filter((p) => p.capabilities.transcription);
  const activeList = modelLists[draft.llm.provider] || { models: [], loading: false, error: '' };
  const activeModels = draft.llm.models[draft.llm.provider] || { standard: '', advanced: '', vision: '' };

  const patchLlm = (patch) => setDraft((d) => ({ ...d, llm: { ...d.llm, ...patch } }));
  const patchModels = (patch) => patchLlm({
    models: {
      ...draft.llm.models,
      [draft.llm.provider]: { ...activeModels, ...patch }
    }
  });
  const patchStt = (patch) => setDraft((d) => ({ ...d, stt: { ...d.stt, ...patch } }));

  const visionOf = (modelId) => {
    if (!modelId) return null;
    const override = draft.llm.visionOverrides[modelId];
    if (typeof override === 'boolean') return override;
    const record = activeList.models.find((m) => m.id === modelId);
    return record ? !!record.vision : null;
  };

  const setVisionOverride = (modelId, value) => {
    const next = { ...draft.llm.visionOverrides };
    if (value === undefined) delete next[modelId];
    else next[modelId] = value;
    patchLlm({ visionOverrides: next });
  };

  const setKeyDraft = (section, providerId, value) =>
    setKeyDrafts((prev) => ({ ...prev, [`${section}:${providerId}`]: value }));

  const keyDraftValue = (section, providerId) => {
    const raw = keyDrafts[`${section}:${providerId}`];
    return typeof raw === 'string' ? raw : '';
  };

  const collectKeys = (section, providerIds) => {
    const out = {};
    for (const id of providerIds) {
      const raw = keyDrafts[`${section}:${id}`];
      if (raw === null) out[id] = null;          // clear
      else if (typeof raw === 'string' && raw.trim()) out[id] = raw.trim();
    }
    return out;
  };

  const handleSave = async () => {
    setSaveStatus('Saving…');
    try {
      const patch = {
        llm: {
          provider: draft.llm.provider,
          baseUrl: draft.llm.baseUrl.trim(),
          models: draft.llm.models,
          visionOverrides: draft.llm.visionOverrides,
          apiKeys: collectKeys('llm', providers.map((p) => p.id))
        },
        stt: {
          engine: draft.stt.engine,
          provider: draft.stt.provider,
          languages: draft.stt.languages,
          baseUrl: draft.stt.baseUrl.trim(),
          models: draft.stt.models,
          engineModels: draft.stt.engineModels,
          apiKeys: collectKeys('stt', sttProviders.map((p) => p.id)),
          engineKeys: collectKeys('sttEngine', sttEngines.map((e) => e.id))
        },
        rateLimits: draft.rateLimits,
        autoAnswer: draft.autoAnswer,
        capture: draft.capture,
        sessions: draft.sessions,
        transcript: draft.transcript
      };
      const updated = await sidecar.setSettings(patch);
      setView(updated);
      setKeyDrafts({});
      setSaveStatus('Settings saved');
      setTimeout(() => {
        setSaveStatus('');
        onClose();
      }, 900);
    } catch (e) {
      setSaveStatus('Error saving settings.');
      console.error(e);
    }
  };

  return (
    <div className="modal-scrim" onClick={(e) => e.target.className === 'modal-scrim' && onClose()}>
      <div className="settings-modal modal-glass animate-pop">
        <div className="modal-header">
          <h2 className="modal-title">Preferences</h2>
          <button className="modal-close-btn" onClick={onClose}>Done</button>
        </div>

        <div className="modal-tabs">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              className={`modal-tab-btn ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {tab === 'context' && (
            <ContextTab
              sidecar={sidecar}
              context={context}
              onContextChange={setContext}
              progressStage={progressStage}
            />
          )}

          {tab === 'sessions' && (
            <SessionsTab
              sidecar={sidecar}
              retention={draft.sessions}
              onRetentionChange={(sessions) => setDraft((d) => ({ ...d, sessions }))}
            />
          )}

          {tab === 'models' && (
            <>
              <div className="setting-group">
                <label className="setting-label">Chat provider</label>
                <div className="provider-tabs">
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      className={`provider-tab-btn ${draft.llm.provider === p.id ? 'active' : ''}`}
                      onClick={() => patchLlm({ provider: p.id })}
                      title={p.name}
                    >
                      {p.id === 'custom' ? 'CUSTOM' : p.name.split(' ')[0].toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {providerMeta.requiresBaseUrl && (
                <div className="setting-group">
                  <label className="setting-label">Base URL</label>
                  <div className="input-field">
                    <input
                      type="text"
                      spellCheck="false"
                      placeholder="http://localhost:11434/v1"
                      value={draft.llm.baseUrl}
                      onChange={(e) => patchLlm({ baseUrl: e.target.value })}
                    />
                  </div>
                  <p className="setting-hint">
                    Any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM, OpenRouter.
                  </p>
                </div>
              )}

              <div className="setting-group">
                <ModelPicker
                  label="Standard model"
                  value={activeModels.standard}
                  models={activeList.models}
                  loading={activeList.loading}
                  error={activeList.error}
                  vision={visionOf(activeModels.standard)}
                  visionOverride={draft.llm.visionOverrides[activeModels.standard]}
                  onToggleVision={(v) => setVisionOverride(activeModels.standard, v)}
                  onChange={(v) => patchModels({ standard: v })}
                  onRefresh={() => fetchModels(draft.llm.provider, true)}
                />
                <ModelPicker
                  label="Advanced model (Smart Mode)"
                  value={activeModels.advanced}
                  models={activeList.models}
                  loading={activeList.loading}
                  vision={visionOf(activeModels.advanced)}
                  visionOverride={draft.llm.visionOverrides[activeModels.advanced]}
                  onToggleVision={(v) => setVisionOverride(activeModels.advanced, v)}
                  onChange={(v) => patchModels({ advanced: v })}
                />
                <ModelPicker
                  label="Vision model (optional)"
                  hint="Used when the chat model cannot accept screenshots. Leave blank to drop images instead."
                  placeholder="leave blank to disable"
                  value={activeModels.vision}
                  models={activeList.models.filter((m) => m.vision)}
                  loading={activeList.loading}
                  vision={visionOf(activeModels.vision)}
                  onChange={(v) => patchModels({ vision: v })}
                />
              </div>

              <div className="setting-group">
                <label className="setting-label">API keys</label>
                {providers.map((p) => (
                  <KeyField
                    key={p.id}
                    label={p.name.split(' ')[0]}
                    placeholder={KEY_PLACEHOLDERS[p.id] || ''}
                    stored={!!(view.keyPresence.llm || {})[p.id]}
                    value={keyDraftValue('llm', p.id)}
                    onChange={(v) => setKeyDraft('llm', p.id, v)}
                    onClear={() => setKeyDraft('llm', p.id, null)}
                  />
                ))}
                <p className={view.encryptionAvailable ? 'setting-hint' : 'setting-warning'}>
                  {view.encryptionAvailable
                    ? 'Keys are encrypted with your OS keychain and never leave this machine.'
                    : 'OS encryption is unavailable here — keys are stored as plaintext in your user data folder.'}
                </p>
              </div>
            </>
          )}

          {tab === 'speech' && (
            <SpeechTab
              draft={draft}
              view={view}
              engines={sttEngines}
              sttProviders={sttProviders}
              languages={LANGUAGES}
              keyPlaceholders={KEY_PLACEHOLDERS}
              patchStt={patchStt}
              keyDraftValue={keyDraftValue}
              setKeyDraft={setKeyDraft}
            />
          )}

          {tab === 'screen' && (
            <CaptureTab
              sidecar={sidecar}
              capture={draft.capture}
              overlay={draft.overlay}
              onCaptureChange={(capture) => setDraft((d) => ({ ...d, capture }))}
              onOverlayChange={async (overlay) => {
                setDraft((d) => ({ ...d, overlay }));
                // Opacity and text size should react as the slider moves.
                await sidecar.overlay.apply(overlay);
              }}
            />
          )}

          {tab === 'limits' && (
            <>
            <div className="setting-group">
              <label className="setting-label">Auto-answer</label>
              <p className="setting-hint">
                Off by default. When armed, detected questions are answered without a hotkey —
                which spends your quota on its own. Manual presses always win.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={!!draft.autoAnswer.enabled}
                  onChange={(e) => setDraft((d) => ({
                    ...d, autoAnswer: { ...d.autoAnswer, enabled: e.target.checked }
                  }))}
                />
                <span>Answer detected questions automatically</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={!!draft.autoAnswer.speculative}
                  onChange={(e) => setDraft((d) => ({
                    ...d, autoAnswer: { ...d.autoAnswer, speculative: e.target.checked }
                  }))}
                />
                <span>Start answering before the question finishes (costs extra requests)</span>
              </label>
              <div className="limit-row">
                <span className="limit-name">Confidence to fire</span>
                <label className="limit-input">
                  <span>0-1</span>
                  <input
                    type="number" min="0.1" max="1" step="0.05"
                    value={draft.autoAnswer.threshold}
                    onChange={(e) => setDraft((d) => ({
                      ...d,
                      autoAnswer: { ...d.autoAnswer, threshold: Math.min(1, Math.max(0.1, Number(e.target.value) || 0.7)) }
                    }))}
                  />
                </label>
              </div>
              <div className="limit-row">
                <span className="limit-name">Pacing</span>
                <label className="limit-input">
                  <span>cooldown s</span>
                  <input
                    type="number" min="0"
                    value={Math.round(draft.autoAnswer.cooldownMs / 1000)}
                    onChange={(e) => setDraft((d) => ({
                      ...d,
                      autoAnswer: { ...d.autoAnswer, cooldownMs: Math.max(0, Number(e.target.value) || 0) * 1000 }
                    }))}
                  />
                </label>
                <label className="limit-input">
                  <span>max/min</span>
                  <input
                    type="number" min="1"
                    value={draft.autoAnswer.maxPerMinute}
                    onChange={(e) => setDraft((d) => ({
                      ...d,
                      autoAnswer: { ...d.autoAnswer, maxPerMinute: Math.max(1, Number(e.target.value) || 1) }
                    }))}
                  />
                </label>
              </div>
            </div>
            <div className="setting-group">
              <label className="setting-label">Transcript window</label>
              <p className="setting-hint">
                Only the most recent turns go to the model; everything older is folded into a
                running summary.
              </p>
              <div className="limit-row">
                <span className="limit-name">Turns kept verbatim</span>
                <label className="limit-input">
                  <span>turns</span>
                  <input
                    type="number"
                    min="4"
                    value={draft.transcript.windowTurns}
                    onChange={(e) => setDraft((d) => ({
                      ...d,
                      transcript: { ...d.transcript, windowTurns: Math.max(4, Number(e.target.value) || 4) }
                    }))}
                  />
                </label>
                <label className="limit-input">
                  <span>token cap</span>
                  <input
                    type="number"
                    min="500"
                    step="500"
                    value={draft.transcript.maxPromptTokens}
                    onChange={(e) => setDraft((d) => ({
                      ...d,
                      transcript: { ...d.transcript, maxPromptTokens: Math.max(500, Number(e.target.value) || 500) }
                    }))}
                  />
                </label>
              </div>
            </div>
            <div className="setting-group">
              <label className="setting-label">Request budget per provider</label>
              <p className="setting-hint">
                Free tiers cap requests per minute and per day. Sidecar queues rather than fails,
                and always runs your hotkey before background work.
              </p>
              {providers.map((p) => {
                const limits = draft.rateLimits[p.id] || { rpm: 60, rpd: 1000 };
                return (
                  <div className="limit-row" key={p.id}>
                    <span className="limit-name">{p.name}</span>
                    <label className="limit-input">
                      <span>per min</span>
                      <input
                        type="number"
                        min="1"
                        value={limits.rpm}
                        onChange={(e) => setDraft((d) => ({
                          ...d,
                          rateLimits: {
                            ...d.rateLimits,
                            [p.id]: { ...limits, rpm: Math.max(1, Number(e.target.value) || 1) }
                          }
                        }))}
                      />
                    </label>
                    <label className="limit-input">
                      <span>per day</span>
                      <input
                        type="number"
                        min="1"
                        value={limits.rpd}
                        onChange={(e) => setDraft((d) => ({
                          ...d,
                          rateLimits: {
                            ...d.rateLimits,
                            [p.id]: { ...limits, rpd: Math.max(1, Number(e.target.value) || 1) }
                          }
                        }))}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
            </>
          )}

          {saveStatus && <div className="save-status-msg">{saveStatus}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={handleSave}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}

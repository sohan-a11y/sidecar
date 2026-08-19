const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const KeyStore = require('./KeyStore');
const Providers = require('./providers');

const SCHEMA_VERSION = 2;

/**
 * Settings live in one deep-merged object. Two rules matter:
 *   1. Anything not present in `defaults` will not survive a load.
 *   2. API keys are sealed on disk (KeyStore) and never leave main in plaintext —
 *      the renderer gets publicView(), which reports presence, not values.
 */
class SettingsManager {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'sidecar-data.json');
    this.defaults = {
      schemaVersion: SCHEMA_VERSION,
      smartModeEnabled: false,
      onboardingComplete: false,

      llm: {
        provider: 'openai',
        baseUrl: '',
        // Per-provider so switching provider doesn't discard the other's config.
        models: {
          openai: { standard: 'gpt-4o-mini', advanced: 'gpt-4o', vision: '' },
          anthropic: { standard: 'claude-3-5-haiku-latest', advanced: 'claude-3-5-sonnet-latest', vision: '' },
          gemini: { standard: 'gemini-2.5-flash-lite', advanced: 'gemini-2.5-flash', vision: '' },
          tokenrouter: {
            standard: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
            advanced: 'qwen/qwen3.8-max-free',
            vision: ''
          },
          custom: { standard: '', advanced: '', vision: '' }
        },
        apiKeys: { openai: '', anthropic: '', gemini: '', tokenrouter: '', custom: '' },
        // Manual override of vision detection, keyed by model id: { 'some-model': true }
        visionOverrides: {}
      },

      stt: {
        provider: 'openai',
        language: 'auto',
        baseUrl: '',
        models: { openai: 'whisper-1', gemini: 'gemini-2.5-flash', custom: 'whisper-1' },
        apiKeys: { openai: '', gemini: '', custom: '' }
      },

      // Free tiers cap requests/minute and requests/day; defaults are deliberately conservative.
      rateLimits: {
        openai: { rpm: 60, rpd: 1000 },
        anthropic: { rpm: 50, rpd: 1000 },
        gemini: { rpm: 15, rpd: 1000 },
        tokenrouter: { rpm: 20, rpd: 200 },
        custom: { rpm: 60, rpd: 1000 }
      },

      sessions: {
        // 'forever' | 'days' | 'never'
        retention: 'forever',
        retentionDays: 30
      },

      transcript: {
        // Rolling window fed to the model; everything older lives in the running summary.
        windowTurns: 30,
        maxPromptTokens: 6000,
        summariseEvery: 20
      },

      // providerId -> { fetchedAt, models: [{ id, label, vision, ... }] }
      modelCache: {}
    };
    this.settings = null;
  }

  load() {
    if (this.settings) return this.settings;
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        const migrated = this.migrate(parsed);
        this.settings = this.mergeDeep(this.defaults, migrated);
        this.unsealKeys();
      } else {
        this.settings = this.clone(this.defaults);
      }
    } catch (e) {
      console.error('[SettingsManager] Failed to load settings:', e.message);
      this.settings = this.clone(this.defaults);
    }
    return this.settings;
  }

  /**
   * v1 -> v2. v1 had a single `currentProvider` driving both chat and transcription,
   * flat `apiKeys`, and `modelPreferences`. Nobody loses their config here.
   */
  migrate(parsed) {
    if (!parsed || typeof parsed !== 'object') return {};
    if (parsed.schemaVersion >= SCHEMA_VERSION) return parsed;

    const legacyProvider = parsed.currentProvider || 'openai';
    const legacyKeys = parsed.apiKeys || {};
    const legacyModels = parsed.modelPreferences || {};

    const models = this.clone(this.defaults.llm.models);
    for (const [providerId, prefs] of Object.entries(legacyModels)) {
      if (!models[providerId]) continue;
      if (prefs.standard) models[providerId].standard = prefs.standard;
      if (prefs.advanced) models[providerId].advanced = prefs.advanced;
    }

    // v1 derived STT from currentProvider: gemini if gemini, otherwise OpenAI.
    // Preserve exactly that so behaviour doesn't change under the user.
    const sttProvider = legacyProvider === 'gemini' ? 'gemini' : 'openai';

    console.log('[SettingsManager] Migrating settings v1 -> v2.');

    return {
      schemaVersion: SCHEMA_VERSION,
      smartModeEnabled: !!parsed.smartModeEnabled,
      onboardingComplete: !!parsed.onboardingComplete,
      llm: {
        provider: Providers.has(legacyProvider) ? legacyProvider : 'openai',
        baseUrl: '',
        models,
        apiKeys: {
          openai: legacyKeys.openai || '',
          anthropic: legacyKeys.anthropic || '',
          gemini: legacyKeys.gemini || '',
          tokenrouter: '',
          custom: ''
        },
        visionOverrides: {}
      },
      stt: {
        provider: sttProvider,
        language: 'auto',
        baseUrl: '',
        models: this.clone(this.defaults.stt.models),
        apiKeys: {
          openai: legacyKeys.openai || '',
          gemini: legacyKeys.gemini || '',
          custom: ''
        }
      }
    };
  }

  /** Decrypt keys into memory. Disk always holds sealed values where the OS allows it. */
  unsealKeys() {
    this.settings.llm.apiKeys = KeyStore.openMap(this.settings.llm.apiKeys);
    this.settings.stt.apiKeys = KeyStore.openMap(this.settings.stt.apiKeys);
  }

  save() {
    try {
      const onDisk = this.clone(this.settings);
      onDisk.llm.apiKeys = KeyStore.sealMap(this.settings.llm.apiKeys);
      onDisk.stt.apiKeys = KeyStore.sealMap(this.settings.stt.apiKeys);
      fs.writeFileSync(this.filePath, JSON.stringify(onDisk, null, 2), 'utf8');
    } catch (e) {
      console.error('[SettingsManager] Failed to save settings:', e.message);
    }
  }

  /** Main-process view: keys in plaintext. Never send this to the renderer. */
  get() {
    return this.load();
  }

  /**
   * Renderer view: no key material, just presence flags and environment facts.
   * Hard rule — keys are never serialised out of main.
   */
  publicView() {
    const s = this.load();
    const view = this.clone(s);
    view.llm.apiKeys = this.blankKeys(s.llm.apiKeys);
    view.stt.apiKeys = this.blankKeys(s.stt.apiKeys);
    view.keyPresence = {
      llm: this.presence(s.llm.apiKeys),
      stt: this.presence(s.stt.apiKeys)
    };
    view.encryptionAvailable = KeyStore.available();
    view.providers = Providers.list();
    return view;
  }

  blankKeys(map) {
    return Object.fromEntries(Object.keys(map || {}).map((k) => [k, '']));
  }

  presence(map) {
    return Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k, !!v]));
  }

  /**
   * Apply a patch. Key fields use a three-state convention because the renderer
   * never sees the current value:
   *   ''      -> leave the stored key alone
   *   null    -> clear the stored key
   *   'sk-..' -> replace it
   */
  set(patch) {
    this.load();
    const cleaned = this.clone(patch || {});
    const keyUpdates = [];

    for (const section of ['llm', 'stt']) {
      const keys = cleaned[section] && cleaned[section].apiKeys;
      if (!keys) continue;
      for (const [providerId, value] of Object.entries(keys)) {
        if (value === '' || value === undefined) continue;
        keyUpdates.push([section, providerId, value === null ? '' : String(value)]);
      }
      delete cleaned[section].apiKeys;
    }

    this.settings = this.mergeDeep(this.settings, cleaned);
    for (const [section, providerId, value] of keyUpdates) {
      this.settings[section].apiKeys[providerId] = value;
    }

    this.save();
    return this.settings;
  }

  /**
   * Flattened, resolved config for consumers that shouldn't care where a value lives.
   * This is the shape BUILD-PLAN 0.4 describes; storage keeps per-provider prefs so
   * switching provider doesn't wipe the other one's models.
   */
  effective() {
    const s = this.load();
    const llmProvider = s.llm.provider;
    const llmModels = s.llm.models[llmProvider] || { standard: '', advanced: '', vision: '' };
    const sttProvider = s.stt.provider;

    return {
      llm: {
        provider: llmProvider,
        model: s.smartModeEnabled ? (llmModels.advanced || llmModels.standard) : llmModels.standard,
        standardModel: llmModels.standard,
        advancedModel: llmModels.advanced,
        visionModel: llmModels.vision || '',
        baseUrl: s.llm.baseUrl || '',
        apiKey: s.llm.apiKeys[llmProvider] || '',
        visionOverrides: s.llm.visionOverrides || {}
      },
      stt: {
        provider: sttProvider,
        model: (s.stt.models || {})[sttProvider] || '',
        language: s.stt.language || 'auto',
        baseUrl: s.stt.baseUrl || '',
        apiKey: (s.stt.apiKeys || {})[sttProvider] || ''
      },
      rateLimits: s.rateLimits
    };
  }

  /** Cache a provider's model list so the dropdown isn't empty offline. */
  cacheModels(providerId, models) {
    this.load();
    this.settings.modelCache = {
      ...this.settings.modelCache,
      [providerId]: { fetchedAt: Date.now(), models }
    };
    this.save();
    return this.settings.modelCache[providerId];
  }

  cachedModels(providerId) {
    const entry = (this.load().modelCache || {})[providerId];
    return entry && Array.isArray(entry.models) ? entry : null;
  }

  clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  mergeDeep(target, source) {
    const output = Object.assign({}, target);
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach((key) => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.mergeDeep(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }

  isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
  }
}

module.exports = new SettingsManager();

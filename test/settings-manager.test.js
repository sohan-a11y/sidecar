import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let tmpDir;






function loadSettings() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-test-'));
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => tmpDir },
      safeStorage: { isEncryptionAvailable: () => false }
    }
  };
  for (const mod of ['../src/main/SettingsManager.js', '../src/main/KeyStore.js']) {
    delete require.cache[require.resolve(mod)];
  }
  return require('../src/main/SettingsManager.js');
}

function writeLegacyFile(contents) {
  fs.writeFileSync(path.join(tmpDir, 'sidecar-data.json'), JSON.stringify(contents), 'utf8');
}

describe('SettingsManager', () => {
  let settings;

  beforeEach(() => {
    settings = loadSettings();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {

    }
  });

  it('migrates a v1 file without losing keys or model preferences', () => {
    writeLegacyFile({
      currentProvider: 'anthropic',
      smartModeEnabled: true,
      onboardingComplete: true,
      apiKeys: { openai: 'sk-openai', anthropic: 'sk-ant', gemini: '' },
      modelPreferences: {
        openai: { standard: 'gpt-4o-mini', advanced: 'gpt-4o' },
        anthropic: { standard: 'claude-3-5-haiku-latest', advanced: 'claude-3-opus-latest' },
        gemini: { standard: 'gemini-2.5-flash-lite', advanced: 'gemini-2.5-flash' }
      }
    });

    const s = settings.get();
    expect(s.schemaVersion).toBe(2);
    expect(s.llm.provider).toBe('anthropic');
    expect(s.llm.apiKeys.anthropic).toBe('sk-ant');
    expect(s.llm.apiKeys.openai).toBe('sk-openai');
    expect(s.llm.models.anthropic.advanced).toBe('claude-3-opus-latest');
    expect(s.smartModeEnabled).toBe(true);
    expect(s.onboardingComplete).toBe(true);
  });

  it('preserves the v1 transcription provider rule (gemini, else openai)', () => {
    writeLegacyFile({
      currentProvider: 'anthropic',
      apiKeys: { openai: 'sk-o', anthropic: 'sk-a' }
    });
    expect(settings.get().stt.provider).toBe('openai');
    expect(settings.get().stt.apiKeys.openai).toBe('sk-o');
  });

  it('migrates a gemini v1 file to gemini transcription', () => {
    writeLegacyFile({ currentProvider: 'gemini', apiKeys: { gemini: 'AIza-key' } });
    expect(settings.get().stt.provider).toBe('gemini');
    expect(settings.get().stt.apiKeys.gemini).toBe('AIza-key');
  });

  it('never exposes key material through publicView', () => {
    writeLegacyFile({ currentProvider: 'openai', apiKeys: { openai: 'sk-secret-value' } });
    const view = settings.publicView();
    const serialised = JSON.stringify(view);

    expect(serialised).not.toContain('sk-secret-value');
    expect(view.llm.apiKeys.openai).toBe('');
    expect(view.keyPresence.llm.openai).toBe(true);
    expect(view.keyPresence.llm.anthropic).toBe(false);
    expect(view.providers.map((p) => p.id)).toContain('tokenrouter');
  });

  it('treats an empty key patch as "leave it alone" and null as "clear it"', () => {
    writeLegacyFile({ currentProvider: 'openai', apiKeys: { openai: 'sk-original' } });
    settings.get();

    settings.set({ llm: { apiKeys: { openai: '' } } });
    expect(settings.get().llm.apiKeys.openai).toBe('sk-original');

    settings.set({ llm: { apiKeys: { openai: 'sk-replaced' } } });
    expect(settings.get().llm.apiKeys.openai).toBe('sk-replaced');

    settings.set({ llm: { apiKeys: { openai: null } } });
    expect(settings.get().llm.apiKeys.openai).toBe('');
  });

  it('resolves the effective model from smart mode', () => {
    settings.set({
      smartModeEnabled: false,
      llm: { provider: 'openai', models: { openai: { standard: 'small', advanced: 'big' } } }
    });
    expect(settings.effective().llm.model).toBe('small');

    settings.set({ smartModeEnabled: true });
    expect(settings.effective().llm.model).toBe('big');
  });

  it('keeps per-provider model config when the provider changes', () => {
    settings.set({ llm: { provider: 'openai', models: { openai: { standard: 'gpt-custom' } } } });
    settings.set({ llm: { provider: 'gemini' } });
    settings.set({ llm: { provider: 'openai' } });
    expect(settings.effective().llm.model).toBe('gpt-custom');
  });

  it('round-trips settings through disk', () => {
    settings.set({ llm: { provider: 'tokenrouter', apiKeys: { tokenrouter: 'tr-key' } } });
    const reloaded = loadSettingsFrom(tmpDir);
    expect(reloaded.get().llm.provider).toBe('tokenrouter');
    expect(reloaded.get().llm.apiKeys.tokenrouter).toBe('tr-key');
  });
});


function loadSettingsFrom(dir) {
  const electronPath = require.resolve('electron');
  require.cache[electronPath].exports.app.getPath = () => dir;
  delete require.cache[require.resolve('../src/main/SettingsManager.js')];
  return require('../src/main/SettingsManager.js');
}
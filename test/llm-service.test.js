import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let tmpDir;
let LlmService;
let SettingsManager;
let Providers;
let calls;
let statuses;

const MAIN_MODULES = [
  '../src/main/LlmService.js',
  '../src/main/SettingsManager.js',
  '../src/main/KeyStore.js',
  '../src/main/RateLimiter.js',
  '../src/main/providers/index.js'
];

function bootMain() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-llm-'));
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
  for (const mod of MAIN_MODULES) delete require.cache[require.resolve(mod)];

  Providers = require('../src/main/providers/index.js');
  SettingsManager = require('../src/main/SettingsManager.js');
  LlmService = require('../src/main/LlmService.js');

  calls = [];
  statuses = [];
  LlmService.onStatus = (message) => statuses.push(message);

  // Stand in for a real provider; records exactly what the dispatcher decided to send.
  Providers.get = () => ({
    id: 'openai',
    name: 'OpenAI',
    capabilities: { vision: true, streaming: true, transcription: true },
    async streamChat(args, onToken) {
      calls.push(args);
      onToken('ok');
    }
  });
}

describe('LlmService vision gating', () => {
  beforeEach(() => {
    bootMain();
    SettingsManager.set({
      llm: {
        provider: 'openai',
        apiKeys: { openai: 'sk-test' },
        models: { openai: { standard: 'gpt-4o-mini', advanced: 'gpt-4o', vision: '' } }
      }
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      /* best effort */
    }
  });

  const run = (images) =>
    LlmService.stream(
      { mode: 'assist', messages: [{ role: 'user', content: 'hi' }], images },
      () => {}
    );

  it('sends the image when the chat model has vision', async () => {
    await run(['data:image/png;base64,AAA']);
    expect(calls[0].model).toBe('gpt-4o-mini');
    expect(calls[0].images).toHaveLength(1);
    expect(statuses).toHaveLength(0);
  });

  it('drops the image for a text-only model and says so once', async () => {
    SettingsManager.set({ llm: { models: { openai: { standard: 'text-only-model-v1' } } } });

    await run(['data:image/png;base64,AAA']);
    await run(['data:image/png;base64,AAA']);

    expect(calls[0].model).toBe('text-only-model-v1');
    expect(calls[0].images).toHaveLength(0);
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toContain('text-only');
  });

  it('routes screenshots to the configured vision model instead of dropping them', async () => {
    SettingsManager.set({
      llm: { models: { openai: { standard: 'text-only-model-v1', vision: 'gpt-4o' } } }
    });

    await run(['data:image/png;base64,AAA']);

    expect(calls[0].model).toBe('gpt-4o');
    expect(calls[0].images).toHaveLength(1);
    expect(statuses[0]).toContain('vision');
  });

  it('honours a manual vision override', async () => {
    SettingsManager.set({
      llm: {
        models: { openai: { standard: 'mystery-model' } },
        visionOverrides: { 'mystery-model': true }
      }
    });

    await run(['data:image/png;base64,AAA']);
    expect(calls[0].images).toHaveLength(1);
  });

  it('leaves text-only requests alone regardless of model capability', async () => {
    SettingsManager.set({ llm: { models: { openai: { standard: 'text-only-model-v1' } } } });
    await run([]);
    expect(calls[0].images).toEqual([]);
    expect(statuses).toHaveLength(0);
  });

  it('refuses to run without an API key', async () => {
    SettingsManager.set({ llm: { apiKeys: { openai: null } } });
    await expect(run([])).rejects.toThrow(/API key/);
  });

  it('uses the advanced model when smart mode is on', async () => {
    SettingsManager.set({ smartModeEnabled: true });
    await run([]);
    expect(calls[0].model).toBe('gpt-4o');
  });
});

describe('provider registry', () => {
  beforeEach(() => {
    bootMain();
    delete require.cache[require.resolve('../src/main/providers/index.js')];
    Providers = require('../src/main/providers/index.js');
  });

  it('exposes exactly the adapters the plan calls for', () => {
    expect(Providers.ids).toEqual(['openai', 'anthropic', 'gemini', 'tokenrouter', 'custom']);
  });

  it('only offers transcription-capable providers for speech', () => {
    expect(Providers.transcriptionProviders().map((p) => p.id)).toEqual([
      'openai',
      'gemini',
      'custom'
    ]);
  });

  it('gives every adapter the same interface', () => {
    for (const id of Providers.ids) {
      const adapter = Providers.get(id);
      expect(typeof adapter.listModels).toBe('function');
      expect(typeof adapter.streamChat).toBe('function');
      expect(adapter.capabilities).toHaveProperty('vision');
      expect(adapter.capabilities).toHaveProperty('streaming');
      expect(adapter.capabilities).toHaveProperty('transcription');
      if (adapter.capabilities.transcription) {
        expect(typeof adapter.transcribe).toBe('function');
      }
    }
  });
});

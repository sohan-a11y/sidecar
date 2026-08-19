import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let tmpDir;
let PromptBuilder;
let SettingsManager;
let ContextStore;

const MODULES = [
  '../src/main/PromptBuilder.js',
  '../src/main/SettingsManager.js',
  '../src/main/ContextStore.js',
  '../src/main/LlmService.js',
  '../src/main/KeyStore.js'
];

function boot() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-shape-'));
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
  for (const mod of MODULES) delete require.cache[require.resolve(mod)];
  SettingsManager = require('../src/main/SettingsManager.js');
  ContextStore = require('../src/main/ContextStore.js');
  PromptBuilder = require('../src/main/PromptBuilder.js');
}

describe('answer shaping and threading', () => {
  beforeEach(() => boot());
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  it('defaults to speaking points', () => {
    const text = PromptBuilder.build('reply', { transcript: [] }).system[0].text;
    expect(text).toContain('3-5 bullet points');
    expect(text).toContain('7 words');
  });

  it('uses the per-mode preset over the global default', () => {
    expect(PromptBuilder.presetFor('code')).toBe('code');
    expect(PromptBuilder.presetFor('reply')).toBe('speak-points');
  });

  it('lets a single request override the preset', () => {
    const text = PromptBuilder.build('reply', { transcript: [], preset: 'detailed' }).system[0].text;
    expect(text).toContain('full answer');
    expect(text).not.toContain('3-5 bullet points');
  });

  it('ignores an unknown preset rather than sending garbage', () => {
    expect(PromptBuilder.presetFor('reply', 'shakespearean-sonnet')).toBe('speak-points');
  });

  it('sends prior turns ahead of the new one so follow-ups work', () => {
    const history = [
      { role: 'user', content: 'What is your greatest weakness?' },
      { role: 'assistant', content: 'Delegating early enough.' }
    ];
    const built = PromptBuilder.build('ask', { transcript: [], userText: 'Say more about that', history });

    expect(built.messages).toHaveLength(3);
    expect(built.messages[0].content).toContain('greatest weakness');
    expect(built.messages[1].role).toBe('assistant');
    expect(built.messages[2].content).toContain('Say more about that');
  });

  it('still respects session length and tone alongside the preset', () => {
    ContextStore.setSession({ answerLength: 'brief', tone: 'formal', answerLanguage: 'Hindi' });
    const text = PromptBuilder.build('reply', { transcript: [] }).system[0].text;
    expect(text).toContain('2 short sentences');
    expect(text).toContain('professional and precise');
    expect(text).toContain('Hindi');
  });

  it('honours a changed global preset', () => {
    SettingsManager.set({ answers: { preset: 'brief' } });
    expect(PromptBuilder.presetFor('reply')).toBe('brief');
  });
});

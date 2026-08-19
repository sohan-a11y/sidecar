import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let tmpDir;
let SessionManager;
let SettingsManager;
let ContextStore;

const MODULES = [
  '../src/main/SessionManager.js',
  '../src/main/SettingsManager.js',
  '../src/main/ContextStore.js',
  '../src/main/KeyStore.js'
];

function boot(dir) {
  tmpDir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-sess-'));
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
  SessionManager = require('../src/main/SessionManager.js');
  SessionManager.init(tmpDir);
}

const say = (sender, text, extra = {}) =>
  SessionManager.upsertTurn({ sender, channel: sender, text, ...extra });

describe('SessionManager', () => {
  beforeEach(() => boot());
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      /* best effort */
    }
  });

  it('snapshots the interview context into the session', () => {
    ContextStore.setSession({ role: 'Staff Engineer', company: 'Globex' });
    const session = SessionManager.start();
    expect(session.title).toBe('Staff Engineer at Globex');
    expect(session.context.company).toBe('Globex');
    expect(SessionManager.isActive()).toBe(true);
  });

  it('replaces an interim turn in place instead of appending', () => {
    SessionManager.start();
    const interim = say('system', 'tell me about a', { interim: true });
    const final = say('system', 'tell me about a migration', { interim: false });

    expect(final.id).toBe(interim.id);
    expect(SessionManager.transcriptView()).toHaveLength(1);
    expect(SessionManager.finalTurns()[0].text).toBe('tell me about a migration');
  });

  it('keeps interim turns off disk', () => {
    SessionManager.start();
    say('system', 'final line');
    say('user', 'still speaking', { interim: true });
    SessionManager.persist(true);

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'sessions', `${SessionManager.current().id}.json`), 'utf8')
    );
    expect(onDisk.transcript).toHaveLength(1);
    expect(onDisk.transcript[0].text).toBe('final line');
  });

  it('bounds the prompt window by turn count', () => {
    SettingsManager.set({ transcript: { windowTurns: 5, maxPromptTokens: 100000 } });
    SessionManager.start();
    for (let i = 0; i < 20; i += 1) say('system', `turn number ${i}`);

    const window = SessionManager.getPromptWindow();
    expect(window.turns).toHaveLength(5);
    expect(window.turns[4].text).toBe('turn number 19');
    expect(window.droppedTurns).toBe(15);
  });

  it('bounds the prompt window by the token ceiling', () => {
    SettingsManager.set({ transcript: { windowTurns: 50, maxPromptTokens: 60 } });
    SessionManager.start();
    for (let i = 0; i < 20; i += 1) say('system', 'a fairly wordy turn that eats budget');

    const window = SessionManager.getPromptWindow();
    expect(window.turns.length).toBeLessThan(20);
    expect(window.estimatedTokens).toBeLessThanOrEqual(60);
  });

  it('folds older turns into a running summary exactly once per interval', async () => {
    SettingsManager.set({
      transcript: { windowTurns: 5, summariseEvery: 5, maxPromptTokens: 100000 }
    });
    let calls = 0;
    SessionManager.onSummaryNeeded = async (older) => {
      calls += 1;
      return `summary of ${older.length} turns`;
    };

    SessionManager.start();
    for (let i = 0; i < 12; i += 1) say('system', `turn ${i}`);
    await new Promise((r) => setTimeout(r, 30));

    expect(calls).toBeGreaterThan(0);
    const window = SessionManager.getPromptWindow();
    expect(window.summary).toMatch(/summary of \d+ turns/);
  });

  it('recovers a session left open by an unclean shutdown', () => {
    SessionManager.start('Interrupted');
    say('system', 'we were mid conversation');
    SessionManager.persist(true);

    const dir = tmpDir;
    boot(dir); // simulate relaunch
    const recovered = SessionManager.recover();

    expect(recovered).not.toBeNull();
    expect(recovered.title).toBe('Interrupted');
    expect(SessionManager.finalTurns()[0].text).toBe('we were mid conversation');
  });

  it('ends a session, stamps it, and clears the interview context', () => {
    ContextStore.setSession({ role: 'Staff Engineer' });
    SessionManager.start();
    say('user', 'hello');
    const ended = SessionManager.end();

    expect(ended.endedAt).toBeGreaterThan(0);
    expect(SessionManager.isActive()).toBe(false);
    expect(ContextStore.getSession().role).toBe('');
    expect(SessionManager.list()).toHaveLength(1);
  });

  it('writes nothing to disk when retention is "never"', () => {
    SettingsManager.set({ sessions: { retention: 'never' } });
    SessionManager.start();
    say('user', 'private');
    SessionManager.persist();

    expect(SessionManager.list()).toHaveLength(0);
  });

  it('deletes sessions older than the retention window', () => {
    SettingsManager.set({ sessions: { retention: 'days', retentionDays: 7 } });
    SessionManager.start('Old one');
    SessionManager.current().startedAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
    SessionManager.persist(true);
    SessionManager.session = null;

    SessionManager.applyRetention();
    expect(SessionManager.list()).toHaveLength(0);
  });

  it('exports markdown, text and json', () => {
    SessionManager.start('Export me');
    say('system', 'What is your greatest weakness?');
    say('user', 'Answering this question.');
    SessionManager.addAnswer({
      mode: 'reply',
      provider: 'openai',
      model: 'gpt-4o',
      text: 'Say something true.'
    });
    const id = SessionManager.current().id;

    const md = SessionManager.export(id, 'md');
    expect(md).toContain('# Export me');
    expect(md).toContain('**Them:** What is your greatest weakness?');
    expect(md).toContain('gpt-4o');

    expect(SessionManager.export(id, 'txt')).toContain('Them: What is your greatest weakness?');
    expect(JSON.parse(SessionManager.export(id, 'json')).answers).toHaveLength(1);
  });

  it('renames a saved session', () => {
    SessionManager.start('Before');
    SessionManager.end();
    const { id } = SessionManager.list()[0];
    SessionManager.rename(id, 'After');
    expect(SessionManager.list()[0].title).toBe('After');
  });
});

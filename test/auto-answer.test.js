import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let tmpDir;
let QuestionDetector;
let AutoAnswer;
let SettingsManager;
let RateLimiter;

const MODULES = [
  '../src/main/QuestionDetector.js',
  '../src/main/AutoAnswer.js',
  '../src/main/SettingsManager.js',
  '../src/main/RateLimiter.js',
  '../src/main/KeyStore.js'
];

function boot() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-auto-'));
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
  RateLimiter = require('../src/main/RateLimiter.js');
  QuestionDetector = require('../src/main/QuestionDetector.js');
  AutoAnswer = require('../src/main/AutoAnswer.js');
}

describe('QuestionDetector', () => {
  beforeEach(() => boot());
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  const confidence = (text, ctx) => QuestionDetector.detect(text, ctx).confidence;

  it('scores a direct question highly', () => {
    expect(confidence('What is your greatest weakness?', { silenceMs: 1500, isFinal: true }))
      .toBeGreaterThan(0.7);
  });

  it('catches an imperative prompt with no question mark', () => {
    expect(confidence('Tell me about a time you disagreed with a colleague', { silenceMs: 1500, isFinal: true }))
      .toBeGreaterThan(0.7);
  });

  it('catches auxiliary-verb inversion', () => {
    expect(confidence('Can you walk me through your last project', { silenceMs: 1400, isFinal: true }))
      .toBeGreaterThan(0.7);
  });

  it('ignores conversational filler that ends in a question mark', () => {
    expect(confidence('Can you hear me?', { silenceMs: 2000, isFinal: true })).toBe(0);
    expect(confidence('Right?', { silenceMs: 2000, isFinal: true })).toBe(0);
  });

  it('ignores a statement', () => {
    expect(confidence('We build the billing system in Go.', { silenceMs: 2000, isFinal: true }))
      .toBeLessThan(0.5);
  });

  it('holds back when the speaker trails off mid-thought', () => {
    const finished = confidence('So what would you do in that situation', { silenceMs: 1500, isFinal: true });
    const trailing = confidence('So what would you do in that situation and', { silenceMs: 200, isFinal: true });
    expect(trailing).toBeLessThan(finished);
  });

  it('discounts an interim transcript', () => {
    const final = confidence('Why did you leave that role?', { silenceMs: 1500, isFinal: true });
    const interim = confidence('Why did you leave that role?', { silenceMs: 100, isFinal: false });
    expect(interim).toBeLessThan(final);
  });

  it('accepts a pluggable strategy without callers changing', () => {
    QuestionDetector.setStrategy(() => ({ isQuestion: true, confidence: 0.99, reasons: ['stub'], trigger: 'x' }));
    expect(confidence('anything at all')).toBe(0.99);
    QuestionDetector.setStrategy(null);
  });
});

describe('AutoAnswer interlock', () => {
  let fired;

  beforeEach(() => {
    boot();
    fired = [];
    AutoAnswer.onTrigger = (info) => fired.push(info);
    AutoAnswer.onNotice = () => {};
    SettingsManager.set({
      autoAnswer: { enabled: true, threshold: 0.7, debounceMs: 5, cooldownMs: 50, maxPerMinute: 2 }
    });
    RateLimiter.configure({ openai: { rpm: 60, rpd: 1000 } });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  const ask = (text, extra = {}) =>
    AutoAnswer.consider({ text, isFinal: true, silenceMs: 1500, ...extra }, 'openai');
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it('does nothing at all when disabled', async () => {
    SettingsManager.set({ autoAnswer: { enabled: false } });
    ask('What is your greatest weakness?');
    await settle();
    expect(fired).toHaveLength(0);
  });

  it('fires on a confident question when enabled', async () => {
    ask('Tell me about a time you shipped something hard');
    await settle();
    expect(fired).toHaveLength(1);
    expect(fired[0].trigger).toContain('shipped something hard');
  });

  it('stays silent below the confidence threshold', async () => {
    ask('We use Postgres for that.');
    await settle();
    expect(fired).toHaveLength(0);
  });

  it('respects the cooldown between answers', async () => {
    ask('What is your greatest weakness?');
    await settle();
    ask('And why did you leave that role?');
    await settle();
    expect(fired).toHaveLength(1);
  });

  it('respects the per-minute cap', async () => {
    AutoAnswer.lastFiredAt = 0;
    SettingsManager.set({ autoAnswer: { cooldownMs: 0, maxPerMinute: 2 } });

    for (const q of ['What is your weakness?', 'Why did you leave?', 'How do you handle conflict?']) {
      ask(q);
      await settle();
    }
    expect(fired).toHaveLength(2);
  });

  it('will not spend the last of the daily budget', async () => {
    RateLimiter.configure({ openai: { rpm: 60, rpd: 3 } });
    await RateLimiter.schedule('openai', {}, async () => 'x'); // 1 of 3 spent

    ask('What is your greatest weakness?');
    await settle();
    expect(fired).toHaveLength(0);
  });

  it('is cancelled by a manual request standing it down', async () => {
    ask('Tell me about a time you failed');
    AutoAnswer.standDown(); // a hotkey press
    await settle();
    expect(fired).toHaveLength(0);
  });

  it('ignores interim turns unless speculative generation is on', async () => {
    AutoAnswer.consider({ text: 'Tell me about a time you failed', isFinal: false, silenceMs: 100 }, 'openai');
    await settle();
    expect(fired).toHaveLength(0);

    SettingsManager.set({ autoAnswer: { speculative: true, threshold: 0.5 } });
    AutoAnswer.consider({ text: 'Tell me about a time you failed', isFinal: false, silenceMs: 1500 }, 'openai');
    await settle();
    expect(fired).toHaveLength(1);
    expect(fired[0].speculative).toBe(true);
  });

  it('treats appended words as the same question, not a new one', () => {
    expect(AutoAnswer.divergedFrom('tell me about a time', 'tell me about a time you failed')).toBe(false);
    expect(AutoAnswer.divergedFrom('tell me about a time', 'what is your salary expectation')).toBe(true);
  });
});

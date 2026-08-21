import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let tmpDir;
let MediaCapture;
let ShortcutsManager;
let SettingsManager;
let registered;
let ownedByOthers;

const MODULES = [
'../src/main/MediaCapture.js',
'../src/main/ShortcutsManager.js',
'../src/main/SettingsManager.js',
'../src/main/KeyStore.js'];


function boot() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cap-'));
  registered = [];
  ownedByOthers = new Set();

  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => tmpDir, quit() {} },
      safeStorage: { isEncryptionAvailable: () => false },
      screen: {
        getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 } }),
        getAllDisplays: () => []
      },
      desktopCapturer: { getSources: async () => [] },
      globalShortcut: {
        register: (accelerator) => {
          if (ownedByOthers.has(accelerator)) return false;
          registered.push(accelerator);
          return true;
        },
        isRegistered: (accelerator) =>
        ownedByOthers.has(accelerator) || registered.includes(accelerator),
        unregisterAll: () => {
          registered = [];
        }
      }
    }
  };
  for (const mod of MODULES) delete require.cache[require.resolve(mod)];
  SettingsManager = require('../src/main/SettingsManager.js');
  MediaCapture = require('../src/main/MediaCapture.js');
  ShortcutsManager = require('../src/main/ShortcutsManager.js');
}


function fakeImage(bytes) {
  return {
    resize: () => ({ toBitmap: () => Buffer.from(bytes) })
  };
}


function gradient(brightCount) {
  const bytes = [];
  for (let i = 0; i < 64; i += 1) {
    const v = i < brightCount ? 255 : 0;
    bytes.push(v, v, v, 255);
  }
  return fakeImage(bytes);
}

describe('capture change detection', () => {
  beforeEach(() => boot());
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {

    }
  });

  it('produces a 64-bit hash', () => {
    expect(MediaCapture.averageHash(gradient(32))).toHaveLength(64);
  });

  it('gives identical screens an identical hash', () => {
    expect(MediaCapture.averageHash(gradient(32))).toBe(MediaCapture.averageHash(gradient(32)));
  });

  it('gives a materially different screen a distant hash', () => {
    const a = MediaCapture.averageHash(gradient(8));
    const b = MediaCapture.averageHash(gradient(56));
    expect(MediaCapture.hammingDistance(a, b)).toBeGreaterThan(4);
  });

  it('treats a hash of a different length as maximally distant', () => {
    expect(MediaCapture.hammingDistance('1010', null)).toBe(Number.MAX_SAFE_INTEGER);
    expect(MediaCapture.hammingDistance('1010', '10')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('bounds the audio buffer so a stuck VAD cannot grow it forever', () => {
    MediaCapture.toggleListening(true);
    const oneSecond = new Uint8Array(32000);
    for (let i = 0; i < 120; i += 1) MediaCapture.appendAudioChunk('user', oneSecond.buffer);

    const flushed = MediaCapture.getAndFlushAudio('user');
    expect(flushed.length).toBeLessThanOrEqual(32000 * 61);
  });
});

describe('shortcut registration', () => {
  beforeEach(() => boot());
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {

    }
  });

  it('registers every configured binding', () => {
    const conflicts = ShortcutsManager.registerAll({
      assist: () => {},
      code: () => {},
      quickAssist: () => {},
      toggleOverlay: () => {}
    });
    expect(conflicts).toEqual([]);
    expect(registered).toContain('CommandOrControl+Return');
    expect(registered).toContain('CommandOrControl+Shift+H');
  });

  it('reports a shortcut another application already owns', () => {
    ownedByOthers.add('CommandOrControl+H');
    const conflicts = ShortcutsManager.registerAll({ assist: () => {}, code: () => {} });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].action).toBe('code');
    expect(conflicts[0].reason).toMatch(/another application/);
  });

  it('reports two actions bound to the same combination', () => {
    SettingsManager.set({
      shortcuts: { assist: 'CommandOrControl+J', code: 'CommandOrControl+J' }
    });
    const conflicts = ShortcutsManager.registerAll({ assist: () => {}, code: () => {} });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toMatch(/already bound to/);
  });

  it('probes an accelerator before it is assigned', () => {
    expect(ShortcutsManager.probe('CommandOrControl+Return').ok).toBe(false);
    expect(ShortcutsManager.probe('CommandOrControl+Alt+Z').ok).toBe(true);
    expect(ShortcutsManager.probe('').ok).toBe(false);
  });

  it('offers an overlay toggle, which the app previously had no way to do', () => {
    expect(ShortcutsManager.actions().map((a) => a.id)).toContain('toggleOverlay');
    expect(SettingsManager.get().shortcuts.toggleOverlay).toBeTruthy();
  });
});
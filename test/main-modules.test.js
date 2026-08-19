import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let tmpDir;

/**
 * Electron cannot run headless here, so this stands in for the "does the main process
 * even load" half of the smoke test: every module is required against a stubbed
 * electron, and IpcRouter.initialize() is run to prove every handler wires up.
 */
const handlers = { invoke: {}, on: {} };
const sent = [];

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-main-'));
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => tmpDir, quit() {}, on() {}, whenReady: () => Promise.resolve() },
      safeStorage: { isEncryptionAvailable: () => false },
      ipcMain: {
        handle: (channel, fn) => { handlers.invoke[channel] = fn; },
        on: (channel, fn) => { handlers.on[channel] = fn; }
      },
      shell: { openExternal: () => Promise.resolve() },
      globalShortcut: { register: () => true, unregisterAll() {} },
      desktopCapturer: { getSources: () => Promise.resolve([]) },
      screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
      BrowserWindow: class {},
      session: { defaultSession: {} }
    }
  };
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {
    /* best effort */
  }
});

describe('main process modules', () => {
  it('all load without throwing', () => {
    const modules = [
      '../src/main/KeyStore.js',
      '../src/main/RateLimiter.js',
      '../src/main/SettingsManager.js',
      '../src/main/MediaCapture.js',
      '../src/main/WindowManager.js',
      '../src/main/ShortcutsManager.js',
      '../src/main/TranscriptionService.js',
      '../src/main/LlmService.js',
      '../src/main/IpcRouter.js',
      '../src/main/providers/index.js'
    ];
    for (const mod of modules) {
      expect(() => require(mod), `${mod} should load`).not.toThrow();
    }
  });

  it('registers every IPC channel the preload bridge exposes', () => {
    const IpcRouter = require('../src/main/IpcRouter.js');
    const WindowManager = require('../src/main/WindowManager.js');
    WindowManager.send = (channel, data) => sent.push({ channel, data });

    IpcRouter.initialize();

    const invokeChannels = Object.keys(handlers.invoke).sort();
    const sendChannels = Object.keys(handlers.on).sort();

    expect(invokeChannels).toEqual([
      'sidecar:models:list',
      'sidecar:settings:get',
      'sidecar:settings:set',
      'sidecar:toggle-listening',
      'sidecar:usage:get'
    ]);
    expect(sendChannels).toEqual([
      'sidecar:audio-chunk',
      'sidecar:log',
      'sidecar:mouse-ignore',
      'sidecar:open-url',
      'sidecar:run-mode'
    ]);
  });

  it('exposes the same invoke channels from the preload bridge', () => {
    const preload = fs.readFileSync(new URL('../src/preload/index.js', import.meta.url), 'utf8');
    for (const channel of Object.keys(handlers.invoke)) {
      expect(preload, `preload should call ${channel}`).toContain(channel);
    }
  });

  it('whitelists every channel main actually sends to the renderer', () => {
    const preload = fs.readFileSync(new URL('../src/preload/index.js', import.meta.url), 'utf8');
    const mainSources = ['IpcRouter.js', 'WindowManager.js']
      .map((f) => fs.readFileSync(new URL(`../src/main/${f}`, import.meta.url), 'utf8'))
      .join('\n');

    const sentChannels = new Set(
      [...mainSources.matchAll(/send\(\s*'([a-z:]+)'/g)].map((m) => m[1])
    );

    for (const channel of sentChannels) {
      expect(preload, `preload must whitelist "${channel}"`).toContain(`'${channel}'`);
    }
    expect(sentChannels.size).toBeGreaterThan(4);
  });

  it('returns a redacted settings view over IPC', async () => {
    const SettingsManager = require('../src/main/SettingsManager.js');
    SettingsManager.set({ llm: { apiKeys: { openai: 'sk-should-never-leave-main' } } });

    const view = await handlers.invoke['sidecar:settings:get']();
    expect(JSON.stringify(view)).not.toContain('sk-should-never-leave-main');
    expect(view.keyPresence.llm.openai).toBe(true);
  });

  it('reports a usage snapshot over IPC', async () => {
    const snapshot = await handlers.invoke['sidecar:usage:get']();
    expect(snapshot).toHaveProperty('openai');
    expect(snapshot.openai).toHaveProperty('remainingDay');
  });
});

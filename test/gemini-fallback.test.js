import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let tmpDir;
let IpcRouter;

/**
 * Regression coverage for a real bug: Gemini's /v1beta/models list can still return a
 * pinned id (e.g. gemini-2.5-flash) after Google retires it for new callers.
 * generateContent then 404s even though the model passed the list-membership check.
 * pickFallbackModel must prefer a '-latest' alias whenever the list offers one, since
 * aliases redirect server-side and don't go stale the same way.
 */
function boot() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fallback-'));
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => tmpDir, quit() {}, on() {} },
      safeStorage: { isEncryptionAvailable: () => false },
      ipcMain: { handle() {}, on() {} },
      shell: { openExternal: () => Promise.resolve() },
      dialog: { showSaveDialog: () => Promise.resolve({ canceled: true }) }
    }
  };
  for (const mod of [
    '../src/main/IpcRouter.js',
    '../src/main/SettingsManager.js',
    '../src/main/KeyStore.js'
  ]) {
    delete require.cache[require.resolve(mod)];
  }
  IpcRouter = require('../src/main/IpcRouter.js');
}

const asModels = (ids) => ids.map((id) => ({ id }));

describe('IpcRouter.pickFallbackModel — gemini', () => {
  beforeEach(() => boot());

  it('prefers a -latest alias over a pinned id still present in the list', () => {
    const models = asModels([
      'gemini-2.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-2.5-pro'
    ]);
    expect(IpcRouter.pickFallbackModel('gemini', models, 'standard')).toBe(
      'gemini-flash-lite-latest'
    );
  });

  it('picks the flash alias for the advanced slot over the lite alias', () => {
    const models = asModels(['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-pro']);
    expect(IpcRouter.pickFallbackModel('gemini', models, 'advanced')).toBe('gemini-flash-latest');
  });

  it('falls back to a pinned id when no alias exists at all', () => {
    const models = asModels(['gemini-2.5-flash-lite', 'gemini-2.5-pro']);
    expect(IpcRouter.pickFallbackModel('gemini', models, 'standard')).toBe('gemini-2.5-flash-lite');
  });

  it('does not pick a lite alias for the flash-only advanced slot', () => {
    const models = asModels(['gemini-flash-lite-latest', 'gemini-2.5-pro']);
    // No flash alias/pinned id at all: advanced falls back to lite, then to the first id.
    expect(IpcRouter.pickFallbackModel('gemini', models, 'advanced')).toBe(
      'gemini-flash-lite-latest'
    );
  });
});

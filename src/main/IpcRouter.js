const { ipcMain, shell, app } = require('electron');
const SettingsManager = require('./SettingsManager');
const WindowManager = require('./WindowManager');
const MediaCapture = require('./MediaCapture');
const TranscriptionService = require('./TranscriptionService');
const LlmService = require('./LlmService');
const PromptBuilder = require('./PromptBuilder');
const ContextStore = require('./ContextStore');
const ProfileBuilder = require('./ProfileBuilder');
const RateLimiter = require('./RateLimiter');
const Providers = require('./providers');
const { isAbort } = require('./providers/util');

const TRANSCRIPTION_INTERVAL_MS = 3500;

class IpcRouter {
  constructor() {
    this.transcript = [];
    this.transcriptionTimer = null;
    this.transcriptionBusy = { user: false, system: false };
    this.isLlmBusy = false;
    this.activeRequest = null;
    this.sttErrorShown = false;
  }

  initialize() {
    RateLimiter.init(app.getPath('userData'));
    this.applyRateLimits();

    // Main-process modules report to the user through one channel.
    LlmService.onStatus = (message) => WindowManager.send('status', { message });
    TranscriptionService.onStatus = (message) => WindowManager.send('status', { message });
    RateLimiter.onChange = (snapshot) => WindowManager.send('usage', snapshot);
    ContextStore.onChange = (view) => WindowManager.send('context:changed', view);

    // 1. Settings handlers — the renderer only ever sees the redacted view.
    ipcMain.handle('sidecar:settings:get', () => SettingsManager.publicView());
    ipcMain.handle('sidecar:settings:set', (_event, patch) => {
      this.sttErrorShown = false;
      LlmService.resetNotices();
      SettingsManager.set(patch);
      this.applyRateLimits();
      this.validateConfiguredModels();
      return SettingsManager.publicView();
    });

    // 2. Listening / capture toggle
    ipcMain.handle('sidecar:toggle-listening', () => {
      const state = !MediaCapture.isListening;
      const active = MediaCapture.toggleListening(state);
      if (active) this.startTranscriptionLoop();
      else this.stopTranscriptionLoop();
      WindowManager.send('capture:state', { active });
      return active;
    });

    // 3. Audio chunks from the renderer (16 kHz mono Int16 PCM)
    ipcMain.on('sidecar:audio-chunk', (_event, { source, arrayBuffer }) => {
      MediaCapture.appendAudioChunk(source, arrayBuffer);
    });

    // 4. Run a mode (trigger an LLM task)
    ipcMain.on('sidecar:run-mode', (_event, payload) => {
      this.executeMode(payload.mode, payload.text);
    });

    // 5. Mouse click-through
    ipcMain.on('sidecar:mouse-ignore', (_event, ignore) => {
      WindowManager.setIgnoreMouseEvents(ignore);
    });

    // 6. External URL
    ipcMain.on('sidecar:open-url', (_event, url) => {
      shell.openExternal(url).catch((err) => console.error('[IpcRouter] Open URL failed:', err.message));
    });

    // 7. Renderer logging
    ipcMain.on('sidecar:log', (_event, msg) => {
      console.log('[Renderer]', msg);
    });

    // 8. Model list for the settings dropdowns
    ipcMain.handle('sidecar:models:list', async (_event, { providerId, refresh } = {}) => {
      try {
        const result = await LlmService.listModels(providerId, { refresh });
        return { ok: true, ...result };
      } catch (e) {
        console.error(`[IpcRouter] Model list failed for ${providerId}:`, e.message);
        return { ok: false, models: [], error: e.message };
      }
    });

    // 9. Rate-limit budget snapshot
    ipcMain.handle('sidecar:usage:get', () => RateLimiter.snapshot());

    // 10. Context layer — documents, profile, story bank, session setup
    ipcMain.handle('sidecar:context:get', () => ContextStore.publicView());

    ipcMain.handle('sidecar:context:ingest', async (_event, { name, bytes }) => {
      try {
        const doc = await ContextStore.ingest(name, Buffer.from(bytes));
        return { ok: true, document: { id: doc.id, filename: doc.filename, chars: doc.text.length } };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });

    ipcMain.handle('sidecar:context:remove', (_event, id) => {
      ContextStore.removeDocument(id);
      return ContextStore.publicView();
    });

    ipcMain.handle('sidecar:context:distill', async () => {
      try {
        const profile = await ProfileBuilder.distill(
          ContextStore.rawText(),
          (stage) => WindowManager.send('context:progress', { stage })
        );
        ContextStore.setProfile(profile);
        return { ok: true, profile };
      } catch (e) {
        WindowManager.send('context:progress', { stage: '' });
        return { ok: false, error: e.message };
      }
    });

    ipcMain.handle('sidecar:context:profile:set', (_event, profile) => {
      ContextStore.setProfile(profile);
      return ContextStore.publicView();
    });

    ipcMain.handle('sidecar:context:story:save', (_event, story) => {
      try {
        ContextStore.upsertStory(story);
        return { ok: true, view: ContextStore.publicView() };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });

    ipcMain.handle('sidecar:context:story:delete', (_event, id) => {
      ContextStore.deleteStory(id);
      return ContextStore.publicView();
    });

    ipcMain.handle('sidecar:context:session:set', (_event, patch) => {
      ContextStore.setSession(patch);
      return ContextStore.publicView();
    });

    ipcMain.handle('sidecar:context:clear', (_event, scope) => {
      if (scope === 'session') ContextStore.clearSession();
      else ContextStore.clearAll();
      return ContextStore.publicView();
    });

    this.validateConfiguredModels();
  }

  applyRateLimits() {
    RateLimiter.configure(SettingsManager.get().rateLimits);
  }

  /**
   * Drop configured models that the provider no longer serves.
   * Generalises the old Gemini-only check to every provider (BUILD-PLAN 0.2).
   */
  async validateConfiguredModels() {
    const settings = SettingsManager.get();
    const providerId = settings.llm.provider;
    const apiKey = settings.llm.apiKeys[providerId];
    if (!apiKey && providerId !== 'custom') return;

    // Non-blocking: a slow or unauthorised models endpoint must not delay startup.
    setTimeout(async () => {
      let models = [];
      try {
        const result = await LlmService.listModels(providerId, { refresh: true });
        models = result.models || [];
      } catch (e) {
        console.warn(`[IpcRouter] Could not validate ${providerId} models:`, e.message);
        return;
      }
      if (models.length === 0) return;

      const available = new Set(models.map((m) => m.id));
      const prefs = { ...settings.llm.models[providerId] };
      let changed = false;

      for (const slot of ['standard', 'advanced']) {
        const configured = prefs[slot];
        if (!configured || available.has(configured)) continue;
        const replacement = this.pickFallbackModel(providerId, models, slot);
        if (!replacement || replacement === configured) continue;
        console.log(`[IpcRouter] ${providerId} model "${configured}" is gone — using "${replacement}".`);
        prefs[slot] = replacement;
        changed = true;
      }

      if (prefs.vision && !available.has(prefs.vision)) {
        prefs.vision = '';
        changed = true;
      }

      if (changed) {
        SettingsManager.set({ llm: { models: { [providerId]: prefs } } });
        const label = Providers.get(providerId).name;
        WindowManager.send('status', {
          message: `${label} model updated automatically — the configured model was retired.`
        });
        WindowManager.send('settings:changed', SettingsManager.publicView());
      }
    }, 1000);
  }

  pickFallbackModel(providerId, models, slot) {
    const ids = models.map((m) => m.id);
    if (providerId === 'gemini') {
      const lite = ids.find((id) => id.toLowerCase().includes('flash-lite'));
      const flash = ids.find((id) => id.toLowerCase().includes('flash') && !id.toLowerCase().includes('flash-lite'));
      if (slot === 'advanced') return flash || lite || ids[0];
      return lite || flash || ids[0];
    }
    // Free tiers first for routers — an unavailable model must not silently cost money.
    const free = models.filter((m) => m.free).map((m) => m.id);
    if (free.length > 0) return free[0];
    return ids[0];
  }

  startTranscriptionLoop() {
    if (this.transcriptionTimer) return;
    this.transcriptionTimer = setInterval(() => {
      this.processTranscription('user');
      this.processTranscription('system');
    }, TRANSCRIPTION_INTERVAL_MS);
  }

  stopTranscriptionLoop() {
    if (this.transcriptionTimer) {
      clearInterval(this.transcriptionTimer);
      this.transcriptionTimer = null;
    }
  }

  async processTranscription(source) {
    if (this.transcriptionBusy[source]) return;
    const pcm = MediaCapture.getAndFlushAudio(source);
    if (!pcm || pcm.length === 0) return;

    this.transcriptionBusy[source] = true;
    try {
      const text = await TranscriptionService.transcribe(pcm, source);
      if (text && text.trim()) {
        const turn = {
          sender: source === 'user' ? 'user' : 'system',
          text: text.trim(),
          timestamp: Date.now()
        };
        this.transcript.push(turn);
        WindowManager.send('transcript', turn);
      }
    } catch (e) {
      // Configuration problems are worth telling the user about, once.
      if (e.code === 'STT_NOT_READY' || e.code === 'RATE_LIMIT_DAILY') {
        if (!this.sttErrorShown) {
          this.sttErrorShown = true;
          WindowManager.send('status', { message: e.message });
        }
      } else {
        console.error(`[IpcRouter] STT ${source} error:`, e.message);
      }
    } finally {
      this.transcriptionBusy[source] = false;
    }
  }

  async executeMode(mode, userText, { priority = 'user' } = {}) {
    if (this.isLlmBusy) return;
    const modeConfig = LlmService.modes[mode];
    if (!modeConfig) return;

    this.isLlmBusy = true;
    const controller = new AbortController();
    this.activeRequest = controller;

    const userBubble = modeConfig.requiresScreen || mode === 'ask'
      ? (userText || (mode === 'code' ? 'Analyze screen contents' : 'Assist'))
      : null;

    WindowManager.send('llm:start', { userBubble, small: mode === 'questions' || mode === 'summarize' });

    try {
      const images = [];
      if (modeConfig.requiresScreen) {
        try {
          images.push(await MediaCapture.takeScreenshot());
        } catch (e) {
          WindowManager.send('status', { message: 'Screen Recording permission is required for screenshot features.' });
        }
      }

      const prompt = PromptBuilder.build(mode, {
        transcript: this.transcript,
        userText,
        images
      });

      await LlmService.stream(
        {
          mode,
          system: prompt.system,
          messages: prompt.messages,
          images,
          signal: controller.signal,
          priority
        },
        (token) => WindowManager.send('llm:token', { text: token })
      );

      WindowManager.send('llm:done', {});
    } catch (err) {
      if (isAbort(err)) {
        WindowManager.send('llm:done', {});
      } else {
        WindowManager.send('llm:error', { message: `LLM Error: ${err.message}` });
      }
    } finally {
      this.isLlmBusy = false;
      this.activeRequest = null;
    }
  }

  ensureListeningAndAssist() {
    if (!MediaCapture.isListening) {
      const active = MediaCapture.toggleListening(true);
      if (active) this.startTranscriptionLoop();
      WindowManager.send('capture:state', { active });
    }
    this.executeMode('assist', '');
  }
}

module.exports = new IpcRouter();

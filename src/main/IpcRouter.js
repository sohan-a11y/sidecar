const { ipcMain, shell, app, dialog } = require('electron');
const fs = require('fs');
const SettingsManager = require('./SettingsManager');
const WindowManager = require('./WindowManager');
const MediaCapture = require('./MediaCapture');
const TranscriptionService = require('./TranscriptionService');
const LlmService = require('./LlmService');
const PromptBuilder = require('./PromptBuilder');
const ContextStore = require('./ContextStore');
const ProfileBuilder = require('./ProfileBuilder');
const SessionManager = require('./SessionManager');
const RateLimiter = require('./RateLimiter');
const Providers = require('./providers');
const { isAbort } = require('./providers/util');

const SttEngines = require('./stt');
const AutoAnswer = require('./AutoAnswer');

class IpcRouter {
  constructor() {
    this.transcriptionTimer = null;
    this.transcriptionBusy = { user: false, system: false };
    this.isLlmBusy = false;
    this.activeRequest = null;
    this.sttErrorShown = false;
    this.activeRequestIsAuto = false;
    this.lastSystemTurnAt = 0;
  }

  initialize() {
    RateLimiter.init(app.getPath('userData'));
    SessionManager.init(app.getPath('userData'));
    this.applyRateLimits();

    // Main-process modules report to the user through one channel.
    LlmService.onStatus = (message) => WindowManager.send('status', { message });
    TranscriptionService.onStatus = (message) => WindowManager.send('status', { message });
    TranscriptionService.onResult = (result) => this.handleSttResult(result);

    AutoAnswer.onNotice = (message) => WindowManager.send('status', { message });
    AutoAnswer.onCancel = (why) => {
      if (this.activeRequest && this.activeRequestIsAuto) {
        this.activeRequest.abort();
        WindowManager.send('status', { message: `Auto-answer cancelled — ${why}.` });
      }
    };
    AutoAnswer.onTrigger = ({ trigger, confidence, reasons, speculative }) => {
      WindowManager.send('auto-answer:fired', { trigger, confidence, reasons, speculative });
      this.executeMode('reply', '', { priority: 'auto', auto: true });
    };
    RateLimiter.onChange = (snapshot) => WindowManager.send('usage', snapshot);
    ContextStore.onChange = (view) => WindowManager.send('context:changed', view);
    SessionManager.onChange = (state) => WindowManager.send('session:state', state);
    SessionManager.onSummaryNeeded = (turns, previous) => this.summariseTurns(turns, previous);

    // A session file with no end time means the app died mid-conversation.
    const recovered = SessionManager.recover();
    if (recovered) {
      WindowManager.send('status', {
        message: `Recovered the session "${recovered.title}" from an unclean shutdown.`
      });
    }

    // 1. Settings handlers — the renderer only ever sees the redacted view.
    ipcMain.handle('sidecar:settings:get', () => SettingsManager.publicView());
    ipcMain.handle('sidecar:settings:set', (_event, patch) => {
      this.sttErrorShown = false;
      LlmService.resetNotices();
      SettingsManager.set(patch);
      this.applyRateLimits();
      TranscriptionService.reset();
      AutoAnswer.reset();
      this.validateConfiguredModels();
      return SettingsManager.publicView();
    });

    // 2. Listening / capture toggle
    ipcMain.handle('sidecar:toggle-listening', () => {
      const state = !MediaCapture.isListening;
      const active = MediaCapture.toggleListening(state);
      if (active) {
        SessionManager.start();
        TranscriptionService.start();
      } else {
        TranscriptionService.stop();
      }
      WindowManager.send('capture:state', { active });
      return active;
    });

    // 3. Audio chunks from the renderer (16 kHz mono Int16 PCM)
    ipcMain.on('sidecar:audio-chunk', (_event, { source, arrayBuffer }) => {
      const buffer = MediaCapture.appendAudioChunk(source, arrayBuffer);
      if (buffer) TranscriptionService.pushAudio(source, buffer);
    });

    // Speech boundaries from the renderer's VAD drive batch transcription.
    ipcMain.on('sidecar:vad', (_event, { source, state }) => {
      if (state === 'start') {
        MediaCapture.clearChannel(source);
        return;
      }
      if (state === 'abort') {
        MediaCapture.clearChannel(source);
        return;
      }
      if (state === 'end') this.transcribeSegment(source);
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

    ipcMain.handle('sidecar:stt:engines', () => SttEngines.list());

    // Auto-answer toggle lives in the header, so it gets its own channel.
    ipcMain.handle('sidecar:auto-answer:toggle', (_event, enabled) => {
      SettingsManager.set({ autoAnswer: { enabled: !!enabled } });
      AutoAnswer.reset();
      return SettingsManager.get().autoAnswer;
    });
    ipcMain.handle('sidecar:auto-answer:get', () => SettingsManager.get().autoAnswer);

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

    // 11. Sessions
    ipcMain.handle('sidecar:session:state', () => SessionManager.state());
    ipcMain.handle('sidecar:session:transcript', () => SessionManager.transcriptView());
    ipcMain.handle('sidecar:session:start', (_event, title) => SessionManager.start(title) && SessionManager.state());
    ipcMain.handle('sidecar:session:end', () => {
      SessionManager.end();
      return SessionManager.state();
    });
    ipcMain.handle('sidecar:session:list', () => SessionManager.list());
    ipcMain.handle('sidecar:session:rename', (_event, { id, title }) => {
      SessionManager.rename(id, title);
      return SessionManager.list();
    });
    ipcMain.handle('sidecar:session:remove', (_event, id) => {
      SessionManager.remove(id);
      return SessionManager.list();
    });
    ipcMain.handle('sidecar:session:remove-all', () => {
      SessionManager.removeAll();
      return SessionManager.list();
    });
    ipcMain.handle('sidecar:session:open', (_event, id) => {
      const record = SessionManager.readFile(id);
      return record ? { ok: true, session: record } : { ok: false, error: 'That session is no longer on disk.' };
    });
    ipcMain.handle('sidecar:session:export', async (_event, { id, format }) => {
      try {
        const contents = SessionManager.export(id, format);
        const extension = format === 'json' ? 'json' : (format === 'txt' ? 'txt' : 'md');
        const result = await dialog.showSaveDialog(WindowManager.getWindow(), {
          title: 'Export session',
          defaultPath: `${id}.${extension}`,
          filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
        });
        if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
        fs.writeFileSync(result.filePath, contents, 'utf8');
        return { ok: true, path: result.filePath };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });

    ipcMain.handle('sidecar:context:clear', (_event, scope) => {
      if (scope === 'session') ContextStore.clearSession();
      else ContextStore.clearAll();
      return ContextStore.publicView();
    });

    this.validateConfiguredModels();
  }

  /**
   * Fold the turns that fell out of the prompt window into a running summary.
   * Runs at 'auto' priority so it can never delay a hotkey press.
   */
  async summariseTurns(turns, previousSummary) {
    const rendered = turns
      .map((t) => `${t.sender === 'user' ? 'You' : 'Them'}: ${t.text}`)
      .join(String.fromCharCode(10));

    const instruction = [
      'Previous summary:',
      previousSummary || '(none yet)',
      '',
      'New turns to fold in:',
      rendered,
      '',
      'Return the updated summary only, under 150 words.'
    ].join(String.fromCharCode(10));

    let out = '';
    await LlmService.stream(
      {
        system: 'You maintain a running summary of a live conversation. Keep names, decisions, '
          + 'numbers and anything the user was asked to follow up on. Drop small talk. '
          + 'Write plain prose, no headings, no preamble.',
        messages: [{ role: 'user', content: instruction }],
        priority: 'auto'
      },
      (token) => { out += token; }
    );
    return out;
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

  /** Streaming results arrive here; interim turns replace the open one on that channel. */
  handleSttResult({ channel, text, isFinal, startMs, endMs, confidence }) {
    if (!text || !text.trim()) return;
    const turn = SessionManager.upsertTurn({
      sender: channel === 'user' ? 'user' : 'system',
      channel,
      text: text.trim(),
      timestamp: Date.now(),
      interim: !isFinal,
      startMs,
      endMs,
      confidence
    });
    WindowManager.send('transcript', turn);

    // Detection runs on the other side of the conversation only.
    if (channel === 'system') {
      const silenceMs = this.lastSystemTurnAt ? Date.now() - this.lastSystemTurnAt : undefined;
      if (isFinal) this.lastSystemTurnAt = Date.now();
      AutoAnswer.consider(
        { text: turn.text, isFinal: !!isFinal, silenceMs },
        SettingsManager.effective().llm.provider
      );
    }
  }

  /** One VAD-delimited utterance, batch engine only. */
  async transcribeSegment(source) {
    if (TranscriptionService.isStreaming()) return;
    if (this.transcriptionBusy[source]) return;

    const pcm = MediaCapture.getAndFlushAudio(source);
    if (!pcm || pcm.length === 0) return;

    this.transcriptionBusy[source] = true;
    try {
      const text = await TranscriptionService.transcribeSegment(pcm, source);
      if (text && text.trim()) {
        this.handleSttResult({ channel: source, text, isFinal: true });
      }
    } catch (e) {
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

  async executeMode(mode, userText, { priority = 'user', auto = false } = {}) {
    if (!auto) {
      // A manual press outranks anything auto-answer was about to do, including
      // a request already in flight.
      AutoAnswer.standDown();
      if (this.isLlmBusy && this.activeRequestIsAuto && this.activeRequest) {
        this.activeRequest.abort();
        this.isLlmBusy = false;
      }
    }
    if (this.isLlmBusy) return;
    const modeConfig = LlmService.modes[mode];
    if (!modeConfig) return;

    this.isLlmBusy = true;
    const controller = new AbortController();
    this.activeRequest = controller;
    this.activeRequestIsAuto = auto;

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

      const window = SessionManager.getPromptWindow();
      const prompt = PromptBuilder.build(mode, {
        transcript: window.turns,
        transcriptSummary: window.summary,
        userText,
        images
      });

      let answerText = '';
      await LlmService.stream(
        {
          mode,
          system: prompt.system,
          messages: prompt.messages,
          images,
          signal: controller.signal,
          priority
        },
        (token) => {
          answerText += token;
          WindowManager.send('llm:token', { text: token });
        }
      );

      const eff = SettingsManager.effective();
      SessionManager.addAnswer({
        mode,
        provider: eff.llm.provider,
        model: eff.llm.model,
        text: answerText,
        userText
      });

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
      this.activeRequestIsAuto = false;
    }
  }

  shutdown() {
    TranscriptionService.stop();
    if (SessionManager.isActive()) SessionManager.persist(true);
  }

  ensureListeningAndAssist() {
    if (!MediaCapture.isListening) {
      const active = MediaCapture.toggleListening(true);
      if (active) {
        SessionManager.start();
        TranscriptionService.start();
      }
      WindowManager.send('capture:state', { active });
    }
    this.executeMode('assist', '');
  }
}

module.exports = new IpcRouter();

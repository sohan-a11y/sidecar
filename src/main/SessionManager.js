const fs = require('fs');
const path = require('path');
const SettingsManager = require('./SettingsManager');
const ContextStore = require('./ContextStore');

// Rough enough for a budget indicator: English averages ~4 characters per token.
const CHARS_PER_TOKEN = 4;

/**
 * Owns the live conversation and its on-disk record.
 *
 * Before Phase 2 the transcript was an unbounded array on IpcRouter that was
 * re-serialised into every prompt. Now it lives here, is windowed for prompting, and
 * is persisted per session (BUILD-PLAN 2 Contract).
 */
class SessionManager {
  constructor() {
    this.sessionsDir = null;
    this.session = null;
    this.onChange = null;
    this.onSummaryNeeded = null;
    this._saveTimer = null;
    this._summarising = false;
  }

  init(userDataDir) {
    this.sessionsDir = path.join(userDataDir, 'sessions');
    try {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    } catch (e) {
      console.error('[SessionManager] Could not create sessions directory:', e.message);
    }
    this.applyRetention();
  }

  // ------------------------------------------------------------------ lifecycle

  slugify(text) {
    return (
      (text || 'session')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'session'
    );
  }

  /** Snapshot the interview context so a saved session explains itself later. */
  start(title) {
    if (this.session && !this.session.endedAt) return this.session;

    const context = ContextStore.getSession();
    const startedAt = Date.now();
    const label =
      title || [context.role, context.company].filter(Boolean).join(' at ') || 'Session';

    this.session = {
      id: `${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}-${this.slugify(label)}`,
      title: label,
      startedAt,
      endedAt: null,
      context: { ...context },
      transcript: [],
      answers: [],
      summary: { text: '', coveredThrough: 0 }
    };

    this.persist();
    this.emit();
    return this.session;
  }

  current() {
    return this.session;
  }

  isActive() {
    return !!(this.session && !this.session.endedAt);
  }

  /** End the session, flush it to disk, and clear the per-interview context. */
  end() {
    if (!this.session) return null;
    this.session.endedAt = Date.now();
    this.persist(true);
    ContextStore.clearSession();
    const ended = this.session;
    this.session = null;
    this.emit();
    return ended;
  }

  // ---------------------------------------------------------------------- turns

  /**
   * Add or replace a turn. Interim turns (Phase 3) are held in memory only and are
   * replaced in place when the final arrives on the same channel.
   */
  upsertTurn({ sender, text, timestamp, interim = false, channel }) {
    if (!this.isActive()) this.start();
    const turns = this.session.transcript;
    const channelKey = channel || sender;

    const openInterim = turns.findIndex((t) => t.interim && (t.channel || t.sender) === channelKey);
    const turn = {
      id: openInterim >= 0 ? turns[openInterim].id : `turn_${Date.now()}_${turns.length}`,
      sender,
      channel: channelKey,
      text,
      timestamp: timestamp || Date.now(),
      interim
    };

    if (openInterim >= 0) turns[openInterim] = turn;
    else turns.push(turn);

    if (!interim) this.scheduleSave();
    this.maybeSummarise();
    return turn;
  }

  /** Every answer is recorded with the model that produced it. */
  addAnswer({ mode, provider, model, text, userText }) {
    if (!this.isActive()) return null;
    const answer = {
      at: Date.now(),
      mode,
      provider,
      model,
      userText: userText || '',
      text: text || ''
    };
    this.session.answers.push(answer);
    this.scheduleSave();
    return answer;
  }

  finalTurns() {
    return this.session ? this.session.transcript.filter((t) => !t.interim) : [];
  }

  // -------------------------------------------------------------- prompt window

  windowConfig() {
    const s = SettingsManager.get().transcript || {};
    return {
      windowTurns: s.windowTurns || 30,
      maxPromptTokens: s.maxPromptTokens || 6000,
      summariseEvery: s.summariseEvery || 20
    };
  }

  estimateTokens(text) {
    return Math.ceil((text || '').length / CHARS_PER_TOKEN);
  }

  /**
   * A bounded slice plus the running summary of everything older.
   * Nothing downstream reads the raw transcript array.
   */
  getPromptWindow() {
    if (!this.session) return { turns: [], summary: '', estimatedTokens: 0, droppedTurns: 0 };

    const { windowTurns, maxPromptTokens } = this.windowConfig();
    const finals = this.finalTurns();
    let slice = finals.slice(-windowTurns);
    const summary = this.session.summary.text || '';

    // Hard ceiling: drop from the oldest end until the estimate fits.
    const cost = (turns) =>
      this.estimateTokens(summary + turns.map((t) => `${t.sender}: ${t.text}`).join('\n'));
    while (slice.length > 1 && cost(slice) > maxPromptTokens) {
      slice = slice.slice(1);
    }

    return {
      turns: slice,
      summary,
      estimatedTokens: cost(slice),
      droppedTurns: finals.length - slice.length
    };
  }

  /**
   * Regenerate the running summary once enough turns have scrolled out of the window.
   * Fire-and-forget: summarising must never delay an answer.
   */
  maybeSummarise() {
    if (!this.session || this._summarising) return;
    const { windowTurns, summariseEvery } = this.windowConfig();
    const finals = this.finalTurns();
    const olderCount = Math.max(0, finals.length - windowTurns);
    if (olderCount === 0) return;
    if (olderCount - this.session.summary.coveredThrough < summariseEvery) return;
    if (typeof this.onSummaryNeeded !== 'function') return;

    const upTo = olderCount;
    const older = finals.slice(0, upTo);
    this._summarising = true;

    Promise.resolve(this.onSummaryNeeded(older, this.session.summary.text))
      .then((text) => {
        if (text && this.session) {
          this.session.summary = { text: text.trim(), coveredThrough: upTo };
          this.scheduleSave();
          this.emit();
        }
      })
      .catch((e) => console.warn('[SessionManager] Summary failed:', e.message))
      .finally(() => {
        this._summarising = false;
      });
  }

  // ------------------------------------------------------------------ persistence

  filePathFor(id) {
    return path.join(this.sessionsDir, `${id}.json`);
  }

  scheduleSave() {
    this.emit();
    if (SettingsManager.get().sessions.retention === 'never') return;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.persist();
    }, 1000);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  persist(force = false) {
    if (!this.session || !this.sessionsDir) return;
    if (!force && SettingsManager.get().sessions.retention === 'never') return;
    try {
      const record = { ...this.session, transcript: this.finalTurns() };
      fs.writeFileSync(this.filePathFor(this.session.id), JSON.stringify(record, null, 2), 'utf8');
    } catch (e) {
      console.error('[SessionManager] Could not save session:', e.message);
    }
  }

  readFile(id) {
    try {
      return JSON.parse(fs.readFileSync(this.filePathFor(id), 'utf8'));
    } catch (e) {
      return null;
    }
  }

  list() {
    if (!this.sessionsDir) return [];
    let files = [];
    try {
      files = fs.readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'));
    } catch (e) {
      return [];
    }
    return files
      .map((f) => this.readFile(f.replace(/\.json$/, '')))
      .filter(Boolean)
      .map((s) => ({
        id: s.id,
        title: s.title,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        turnCount: (s.transcript || []).length,
        answerCount: (s.answers || []).length,
        role: s.context ? s.context.role : '',
        company: s.context ? s.context.company : ''
      }))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  rename(id, title) {
    if (this.session && this.session.id === id) {
      this.session.title = title;
      this.persist(true);
      this.emit();
      return true;
    }
    const record = this.readFile(id);
    if (!record) return false;
    record.title = title;
    try {
      fs.writeFileSync(this.filePathFor(id), JSON.stringify(record, null, 2), 'utf8');
      return true;
    } catch (e) {
      return false;
    }
  }

  remove(id) {
    try {
      fs.unlinkSync(this.filePathFor(id));
    } catch (e) {
      /* already gone */
    }
    if (this.session && this.session.id === id) {
      this.session = null;
      this.emit();
    }
    return true;
  }

  removeAll() {
    for (const entry of this.list()) this.remove(entry.id);
    this.session = null;
    this.emit();
  }

  /** A session file left without an end time means the app died mid-conversation. */
  recover() {
    const open = this.list().find((s) => !s.endedAt);
    if (!open) return null;
    const record = this.readFile(open.id);
    if (!record) return null;
    this.session = { summary: { text: '', coveredThrough: 0 }, ...record };
    this.emit();
    return this.session;
  }

  applyRetention() {
    const { retention, retentionDays } = SettingsManager.get().sessions;
    if (retention === 'forever') return;
    if (retention === 'never') {
      this.removeAll();
      return;
    }
    const cutoff = Date.now() - (retentionDays || 30) * 24 * 60 * 60 * 1000;
    for (const entry of this.list()) {
      if (entry.startedAt < cutoff) this.remove(entry.id);
    }
  }

  // ---------------------------------------------------------------------- export

  export(id, format = 'md') {
    const record = this.session && this.session.id === id ? this.session : this.readFile(id);
    if (!record) throw new Error('That session is no longer on disk.');

    if (format === 'json') return JSON.stringify(record, null, 2);

    const when = new Date(record.startedAt).toLocaleString();
    const lines = [];

    if (format === 'md') {
      lines.push(`# ${record.title}`, '', `_${when}_`, '');
      if (record.context && (record.context.role || record.context.company)) {
        lines.push(
          `**Role:** ${record.context.role || '—'}  `,
          `**Company:** ${record.context.company || '—'}`,
          ''
        );
      }
      lines.push('## Transcript', '');
      for (const t of record.transcript || []) {
        lines.push(`**${t.sender === 'user' ? 'You' : 'Them'}:** ${t.text}`, '');
      }
      if ((record.answers || []).length) {
        lines.push('## Answers', '');
        for (const a of record.answers) {
          lines.push(`### ${a.mode} · ${a.model || 'unknown model'}`, '');
          if (a.userText) lines.push(`> ${a.userText}`, '');
          lines.push(a.text, '');
        }
      }
      return lines.join('\n');
    }

    lines.push(`${record.title} — ${when}`, '');
    for (const t of record.transcript || []) {
      lines.push(`${t.sender === 'user' ? 'You' : 'Them'}: ${t.text}`);
    }
    if ((record.answers || []).length) {
      lines.push('', '--- Answers ---', '');
      for (const a of record.answers) lines.push(`[${a.mode}] ${a.text}`, '');
    }
    return lines.join('\n');
  }

  /** Serialisable state for the renderer. */
  state() {
    if (!this.session) {
      return {
        active: false,
        id: null,
        title: '',
        turnCount: 0,
        answerCount: 0,
        estimatedTokens: 0
      };
    }
    const window = this.getPromptWindow();
    return {
      active: this.isActive(),
      id: this.session.id,
      title: this.session.title,
      startedAt: this.session.startedAt,
      turnCount: this.finalTurns().length,
      answerCount: this.session.answers.length,
      estimatedTokens: window.estimatedTokens,
      droppedTurns: window.droppedTurns,
      hasSummary: !!this.session.summary.text
    };
  }

  transcriptView() {
    return this.session ? this.session.transcript : [];
  }

  emit() {
    if (typeof this.onChange === 'function') {
      try {
        this.onChange(this.state());
      } catch (e) {
        console.warn('[SessionManager] state listener threw:', e.message);
      }
    }
  }
}

module.exports = new SessionManager();

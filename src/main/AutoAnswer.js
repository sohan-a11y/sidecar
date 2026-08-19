const QuestionDetector = require('./QuestionDetector');
const SettingsManager = require('./SettingsManager');
const RateLimiter = require('./RateLimiter');

/**
 * Turns detected questions into answers, under an interlock strict enough that a free
 * tier survives a whole interview.
 *
 * Off by default. Manual hotkeys always outrank auto-triggers, and an auto-answer can
 * never exceed the configured budget (BUILD-PLAN 4 Contract).
 */
class AutoAnswer {
  constructor() {
    this.onTrigger = null; // ({ trigger, confidence, reasons, speculative }) => void
    this.onCancel = null; // () => void
    this.onNotice = null; // (message) => void
    this.lastFiredAt = 0;
    this.firedTimestamps = [];
    this.debounceTimer = null;
    this.pending = null;
    this.speculativeText = '';
  }

  config() {
    const s = SettingsManager.get().autoAnswer || {};
    // Nullish, not falsy: a deliberate 0 must not fall through to the default.
    const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);
    return {
      enabled: !!s.enabled,
      threshold: num(s.threshold, 0.7),
      debounceMs: num(s.debounceMs, 700),
      cooldownMs: num(s.cooldownMs, 12000),
      maxPerMinute: num(s.maxPerMinute, 4),
      speculative: !!s.speculative
    };
  }

  notice(message) {
    if (typeof this.onNotice === 'function') this.onNotice(message);
  }

  /** Requests fired in the last 60 s. */
  recentCount(now) {
    this.firedTimestamps = this.firedTimestamps.filter((t) => now - t < 60000);
    return this.firedTimestamps.length;
  }

  /**
   * Why an auto-answer may not fire right now. Returns null when it may.
   * Checked before spending anything.
   */
  blockedReason(now, providerId) {
    const { cooldownMs, maxPerMinute } = this.config();

    if (now - this.lastFiredAt < cooldownMs) return 'cooldown';
    if (this.recentCount(now) >= maxPerMinute) return 'per-minute cap';

    // Never let an auto-answer eat the budget a manual press would need.
    const snapshot = RateLimiter.snapshot()[providerId];
    if (snapshot) {
      if (snapshot.remainingDay <= 0) return 'daily budget spent';
      if (snapshot.remainingDay <= 5) return 'daily budget nearly spent';
      if (snapshot.queued > 0) return 'a request is already queued';
    }
    return null;
  }

  /**
   * Feed a transcript turn from the system channel.
   * @param {{ text: string, isFinal: boolean, silenceMs?: number }} turn
   * @param {string} providerId provider the answer would be billed against
   */
  consider(turn, providerId) {
    const config = this.config();
    if (!config.enabled) return null;
    if (!turn || !turn.text) return null;

    // Interim turns are scored as if complete: the interim penalty plus the
    // speculative margin below would otherwise double-count the same uncertainty.
    const verdict = QuestionDetector.detect(turn.text, {
      isFinal: true,
      silenceMs: turn.silenceMs
    });

    // Speculative generation starts on the interim transcript and is cancelled if the
    // final diverges. It costs extra requests, so it is opt-in.
    if (!turn.isFinal) {
      if (!config.speculative) return null;
      if (verdict.confidence < config.threshold + 0.1) return null;
      return this.schedule(verdict, providerId, true);
    }

    if (verdict.confidence < config.threshold) {
      // A speculative run that no longer matches must be abandoned.
      this.cancelSpeculative('the question changed');
      return null;
    }

    if (this.pending && this.pending.speculative) {
      if (this.divergedFrom(this.pending.trigger, turn.text)) {
        this.cancelSpeculative('the question changed');
      } else {
        return null; // the speculative run already covers this
      }
    }

    return this.schedule(verdict, providerId, false);
  }

  /** Materially different means more than trailing words being appended. */
  divergedFrom(speculativeText, finalText) {
    const a = (speculativeText || '').toLowerCase().trim();
    const b = (finalText || '').toLowerCase().trim();
    if (!a) return true;
    if (b.startsWith(a)) return false;
    const prefix = a.slice(0, Math.min(a.length, Math.floor(b.length * 0.6)));
    return !b.startsWith(prefix);
  }

  schedule(verdict, providerId, speculative) {
    const { debounceMs } = this.config();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.pending = { ...verdict, speculative };
    this.debounceTimer = setTimeout(
      () => {
        this.debounceTimer = null;
        this.fire(providerId);
      },
      speculative ? debounceMs / 2 : debounceMs
    );
    if (this.debounceTimer.unref) this.debounceTimer.unref();
    return this.pending;
  }

  fire(providerId) {
    const pending = this.pending;
    if (!pending) return;

    const now = Date.now();
    const blocked = this.blockedReason(now, providerId);
    if (blocked) {
      this.pending = null;
      this.notice(`Auto-answer skipped — ${blocked}.`);
      return;
    }

    this.lastFiredAt = now;
    this.firedTimestamps.push(now);
    if (!pending.speculative) this.pending = null;

    if (typeof this.onTrigger === 'function') {
      this.onTrigger({
        trigger: pending.trigger,
        confidence: pending.confidence,
        reasons: pending.reasons,
        speculative: pending.speculative
      });
    }
  }

  cancelSpeculative(why) {
    if (!this.pending || !this.pending.speculative) return;
    this.pending = null;
    if (typeof this.onCancel === 'function') this.onCancel(why);
  }

  /** A manual request supersedes anything auto-answer was about to do. */
  standDown() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pending = null;
  }

  reset() {
    this.standDown();
    this.lastFiredAt = 0;
    this.firedTimestamps = [];
  }
}

module.exports = new AutoAnswer();

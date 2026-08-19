const fs = require('fs');
const path = require('path');
const { isAbort } = require('./providers/util');

const MINUTE_MS = 60 * 1000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 800;
const MAX_BACKOFF_MS = 20000;

class RateLimitError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RateLimitError';
    this.code = code;
  }
}

/** YYYY-MM-DD in local time — daily quotas are what the user experiences locally. */
function dayKey(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : null;
}

/** Retry-After is either delta-seconds or an HTTP date. Returns ms, or null. */
function parseRetryAfter(err) {
  const raw = headerValue(err && (err.headers || (err.response && err.response.headers)), 'retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

function statusOf(err) {
  return (err && (err.status || err.statusCode || (err.response && err.response.status))) || 0;
}

function isRetryable(err) {
  const status = statusOf(err);
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  const code = err && err.code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'EPIPE';
}

/**
 * Per-provider request budget with priority queueing, backoff and a persisted daily counter.
 * Every model call in the app goes through schedule() — see BUILD-PLAN 0.5.
 *
 * Limits gate *starts*, not concurrency: a long streaming answer must never block a
 * transcription request behind it.
 */
class RateLimiter {
  constructor() {
    this.limits = {};
    this.buckets = {};
    this.daily = { date: dayKey(Date.now()), counts: {} };
    this.storagePath = null;
    this.onChange = null;
    this._saveTimer = null;
    this._timers = {};
    this.now = () => Date.now();
    // Seam for tests: real backoff is seconds long, which no unit test should sit through.
    this.backoffBaseMs = BASE_BACKOFF_MS;
  }

  init(userDataDir) {
    if (userDataDir) this.storagePath = path.join(userDataDir, 'sidecar-usage.json');
    this._loadDaily();
  }

  /** limits: { providerId: { rpm, rpd } } */
  configure(limits) {
    this.limits = { ...this.limits, ...(limits || {}) };
  }

  limitsFor(providerId) {
    return this.limits[providerId] || { rpm: 60, rpd: 1000 };
  }

  _bucket(providerId) {
    if (!this.buckets[providerId]) {
      this.buckets[providerId] = {
        windowStart: this.now(),
        windowCount: 0,
        throttledUntil: 0,
        queue: []
      };
    }
    return this.buckets[providerId];
  }

  _rollWindows(providerId) {
    const bucket = this._bucket(providerId);
    const now = this.now();
    if (now - bucket.windowStart >= MINUTE_MS) {
      bucket.windowStart = now;
      bucket.windowCount = 0;
    }
    const today = dayKey(now);
    if (this.daily.date !== today) {
      this.daily = { date: today, counts: {} };
      this._persistDaily();
    }
  }

  usedToday(providerId) {
    return this.daily.counts[providerId] || 0;
  }

  /**
   * Run `fn` when the provider has budget. Options:
   *   priority: 'user' (hotkey, always first) | 'auto' (Phase 4 auto-answer)
   *   signal:   AbortSignal
   *   canRetry: () => boolean — false once output has been emitted, so a retry can't duplicate it
   *   onRetry:  (info) => void — for status messages
   */
  schedule(providerId, options, fn) {
    const { priority = 'user', signal, canRetry, onRetry } = options || {};
    return new Promise((resolve, reject) => {
      const job = { providerId, priority, signal, canRetry, onRetry, fn, resolve, reject };
      const bucket = this._bucket(providerId);

      if (priority === 'user') {
        // User work jumps every queued auto job, but never reorders other user work.
        const firstAuto = bucket.queue.findIndex((j) => j.priority !== 'user');
        if (firstAuto === -1) bucket.queue.push(job);
        else bucket.queue.splice(firstAuto, 0, job);
      } else {
        bucket.queue.push(job);
      }

      this._pump(providerId);
    });
  }

  _pump(providerId) {
    const bucket = this._bucket(providerId);
    this._rollWindows(providerId);
    const { rpm, rpd } = this.limitsFor(providerId);
    const now = this.now();

    while (bucket.queue.length > 0) {
      const job = bucket.queue[0];

      if (job.signal && job.signal.aborted) {
        bucket.queue.shift();
        job.reject(this._abortError());
        continue;
      }

      if (this.usedToday(providerId) >= rpd) {
        bucket.queue.shift();
        job.reject(new RateLimitError(
          `Daily request limit reached for ${providerId} (${rpd}/day). Raise it in Settings or wait for reset.`,
          'RATE_LIMIT_DAILY'
        ));
        continue;
      }

      if (bucket.throttledUntil > now) {
        this._wakeAt(providerId, bucket.throttledUntil);
        break;
      }

      if (bucket.windowCount >= rpm) {
        this._wakeAt(providerId, bucket.windowStart + MINUTE_MS);
        break;
      }

      bucket.queue.shift();
      this._consume(providerId);
      this._run(job);
    }

    this._emitChange();
  }

  _abortError() {
    const err = new Error('Request cancelled');
    err.name = 'AbortError';
    return err;
  }

  _consume(providerId) {
    const bucket = this._bucket(providerId);
    bucket.windowCount += 1;
    this.daily.counts[providerId] = this.usedToday(providerId) + 1;
    this._persistDaily();
  }

  _wakeAt(providerId, when) {
    const delay = Math.max(50, when - this.now());
    if (this._timers[providerId]) return;
    this._timers[providerId] = setTimeout(() => {
      this._timers[providerId] = null;
      this._pump(providerId);
    }, delay);
    if (this._timers[providerId].unref) this._timers[providerId].unref();
  }

  async _run(job) {
    let attempt = 0;
    for (;;) {
      try {
        const result = await job.fn();
        job.resolve(result);
        this._emitChange();
        return;
      } catch (err) {
        if (isAbort(err)) {
          job.reject(err);
          return;
        }
        const retryable = isRetryable(err)
          && attempt < MAX_RETRIES
          && (typeof job.canRetry !== 'function' || job.canRetry());

        if (!retryable) {
          job.reject(err);
          this._emitChange();
          return;
        }

        const bucket = this._bucket(job.providerId);
        const retryAfter = parseRetryAfter(err);
        const backoff = Math.min(MAX_BACKOFF_MS, this.backoffBaseMs * 2 ** attempt);
        const jitter = Math.floor(Math.random() * 400);
        const delay = (retryAfter === null ? backoff : retryAfter) + jitter;

        if (statusOf(err) === 429) {
          bucket.throttledUntil = Math.max(bucket.throttledUntil, this.now() + delay);
        }

        attempt += 1;
        if (typeof job.onRetry === 'function') {
          job.onRetry({ attempt, delay, status: statusOf(err), provider: job.providerId });
        }

        await this._sleep(delay, job.signal);
        if (job.signal && job.signal.aborted) {
          job.reject(this._abortError());
          return;
        }
        // A retry is a real request against the budget.
        this._consume(job.providerId);
      }
    }
  }

  _sleep(ms, signal) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (timer.unref) timer.unref();
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      }
    });
  }

  /** Serialisable budget state for the UI. Contains no keys and no request content. */
  snapshot() {
    const out = {};
    const ids = new Set([...Object.keys(this.limits), ...Object.keys(this.buckets)]);
    for (const providerId of ids) {
      this._rollWindows(providerId);
      const bucket = this._bucket(providerId);
      const { rpm, rpd } = this.limitsFor(providerId);
      out[providerId] = {
        rpm,
        rpd,
        usedMinute: bucket.windowCount,
        usedDay: this.usedToday(providerId),
        remainingMinute: Math.max(0, rpm - bucket.windowCount),
        remainingDay: Math.max(0, rpd - this.usedToday(providerId)),
        queued: bucket.queue.length,
        throttledUntil: bucket.throttledUntil > this.now() ? bucket.throttledUntil : 0
      };
    }
    return out;
  }

  _emitChange() {
    if (typeof this.onChange === 'function') {
      try {
        this.onChange(this.snapshot());
      } catch (e) {
        console.warn('[RateLimiter] usage listener threw:', e.message);
      }
    }
  }

  _loadDaily() {
    if (!this.storagePath) return;
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (parsed && parsed.date === dayKey(this.now()) && parsed.counts) {
        this.daily = { date: parsed.date, counts: { ...parsed.counts } };
      }
    } catch (e) {
      console.warn('[RateLimiter] Could not read usage file:', e.message);
    }
  }

  _persistDaily() {
    if (!this.storagePath) return;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        fs.writeFileSync(this.storagePath, JSON.stringify(this.daily), 'utf8');
      } catch (e) {
        console.warn('[RateLimiter] Could not write usage file:', e.message);
      }
    }, 2000);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }
}

const instance = new RateLimiter();
instance.RateLimitError = RateLimitError;
module.exports = instance;
module.exports.RateLimitError = RateLimitError;

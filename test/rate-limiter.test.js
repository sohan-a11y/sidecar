import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const modulePath = require.resolve('../src/main/RateLimiter.js');


function freshLimiter() {
  delete require.cache[modulePath];
  return require('../src/main/RateLimiter.js');
}

describe('RateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = freshLimiter();
    limiter.backoffBaseMs = 1;
  });

  it('runs user-priority work before queued auto work', async () => {
    limiter.configure({ p: { rpm: 1, rpd: 10 } });
    const order = [];
    let clock = 0;
    limiter.now = () => clock;


    const first = limiter.schedule('p', { priority: 'auto' }, async () => {
      order.push('auto1');
    });
    await first;


    const queuedAuto = limiter.schedule('p', { priority: 'auto' }, async () => {
      order.push('auto2');
    });
    const queuedUser = limiter.schedule('p', { priority: 'user' }, async () => {
      order.push('user1');
    });

    clock += 61 * 1000;
    limiter.configure({ p: { rpm: 10, rpd: 10 } });
    limiter._pump('p');
    await Promise.all([queuedAuto, queuedUser]);

    expect(order).toEqual(['auto1', 'user1', 'auto2']);
  });

  it('refuses work once the daily cap is spent', async () => {
    limiter.configure({ p: { rpm: 100, rpd: 2 } });
    await limiter.schedule('p', {}, async () => 'a');
    await limiter.schedule('p', {}, async () => 'b');

    await expect(limiter.schedule('p', {}, async () => 'c')).rejects.toMatchObject({
      code: 'RATE_LIMIT_DAILY'
    });
    expect(limiter.snapshot().p.remainingDay).toBe(0);
  });

  it('retries a 429 and honours Retry-After, charging each attempt to the budget', async () => {
    limiter.configure({ p: { rpm: 100, rpd: 100 } });
    const retries = [];
    let attempts = 0;

    const result = await limiter.schedule(
      'p',
      { onRetry: (info) => retries.push(info.status) },
      async () => {
        attempts += 1;
        if (attempts < 3) {
          const err = new Error('rate limited');
          err.status = 429;
          err.headers = { 'retry-after': '0' };
          throw err;
        }
        return 'ok';
      }
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(retries).toEqual([429, 429]);
    expect(limiter.snapshot().p.usedDay).toBe(3);
  });

  it('gives up after 3 retries and surfaces the original error', async () => {
    limiter.configure({ p: { rpm: 100, rpd: 100 } });
    let attempts = 0;

    await expect(
      limiter.schedule('p', {}, async () => {
        attempts += 1;
        const err = new Error('upstream exploded');
        err.status = 503;
        throw err;
      })
    ).rejects.toThrow('upstream exploded');

    expect(attempts).toBe(4);
  });

  it('does not retry once output has been emitted', async () => {
    limiter.configure({ p: { rpm: 100, rpd: 100 } });
    let attempts = 0;
    let emitted = false;

    await expect(
      limiter.schedule('p', { canRetry: () => !emitted }, async () => {
        attempts += 1;
        emitted = true;
        const err = new Error('died mid-stream');
        err.status = 500;
        throw err;
      })
    ).rejects.toThrow('died mid-stream');

    expect(attempts).toBe(1);
  });

  it('does not retry a 4xx that is not a 429', async () => {
    limiter.configure({ p: { rpm: 100, rpd: 100 } });
    let attempts = 0;

    await expect(
      limiter.schedule('p', {}, async () => {
        attempts += 1;
        const err = new Error('bad key');
        err.status = 401;
        throw err;
      })
    ).rejects.toThrow('bad key');

    expect(attempts).toBe(1);
  });

  it('rejects queued work whose signal is already aborted', async () => {
    limiter.configure({ p: { rpm: 100, rpd: 100 } });
    const controller = new AbortController();
    controller.abort();

    await expect(
      limiter.schedule('p', { signal: controller.signal }, async () => 'never')
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('resets the minute window but keeps the daily counter', async () => {
    limiter.configure({ p: { rpm: 1, rpd: 10 } });
    let clock = 1_000_000;
    limiter.now = () => clock;

    await limiter.schedule('p', {}, async () => 'a');
    expect(limiter.snapshot().p.remainingMinute).toBe(0);

    clock += 61 * 1000;
    const snap = limiter.snapshot().p;
    expect(snap.remainingMinute).toBe(1);
    expect(snap.usedDay).toBe(1);
  });
});
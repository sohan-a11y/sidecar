# 4. Client-side rate limiting with priorities

Status: accepted

## Context

Free tiers cap requests per minute and per day. Phase 4 added auto-answer, which spends quota
without anyone pressing anything. With no backend (ADR 1) there is nowhere else to enforce a budget,
and the failure mode — a quota exhausted mid-interview — is exactly when the app matters most.

## Decision

`RateLimiter.schedule()` fronts every model call. Per-provider limits gate request *starts*, not
concurrency. Work carries a priority: `user` for anything the user initiated, `auto` for background
work, and user work jumps queued auto work. Daily counters persist to `sidecar-usage.json`.
429 and 5xx get jittered exponential backoff honouring `Retry-After`, capped at three tries, and a
retry is refused once output has already reached the UI.

## Decision on the interlock

Auto-answer additionally refuses to fire inside a cooldown, above a per-minute cap, or when fewer
than five requests remain for the day — so a manual press always has budget left.

## Consequences

- Gating starts rather than concurrency means a long streaming answer never blocks transcription
  behind it.
- The remaining budget is visible in the composer, and throttling produces a status message instead
  of a silent failure.
- Limits are user-editable: someone on a paid tier is not held to free-tier defaults.

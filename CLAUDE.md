# Sidecar — Project Context

Electron + React desktop overlay copilot. Captures mic + system-loopback audio, transcribes both
channels, captures the screen, and streams LLM answers into a transparent always-on-top panel.

Open source, MIT, BYO-key. **There is no backend and none is planned.** Everything runs locally on
the user's machine against their own API keys. Do not introduce a server, auth, telemetry, billing,
or any phone-home behaviour.

## Stack

Electron 33 (main) · React 18 + Vite 5 (renderer) · CommonJS in `src/main` and `src/preload`,
ESM + JSX in `src/renderer`. No TypeScript. Tests use `vitest` (unit tests for pure main-process
logic only — no renderer test harness).

## Layout

```
src/main/        WindowManager, MediaCapture, TranscriptionService, LlmService,
                 SettingsManager, ShortcutsManager, IpcRouter, RateLimiter, KeyStore, index.js
src/main/providers/  Provider adapters (openai, anthropic, gemini, openaiCompatible) + registry
src/preload/     contextBridge surface, exposed as window.sidecar
src/renderer/    App.jsx (state coordinator) + components/, index.css (hand-rolled design system)
test/            vitest unit tests for pure main-process logic
```

## Hard rules

* IPC is the only main↔renderer channel. `contextIsolation: true`, `nodeIntegration: false`.
  Every new IPC channel must be added to the `allowed` array in `src/preload/index.js` — the
  renderer cannot subscribe to a channel that isn't whitelisted there.
* Never log or serialise API keys, not to console, not to status messages, not to session files.
* Audio stays raw. Renderer emits 16 kHz mono Int16 PCM over IPC. Don't switch to Blob/WebM without
  changing both ends and the WAV muxer in `TranscriptionService`.
* The overlay must stay click-through by default. Mouse events are only captured over
  `#toolbar, .panel-glass, .modal-glass` (see `setupClickThrough` in `App.jsx`). Any new
  interactive surface needs a matching selector or it will be unclickable.
* No new heavyweight deps without a note in the PR description explaining why. Keep it lean.
  Native modules are a last resort — they break the unsigned cross-platform build.
* Preserve the existing CSS design system in `index.css`. Add variables, don't bolt on Tailwind.
* Every model call goes through `RateLimiter.schedule()`. Nothing calls a provider SDK directly
  outside `src/main/providers/`.

## Conventions

* Main-process modules are singleton class instances exported via `module.exports = new Thing()`.
  Provider adapters are the exception: they are plain objects in a registry.
* Log prefix is `[ModuleName]`. Renderer errors at level >= 2 are forwarded to main stdout.
* User-visible errors go through `WindowManager.send('status', { message })`, not `console`.
* Settings are deep-merged against `defaults` in `SettingsManager`. Add new keys to `defaults` or
  they will not survive a load.
* Persisted files live in `app.getPath('userData')`:
  * `sidecar-data.json` — settings (API keys encrypted via `safeStorage` where available)
  * `sidecar-usage.json` — daily request counters for the rate limiter

## Non-goals

Do not work on: anti-detection or capture-evasion features, accounts, subscriptions, billing,
usage metering (beyond local rate limiting), analytics, or crash reporting. If a task seems to
require one of these, stop and say so instead of building it.

## Build plan

Work proceeds in numbered phases. The full spec is in `docs/BUILD-PLAN.md`. Read the phase you have
been asked for and its Contract section before writing code. Do not start a later phase early;
later phases assume earlier contracts exist.

## Working agreement

* Before editing, read the files you're changing. This codebase is small — read it.
* One phase per branch: `phase-N-short-name`. Conventional commits.
* After each phase, update `docs/BUILD-PLAN.md` to check off what landed, and update this file if a
  hard rule or contract changed.
* If a spec item conflicts with something you find in the code, say so and ask — don't silently
  pick one.
* Verify with `npm run build` and a manual `NODE_ENV=development npm start` smoke test. State
  plainly what you did and did not verify.

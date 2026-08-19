# Contributing to Sidecar

Thanks for looking. Sidecar is a local-only, bring-your-own-key desktop overlay. Everything runs on
the contributor's machine against their own API keys, and that constraint shapes most of what
follows.

## Getting set up

```bash
git clone https://github.com/Ganeshp000/sidecar.git
cd sidecar
npm install
```

Two terminals for development:

```bash
npm run dev
```

```bash
NODE_ENV=development npm start
```

The first runs Vite for the renderer; the second launches Electron against it. On Windows PowerShell
use `$env:NODE_ENV='development'; npm start`.

For a production-shaped run:

```bash
npm run build
npm start
```

Useful environment variables:

| Variable | Effect |
|---|---|
| `NODE_ENV=development` | Loads the renderer from the Vite dev server and opens DevTools |
| `SIDECAR_DEBUG=1` | Opens DevTools even in a production build |
| `SIDECAR_NO_PROTECT=1` | Disables content protection, so the window shows in screen recordings |

## Verifying a change

```bash
npm run lint
npm test
npm run build
```

Then smoke-test the actual app. Unit tests cover main-process logic; there is no renderer test
harness, so anything visual has to be looked at.

State plainly in your PR what you tested and what you did not.

## The phase model

Work proceeds in numbered phases, specified in [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md). Each phase
has a **Contract** — what later phases are allowed to assume. Read the phase and its contract before
writing code, and don't start a later phase early: it will assume interfaces that do not exist yet.

One phase per branch, named `phase-N-short-name`. Conventional commits (`feat:`, `fix:`, `refactor:`,
`docs:`, `test:`, `chore:`, `perf:`, `ci:`).

If a spec item conflicts with what you find in the code, say so in the issue or PR rather than
silently picking one.

## House rules

These are not style preferences; breaking them breaks the app.

- **IPC is the only main↔renderer channel.** `contextIsolation: true`, `nodeIntegration: false`.
  Every new channel must be added to the `allowed` list in `src/preload/index.js`, or the renderer
  simply cannot subscribe to it.
- **API keys never leave the main process.** They are sealed with Electron `safeStorage` on disk,
  and the renderer receives presence flags, never values. Never log, serialise, or send a key.
- **Audio stays raw.** The renderer emits 16 kHz mono Int16 PCM. Changing that means changing both
  ends and the WAV muxer in `TranscriptionService`.
- **The overlay stays click-through by default.** Mouse events are only captured over
  `#toolbar, .panel-glass, .modal-glass`. A new interactive surface outside those selectors will be
  unclickable.
- **Every model call goes through `RateLimiter.schedule()`**, and every prompt through
  `PromptBuilder.build()`. Nothing calls a provider SDK directly outside `src/main/providers/`.
- **New settings keys go in `defaults`** in `SettingsManager`, or they will not survive a load.
- **Dependencies are expensive.** Explain any new one in the PR: what it does, how large it is, and
  why nothing already present will do. Native modules are a last resort — they break the unsigned
  cross-platform build.
- **Keep the CSS design system** in `src/renderer/index.css`. Add variables; don't bolt on a
  framework.

## Non-goals

Sidecar will not grow a backend, accounts, subscriptions, billing, usage metering, analytics, crash
reporting, or anti-detection and capture-evasion features. If a change seems to need one of these,
open an issue and say so rather than building it.

## Where things live

```
src/main/        Electron main: window, capture, transcription, LLM dispatch, sessions, context
src/main/providers/  Chat provider adapters behind one interface
src/main/stt/    Transcription engines (streaming sockets plus the batch fallback)
src/preload/     The contextBridge surface, exposed as window.sidecar
src/renderer/    React overlay: App.jsx coordinates state, components/ renders it
test/            vitest unit tests for main-process logic
docs/adr/        Decisions worth remembering, and why
```

## Good first issues

Issues labelled `good first issue` are scoped so that they touch one or two files and have an
obvious way to verify them. If one turns out to be larger than advertised, say so in the issue — that
is useful information, not a failure.

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

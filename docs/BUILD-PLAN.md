# Sidecar Build Plan

Seven phases, in dependency order. Each phase has a **Contract** (what later phases are allowed to
assume) — treat the Contract as the acceptance criteria.

Scope note: no backend, no accounts, no billing, no telemetry. BYO-key, local-only, MIT.

- [x] Phase 0 — Provider abstraction, TokenRouter, STT/LLM split, rate limiting
- [x] Phase 1 — Context layer (resume, JD, profile, story bank)
- [x] Phase 2 — Live transcript UI + sessions
- [x] Phase 3 — Streaming ASR + multilingual
- [x] Phase 4 — Question detection + auto-answer
- [x] Phase 5 — Answer UX + follow-up threading
- [x] Phase 6 — Capture + overlay controls
- [x] Phase 7 — Open-source hygiene (can run any time after Phase 0)

---

## Phase 0 — Provider abstraction, TokenRouter, STT/LLM split, rate limiting

**Why first:** every later phase calls a model. Today `LlmService.streamCompletion` is a three-branch
if/else, and `IpcRouter.processTranscription` derives the STT provider from `currentProvider` — so
selecting any provider without a transcription endpoint silently kills transcription.

### 0.1 Provider adapters

Extract into `src/main/providers/`. Every adapter exports the same interface:

```js
{
  id, name,
  capabilities: { vision: bool, streaming: bool, transcription: bool },
  listModels(apiKey) -> [{ id, label, vision?, contextWindow? }],
  streamChat({ apiKey, model, system, messages, images, signal }, onToken) -> Promise<void>,
  transcribe?({ apiKey, model, wav, language }) -> Promise<string>
}
```

Adapters: `openai.js`, `anthropic.js`, `gemini.js`, and `openaiCompatible.js` — a generic
Chat-Completions adapter parameterised by base URL, used for TokenRouter **and** any custom
OpenAI-compatible endpoint the user configures. Preserve current behaviour exactly for the three
existing providers; this is a refactor, not a rewrite. `LlmService` becomes a thin dispatcher.

### 0.2 TokenRouter

- Base URL `https://api.tokenrouter.com/v1`, `Authorization: Bearer <key>`, OpenAI Chat Completions
  request/response shape, SSE streaming.
- **Do not hardcode the model list.** Call `GET /v1/models` and populate a searchable dropdown.
  Cache the result in settings with a timestamp; refresh on demand and on key change.
- Seed defaults, used only when the list can't be fetched:
  `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` and `qwen/qwen3.8-max-free`.
  If a configured model ID is absent from a successful `/v1/models` response, fall back to the
  first available free model and surface a `status` message — mirror the existing Gemini
  auto-fallback in `IpcRouter.validateGeminiModelsConfig`.
- Also expose a **Custom (OpenAI-compatible)** provider entry with a user-supplied base URL, so
  Ollama, LM Studio, vLLM, OpenRouter and friends work with no further code.

### 0.3 Vision capability gating — required, not optional

`assist`, `code`, and `ask` all attach a screenshot. Free text-only models will hard-fail on an
image part. So:

- Track `vision` per model. Derive from `/v1/models` metadata when present; otherwise maintain a
  small heuristic allowlist plus a manual override toggle in settings.
- Add a `visionModel` setting, independent of the chat model.
- If the chat model lacks vision: route screenshot-bearing requests to `visionModel` if configured;
  otherwise drop the image, run text-only, and emit a one-time `status` explaining it.
- Never send an image part to a model flagged text-only.

### 0.4 Split STT from LLM

Settings gains two independent blocks:

```js
llm: { provider, model, visionModel, baseUrl?, apiKeys: {...} }
stt: { provider, model, language: 'auto', apiKeys: {...} }
```

`stt.provider` is limited to adapters with `capabilities.transcription`. Migrate existing
`currentProvider` / `modelPreferences` / `apiKeys` on load — nobody loses their config. If
`stt.provider` has no key, transcription degrades with a clear status message while chat keeps
working.

### 0.5 Rate limiting and backoff

Free tiers cap requests/minute and requests/day. Phase 4 will make this critical.

- `src/main/RateLimiter.js`: per-provider token bucket, configurable rpm/rpd, in-memory plus a
  daily counter persisted to disk.
- Respect `Retry-After`; exponential backoff with jitter on 429 and 5xx; cap retries at 3.
- Requests carry a priority — a user-initiated hotkey press must never be dropped in favour of an
  auto-triggered one.
- Surface remaining budget in the UI, and emit a `status` when throttled instead of failing silently.

### 0.6 Key storage

Replace plaintext keys in `sidecar-data.json` with Electron `safeStorage` (Keychain / DPAPI /
libsecret). Fall back to plaintext with a visible warning where `safeStorage.isEncryptionAvailable()`
is false. Migrate existing files on first load. This is an open-source app — plaintext keys on disk
is not acceptable.

**Contract:** any module can call `LlmService.stream({ mode, images, messages, signal }, onToken)`
without knowing the provider; vision is safe to request; STT and chat are independently configured;
all model calls pass through the rate limiter.

**Landed** (`phase-0-providers`):

- `src/main/providers/` — `openai`, `anthropic`, `gemini`, `openaiCompatible` factory (backs both
  TokenRouter and Custom), shared `util.js`, registry `index.js`. `LlmService` is now a dispatcher.
- TokenRouter via `GET /v1/models` with settings-cached list, free-model fallback, seed defaults.
- Vision gating: per-model capability from provider metadata → id heuristic → manual override;
  `visionModel` routing; images dropped with a one-time notice rather than hard-failing.
- `llm` / `stt` settings blocks with v1 → v2 migration preserving the old STT derivation rule.
- `RateLimiter.js`: per-provider rpm/rpd, priority queue, Retry-After + jittered backoff (3 tries),
  daily counter in `sidecar-usage.json`, budget surfaced in the composer.
- `KeyStore.js`: keys sealed with `safeStorage`; the renderer receives presence flags, never values.

**Deviations from the spec above, and why:**

- Settings store `llm.models[provider] = { standard, advanced, vision }` rather than a flat
  `{ model, visionModel }`. The flat shape would have discarded the existing Smart Mode
  standard/advanced pair and reset model choices on every provider switch.
  `SettingsManager.effective()` returns the flat shape the Contract describes.
- `stt.apiKeys` is a separate block as specified, but the renderer never receives key values at
  all — main returns presence flags only. Blank means "keep", `null` means "clear".

---

## Phase 1 — Context layer

Today `LlmService.MODES` contains six system prompts and not one byte about the user. This is the
single highest-impact phase.

### 1.1 Document ingestion

- `src/main/ContextStore.js`, persisted to `sidecar-context.json`.
- Accept PDF, DOCX, TXT, MD via drag-drop and file picker. Parse with `pdfjs-dist` (already a
  transitive option) or `pdf-parse`, and `mammoth` for DOCX. Cap at ~10 MB / 50 pages.
- Store raw extracted text plus source filename and ingest timestamp.

### 1.2 Profile distillation

One LLM call on ingest turns raw text into a structured profile. Prompt for strict JSON, parse
defensively, never crash on malformed output.

```js
UserProfile = {
  name, headline, location, yearsExperience,
  skills: [{ name, level, years }],
  experience: [{ company, title, start, end, bullets: [], metrics: [] }],
  projects: [{ name, summary, stack: [], impact }],
  education: [...],
  stories: [{ id, title, situation, task, action, result, tags: [] }]
}
```

The `stories` array is the STAR story bank and matters more than the résumé dump — behavioural
answers retrieve from it. Let the user add, edit, and delete stories by hand.

### 1.3 Session context

Separate from the durable profile, set per session and cleared on session end:
target role, company, JD text (paste or URL), interview type
(`behavioural | technical | system-design | general`), answer language, answer length
(`brief | normal | detailed`), tone (`neutral | conversational | formal`).

### 1.4 Prompt assembly

- `src/main/PromptBuilder.js` composes: system prompt → profile block → session block →
  retrieved stories → transcript window → user turn.
- Order matters for caching: **stable content first**. Profile and session context are stable for
  a whole session; transcript is not.
- Use provider prompt caching where available — Anthropic `cache_control: {type: 'ephemeral'}` on
  the profile block; OpenAI caches long stable prefixes automatically.
- Story retrieval v1 is keyword/tag overlap against the detected question. No vector DB. Revisit
  only if v1 measurably underperforms.
- Every mode in `LlmService.MODES` gains profile awareness. Rewrite the six system prompts to use
  the user's actual background and to forbid inventing experience not present in the profile.

### 1.5 UI

New **Context** tab in `SettingsModal`: drop zone, ingest progress, profile viewer/editor, story
bank CRUD, session setup form. Show a clear "no profile loaded" state — the user must be able to
tell at a glance whether answers are personalised.

**Contract:** `PromptBuilder.build(mode, { transcript, userText, images })` returns a fully
composed, cache-friendly request. Nothing downstream assembles prompts by hand.

**Landed** (`phase-1-context`):

- `ContextStore.js` -> `sidecar-context.json`: PDF/DOCX/TXT/MD ingestion via drag-drop and file
  picker, 10 MB / 50 page caps, profile normalisation that never throws on model output.
- `ProfileBuilder.js`: one distillation call, defensive JSON parsing (fenced, padded, trailing
  commas), refuses to overwrite a profile with garbage.
- `PromptBuilder.js`: system blocks ordered stable-first (mode -> profile -> session), stories and
  transcript in the user turn. Anthropic gets `cache_control` on blocks over 1500 chars; other
  providers get the concatenation. Story retrieval is keyword/tag overlap with 6-character stems.
- Six mode prompts rewritten for profile awareness, with an explicit ban on inventing experience.
- Context tab in Settings: drop zone, document list, profile summary with a loud "no profile"
  state, story bank CRUD, session setup form, and per-scope clear buttons.
- Composer shows a "Profile on / No profile" chip so personalisation is visible at a glance.

**Note on dependencies:** `pdf-parse@1.1.1` and `mammoth` added. pdf-parse 2.x pulls a 36 MB
`pdfjs-dist` that needs a DOM (`DOMMatrix`) and cannot load in the main process at all; 1.1.1 is
pure CJS and works headless. Its bundled extra pdf.js copies and test corpus are excluded from
packaging in `build.files`. Its `lib/pdf-parse.js` entry is required directly, because the package
root runs a debug harness against a sample PDF when it thinks it is the main module.

---

## Phase 2 — Live transcript UI + sessions

### 2.1 Transcript UI

`App.jsx` listener #3 currently receives every transcript turn and calls `sidecar.log()` — it goes
to console and nowhere else. Fix:

- Transcript state in the renderer, rendered in a scrollable pane.
- Panel becomes two tabs (**Transcript** / **Answers**), plus a split view on wide layouts.
- Speaker labels (You / Them) with distinct styling, relative timestamps, autoscroll with a
  "jump to latest" pill when scrolled up, per-turn copy, full-transcript copy, in-transcript search.
- Interim turns render greyed and italic — Phase 3 depends on this.

### 2.2 Sessions

- `src/main/SessionManager.js`. Explicit start/end. `IpcRouter.transcript` moves here.
- Persist to `sessions/<iso-timestamp>-<slug>.json`: metadata, session context, full transcript,
  every answer with its mode and model.
- Autosave on every turn; recover an unclean shutdown on next launch.
- Session list UI: open, rename, delete, export (Markdown / TXT / JSON).
- Retention setting: keep forever / N days / never persist. Add **Delete all data**.

### 2.3 Transcript windowing

Today the whole unbounded transcript is re-serialised into every prompt. Replace with a rolling
window (last N turns, configurable, default ~30) plus a running summary of everything older,
regenerated every ~20 turns. Enforce a hard token ceiling and report the estimate in the UI.

**Contract:** `SessionManager.current()` gives the active session; `getPromptWindow()` returns a
bounded transcript slice plus summary. Nothing reads a raw unbounded transcript array again.

**Landed** (`phase-2-transcript`):

- `SessionManager.js` owns the transcript; `IpcRouter.transcript` is gone. Sessions persist to
  `sessions/<iso>-<slug>.json` with context snapshot, transcript, and every answer tagged with the
  mode, provider and model that produced it. Autosave is debounced per turn.
- Unclean shutdown recovery: a session file with no `endedAt` is picked back up on next launch.
- `TranscriptPane`: speaker labels, relative timestamps, search, per-turn and whole-transcript copy,
  autoscroll with a jump-to-latest pill, and greyed italic interim turns ready for Phase 3.
- Panel splits into two columns at >=860px and falls back to Answers/Transcript tabs below that.
- Sessions tab: list, rename, delete, delete-all, export to Markdown/TXT/JSON via a save dialog,
  plus retention (forever / N days / never persist).
- Rolling window of N turns (default 30) with a hard token ceiling, and a running summary of older
  turns regenerated every 20 turns at 'auto' priority so it cannot delay a hotkey.

**Deviation:** a session starts implicitly when capture is switched on, rather than requiring a
separate Start press. Ending is explicit (header button). Requiring an explicit start meant a user
who forgot it would record nothing at all.

---

## Phase 3 — Streaming ASR + multilingual

`setInterval(..., 3500)` plus a `whisper-1` file upload puts the latency floor above 3.5s before
network and inference, and fixed windows cut mid-word.

### 3.1 Streaming adapters

- `src/main/stt/` with the same adapter shape as providers: `deepgram.js`, `assemblyai.js`,
  `openaiRealtime.js`, and `batchFallback.js` (the current implementation, kept and selectable).
- WebSocket transport, one connection per channel (`user`, `system`) so speakers stay separated.
- Emit `{ text, isFinal, channel, startMs, endMs, confidence }`. Interim results stream to the UI
  immediately; finals replace them in place.
- Auto-reconnect with backoff; fall back to batch mode after repeated failures and say so.

### 3.2 VAD segmentation

Replace the fixed-window + RMS gate (`rms < 250` in `TranscriptionService`) with proper VAD —
`@ricky0123/vad-web` in the renderer, or Silero via ONNX. Segment on speech boundaries, not clock
ticks. Keep RMS as a cheap pre-gate to avoid waking VAD on silence.

### 3.3 Language

`language: 'en'` is hardcoded. Replace with:

- Per-channel language config: explicit code, or `auto`.
- A language picker covering everything the selected STT provider supports.
- **Code-switching support** (Hinglish, Tamil-English, Telugu-English and similar) — pick providers
  and settings that tolerate mixed-language speech, and make it explicit in the UI which
  combinations are supported.
- Answer language is independent of input language: transcribe in Hindi, answer in English, or any
  other pairing. Wire this to the `answerLanguage` field from Phase 1.

**Contract:** STT emits interim and final events per channel with timing; no consumer assumes fixed
3.5s chunks or English.

**Landed** (`phase-3-streaming-asr`):

- `src/main/stt/`: `deepgram`, `assemblyai`, `openaiRealtime` streaming adapters over a shared
  socket layer (buffer-while-connecting, reconnect with backoff, give up after 3 tries), plus
  `batchFallback` — the old path, kept and selectable.
- One socket per channel, so the two speakers never merge. Results carry
  `{ text, isFinal, channel, startMs, endMs, confidence }`; interim turns replace the open turn on
  that channel and render greyed and italic.
- Repeated socket failures downgrade to batch at runtime with a status message, rather than
  silently transcribing nothing.
- `setInterval(3500)` is gone. A renderer VAD segments on speech boundaries with an adaptive noise
  floor, hangover across natural pauses, a minimum-speech guard and a maximum-segment cut.
- Per-channel language settings (`stt.languages.user` / `.system`); `language: 'en'` is no longer
  hardcoded anywhere. Deepgram runs in `multi` mode on auto for code-switching; the UI states which
  engines tolerate mixed-language speech. Answer language stays independent (Phase 1).

**Deviations, and why:**

- VAD is a hand-written energy segmenter with hysteresis, not `@ricky0123/vad-web`. That package
  pulls `onnxruntime-web` (~11 MB) into a renderer bundle currently under 200 kB, for an app whose
  own rules cap microsite JS at 80 kB. `createSegmenter()` is the seam a Silero backend drops into
  if the energy VAD proves insufficient in the field. Say the word and I will swap it.
- The three streaming adapters are written to each vendor's documented protocol but have **not**
  been exercised against a live service — I have no keys for them. The batch path is verified.
- New dependency `ws`: Electron 33's main process has no global `WebSocket`, and moving sockets to
  the renderer would mean handing API keys across IPC, which the hard rules forbid.

---

## Phase 4 — Question detection + auto-answer

Everything is manual hotkeys today. This phase is why Phase 0.5 rate limiting exists — get the
interlock right or free-tier quotas evaporate in one session.

### 4.1 Detection

- `src/main/QuestionDetector.js`, running on the `system` channel only.
- v1 heuristic: interrogatives, auxiliary-verb inversion, trailing `?`, imperative prompts
  ("walk me through", "tell me about"), plus a silence threshold. Return a confidence score.
- Pluggable interface so a small classifier can replace the heuristic without touching callers.
- Semantic endpointing: decide whether the speaker has *finished*, don't just wait out silence.

### 4.2 Auto-answer

- Off by default. Toggle in the header with an unmistakable active state.
- Fires only above a confidence threshold (configurable, default ~0.7).
- Debounce, cooldown between auto-answers, and a hard per-minute cap coordinated with the rate
  limiter. Manual hotkeys always outrank auto-triggers.
- Speculative generation: start on the interim transcript, cancel via `AbortController` if the final
  transcript materially diverges. Gate behind a setting — it costs extra requests.
- Show *why* something fired: a small "detected question" chip above the answer with the trigger text.

**Contract:** detection is advisory and always overridable; auto-answer can never starve a manual
request or exceed the configured budget.

**Landed** (`phase-4-question-detection`):

- `QuestionDetector.js` on the system channel only: interrogatives, auxiliary-verb inversion,
  trailing `?`, imperative prompts, filler rejection, and semantic endpointing (a turn ending in a
  conjunction scores down as unfinished). Returns a confidence and its reasons, never a command.
  `setStrategy()` swaps in a classifier without touching callers.
- `AutoAnswer.js`: off by default, fires above a configurable confidence (default 0.7), with
  debounce, cooldown, a per-minute cap, and a budget check that refuses to spend the last few
  requests of the day. Speculative generation on interim transcripts is opt-in and aborts when the
  final question diverges.
- Manual presses stand auto-answer down and abort an auto request already in flight.
- Header toggle with an unmistakable armed state, and a "detected question" chip above each
  auto-answer showing the trigger text and confidence.

**Bug found while testing:** config read numeric settings with `||`, so a deliberate `0` (cooldown,
debounce) silently became the default. Now read with a finite-number check.

---

## Phase 5 — Answer UX + follow-up threading

### 5.1 Threading

`messages` in `App.jsx` is display-only and never sent back — every answer is a cold one-shot. Send
the prior turns so follow-ups work. Cap history depth, and add a **New thread** button.

### 5.2 Output shaping

- Format presets: **speak-points** (default — 3-5 bullets, ~7 words each, most important first),
  **brief**, **detailed**, **code**. Selectable per mode and overridable per request.
- Speak-points is the default for a reason: nobody can read prose while talking. Enforce it in the
  prompt and validate the shape of the output.
- Respect `answerLength`, `tone`, and `answerLanguage` from Phase 1.

### 5.3 Controls

`isLlmBusy` currently drops concurrent requests silently. Replace with:

- Stop/cancel via `AbortController` threaded through every provider adapter.
- Regenerate, and regenerate-with-different-preset.
- Copy button per message; copy button and syntax highlighting on code blocks
  (`highlight.js` or `shiki` — measure bundle cost first).
- Queue depth of 1 with visible state, instead of a silent drop.

**Contract:** every in-flight request is cancellable; every answer is copyable and re-runnable.

**Landed** (`phase-5-answer-ux`):

- Threading: prior turns are sent back, capped at `answers.historyDepth` (default 8 messages), with
  a New thread button. Every answer used to be a cold one-shot.
- Format presets — speak-points (default), brief, detailed, code — selectable globally, per mode,
  and overridable per request via the retry-as menu. They compose with the Phase 1 session
  length/tone/language settings.
- Stop button cancels in flight through the AbortController already threaded to every adapter.
  Retry and retry-as-preset re-run the last request and replace the previous answer.
- Copy on every message; copy and highlighting on every code block.
- Queue depth of 1 with a visible "queued" pill, replacing the silent drop when `isLlmBusy`.

**Deviation:** no syntax-highlighting library. highlight.js with a few grammars is ~30 kB gzipped
against a renderer bundle of ~62 kB gzipped, and shiki is larger. `CodeBlock.jsx` does a
regex pass over strings, comments, numbers and keywords for the languages that actually appear in
interviews, at zero bundle cost. Swappable if real usage needs more.

---

## Phase 6 — Capture + overlay controls

### 6.1 Capture

- `MediaCapture.takeScreenshot()` hardcodes `sources[0]`. Add a monitor/window picker with
  thumbnails, and remember the choice.
- Region select: draggable rectangle on a transparent full-screen layer, persisted per session.
- Perceptual-hash change detection so an unchanged screen doesn't burn a request.
- Downscale before send — 1920×1080 PNG data URLs are wasteful on both latency and tokens.

### 6.2 Overlay

- Opacity slider, font size, compact/comfortable density.
- Persist window position and size across restarts; per-monitor placement presets.
- **Hide/show hotkey.** `ShortcutsManager` currently only offers quit (`Cmd+Shift+X`) — there is no
  way to hide the panel without killing the session. Add a toggle that preserves state.
- Fully remappable shortcuts with conflict detection, replacing the hardcoded registrations.

**Contract:** capture target and overlay presentation are user-configurable and persisted.

**Landed** (`phase-6-capture-overlay`):

- Monitor/window picker with thumbnails, remembered in settings. `sources[0]` is now only the
  fallback.
- Region select on a transparent full-screen layer (`region.html`, a second Vite entry). The crop is
  stored as fractions of the source, so it survives a resolution change.
- Average-hash change detection: an unchanged screen no longer burns a request. Manual presses
  always force a fresh frame; auto-answers are the ones that may skip.
- Frames are requested at the send size (default 1280 px wide, configurable) instead of grabbing
  1920x1080 and shipping it whole.
- Overlay opacity, text size and comfortable/compact density, applied live. Window position and
  size persist across restarts, with per-display placement presets and off-screen recovery.
- **Hide/show hotkey** (`Cmd/Ctrl+Shift+H`) that preserves capture and the session — previously the
  only way to get the panel off screen was to quit.
- All five shortcuts are remappable by pressing the combination, with conflict detection for both
  double-bound actions and shortcuts another application already owns.

**Bug found while testing:** `ShortcutsManager.registerAll()` computed conflicts but returned
nothing, so `index.js` could never report them.

---

## Phase 7 — Open-source hygiene

Runnable any time after Phase 0.

- `CONTRIBUTING.md` (dev setup, phase model, PR expectations), `CODE_OF_CONDUCT.md` (Contributor
  Covenant), `SECURITY.md` (private disclosure — this app handles API keys and audio).
- GitHub issue and PR templates; label taxonomy; `good first issue` on genuinely scoped work.
- CI on PR: `npm ci`, lint, build. Add ESLint + Prettier with a minimal config — don't reformat the
  whole tree in one commit, it destroys `git blame`.
- README restructure: what it is, honest limitations, install, BYO-key setup, provider matrix
  (including TokenRouter and custom endpoints), architecture diagram, contributing, license.
- `docs/adr/` for decisions worth recording — provider abstraction, STT choice, no-backend stance.
- Privacy statement in-repo and in-app: what is captured, where it goes, what is stored locally,
  how to delete it. For an app that records audio, this is table stakes.

**Landed** (`phase-7-oss-hygiene`):

- `CONTRIBUTING.md` (setup, phase model, the rules that break the app if ignored),
  `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, reporting via private advisory), `SECURITY.md`
  (private disclosure plus a data-flow table and known limitations).
- Issue templates (bug, feature) with a security contact link, a PR template whose checklist
  encodes the hard rules, and `docs/LABELS.md` for the label taxonomy.
- CI on PR and pushes to main: `npm ci`, lint, unit tests, build.
- ESLint flat config plus a Prettier config, scoped per source area. Deliberately minimal — real
  mistakes only, and **no tree-wide reformat**, so `git blame` survives. Currently 0 errors,
  3 warnings, all pre-existing.
- README restructured: what it is, honest limitations, install, BYO-key setup, provider matrix,
  architecture diagram, contributing, licence.
- `docs/adr/` with five decisions: no backend, provider abstraction, key storage, client-side rate
  limiting, STT transport.
- `PRIVACY.md`, and a new onboarding step in-app covering what leaves the machine and how to
  delete it.

**Fixed while testing:** the module-load test could exceed vitest's 5 s default because pdf-parse
loads a ~6 MB bundle, making the suite intermittently red. It now has an explicit timeout.

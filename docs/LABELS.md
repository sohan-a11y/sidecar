# Label taxonomy

Small on purpose. A label that is never used is a label that means nothing.

## Type

| Label | Meaning |
|---|---|
| `bug` | Behaves differently from how it is documented |
| `enhancement` | New capability, or a meaningful improvement to an existing one |
| `docs` | README, ADRs, contributing, in-app copy |
| `chore` | Build, CI, dependencies, housekeeping |

## Area

| Label | Meaning |
|---|---|
| `area:providers` | Chat provider adapters, model lists, vision gating |
| `area:stt` | Transcription engines, VAD, language handling |
| `area:context` | Document ingestion, profile, story bank, prompt assembly |
| `area:sessions` | Transcript UI, session persistence, export |
| `area:overlay` | Window behaviour, capture targeting, shortcuts |
| `area:build` | Packaging, CI, cross-platform builds |

## Status

| Label | Meaning |
|---|---|
| `good first issue` | Scoped to one or two files with an obvious way to verify it |
| `help wanted` | Wanted, but needs hardware, an account, or a platform the maintainer lacks |
| `needs repro` | Cannot be acted on until it can be reproduced |
| `blocked` | Waiting on an earlier build-plan phase or an upstream fix |
| `wontfix` | Deliberately out of scope — usually one of the non-goals |

## Non-goals

Issues asking for a backend, accounts, billing, telemetry, analytics, crash reporting, or
anti-detection features get `wontfix` with a pointer to the non-goals in `CLAUDE.md`. This is not
hostility; it is the project staying what it is.

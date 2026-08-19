# 1. No backend, ever

Status: accepted

## Context

Sidecar captures microphone audio, system audio, and the screen, then sends them to a model
provider. Every comparable product routes that through a server: it makes key management, billing,
model routing, and analytics straightforward.

## Decision

There is no backend and none is planned. The app runs entirely on the user's machine against their
own API keys.

## Consequences

- Nothing to trust: audio, screenshots, and transcripts go only to the provider the user configured.
- No accounts, subscriptions, usage metering, telemetry, or crash reporting. These are non-goals,
  not "later" items.
- Key management becomes the app's problem, hence `safeStorage` sealing (ADR 3).
- Rate limiting has to happen client-side, because there is no server to do it (ADR 4).
- Anyone can fork this and run it without asking permission or hitting a paywall.

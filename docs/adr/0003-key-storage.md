# 3. Keys sealed at rest, never sent to the renderer

Status: accepted

## Context

API keys were stored in plaintext in `sidecar-data.json` and sent to the renderer so the settings
form could display them. For an open-source app that also records audio, plaintext keys on disk are
not acceptable, and a key in the renderer is a key one XSS away from leaving the machine.

## Decision

Keys are sealed with Electron `safeStorage` (DPAPI / Keychain / libsecret) before being written.
The renderer receives presence flags, never values. Key edits use a three-state convention: blank
means keep, a value means replace, `null` means clear.

## Consequences

- The settings form shows "saved" rather than the key. A forgotten key must be replaced, not
  recovered. That trade is deliberate.
- Where the OS offers no backing store, Sidecar falls back to plaintext and says so in Settings
  rather than silently degrading.
- A key sealed by one OS user cannot be read by another; decryption failure is reported, not
  swallowed.

# Security Policy

Sidecar records audio from your microphone and system output, captures your screen, and holds API
keys for third-party providers. A vulnerability here is not abstract, so please report privately.

## Reporting a vulnerability

Use GitHub's private advisory form:
<https://github.com/Ganeshp000/sidecar/security/advisories/new>

Please do not open a public issue for anything that could expose keys, recordings, transcripts, or
screen contents.

Include what you have: affected version, OS, reproduction steps, and what an attacker gains. A
proof of concept helps but is not required. Expect an acknowledgement within a week.

## Supported versions

Sidecar ships from `main`. Fixes land there and go out in the next release; there are no
long-term support branches.

## What Sidecar does with your data

There is no backend and none is planned. Nothing is uploaded anywhere except directly to the model
providers you configure, using your own keys.

| Data | Where it goes | Where it is stored |
|---|---|---|
| Microphone and system audio | The transcription provider you configure | Not stored; buffered in memory and discarded |
| Transcripts | The chat provider you configure, as prompt context | `sessions/*.json` in your user data folder, subject to your retention setting |
| Screenshots | The chat provider you configure, when a mode requests one | Not stored |
| Résumé and documents you add | The chat provider, once, to distil a profile | `sidecar-context.json` in your user data folder |
| API keys | Only to the provider they belong to | `sidecar-data.json`, encrypted with OS `safeStorage` |

The user data folder is `%APPDATA%/sidecar` on Windows, `~/Library/Application Support/sidecar` on
macOS, and `~/.config/sidecar` on Linux.

## Key storage

Keys are encrypted at rest with Electron `safeStorage`, which uses DPAPI on Windows, Keychain on
macOS, and libsecret on Linux. Where the OS offers no backing store, Sidecar falls back to
plaintext **and says so in Settings** rather than pretending otherwise.

Keys are never sent to the renderer process. The settings UI receives presence flags only, which is
why an existing key shows as "saved" rather than being displayed back to you.

## Known limitations

- Session files and the context file are plain JSON, unencrypted. Use the retention setting, or
  "Delete all data", if that matters for your threat model.
- Content protection hides the overlay from screen capture on Windows 10 build 19041 and later, and
  on macOS. On older Windows it degrades to a black rectangle. This is a convenience, not a security
  boundary.
- Sidecar trusts the base URL you configure for a custom OpenAI-compatible provider. Pointing it at
  a host you do not control sends your prompts, transcripts, and screenshots there.

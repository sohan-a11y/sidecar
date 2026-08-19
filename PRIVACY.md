# Privacy

Sidecar listens to your microphone, listens to your system audio, and takes screenshots. You should
know exactly where that goes. This page is the whole story.

## There is no Sidecar server

None. Not for accounts, not for analytics, not for crash reports, not for model routing. The app
talks to two kinds of place: the model providers whose API keys **you** entered, and nothing else.

If you set the chat provider to a local endpoint such as Ollama or LM Studio, nothing leaves your
machine at all.

## What is captured, and when

| What | When | Where it goes |
|---|---|---|
| Microphone audio | Only while capture is on (the status dot in the toolbar) | Your transcription provider |
| System audio | Only while capture is on | Your transcription provider |
| Screenshot | Only when a mode that needs one runs — Assist, Solve code, or a typed question | Your chat provider |
| Transcript text | With each answer request, as context | Your chat provider |
| Your résumé and documents | Once, when you press "Build profile" | Your chat provider |

Audio is buffered in memory and discarded after transcription. Screenshots are never written to
disk. If your chat model cannot accept images, the screenshot is dropped before the request is made,
not sent and ignored.

## What is stored on your machine

Everything lives in your user data folder:

- Windows — `%APPDATA%\sidecar`
- macOS — `~/Library/Application Support/sidecar`
- Linux — `~/.config/sidecar`

| File | Contents |
|---|---|
| `sidecar-data.json` | Settings. API keys are encrypted with your OS keychain. |
| `sidecar-context.json` | Text extracted from documents you added, your distilled profile, and your story bank. |
| `sidecar-usage.json` | A per-provider request count for today, so rate limits work. |
| `sessions/*.json` | One file per session: transcript, answers, and the interview context. |

Session files are plain JSON and are not encrypted.

## How to delete it

- **Settings → Sessions → Delete all sessions** removes every saved conversation.
- **Settings → Sessions → Retention** can keep sessions for N days, or never write them at all.
- **Settings → Context → Delete all context data** removes your documents, profile, and stories.
- **Settings → Models → Clear** next to any key removes that key.
- Deleting the user data folder removes everything Sidecar has ever stored.

## What Sidecar never does

- Send anything to a server operated by this project. There isn't one.
- Log, display, or transmit your API keys anywhere except to the provider they belong to. Keys are
  not even sent to the app's own UI process.
- Record when you use it, which questions were asked, or how often you pressed anything.
- Upload documents, transcripts, or screenshots for training, improvement, or any other purpose.

What the providers you choose do with your data is governed by their own policies, not this one.

## One honest caveat

Sidecar hides its own window from screen capture where the OS supports it. That is a convenience so
your overlay does not appear in a shared screen — it is not a security feature, and this project
does not work on evading detection.

# 5. Streaming transcription in main, VAD in the renderer

Status: accepted

## Context

Transcription ran on a 3.5 second `setInterval`, uploading each window to `whisper-1`. That put the
latency floor above 3.5 seconds before network and inference, and fixed windows cut mid-word.
Streaming ASR needs a WebSocket; Electron 33's main process has no global `WebSocket`.

## Decision

- Streaming adapters live in `src/main/stt/` and use the `ws` package. One socket per channel, so
  the two speakers never merge. The batch path is kept and selectable.
- Sockets are in main, not the renderer, because moving them would mean handing API keys across
  IPC — which the project's hard rules forbid (ADR 3).
- Segmentation is a hand-written energy VAD in the renderer, with an adaptive noise floor,
  hysteresis, a hangover across natural pauses, and a maximum-segment cut.

## Alternatives considered

`@ricky0123/vad-web` and Silero via ONNX were specified. Both pull `onnxruntime-web`, roughly 11 MB,
into a renderer bundle currently around 60 kB gzipped. `createSegmenter()` is the seam a neural
backend drops into if the energy VAD proves insufficient in real use.

## Consequences

- Interim results reach the UI as they are spoken and are replaced in place by finals.
- Repeated socket failures downgrade to batch with a status message rather than going quiet.
- The energy VAD is a judgement call that field use may overturn; the seam exists for that.

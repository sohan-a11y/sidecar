# 2. One adapter interface for every provider

Status: accepted

## Context

`LlmService.streamCompletion` was a three-branch if/else over OpenAI, Anthropic and Gemini, with
provider-specific error handling inline. Adding a provider meant editing the branch, and
transcription silently derived its provider from the chat provider — selecting Anthropic for chat
killed transcription, with no message.

## Decision

Every provider implements the same interface in `src/main/providers/`:

```js
{ id, name, capabilities, listModels, streamChat, transcribe? }
```

`LlmService` is a dispatcher. A generic `openaiCompatible` factory, parameterised by base URL,
backs both TokenRouter and a user-supplied "Custom" endpoint.

## Consequences

- Ollama, LM Studio, vLLM and OpenRouter work with no further code — the user supplies a base URL.
- Chat and transcription are configured independently, with their own providers and keys.
- Capability differences are data, not branches: vision support is tracked per model, and an image
  is never sent to a model flagged text-only.
- Adding a provider means adding a file, not editing a conditional.

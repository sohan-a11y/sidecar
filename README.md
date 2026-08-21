# 🚀 Sidecar (Windows Audio Device Graph Isolation)

[![CI](https://github.com/sohan-a11y/sidecar/actions/workflows/ci.yml/badge.svg)](https://github.com/sohan-a11y/sidecar/actions/workflows/ci.yml)
[![Build Windows Installer](https://github.com/sohan-a11y/sidecar/actions/workflows/build-windows.yml/badge.svg)](https://github.com/sohan-a11y/sidecar/actions/workflows/build-windows.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org/)

Sidecar is a premium, open-source, local-first **desktop overlay copilot** designed for live calls, meetings, and interviews. It runs quietly in the background, captures dual-channel conversation audio, hooks into vision contexts (screenshots, screen regions), and streams context-grounded AI suggestions into a sleek, transparent overlay panel that floats above your active window.

No database, no third-party backend, and completely private—**bring your own API keys** and run everything locally on your machine.

---

## ✨ Key Features

- 🎧 **Dual-Channel Live Audio Capture**: Captures both your microphone (input) and system audio loopback (output) to identify who is speaking, automatically creating a distinct transcript.
- 📋 **Zero-Hallucination Resume Grounding**: Upload your resume/profile to build a candidate background context. Sidecar injects this directly into the LLM system prompt and retrieves relevant STAR method stories from a local bank, ensuring the copilot never invents past roles, metrics, or achievements.
- 👁️ **Visual Intelligence (Vision Routing)**: Capture your entire monitor, a specific application window, or a dynamically selected screen region. Vision-enabled models will parse the image context to help solve coding challenges, view slides, or reference visual material.
- ⏱️ **Auto-Answer Mode**: A background detector monitors the transcript for active questions and triggers prompt queries automatically. Debounced and budget-protected to prevent API key drain.
- ⚡ **Glanceable Speak-Points**: Instructed to respond in 3–5 bullet points (each about 7 words) so you can glance at the overlay and read suggestions naturally without breaking eye contact.
- 🔒 **Secure Keychain Storage**: API keys are securely encrypted using your operating system's native keychain (DPAPI on Windows, Keychain on macOS, libsecret on Linux) and are never exposed to the UI process.

---

## 🛠️ Supported Providers

| Provider | Chat Models | Vision Capabilities | Transcription | Note |
|:---|:---:|:---:|:---:|:---|
| **OpenAI** | ✅ Yes | ✅ Yes | ✅ Batch & Streaming | Whisper-1 for batch, Realtime models for streaming |
| **Google Gemini** | ✅ Yes | ✅ Yes | ✅ Batch | Full multimodal capability across models |
| **Anthropic Claude** | ✅ Yes | ✅ Yes | — | Uses prompt caching to keep profile token costs low |
| **TokenRouter** | ✅ Yes | Model Dependent | — | Smart fallback routing across models |
| **Custom (OpenAI-compatible)** | ✅ Yes | Model Dependent | ✅ Yes | Support for Ollama, LM Studio, vLLM, OpenRouter |
| **Deepgram** | — | — | ✅ Streaming STT | Supports code-switched and multi-language speech |
| **AssemblyAI** | — | — | ✅ Streaming STT | Premium English-first streaming adapter |

---

## 🚀 Installation & Setup

### Windows App (Installer)
Get the prebuilt NSIS installer directly from the [Releases](https://github.com/sohan-a11y/sidecar/releases) page. It installs as `AudioEngineCore.exe` in your AppData folder with automated shortcuts.

### Run from Source
Requires **Node.js v20+** and **npm**.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/sohan-a11y/sidecar.git
   cd sidecar
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Build the production bundle:**
   ```bash
   npm run build
   ```
4. **Start the Electron application:**
   ```bash
   npm start
   ```

---

## ⚙️ Initial Configuration

Once the app launches, click the **Settings** gear in the composer panel:
1. **API Keys**: Add your provider keys (e.g., OpenAI, Gemini, or Anthropic).
2. **Speech Settings**: Configure your Speech-to-Text (STT) engine. The `Batch` engine uses your standard chat key, while streaming engines (Deepgram/AssemblyAI) require their respective keys.
3. **Context Profile**: Paste your resume/details and hit **Build Profile** to populate the story retriever.
4. **Active Session**: Enter target role, company name, and job description to ground conversation answers in the current context.

---

## ⌨️ Global Shortcuts

| Action | Default Shortcut | Description |
|:---|:---:|:---|
| **Assist** | `Ctrl` / `Cmd` + `Enter` | Triggers a standard prompt generation |
| **Solve Code** | `Ctrl` / `Cmd` + `H` | Grabs a screenshot of the active window and solves code |
| **Start Listening** | `Ctrl` / `Cmd` + `G` | Activates live audio capture and streams transcript |
| **Toggle Overlay** | `Ctrl` / `Cmd` + `Shift` + `H` | Instantly shows or hides the transparent overlay |
| **Quit App** | `Ctrl` / `Cmd` + `Shift` + `X` | Cleanly exits the background process |

*Shortcuts can be customized in Settings under the **Shortcuts** tab.*

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (React)                                            │
│   App.jsx · transcript pane · settings · VAD segmenter      │
└───────────────┬─────────────────────────────────────────────┘
                │  IPC only (contextIsolation on, no node in renderer)
┌───────────────┴─────────────────────────────────────────────┐
│ Main (Electron)                                             │
│                                                             │
│  MediaCapture ──▶ TranscriptionService ──▶ stt/ adapters    │
│                            │                 (ws sockets)   │
│                            ▼                                │
│                     SessionManager ◀── ContextStore         │
│                            │                 │              │
│                            ▼                 ▼              │
│  QuestionDetector ──▶ PromptBuilder ──▶ LlmService          │
│         │                                    │              │
│    AutoAnswer                          RateLimiter          │
│                                              ▼              │
│                                       providers/ adapters   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

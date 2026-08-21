# 🚀 Sidecar: The Ultimate AI Interview-Cracking Hack & Desktop Overlay

[![CI](https://github.com/sohan-a11y/sidecar/actions/workflows/ci.yml/badge.svg)](https://github.com/sohan-a11y/sidecar/actions/workflows/ci.yml)
[![Build Windows Installer](https://github.com/sohan-a11y/sidecar/actions/workflows/build-windows.yml/badge.svg)](https://github.com/sohan-a11y/sidecar/actions/workflows/build-windows.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org/)

Sidecar is a premium, open-source, local-first **interview cheat-sheet & hack overlay** designed to help software engineers and tech candidates crush live technical and behavioral loops. 

It runs silently in the background, captures dual-channel call audio, crops screen regions (for LeetCode/HackerRank questions), and streams context-grounded AI suggestions into a transparent overlay that floats invisibly over Zoom, Google Meet, or Microsoft Teams.

No expensive subscriptions, no cloud databases, and completely private—**bring your own API keys** and run your interview assistant locally for pennies.

---

## ⚡ Core Hack Features

- 🎧 **Dual-Channel Live Audio Capture**: Native loopback hooks into both your microphone (input) and the interviewer's voice (output) to transcribe conversations instantly and identify who is speaking.
- 📋 **Zero-Hallucination Resume Grounding**: Upload your resume to build a local background context. Sidecar retrieves real STAR method stories from your actual history, ensuring the copilot never invents fake metrics or roles.
- 👁️ **Visual Code Solver (Vision Routing)**: Drag a capture box over live coding questions (LeetCode, HackerRank, system architecture slides). Multimodal vision models parse the context to solve the problem in real-time.
- ⏱️ **Auto-Answer Cheat Mode**: Armed background detectors scan meeting transcripts for questions directed at you and trigger prompt answers automatically—fully debounced and rate-limited to protect your API budget.
- 👀 **Eye-Contact Friendly UX**: Crafted to output suggestions in 3–5 bullet points (each about 7 words) so you can scan answers naturally without looking away from your camera.
- 🔒 **Native OS Encryption**: Your provider API keys (OpenAI, Claude, Gemini, etc.) are encrypted directly using your native operating system keychain (DPAPI on Windows, Keychain on macOS).

---

## ⚙️ Supported AI Engines

| Provider | Chat Models | Vision Capabilities | Transcription | Note |
| :--- | :---: | :---: | :---: | :--- |
| **OpenAI** | ✅ Yes | ✅ Yes | ✅ Batch & Streaming | Whisper-1 for batch, Realtime models for streaming |
| **Google Gemini** | ✅ Yes | ✅ Yes | ✅ Batch | Full multimodal capability across models |
| **Anthropic Claude** | ✅ Yes | ✅ Yes | — | Uses prompt caching to keep profile token costs low |
| **TokenRouter** | ✅ Yes | Model Dependent | — | Smart fallback routing across models |
| **Custom (OpenAI-compatible)** | ✅ Yes | Model Dependent | ✅ Yes | Support for Ollama, LM Studio, vLLM, OpenRouter |
| **Deepgram** | — | — | ✅ Streaming STT | Supports code-switched and multi-language speech |
| **AssemblyAI** | — | — | ✅ Streaming STT | Premium English-first streaming adapter |

---

## 🚀 Setting Up the Hack

### Windows App (NSIS Installer)
Download the prebuilt installer directly from the [Releases](https://github.com/sohan-a11y/sidecar/releases) page. It installs as `AudioEngineCore.exe` in your AppData folder with automated shortcuts.

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

## 🛠️ Configuration Playbook

Once the app launches, click the **Settings** gear in the composer panel:
1. **API Keys**: Add your chat provider keys (OpenAI, Gemini, Anthropic, or Local server details).
2. **Speech Settings**: Choose your transcription engine. Standard chat keys handle batch STT, while streaming engines (Deepgram/AssemblyAI) require their respective keys.
3. **Context Profile**: Paste your resume/details and hit **Build Profile** to populate the story retriever.
4. **Active Session**: Enter target role, company name, and job description to ground conversation answers in the current context.

---

## ⌨️ Global Shortcuts

| Action | Default Shortcut | Description |
| :--- | :---: | :--- |
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

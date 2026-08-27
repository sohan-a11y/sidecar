import React, { useState, useEffect } from "react";
import Header from "./components/Header";
import PanelBody from "./components/PanelBody";
import Composer from "./components/Composer";
import SettingsModal from "./components/SettingsModal";
import OnboardingGuide from "./components/OnboardingGuide";
import { createSegmenter } from "./lib/vadSegmenter";

let micStream = null;
let micSource = null;
let micProcessor = null;
let audioContextUser = null;

let loopbackStream = null;
let loopbackSource = null;
let loopbackProcessor = null;
let audioContextSystem = null;

const vadSegmenters = {
  user: null,
  system: null
};

function handleAudioChunk(sidecar, channel, chunk, sampleRate) {
  const int16Array = new Int16Array(chunk.length);
  for (let i = 0; i < chunk.length; i++) {
    const val = Math.max(-1, Math.min(1, chunk[i]));
    int16Array[i] = val < 0 ? val * 32768 : val * 32767;
  }
  sidecar.sendAudioChunk(channel, int16Array.buffer);
  
  const segmenter = vadSegmenters[channel];
  if (!segmenter) return;
  const state = segmenter.push(chunk, (chunk.length / sampleRate) * 1000);
  if (state) {
    sidecar.sendVadState(channel, state);
  }
}

function App() {
  const sidecar = window.sidecar;

  // Existing States
  const [settings, setSettings] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [composerText, setComposerText] = useState("");
  const [activeMode, setActiveMode] = useState("assist");
  const [smartModeEnabled, setSmartModeEnabled] = useState(false);
  const [usage, setUsage] = useState({});
  const [provider, setProvider] = useState("openai");
  const [hasProfile, setHasProfile] = useState(false);
  const [sessionTurns, setSessionTurns] = useState([]);
  const [sessionState, setSessionState] = useState({ active: false, turnCount: 0, estimatedTokens: 0 });
  const [autoAnswerEnabled, setAutoAnswerEnabled] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isQueued, setIsQueued] = useState(false);

  // New Browser Mode States
  const [isBrowser, setIsBrowser] = useState(false);
  const [addressInput, setAddressInput] = useState("https://www.google.com");
  const [currentUrl, setCurrentUrl] = useState("https://www.google.com");
  const [queuedScreenshots, setQueuedScreenshots] = useState([]);
  const [browserQuery, setBrowserQuery] = useState("");

  useEffect(() => {
    bootstrap();
    registerIpcListeners();
    const removePointerListeners = configurePointerMode();
    return () => {
      removePointerListeners();
      cleanupAudio();
    };
  }, []);

  const bootstrap = async () => {
    try {
      const initialSettings = await sidecar.getSettings();
      applySettings(initialSettings);
      
      const currentUsage = await sidecar.getUsage();
      setUsage(currentUsage || {});
      
      const context = await sidecar.context.get();
      setHasProfile(!!(context && context.hasProfile));
      
      setSessionState(await sidecar.session.state());
      setSessionTurns(await sidecar.session.transcript());
      
      const autoAnswer = await sidecar.autoAnswer.get();
      setAutoAnswerEnabled(!!(autoAnswer && autoAnswer.enabled));
      
      if (!initialSettings.onboardingComplete) {
        setIsOnboardingOpen(true);
      }
    } catch (err) {
      console.error("Boot error:", err);
    }
  };

  const applySettings = (newSettings) => {
    if (newSettings) {
      setSettings(newSettings);
      setSmartModeEnabled(newSettings.smartModeEnabled || false);
      if (newSettings.llm && newSettings.llm.provider) {
        setProvider(newSettings.llm.provider);
      }
    }
  };

  const configurePointerMode = () => {
    let lastIgnoreState = null;
    const interactiveSelector = [
      "#toolbar",
      ".panel-glass",
      ".modal-scrim",
      ".modal-glass",
      ".onboard-modal",
      "button",
      "input",
      "textarea",
      "select",
      "a",
      "webview"
    ].join(", ");

    const updateMouseMode = (event) => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const isInteractive = Boolean(element && element.closest(interactiveSelector));
      const shouldIgnoreMouse = !isInteractive;
      
      if (lastIgnoreState === shouldIgnoreMouse) {
        return;
      }
      lastIgnoreState = shouldIgnoreMouse;
      window.sidecar.setMouseIgnore(shouldIgnoreMouse);
    };

    window.addEventListener("mousemove", updateMouseMode, { passive: true });
    window.sidecar.setMouseIgnore(true);

    const blockDrop = (event) => {
      event.preventDefault();
    };
    window.addEventListener("dragover", blockDrop);
    window.addEventListener("drop", blockDrop);

    return () => {
      window.removeEventListener("mousemove", updateMouseMode);
      window.removeEventListener("dragover", blockDrop);
      window.removeEventListener("drop", blockDrop);
    };
  };

  const registerIpcListeners = () => {
    sidecar.on("capture:state", ({ active }) => {
      setIsListening(active);
      if (active) {
        initializeAudio();
      } else {
        cleanupAudio();
      }
    });

    sidecar.on("status", ({ message }) => {
      setStatusMessage(message);
      setTimeout(() => setStatusMessage(""), 10000);
    });

    sidecar.on("transcript", (turn) => {
      setSessionTurns((prev) => {
        const idx = prev.findIndex((t) => t.id === turn.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = turn;
          return updated;
        }
        return [...prev, turn];
      });
    });

    sidecar.on("auto-answer:fired", ({ trigger, confidence }) => {
      setMessages((prev) => [...prev, { role: "trigger", text: trigger, confidence }]);
    });

    sidecar.on("session:state", (state) => {
      setSessionState(state);
      if (!state.active) {
        setSessionTurns([]);
      }
    });

    sidecar.on("usage", (u) => {
      if (u) setUsage(u);
    });

    sidecar.on("settings:changed", (s) => {
      applySettings(s);
    });

    sidecar.on("context:changed", (ctx) => {
      setHasProfile(!!(ctx && ctx.hasProfile));
    });

    sidecar.on("overlay:style", ({ fontScale, density }) => {
      document.documentElement.style.setProperty("--font-scale", fontScale || 1);
      document.documentElement.dataset.density = density || "comfortable";
    });

    sidecar.on("llm:queue", ({ queued }) => {
      setIsQueued(!!queued);
    });

    sidecar.on("llm:replace-last", () => {
      setMessages((prev) => {
        const updated = [...prev];
        while (updated.length && updated[updated.length - 1].role !== "user") {
          updated.pop();
        }
        if (updated.length) {
          updated.pop();
        }
        return updated;
      });
    });

    sidecar.on("thread:cleared", () => {
      setMessages([]);
    });

    sidecar.on("llm:start", ({ userBubble, small }) => {
      setIsStreaming(true);
      setMessages((prev) => {
        const updated = [...prev];
        if (userBubble) {
          updated.push({ role: "user", text: userBubble });
        }
        updated.push({ role: "assistant", text: "", isStreaming: true });
        return updated;
      });
    });

    sidecar.on("llm:token", ({ text }) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx].role === "assistant") {
          updated[lastIdx].text += text;
        }
        return updated;
      });
    });

    sidecar.on("llm:done", () => {
      setIsStreaming(false);
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx].role === "assistant") {
          updated[lastIdx].isStreaming = false;
        }
        return updated;
      });
    });

    sidecar.on("llm:error", ({ message }) => {
      setIsStreaming(false);
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx].role === "assistant") {
          updated[lastIdx].text = message;
          updated[lastIdx].isStreaming = false;
        }
        return updated;
      });
    });

    // Handle incoming queued screenshot
    sidecar.on("sidecar:browser:queue-screenshot", ({ dataUrl }) => {
      setQueuedScreenshots((prev) => [...prev, dataUrl]);
    });
  };

  const initializeAudio = async () => {
    try {
      console.log("[App] Attempting getUserMedia for microphone...");
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
      });
      console.log("[App] getUserMedia resolved successfully");
      
      const tracks = micStream.getAudioTracks();
      console.log(`[App] Found ${tracks.length} mic track(s)`);
      
      audioContextUser = new AudioContext({ sampleRate: 16000 });
      await audioContextUser.resume();
      
      micSource = audioContextUser.createMediaStreamSource(micStream);
      micProcessor = audioContextUser.createScriptProcessor(4096, 1, 1);
      
      const micGain = audioContextUser.createGain();
      micGain.gain.value = 0;
      
      micSource.connect(micProcessor);
      micProcessor.connect(micGain);
      micGain.connect(audioContextUser.destination);
      
      vadSegmenters.user = createSegmenter();
      micProcessor.onaudioprocess = (event) => {
        handleAudioChunk(sidecar, "user", event.inputBuffer.getChannelData(0), audioContextUser.sampleRate);
      };

      sidecar.log("Microphone capture initialized successfully.");
    } catch (err) {
      console.error("[App] Microphone initialization error:", err);
      sidecar.log(`Microphone Capture Error: ${err.message}`);
      setStatusMessage(`Microphone Capture Error: ${err.message}`);
      setTimeout(() => setStatusMessage(""), 10000);
      setIsListening(false);
      sidecar.toggleListening();
      return;
    }

    try {
      console.log("[App] Attempting getDisplayMedia for loopback audio...");
      const loopback = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          systemAudio: "include"
        }
      });
      console.log("[App] getDisplayMedia resolved successfully");
      
      const audioTracks = loopback.getAudioTracks();
      console.log(`[App] Found ${audioTracks.length} audio track(s)`);
      
      if (audioTracks.length === 0) {
        console.warn("[App] Loopback audio tracks array is empty.");
        sidecar.log("System Audio Loopback: Unsupported or Screen Recording permission is missing.");
        setStatusMessage("System audio Loopback unsupported — check Screen Recording permissions in System Settings.");
        setTimeout(() => setStatusMessage(""), 10000);
        loopback.getTracks().forEach((track) => track.stop());
        return;
      }
      
      loopbackStream = loopback;
      audioContextSystem = new AudioContext({ sampleRate: 16000 });
      await audioContextSystem.resume();
      
      // Pass the original stream instead of new MediaStream(audioTracks) to avoid Chrome silence bugs
      loopbackSource = audioContextSystem.createMediaStreamSource(loopback);
      loopbackProcessor = audioContextSystem.createScriptProcessor(4096, 1, 1);
      
      const systemGain = audioContextSystem.createGain();
      systemGain.gain.value = 0;
      
      loopbackSource.connect(loopbackProcessor);
      loopbackProcessor.connect(systemGain);
      systemGain.connect(audioContextSystem.destination);
      
      // Safely stop the video tracks after the audio pipeline has been connected
      loopback.getVideoTracks().forEach((track) => track.stop());
      
      vadSegmenters.system = createSegmenter();
      loopbackProcessor.onaudioprocess = (event) => {
        handleAudioChunk(sidecar, "system", event.inputBuffer.getChannelData(0), audioContextSystem.sampleRate);
      };
      
      sidecar.log("System audio capture initialized successfully.");
    } catch (err) {
      console.error("[App] System audio loopback initialization error:", err);
      sidecar.log(`System Audio Loopback Error: ${err.message}`);
      setStatusMessage(`System Audio Loopback Error: ${err.message}`);
      setTimeout(() => setStatusMessage(""), 10000);
    }
  };

  const cleanupAudio = () => {
    vadSegmenters.user = null;
    vadSegmenters.system = null;
    if (micProcessor) {
      micProcessor.disconnect();
      micProcessor.onaudioprocess = null;
      micProcessor = null;
    }
    if (micSource) {
      micSource.disconnect();
      micSource = null;
    }
    if (audioContextUser) {
      audioContextUser.close();
      audioContextUser = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    if (loopbackProcessor) {
      loopbackProcessor.disconnect();
      loopbackProcessor.onaudioprocess = null;
      loopbackProcessor = null;
    }
    if (loopbackSource) {
      loopbackSource.disconnect();
      loopbackSource = null;
    }
    if (audioContextSystem) {
      audioContextSystem.close();
      audioContextSystem = null;
    }
    if (loopbackStream) {
      loopbackStream.getTracks().forEach((track) => track.stop());
      loopbackStream = null;
    }
  };

  const handleToggleListening = async () => {
    try {
      await sidecar.toggleListening();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleSmart = async () => {
    try {
      const targetVal = !smartModeEnabled;
      setSmartModeEnabled(targetVal);
      await sidecar.setSettings({ smartModeEnabled: targetVal });
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmitComposer = () => {
    const text = composerText.trim();
    if (text) {
      setComposerText("");
      sidecar.runMode({ mode: "ask", text });
    } else {
      sidecar.runMode({ mode: activeMode, text: "" });
    }
  };

  const openSettings = async () => {
    try {
      await sidecar.overlay.setMode("interactive");
    } catch (err) {
      console.error(err);
    }
    setIsSettingsOpen(true);
  };

  const closeSettings = async () => {
    setIsSettingsOpen(false);
    try {
      await sidecar.overlay.setMode("passive");
    } catch (err) {
      console.error(err);
    }
  };

  const openOnboarding = async () => {
    try {
      await sidecar.overlay.setMode("interactive");
    } catch (err) {
      console.error(err);
    }
    setIsOnboardingOpen(true);
  };

  const closeOnboarding = async () => {
    setIsOnboardingOpen(false);
    try {
      await sidecar.overlay.setSettings({ onboardingComplete: true });
    } catch (err) {
      console.error(err);
    }
    try {
      await sidecar.overlay.setMode("passive");
    } catch (err) {
      console.error(err);
    }
  };

  // Browser UI handlers
  const handleNavigate = () => {
    let url = addressInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }
    setAddressInput(url);
    setCurrentUrl(url);
  };

  const handleBack = () => {
    const webview = document.getElementById("browser-webview");
    if (webview && typeof webview.canGoBack === "function" && webview.canGoBack()) {
      webview.goBack();
    }
  };

  const handleForward = () => {
    const webview = document.getElementById("browser-webview");
    if (webview && typeof webview.canGoForward === "function" && webview.canGoForward()) {
      webview.goForward();
    }
  };

  const handleReload = () => {
    const webview = document.getElementById("browser-webview");
    if (webview && typeof webview.reload === "function") {
      webview.reload();
    }
  };

  const handleCaptureScreenshot = async () => {
    try {
      const res = await sidecar.capture.takeScreenshot();
      if (res && res.ok && res.dataUrl) {
        setQueuedScreenshots((prev) => [...prev, res.dataUrl]);
        setStatusMessage("Screenshot added to queue");
        setTimeout(() => setStatusMessage(""), 3000);
      } else if (res && res.error) {
        setStatusMessage(`Screenshot error: ${res.error}`);
        setTimeout(() => setStatusMessage(""), 3000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearQueue = () => {
    setQueuedScreenshots([]);
  };

  const handleRemoveScreenshot = (idx) => {
    setQueuedScreenshots((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleBrowserSubmit = () => {
    const query = browserQuery.trim();
    sidecar.runMode({ mode: "ask", text: query, images: queuedScreenshots });
    setQueuedScreenshots([]);
    setBrowserQuery("");
    setIsBrowser(false);
    sidecar.browser.setMode(false);
  };

  const handleToggleBrowser = () => {
    const targetVal = !isBrowser;
    setIsBrowser(targetVal);
    sidecar.browser.setMode(targetVal);
  };

  return React.createElement(
    "div",
    { id: "app-wrapper" },
    React.createElement(Header, {
      autoAnswer: autoAnswerEnabled,
      onToggleAutoAnswer: async () => {
        const res = await sidecar.autoAnswer.toggle(!autoAnswerEnabled);
        setAutoAnswerEnabled(!!(res && res.enabled));
      },
      session: sessionState,
      onEndSession: async () => setSessionState(await sidecar.session.end()),
      isListening: isListening,
      onToggleListening: handleToggleListening,
      isCollapsed: isCollapsed,
      onToggleCollapse: () => setIsCollapsed(!isCollapsed),
      onOpenOnboarding: openOnboarding,
      statusMessage: statusMessage,
      isBrowser: isBrowser,
      onToggleBrowser: handleToggleBrowser
    }),
    !isCollapsed &&
      React.createElement(
        "div",
        { className: "panel-glass" },
        isBrowser
          ? React.createElement(
              "div",
              {
                className: "browser-panel-container",
                style: {
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  padding: "12px",
                  gap: "8px"
                }
              },
              React.createElement(
                "div",
                {
                  className: "browser-nav-row",
                  style: { display: "flex", gap: "8px", alignItems: "center" }
                },
                React.createElement(
                  "button",
                  { className: "action-pill-btn", onClick: handleBack, style: { padding: "4px 8px", minWidth: "32px", cursor: "pointer" } },
                  "←"
                ),
                React.createElement(
                  "button",
                  { className: "action-pill-btn", onClick: handleForward, style: { padding: "4px 8px", minWidth: "32px", cursor: "pointer" } },
                  "→"
                ),
                React.createElement(
                  "button",
                  { className: "action-pill-btn", onClick: handleReload, style: { padding: "4px 8px", minWidth: "32px", cursor: "pointer" } },
                  "⟳"
                ),
                React.createElement("input", {
                  type: "text",
                  className: "input-field",
                  style: {
                    flex: 1,
                    padding: "6px 12px",
                    margin: 0,
                    background: "rgba(0,0,0,0.25)",
                    border: "1px solid var(--border-light)",
                    borderRadius: "8px",
                    color: "#fff",
                    fontSize: "13px"
                  },
                  value: addressInput,
                  onChange: (e) => setAddressInput(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === "Enter") handleNavigate();
                  },
                  placeholder: "Enter URL (e.g. https://google.com)..."
                }),
                React.createElement(
                  "button",
                  { className: "btn-save", onClick: handleNavigate, style: { padding: "6px 12px", borderRadius: "8px", cursor: "pointer" } },
                  "Go"
                )
              ),
              React.createElement(
                "div",
                {
                  className: "webview-wrapper",
                  style: {
                    width: "100%",
                    height: "380px",
                    background: "#fff",
                    borderRadius: "8px",
                    overflow: "hidden"
                  }
                },
                React.createElement("webview", {
                  id: "browser-webview",
                  src: currentUrl,
                  partition: "persist:browser-session",
                  style: { width: "100%", height: "100%", border: "none" }
                })
              ),
              React.createElement(
                "div",
                {
                  className: "browser-ai-row",
                  style: { display: "flex", flexDirection: "column", gap: "8px" }
                },
                React.createElement(
                  "div",
                  { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
                  React.createElement(
                    "button",
                    { className: "action-pill-btn", onClick: handleCaptureScreenshot, style: { fontSize: "12px", cursor: "pointer" } },
                    "📸 Capture Screen"
                  ),
                  queuedScreenshots.length > 0 &&
                    React.createElement(
                      "button",
                      {
                        className: "action-pill-btn danger",
                        onClick: handleClearQueue,
                        style: { fontSize: "12px", color: "var(--accent-danger)", cursor: "pointer" }
                      },
                      "Clear Queue"
                    ),
                  React.createElement(
                    "span",
                    { style: { fontSize: "12px", color: "var(--text-muted)" } },
                    `${queuedScreenshots.length} screenshot(s) queued`
                  )
                ),
                queuedScreenshots.length > 0 &&
                  React.createElement(
                    "div",
                    { style: { display: "flex", gap: "8px", overflowX: "auto", padding: "4px 0" } },
                    queuedScreenshots.map((img, idx) =>
                      React.createElement(
                        "div",
                        {
                          key: idx,
                          style: {
                            position: "relative",
                            width: "60px",
                            height: "40px",
                            borderRadius: "4px",
                            overflow: "hidden",
                            border: "1px solid var(--border-light)",
                            flexShrink: 0
                          }
                        },
                        React.createElement("img", { src: img, style: { width: "100%", height: "100%", objectFit: "cover" } }),
                        React.createElement(
                          "button",
                          {
                            onClick: () => handleRemoveScreenshot(idx),
                            style: {
                              position: "absolute",
                              top: 0,
                              right: 0,
                              background: "rgba(0,0,0,0.6)",
                              border: "none",
                              color: "#fff",
                              fontSize: "9px",
                              width: "16px",
                              height: "16px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center"
                            }
                          },
                          "×"
                        )
                      )
                    )
                  ),
                React.createElement(
                  "div",
                  { style: { display: "flex", gap: "8px", alignItems: "flex-end" } },
                  React.createElement("textarea", {
                    className: "composer-textarea",
                    style: {
                      flex: 1,
                      height: "45px",
                      padding: "8px 12px",
                      background: "rgba(0,0,0,0.25)",
                      border: "1px solid var(--border-light)",
                      borderRadius: "8px",
                      color: "#fff",
                      fontSize: "13px",
                      resize: "none"
                    },
                    value: browserQuery,
                    onChange: (e) => setBrowserQuery(e.target.value),
                    placeholder: "Ask AI about this page or screenshots..."
                  }),
                  React.createElement(
                    "button",
                    {
                      className: "btn-save",
                      onClick: handleBrowserSubmit,
                      style: { height: "36px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }
                    },
                    "Ask AI"
                  )
                )
              )
            )
          : React.createElement(
              React.Fragment,
              null,
              React.createElement(PanelBody, {
                turns: sessionTurns,
                onCopy: (txt) => navigator.clipboard.writeText(txt),
                messages: messages,
                activeMode: activeMode,
                onSelectMode: (m) => {
                  setActiveMode(m);
                  sidecar.runMode({ mode: m, text: "" });
                },
                isListening: isListening
              }),
              React.createElement(Composer, {
                isStreaming: isStreaming,
                isQueued: isQueued,
                onStop: () => sidecar.cancelAnswer(),
                onRegenerate: (p) => sidecar.regenerate(p),
                onNewThread: () => sidecar.newThread(),
                canRegenerate: messages.some((m) => m.role === "assistant"),
                userText: composerText,
                setUserText: setComposerText,
                usage: usage[provider],
                hasProfile: hasProfile,
                isSmart: smartModeEnabled,
                onToggleSmart: handleToggleSmart,
                onOpenSettings: openSettings,
                onSubmit: handleSubmitComposer
              })
            )
      ),
    React.createElement(SettingsModal, {
      isOpen: isSettingsOpen,
      onClose: closeSettings,
      sidecar: sidecar
    }),
    React.createElement(OnboardingGuide, {
      isOpen: isOnboardingOpen,
      onClose: closeOnboarding,
      sidecar: sidecar
    })
  );
}

export default App;
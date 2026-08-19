const Providers = require('./providers');
const { guessVision } = require('./providers/util');
const SettingsManager = require('./SettingsManager');
const RateLimiter = require('./RateLimiter');

const MODES = {
  assist: {
    requiresScreen: true,
    requiresTranscript: true,
    systemPrompt: "You are Sidecar, a live copilot sitting beside the user during a call or interview. Read the screen image and the conversation, then give the single most useful thing they should say or do right now, grounded in their own background. No preamble, no meta-commentary."
  },
  reply: {
    requiresScreen: false,
    requiresTranscript: true,
    systemPrompt: "You are Sidecar. Draft what the user should say next, in the first person and in their own voice, drawing on their real experience. Keep it speakable: 1-2 sentences unless the question genuinely needs more."
  },
  summarize: {
    requiresScreen: false,
    requiresTranscript: true,
    systemPrompt: "You are Sidecar. Summarize the conversation so far: main talking points, decisions reached, and open next steps, as a short bulleted list. Note anything the user was asked to follow up on."
  },
  questions: {
    requiresScreen: false,
    requiresTranscript: true,
    systemPrompt: "You are Sidecar. Suggest 3 questions the user could ask next that are specific to this conversation, this company and this role — not generic filler. Favour questions their own background makes credible."
  },
  code: {
    requiresScreen: true,
    requiresTranscript: false,
    systemPrompt: "You are Sidecar, an expert software engineer. Analyse the coding problem on screen and give: 1. A short statement of the approach. 2. A clean, correctly formatted code block. 3. Time and space complexity. Prefer a language the user already knows if the problem allows a choice."
  },
  ask: {
    requiresScreen: true,
    requiresTranscript: true,
    systemPrompt: "You are Sidecar. Answer the user's question directly, using the screen capture, the conversation and their own background as context. Lead with the answer; keep it brief."
  }
};

/**
 * Provider-agnostic entry point for every chat completion in the app.
 * Callers pass a mode, messages and optional images; provider selection, vision
 * capability gating and rate limiting all happen here (BUILD-PLAN 0 Contract).
 */
class LlmService {
  constructor() {
    this.modes = MODES;
    // Emits user-visible notices; IpcRouter wires this to WindowManager.send('status').
    this.onStatus = null;
    this._visionNoticed = new Set();
  }

  status(message) {
    if (typeof this.onStatus === 'function') this.onStatus(message);
  }

  /**
   * Does this model accept image input?
   * Manual override beats the cached provider metadata, which beats the id heuristic.
   */
  modelHasVision(providerId, modelId) {
    if (!modelId) return false;
    const settings = SettingsManager.get();
    const override = (settings.llm.visionOverrides || {})[modelId];
    if (typeof override === 'boolean') return override;

    const cached = SettingsManager.cachedModels(providerId);
    if (cached) {
      const record = cached.models.find((m) => m.id === modelId);
      if (record && typeof record.vision === 'boolean') return record.vision;
    }
    return guessVision(modelId);
  }

  /**
   * Decide which model handles a request and whether the images survive.
   * Never sends an image part to a model flagged text-only (BUILD-PLAN 0.3).
   */
  resolveTarget(eff, images) {
    const { provider, model, visionModel } = eff.llm;
    if (!images || images.length === 0) return { model, images: [] };

    if (this.modelHasVision(provider, model)) return { model, images };

    if (visionModel && this.modelHasVision(provider, visionModel)) {
      return { model: visionModel, images, routed: true };
    }

    return { model, images: [], dropped: true };
  }

  /** One notice per model, not one per keystroke. */
  noticeOnce(key, message) {
    if (this._visionNoticed.has(key)) return;
    this._visionNoticed.add(key);
    this.status(message);
  }

  resetNotices() {
    this._visionNoticed.clear();
  }

  /**
   * Stream a completion. Resolves when the stream ends; rejects on error or abort.
   *   mode      — key of MODES, supplies the system prompt
   *   messages  — [{ role: 'user' | 'assistant', content: string }]
   *   images    — array of data URLs, subject to vision gating
   *   signal    — AbortSignal, threaded into the provider SDK
   *   priority  — 'user' (default) or 'auto'; user work never queues behind auto work
   */
  async stream({ mode, messages, images = [], signal, priority = 'user', system }, onToken) {
    const modeConfig = this.modes[mode];
    if (!modeConfig && !system) throw new Error(`Unknown mode: ${mode}`);

    // `system` may be a string or an ordered list of { text, cacheable } blocks;
    // adapters decide what to do with the structure.
    const systemPrompt = system || modeConfig.systemPrompt;

    const eff = SettingsManager.effective();
    const providerId = eff.llm.provider;
    const adapter = Providers.get(providerId);

    if (!eff.llm.apiKey && providerId !== 'custom') {
      throw new Error(`Please provide your ${adapter.name} API key in Settings.`);
    }
    if (adapter.requiresBaseUrl && !eff.llm.baseUrl) {
      throw new Error(`${adapter.name} needs a base URL — set one in Settings.`);
    }

    const target = this.resolveTarget(eff, images);
    if (!target.model) {
      throw new Error(`No model configured for ${adapter.name}. Pick one in Settings.`);
    }

    if (target.routed) {
      this.noticeOnce(
        `routed:${eff.llm.model}`,
        `"${eff.llm.model}" has no vision support — screenshots go to "${target.model}" instead.`
      );
    } else if (target.dropped) {
      this.noticeOnce(
        `dropped:${target.model}`,
        `"${target.model}" is text-only, so the screenshot was dropped. Set a vision model in Settings to keep screen context.`
      );
    }

    let emitted = false;
    const emit = (token) => {
      emitted = true;
      onToken(token);
    };

    return RateLimiter.schedule(
      providerId,
      {
        priority,
        signal,
        // Retrying after tokens reached the UI would duplicate the answer.
        canRetry: () => !emitted,
        onRetry: ({ attempt, status }) => {
          this.status(`${adapter.name} returned ${status || 'an error'} — retry ${attempt} of 3.`);
        }
      },
      () => adapter.streamChat(
        {
          apiKey: eff.llm.apiKey,
          baseUrl: eff.llm.baseUrl,
          model: target.model,
          system: systemPrompt,
          messages,
          images: target.images,
          signal
        },
        emit
      )
    );
  }

  /**
   * Compose the chat messages for a mode.
   * Phase 1 replaces this with PromptBuilder; until then it reproduces the v1 prompt text.
   */
  buildMessages(mode, { transcript = [], userText = '' } = {}) {
    const modeConfig = this.modes[mode];
    let promptText = '';

    if (modeConfig.requiresTranscript && transcript.length > 0) {
      const turns = transcript
        .map((t) => `${t.sender === 'user' ? 'You' : 'Them'}: ${t.text}`)
        .join('\n');
      promptText += `Dialogue log:\n${turns}\n\n`;
    } else if (modeConfig.requiresTranscript) {
      promptText += 'Dialogue log is currently empty.\n\n';
    }

    if (mode === 'ask' && userText) {
      promptText += `User query: ${userText}`;
    } else {
      promptText += 'Provide instructions or suggestions based on this context.';
    }

    return [{ role: 'user', content: promptText }];
  }

  /** Fetch a provider's model list, cache it, and return it. */
  async listModels(providerId, { refresh = false } = {}) {
    const adapter = Providers.get(providerId);
    const settings = SettingsManager.get();
    const cached = SettingsManager.cachedModels(providerId);

    if (!refresh && cached && Date.now() - cached.fetchedAt < 6 * 60 * 60 * 1000) {
      return { models: cached.models, cached: true, fetchedAt: cached.fetchedAt };
    }

    const apiKey = settings.llm.apiKeys[providerId] || '';
    const models = await adapter.listModels(apiKey, { baseUrl: settings.llm.baseUrl });
    if (models.length > 0) {
      const entry = SettingsManager.cacheModels(providerId, models);
      return { models, cached: false, fetchedAt: entry.fetchedAt };
    }
    return { models: cached ? cached.models : [], cached: true, fetchedAt: cached ? cached.fetchedAt : 0 };
  }
}

module.exports = new LlmService();

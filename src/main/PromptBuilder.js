const LlmService = require('./LlmService');
const ContextStore = require('./ContextStore');
const SettingsManager = require('./SettingsManager');

const MAX_STORIES = 3;
const MAX_JD_CHARS = 4000;

// Marking a block cacheable below this size costs more than it saves.
const MIN_CACHEABLE_CHARS = 1500;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'with', 'that', 'this', 'have', 'has', 'had', 'was', 'were',
  'are', 'can', 'could', 'would', 'should', 'about', 'from', 'they', 'them', 'their', 'what', 'when',
  'where', 'which', 'how', 'why', 'who', 'tell', 'give', 'walk', 'through', 'time', 'into', 'over',
  'been', 'being', 'just', 'like', 'some', 'more', 'most', 'other', 'than', 'then', 'there', 'here'
]);

const INTERVIEW_TYPE_HINTS = {
  behavioural: 'This is a behavioural interview. Answer with a concrete STAR story from the profile whenever one fits.',
  technical: 'This is a technical interview. Lead with the approach, then the trade-offs, then complexity or failure modes.',
  'system-design': 'This is a system design interview. Start with requirements and constraints, then the component sketch, then bottlenecks and trade-offs.',
  general: ''
};

const LENGTH_HINTS = {
  brief: 'Answer in at most 2 short sentences or 3 bullets.',
  normal: 'Keep the answer to roughly 4 bullets or 3 sentences.',
  detailed: 'A fuller answer is welcome, but stay scannable — bullets over paragraphs.'
};

// Output shape. speak-points is the default for a reason: the user is talking while reading it.
const FORMAT_PRESETS = {
  'speak-points': 'Answer as 3-5 bullet points, most important first, each about 7 words — '
    + 'phrases the user can glance at and say out loud. No preamble, no closing line, no prose.',
  brief: 'Answer in at most two short sentences. No preamble.',
  detailed: 'Give a full answer, but keep it scannable: short paragraphs or bullets, no walls of text.',
  code: 'Give a short statement of the approach, then one clean code block, then time and space '
    + 'complexity. No preamble.'
};

const TONE_HINTS = {
  neutral: '',
  conversational: 'Write the way the user would speak it out loud: plain, warm, contractions welcome.',
  formal: 'Keep the register professional and precise.'
};

/**
 * Composes every prompt the app sends. Nothing downstream assembles prompts by hand
 * (BUILD-PLAN 1 Contract).
 *
 * Block order is deliberate: stable content first, so provider prompt caching can
 * reuse the profile and session blocks across a whole conversation, while the
 * transcript — which changes every turn — stays in the user message.
 */
class PromptBuilder {
  /**
   * @param {string} mode key of LlmService.modes
   * @param {{ transcript?: Array, userText?: string, images?: Array }} context
   * @returns {{ system: Array<{text:string, cacheable:boolean}>, messages: Array }}
   */
  build(mode, { transcript = [], transcriptSummary = '', userText = '', images = [], history = [], preset } = {}) {
    const modeConfig = LlmService.modes[mode];
    if (!modeConfig) throw new Error(`Unknown mode: ${mode}`);

    const profile = ContextStore.getProfile();
    const hasProfile = ContextStore.hasProfile();
    const session = ContextStore.getSession();

    const system = [{ text: this.modeBlock(modeConfig, hasProfile, session, mode, preset), cacheable: false }];

    if (hasProfile) {
      const text = this.profileBlock(profile);
      system.push({ text, cacheable: text.length >= MIN_CACHEABLE_CHARS });
    }

    const sessionText = this.sessionBlock(session);
    if (sessionText) {
      system.push({ text: sessionText, cacheable: sessionText.length >= MIN_CACHEABLE_CHARS });
    }

    const parts = [];

    const query = this.retrievalQuery(transcript, userText);
    const stories = hasProfile ? this.retrieveStories(profile, query) : [];
    if (stories.length > 0) parts.push(this.storiesBlock(stories));

    if (modeConfig.requiresTranscript) parts.push(this.transcriptBlock(transcript, transcriptSummary));

    parts.push(this.taskBlock(mode, userText, images));

    return {
      system,
      // Prior turns go ahead of the new one so follow-ups have something to refer to.
      messages: [...history, { role: 'user', content: parts.filter(Boolean).join('\n\n') }],
      meta: { hasProfile, storyCount: stories.length, storyTitles: stories.map((s) => s.title) }
    };
  }

  /** Which output shape applies: explicit override, then per-mode, then the global default. */
  presetFor(mode, override) {
    if (override && FORMAT_PRESETS[override]) return override;
    const answers = SettingsManager.get().answers || {};
    const perMode = (answers.modePresets || {})[mode];
    if (perMode && FORMAT_PRESETS[perMode]) return perMode;
    return FORMAT_PRESETS[answers.preset] ? answers.preset : 'speak-points';
  }

  modeBlock(modeConfig, hasProfile, session, mode, presetOverride) {
    const lines = [modeConfig.systemPrompt];
    lines.push(FORMAT_PRESETS[this.presetFor(mode, presetOverride)]);

    if (hasProfile) {
      lines.push(
        'You are speaking as the candidate described in the CANDIDATE PROFILE block. Use only '
        + 'experience, projects, employers, dates and numbers that appear there. If the profile does '
        + 'not cover something, say so plainly or answer in general terms — never invent a job, a '
        + 'project, a metric or a result.'
      );
    } else {
      lines.push(
        'No candidate profile is loaded, so answer generically and do not claim any personal '
        + 'experience on the user\'s behalf.'
      );
    }

    const typeHint = INTERVIEW_TYPE_HINTS[session.interviewType];
    if (typeHint) lines.push(typeHint);

    const lengthHint = LENGTH_HINTS[session.answerLength];
    if (lengthHint) lines.push(lengthHint);

    const toneHint = TONE_HINTS[session.tone];
    if (toneHint) lines.push(toneHint);

    if (session.answerLanguage && session.answerLanguage !== 'auto') {
      lines.push(`Write the answer in ${session.answerLanguage}, whatever language the conversation is in.`);
    }

    return lines.join('\n\n');
  }

  profileBlock(profile) {
    const lines = ['CANDIDATE PROFILE'];
    const identity = [profile.name, profile.headline, profile.location].filter(Boolean).join(' · ');
    if (identity) lines.push(identity);
    if (profile.yearsExperience) lines.push(`Years of experience: ${profile.yearsExperience}`);

    if (profile.skills.length) {
      lines.push('', 'Skills:');
      lines.push(profile.skills
        .map((s) => (s.years ? `${s.name} (${s.years}y)` : s.name))
        .join(', '));
    }

    if (profile.experience.length) {
      lines.push('', 'Experience:');
      for (const job of profile.experience) {
        const period = [job.start, job.end].filter(Boolean).join(' – ');
        lines.push(`- ${[job.title, job.company].filter(Boolean).join(' at ')}${period ? ` (${period})` : ''}`);
        for (const bullet of job.bullets.slice(0, 6)) lines.push(`    · ${bullet}`);
        for (const metric of job.metrics.slice(0, 4)) lines.push(`    · metric: ${metric}`);
      }
    }

    if (profile.projects.length) {
      lines.push('', 'Projects:');
      for (const p of profile.projects) {
        const stack = p.stack.length ? ` [${p.stack.join(', ')}]` : '';
        lines.push(`- ${p.name}${stack}: ${[p.summary, p.impact].filter(Boolean).join(' ')}`);
      }
    }

    if (profile.education.length) {
      lines.push('', 'Education:');
      for (const e of profile.education) {
        lines.push(`- ${[e.degree, e.field, e.school, e.end].filter(Boolean).join(', ')}`);
      }
    }

    return lines.join('\n');
  }

  sessionBlock(session) {
    const lines = [];
    if (session.role) lines.push(`Target role: ${session.role}`);
    if (session.company) lines.push(`Company: ${session.company}`);
    if (session.jdText) {
      lines.push('', 'Job description:', session.jdText.slice(0, MAX_JD_CHARS));
    }
    if (lines.length === 0) return '';
    return ['INTERVIEW CONTEXT', ...lines].join('\n');
  }

  /** What the retrieval scores against: the most recent thing the other side said, plus any typed query. */
  retrievalQuery(transcript, userText) {
    const lastFromThem = [...transcript].reverse().find((t) => t.sender !== 'user');
    return [userText, lastFromThem ? lastFromThem.text : ''].filter(Boolean).join(' ');
  }

  /**
   * Crude stemming by truncation. Exact token matching missed the most common case in
   * the whole feature — "tell me about a time you disagreed" never matched a story titled
   * "Disagreeing with a staff engineer". Truncating to a 6-character stem collapses
   * disagreed/disagreeing/disagreement onto one key. Occasional over-merging
   * (communicate/community) only nudges ranking, so the trade is worth it.
   */
  stem(word) {
    return word.length > 6 ? word.slice(0, 6) : word;
  }

  tokenise(text) {
    return (text || '')
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map((w) => this.stem(w));
  }

  /**
   * Story retrieval v1: keyword and tag overlap. No vector DB — revisit only if this
   * measurably underperforms (BUILD-PLAN 1.4).
   */
  retrieveStories(profile, query, limit = MAX_STORIES) {
    const stories = (profile && profile.stories) || [];
    if (stories.length === 0) return [];

    const queryTerms = new Set(this.tokenise(query));
    if (queryTerms.size === 0) return [];

    const scored = stories.map((story) => {
      const tagTerms = new Set(this.tokenise(story.tags.join(' ')));
      const titleTerms = new Set(this.tokenise(story.title));
      const bodyTerms = new Set(this.tokenise([story.situation, story.task, story.action, story.result].join(' ')));

      let score = 0;
      for (const term of queryTerms) {
        if (tagTerms.has(term)) score += 3;
        if (titleTerms.has(term)) score += 2;
        if (bodyTerms.has(term)) score += 1;
      }
      return { story, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.story);
  }

  storiesBlock(stories) {
    const lines = ['RELEVANT STORIES FROM THE PROFILE (use these before anything else)'];
    for (const s of stories) {
      lines.push('', `• ${s.title}${s.tags.length ? ` [${s.tags.join(', ')}]` : ''}`);
      if (s.situation) lines.push(`  Situation: ${s.situation}`);
      if (s.task) lines.push(`  Task: ${s.task}`);
      if (s.action) lines.push(`  Action: ${s.action}`);
      if (s.result) lines.push(`  Result: ${s.result}`);
    }
    return lines.join('\n');
  }

  /**
   * The windowed slice, prefixed by the running summary of everything that has
   * scrolled out of it. SessionManager owns the windowing; this only renders.
   */
  transcriptBlock(transcript, summary = '') {
    const lines = ['CONVERSATION'];
    if (summary) lines.push(`Earlier in this conversation: ${summary}`, '');

    if (!transcript || transcript.length === 0) {
      lines.push(summary ? '(no further turns yet)' : '(nothing transcribed yet)');
    } else {
      lines.push(...transcript.map((t) => `${t.sender === 'user' ? 'You' : 'Them'}: ${t.text}`));
    }
    return lines.join('\n');
  }

  taskBlock(mode, userText, images) {
    const lines = ['TASK'];
    if (mode === 'ask' && userText) lines.push(userText);
    else if (userText) lines.push(userText);
    else lines.push('Respond for the current moment in this conversation.');

    if (images && images.length > 0) {
      lines.push('A screenshot of the user\'s screen is attached.');
    }
    return lines.join('\n');
  }
}

module.exports = new PromptBuilder();

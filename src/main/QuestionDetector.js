/**
 * Decides whether the other side just asked something answerable.
 *
 * Runs on the `system` channel only — the user asking their own interviewer a question
 * must never trigger an auto-answer. Detection is advisory: it returns a confidence,
 * never a command (BUILD-PLAN 4 Contract).
 *
 * v1 is a heuristic. `setStrategy()` is the seam for a classifier; callers never change.
 */

const INTERROGATIVES = [
  'what', 'why', 'how', 'when', 'where', 'which', 'who', 'whom', 'whose'
];

// Auxiliary-verb inversion: "can you", "have you", "did they"...
const AUXILIARIES = [
  'can', 'could', 'would', 'will', 'shall', 'should', 'do', 'does', 'did',
  'is', 'are', 'was', 'were', 'have', 'has', 'had', 'may', 'might', 'am'
];

const SUBJECTS = ['you', 'your', 'we', 'they', 'i', 'he', 'she', 'it', 'there', 'that', 'this'];

// Imperative prompts that are questions in everything but punctuation.
const IMPERATIVE_PROMPTS = [
  'tell me about', 'walk me through', 'talk me through', 'describe', 'explain',
  'give me an example', 'give an example', 'share an example', 'take me through',
  'let\'s talk about', 'i\'d like to hear', 'i would like to hear', 'help me understand',
  'what would you do', 'how would you', 'suppose', 'imagine'
];

// Phrases that look interrogative but are conversational filler.
const FILLER = [
  'you know', 'right', 'okay', 'ok', 'sorry', 'what', 'huh', 'pardon',
  'can you hear me', 'are you there', 'can you see my screen', 'is that ok',
  'does that make sense', 'sound good', 'any questions'
];

const MIN_WORDS = 3;

class QuestionDetector {
  constructor() {
    this.strategy = null;
  }

  /** Replace the heuristic with a classifier without touching callers. */
  setStrategy(fn) {
    this.strategy = typeof fn === 'function' ? fn : null;
  }

  normalise(text) {
    return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * @param {string} text the turn to judge
   * @param {{ silenceMs?: number, isFinal?: boolean }} [context]
   * @returns {{ isQuestion: boolean, confidence: number, reasons: string[], trigger: string }}
   */
  detect(text, context = {}) {
    if (this.strategy) return this.strategy(text, context);

    const raw = (text || '').trim();
    const normalised = this.normalise(raw);
    const words = normalised.split(' ').filter(Boolean);
    const reasons = [];
    let score = 0;

    if (words.length < MIN_WORDS) {
      return { isQuestion: false, confidence: 0, reasons: ['too short'], trigger: raw };
    }

    // Filler that ends in a question mark is still filler.
    const stripped = normalised.replace(/[?.!,]+$/, '');
    if (FILLER.includes(stripped)) {
      return { isQuestion: false, confidence: 0, reasons: ['conversational filler'], trigger: raw };
    }

    if (raw.endsWith('?')) {
      score += 0.45;
      reasons.push('ends with a question mark');
    }

    if (INTERROGATIVES.includes(words[0])) {
      score += 0.4;
      reasons.push(`opens with "${words[0]}"`);
    } else if (AUXILIARIES.includes(words[0]) && SUBJECTS.includes(words[1])) {
      score += 0.38;
      reasons.push('auxiliary-verb inversion');
    }

    const imperative = IMPERATIVE_PROMPTS.find((p) => normalised.startsWith(p) || normalised.includes(` ${p}`));
    if (imperative) {
      score += 0.45;
      reasons.push(`imperative prompt "${imperative}"`);
    }

    // A mid-sentence interrogative ("...and what did you do then") still counts, weakly.
    if (score === 0 && words.some((w, i) => i > 0 && INTERROGATIVES.includes(w))) {
      score += 0.18;
      reasons.push('interrogative mid-sentence');
    }

    // Interview questions are rarely one clause; length is weak corroboration.
    if (words.length >= 6) {
      score += 0.1;
      reasons.push('substantial turn');
    }

    // Semantic endpointing: has the speaker actually finished, or just paused?
    // A trailing conjunction or filler means more is coming.
    const lastWord = words[words.length - 1].replace(/[?.!,]+$/, '');
    if (['and', 'but', 'so', 'or', 'because', 'like', 'um', 'uh', 'the', 'a', 'to', 'of'].includes(lastWord)) {
      score -= 0.35;
      reasons.push('trails off mid-thought');
    }

    if (context.isFinal === false) {
      score -= 0.25;
      reasons.push('interim transcript');
    }

    // Silence after the turn is the strongest signal that the ball is in our court.
    if (context.silenceMs >= 1200) {
      score += 0.2;
      reasons.push('speaker stopped');
    } else if (context.silenceMs !== undefined && context.silenceMs < 400) {
      score -= 0.1;
      reasons.push('still speaking');
    }

    const confidence = Math.max(0, Math.min(1, score));
    return {
      isQuestion: confidence > 0,
      confidence,
      reasons,
      trigger: raw
    };
  }
}

module.exports = new QuestionDetector();
module.exports.QuestionDetector = QuestionDetector;

const LlmService = require('./LlmService');
const ContextStore = require('./ContextStore');

// Distillation is one call; keep the input inside a sane window for small free models.
const MAX_INPUT_CHARS = 60000;

const SYSTEM_PROMPT = `You extract a structured candidate profile from résumés and career documents.

Return ONLY a JSON object. No prose, no markdown fences, no commentary.

Schema:
{
  "name": string,
  "headline": string,
  "location": string,
  "yearsExperience": number|null,
  "skills": [{ "name": string, "level": string, "years": number|null }],
  "experience": [{ "company": string, "title": string, "start": string, "end": string,
                   "bullets": [string], "metrics": [string] }],
  "projects": [{ "name": string, "summary": string, "stack": [string], "impact": string }],
  "education": [{ "school": string, "degree": string, "field": string, "start": string, "end": string }],
  "stories": [{ "title": string, "situation": string, "task": string, "action": string,
                "result": string, "tags": [string] }]
}

Rules:
- Use only facts present in the source text. Never invent employers, dates, metrics or results.
- Leave a field empty rather than guessing.
- "metrics" holds quantified outcomes exactly as written (e.g. "cut p99 latency 40%").
- "stories" is a STAR bank built from the strongest achievements. Write 4-8 where the source
  supports them, each one specific enough to answer a behavioural question. Tag each story with
  lowercase themes such as "leadership", "conflict", "failure", "scaling", "ownership", "debugging".
- Dates stay in the source's format.`;

/**
 * Turns ingested document text into the structured profile the prompts read from.
 * Model output is parsed defensively — malformed JSON degrades, it never crashes.
 */
class ProfileBuilder {
  /** Pull a JSON object out of a model response that may be fenced or padded with prose. */
  parseJson(raw) {
    if (!raw || typeof raw !== 'string') return null;

    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;

    const candidate = text.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {
      // Trailing commas are the most common model slip; one repair attempt, then give up.
      try {
        return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
      } catch (e2) {
        return null;
      }
    }
  }

  /**
   * @param {string} rawText concatenated document text
   * @param {(stage: string) => void} [onProgress]
   * @returns {Promise<object>} a normalised profile
   */
  async distill(rawText, onProgress) {
    const source = (rawText || '').trim();
    if (!source) throw new Error('Add a résumé or profile document first.');

    const truncated = source.length > MAX_INPUT_CHARS;
    const input = truncated ? source.slice(0, MAX_INPUT_CHARS) : source;
    if (truncated) {
      console.warn(
        `[ProfileBuilder] Source text truncated to ${MAX_INPUT_CHARS} characters for distillation.`
      );
    }

    if (onProgress) onProgress('Reading documents');

    let output = '';
    await LlmService.stream(
      {
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Source documents:\n\n${input}` }],
        priority: 'user'
      },
      (token) => {
        output += token;
        if (onProgress && output.length % 400 < 12) onProgress('Building profile');
      }
    );

    if (onProgress) onProgress('Parsing profile');
    const parsed = this.parseJson(output);
    if (!parsed) {
      throw new Error(
        'The model did not return usable JSON. Try a stronger model and run it again.'
      );
    }

    const profile = ContextStore.normaliseProfile(parsed);
    if (!profile.name && !profile.experience.length && !profile.skills.length) {
      throw new Error('Nothing usable came back. Check that the document contains readable text.');
    }
    return profile;
  }
}

module.exports = new ProfileBuilder();
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;

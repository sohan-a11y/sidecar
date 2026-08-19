const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Requiring the lib entry rather than the package root: pdf-parse's index.js runs a
// debug harness against a bundled sample PDF when it thinks it is the main module.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const mammoth = require('mammoth');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 50;
const MAX_TEXT_CHARS = 200000;

const SUPPORTED = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.text'];

const EMPTY_PROFILE = {
  name: '',
  headline: '',
  location: '',
  yearsExperience: null,
  skills: [],
  experience: [],
  projects: [],
  education: [],
  stories: []
};

const EMPTY_SESSION = {
  role: '',
  company: '',
  jdText: '',
  interviewType: 'general',
  answerLanguage: 'auto',
  answerLength: 'normal',
  tone: 'neutral'
};

/**
 * Durable user context: ingested documents, the distilled profile with its STAR story
 * bank, and the per-session interview setup. Persisted to sidecar-context.json.
 *
 * This file holds personal data but never API keys.
 */
class ContextStore {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'sidecar-context.json');
    this.data = null;
    this.onChange = null;
  }

  defaults() {
    return {
      schemaVersion: 1,
      documents: [],
      profile: null,
      profileUpdatedAt: 0,
      session: { ...EMPTY_SESSION }
    };
  }

  load() {
    if (this.data) return this.data;
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.data = { ...this.defaults(), ...parsed };
        this.data.session = { ...EMPTY_SESSION, ...(parsed.session || {}) };
        if (this.data.profile) this.data.profile = this.normaliseProfile(this.data.profile);
      } else {
        this.data = this.defaults();
      }
    } catch (e) {
      console.error('[ContextStore] Failed to load context:', e.message);
      this.data = this.defaults();
    }
    return this.data;
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.load(), null, 2), 'utf8');
    } catch (e) {
      console.error('[ContextStore] Failed to save context:', e.message);
    }
    if (typeof this.onChange === 'function') this.onChange(this.publicView());
  }

  // ---------------------------------------------------------------- documents

  static supports(filename) {
    return SUPPORTED.includes(path.extname(filename || '').toLowerCase());
  }

  /**
   * Extract text from a document the renderer read for us.
   * @param {string} filename original name, used for the extension and display
   * @param {Buffer} buffer raw file bytes
   */
  async ingest(filename, buffer) {
    if (!buffer || buffer.length === 0) throw new Error('That file is empty.');
    if (buffer.length > MAX_BYTES) {
      throw new Error(`"${filename}" is larger than the ${MAX_BYTES / 1024 / 1024} MB limit.`);
    }
    const ext = path.extname(filename).toLowerCase();
    if (!SUPPORTED.includes(ext)) {
      throw new Error(`Unsupported file type "${ext}". Use PDF, DOCX, TXT or MD.`);
    }

    const extracted = await this.extract(ext, buffer, filename);
    const text = extracted.text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) {
      throw new Error(`No readable text in "${filename}". Scanned PDFs need OCR first.`);
    }

    const doc = {
      id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      filename,
      kind: ext.replace('.', ''),
      bytes: buffer.length,
      pages: extracted.pages || null,
      truncated: text.length > MAX_TEXT_CHARS,
      ingestedAt: Date.now(),
      text: text.slice(0, MAX_TEXT_CHARS)
    };

    this.load().documents.push(doc);
    this.save();
    return doc;
  }

  async extract(ext, buffer, filename) {
    if (ext === '.pdf') {
      const parsed = await pdfParse(buffer, { max: MAX_PAGES });
      if (parsed.numpages > MAX_PAGES) {
        console.warn(`[ContextStore] "${filename}" has ${parsed.numpages} pages; read the first ${MAX_PAGES}.`);
      }
      return { text: parsed.text || '', pages: parsed.numpages || null };
    }
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value || '', pages: null };
    }
    return { text: buffer.toString('utf8'), pages: null };
  }

  removeDocument(id) {
    const data = this.load();
    data.documents = data.documents.filter((d) => d.id !== id);
    this.save();
    return data.documents;
  }

  /** Every ingested document, concatenated — the input to profile distillation. */
  rawText() {
    return this.load().documents
      .map((d) => `--- ${d.filename} ---\n${d.text}`)
      .join('\n\n');
  }

  // ------------------------------------------------------------------ profile

  /** Coerce anything into the documented profile shape. Never throws. */
  normaliseProfile(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const arr = (v) => (Array.isArray(v) ? v : []);
    const str = (v) => (typeof v === 'string' ? v.trim() : '');

    return {
      name: str(raw.name),
      headline: str(raw.headline),
      location: str(raw.location),
      yearsExperience: Number.isFinite(Number(raw.yearsExperience)) && raw.yearsExperience !== null
        ? Number(raw.yearsExperience)
        : null,
      skills: arr(raw.skills).map((s) => (typeof s === 'string'
        ? { name: s, level: '', years: null }
        : { name: str(s.name), level: str(s.level), years: s.years ?? null })).filter((s) => s.name),
      experience: arr(raw.experience).map((e) => ({
        company: str(e.company),
        title: str(e.title),
        start: str(e.start),
        end: str(e.end),
        bullets: arr(e.bullets).map(str).filter(Boolean),
        metrics: arr(e.metrics).map(str).filter(Boolean)
      })).filter((e) => e.company || e.title),
      projects: arr(raw.projects).map((p) => ({
        name: str(p.name),
        summary: str(p.summary),
        stack: arr(p.stack).map(str).filter(Boolean),
        impact: str(p.impact)
      })).filter((p) => p.name),
      education: arr(raw.education).map((e) => (typeof e === 'string' ? { school: e } : {
        school: str(e.school || e.institution),
        degree: str(e.degree),
        field: str(e.field),
        start: str(e.start),
        end: str(e.end)
      })).filter((e) => e.school || e.degree),
      stories: arr(raw.stories).map((s, i) => ({
        id: str(s.id) || `story_${Date.now()}_${i}`,
        title: str(s.title),
        situation: str(s.situation),
        task: str(s.task),
        action: str(s.action),
        result: str(s.result),
        tags: arr(s.tags).map(str).filter(Boolean)
      })).filter((s) => s.title || s.situation || s.action)
    };
  }

  setProfile(profile) {
    const data = this.load();
    data.profile = this.normaliseProfile(profile);
    data.profileUpdatedAt = Date.now();
    this.save();
    return data.profile;
  }

  getProfile() {
    return this.load().profile;
  }

  hasProfile() {
    const p = this.getProfile();
    if (!p) return false;
    return !!(p.name || p.headline || p.experience.length || p.skills.length || p.stories.length);
  }

  // -------------------------------------------------------------- story bank

  upsertStory(story) {
    const data = this.load();
    if (!data.profile) data.profile = this.normaliseProfile({});
    const normalised = this.normaliseProfile({ stories: [story] }).stories[0];
    if (!normalised) throw new Error('A story needs at least a title or a situation.');

    const existing = data.profile.stories.findIndex((s) => s.id === normalised.id);
    if (existing >= 0) data.profile.stories[existing] = normalised;
    else data.profile.stories.push(normalised);

    data.profileUpdatedAt = Date.now();
    this.save();
    return normalised;
  }

  deleteStory(id) {
    const data = this.load();
    if (!data.profile) return [];
    data.profile.stories = data.profile.stories.filter((s) => s.id !== id);
    this.save();
    return data.profile.stories;
  }

  // ---------------------------------------------------------- session context

  setSession(patch) {
    const data = this.load();
    data.session = { ...data.session, ...(patch || {}) };
    this.save();
    return data.session;
  }

  getSession() {
    return this.load().session;
  }

  /** Session context is per-interview; Phase 2 calls this on session end. */
  clearSession() {
    const data = this.load();
    data.session = { ...EMPTY_SESSION };
    this.save();
    return data.session;
  }

  clearAll() {
    this.data = this.defaults();
    this.save();
    return this.publicView();
  }

  /**
   * Renderer view. Document text is replaced by a preview — the renderer only needs
   * to show what was ingested, not carry 200k characters per document.
   */
  publicView() {
    const data = this.load();
    return {
      documents: data.documents.map((d) => ({
        id: d.id,
        filename: d.filename,
        kind: d.kind,
        bytes: d.bytes,
        pages: d.pages,
        truncated: d.truncated,
        ingestedAt: d.ingestedAt,
        chars: d.text.length,
        preview: d.text.slice(0, 240)
      })),
      profile: data.profile,
      profileUpdatedAt: data.profileUpdatedAt,
      hasProfile: this.hasProfile(),
      session: data.session
    };
  }
}

module.exports = new ContextStore();
module.exports.EMPTY_SESSION = EMPTY_SESSION;
module.exports.EMPTY_PROFILE = EMPTY_PROFILE;
module.exports.MAX_BYTES = MAX_BYTES;

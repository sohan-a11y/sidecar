import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let tmpDir;
let ContextStore;
let PromptBuilder;
let ProfileBuilder;

const MODULES = [
  '../src/main/ContextStore.js',
  '../src/main/PromptBuilder.js',
  '../src/main/ProfileBuilder.js',
  '../src/main/LlmService.js',
  '../src/main/SettingsManager.js',
  '../src/main/KeyStore.js'
];

function boot() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-ctx-'));
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => tmpDir },
      safeStorage: { isEncryptionAvailable: () => false }
    }
  };
  for (const mod of MODULES) delete require.cache[require.resolve(mod)];
  ContextStore = require('../src/main/ContextStore.js');
  PromptBuilder = require('../src/main/PromptBuilder.js');
  ProfileBuilder = require('../src/main/ProfileBuilder.js');
}

const SAMPLE_PROFILE = {
  name: 'Dana Rivers',
  headline: 'Backend engineer',
  yearsExperience: 7,
  skills: [{ name: 'Postgres', years: 5 }, 'Kafka'],
  experience: [
    {
      company: 'Acme',
      title: 'Senior Engineer',
      start: '2021',
      end: 'present',
      bullets: ['Rebuilt the ingestion pipeline'],
      metrics: ['cut p99 latency 40%']
    }
  ],
  projects: [{ name: 'Shipyard', summary: 'deploy tool', stack: ['Go'], impact: 'daily releases' }],
  education: [{ school: 'State University', degree: 'BSc', field: 'CS', end: '2018' }],
  stories: [
    {
      id: 's1',
      title: 'Owning the migration nobody wanted',
      situation: 'Legacy Postgres cluster was failing weekly',
      task: 'Move it without downtime',
      action: 'Built a dual-write shim and cut over per tenant',
      result: 'Zero downtime, incidents dropped to zero',
      tags: ['ownership', 'database', 'migration']
    },
    {
      id: 's2',
      title: 'Disagreeing with a staff engineer',
      situation: 'Design review deadlock',
      task: 'Reach a decision',
      action: 'Ran a spike and brought numbers',
      result: 'Team picked the simpler design',
      tags: ['conflict', 'communication']
    }
  ]
};

describe('ContextStore', () => {
  beforeEach(() => boot());
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      /* best effort */
    }
  });

  it('ingests plain text and markdown', async () => {
    const doc = await ContextStore.ingest('notes.md', Buffer.from('# Resume\n\nBackend engineer.'));
    expect(doc.kind).toBe('md');
    expect(doc.text).toContain('Backend engineer');
    expect(ContextStore.publicView().documents).toHaveLength(1);
  });

  it('extracts text from a real PDF', async () => {
    const fixture = require
      .resolve('pdf-parse/package.json')
      .replace('package.json', 'test/data/01-valid.pdf');
    if (!fs.existsSync(fixture)) {
      console.warn('[test] pdf-parse fixture missing; skipping PDF extraction check');
      return;
    }
    const doc = await ContextStore.ingest('paper.pdf', fs.readFileSync(fixture));
    expect(doc.kind).toBe('pdf');
    expect(doc.pages).toBeGreaterThan(0);
    expect(doc.text.length).toBeGreaterThan(200);
  });

  it('extracts text from a DOCX', async () => {
    let JSZip;
    try {
      JSZip = require('jszip');
    } catch (e) {
      console.warn('[test] jszip unavailable; skipping DOCX extraction check');
      return;
    }
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    );
    zip
      .folder('_rels')
      .file(
        '.rels',
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '</Relationships>'
      );
    zip
      .folder('word')
      .file(
        'document.xml',
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
          '<w:p><w:r><w:t>Senior Backend Engineer at Acme</w:t></w:r></w:p>' +
          '</w:body></w:document>'
      );

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const doc = await ContextStore.ingest('resume.docx', buffer);
    expect(doc.kind).toBe('docx');
    expect(doc.text).toContain('Senior Backend Engineer at Acme');
  });

  it('refuses unsupported types and oversized files', async () => {
    await expect(ContextStore.ingest('photo.png', Buffer.from('x'))).rejects.toThrow(/Unsupported/);
    const huge = Buffer.alloc(11 * 1024 * 1024, 0x41);
    await expect(ContextStore.ingest('big.txt', huge)).rejects.toThrow(/larger than/);
  });

  it('refuses a document with no readable text', async () => {
    await expect(ContextStore.ingest('empty.txt', Buffer.from('   \n  '))).rejects.toThrow(
      /No readable text/
    );
  });

  it('normalises a messy profile instead of throwing', () => {
    const profile = ContextStore.setProfile({
      name: '  Dana  ',
      yearsExperience: '7',
      skills: ['Go', { name: 'Rust', years: 2 }, { name: '' }],
      experience: [{ company: 'Acme' }, {}],
      stories: [{ title: 'A story', tags: ['x', ''] }],
      junk: 'ignored'
    });

    expect(profile.name).toBe('Dana');
    expect(profile.yearsExperience).toBe(7);
    expect(profile.skills.map((s) => s.name)).toEqual(['Go', 'Rust']);
    expect(profile.experience).toHaveLength(1);
    expect(profile.stories[0].tags).toEqual(['x']);
    expect(profile).not.toHaveProperty('junk');
  });

  it('keeps document text out of the renderer view', async () => {
    await ContextStore.ingest('resume.txt', Buffer.from('SECRET_SALARY_FIGURE '.repeat(60)));
    const view = ContextStore.publicView();
    expect(view.documents[0].chars).toBeGreaterThan(1000);
    expect(view.documents[0].preview.length).toBeLessThanOrEqual(240);
    expect(view.documents[0]).not.toHaveProperty('text');
  });

  it('round-trips stories through add, edit and delete', () => {
    ContextStore.setProfile(SAMPLE_PROFILE);
    ContextStore.upsertStory({ id: 's1', title: 'Renamed', situation: 'x', tags: ['ownership'] });
    expect(ContextStore.getProfile().stories.find((s) => s.id === 's1').title).toBe('Renamed');

    ContextStore.deleteStory('s2');
    expect(ContextStore.getProfile().stories.map((s) => s.id)).toEqual(['s1']);
  });

  it('clears session context without touching the profile', () => {
    ContextStore.setProfile(SAMPLE_PROFILE);
    ContextStore.setSession({ role: 'Staff Engineer', company: 'Acme' });
    ContextStore.clearSession();

    expect(ContextStore.getSession().role).toBe('');
    expect(ContextStore.hasProfile()).toBe(true);
  });
});

describe('PromptBuilder', () => {
  beforeEach(() => {
    boot();
    ContextStore.setProfile(SAMPLE_PROFILE);
  });
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      /* best effort */
    }
  });

  it('puts stable context in system blocks and the transcript in the user turn', () => {
    ContextStore.setSession({ role: 'Staff Engineer', company: 'Globex' });
    const built = PromptBuilder.build('assist', {
      transcript: [{ sender: 'system', text: 'Tell me about a migration you owned.' }],
      userText: ''
    });

    expect(built.system[0].text).toContain('Sidecar');
    expect(built.system[1].text).toContain('CANDIDATE PROFILE');
    expect(built.system[1].text).toContain('Dana Rivers');
    expect(built.system[2].text).toContain('Globex');

    const userTurn = built.messages[0].content;
    expect(userTurn).toContain('CONVERSATION');
    expect(userTurn).toContain('Tell me about a migration');
    // The transcript changes every turn — it must never sit in a cacheable block.
    expect(built.system.map((b) => b.text).join()).not.toContain('Tell me about a migration');
  });

  it('forbids inventing experience when a profile is loaded', () => {
    const built = PromptBuilder.build('reply', { transcript: [], userText: '' });
    expect(built.system[0].text).toMatch(/never invent/i);
  });

  it('says there is no profile when none is loaded', () => {
    ContextStore.clearAll();
    const built = PromptBuilder.build('reply', { transcript: [], userText: '' });
    expect(built.system[0].text).toMatch(/No candidate profile is loaded/i);
    expect(built.system).toHaveLength(1);
  });

  it('retrieves the story that matches the question', () => {
    const built = PromptBuilder.build('reply', {
      transcript: [
        { sender: 'system', text: 'Tell me about a time you disagreed with a colleague.' }
      ]
    });
    expect(built.meta.storyTitles).toEqual(['Disagreeing with a staff engineer']);
    expect(built.messages[0].content).toContain('RELEVANT STORIES');
  });

  it('ranks tag matches above body matches', () => {
    const stories = PromptBuilder.retrieveStories(
      ContextStore.getProfile(),
      'database migration ownership'
    );
    expect(stories[0].id).toBe('s1');
  });

  it('retrieves nothing when the question matches nothing', () => {
    const built = PromptBuilder.build('reply', {
      transcript: [{ sender: 'system', text: 'Nice weather today?' }]
    });
    expect(built.meta.storyCount).toBe(0);
    expect(built.messages[0].content).not.toContain('RELEVANT STORIES');
  });

  it('carries session answer preferences into the instructions', () => {
    ContextStore.setSession({
      interviewType: 'behavioural',
      answerLength: 'brief',
      tone: 'conversational',
      answerLanguage: 'English'
    });
    const text = PromptBuilder.build('reply', { transcript: [] }).system[0].text;
    expect(text).toContain('behavioural interview');
    expect(text).toContain('2 short sentences');
    expect(text).toContain('speak it out loud');
    expect(text).toContain('English');
  });

  it('marks a large profile block cacheable and a small session block not', () => {
    ContextStore.setSession({ role: 'X' });
    const bigProfile = {
      ...SAMPLE_PROFILE,
      experience: Array.from({ length: 20 }, (_, i) => ({
        company: `Company ${i}`,
        title: 'Engineer',
        bullets: ['Did a considerable amount of meaningful work on distributed systems'],
        metrics: []
      }))
    };
    ContextStore.setProfile(bigProfile);

    const built = PromptBuilder.build('assist', { transcript: [] });
    expect(built.system[1].cacheable).toBe(true);
    expect(built.system[2].cacheable).toBe(false);
  });
});

describe('ProfileBuilder JSON parsing', () => {
  beforeEach(() => boot());
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      /* best effort */
    }
  });

  it('reads a bare JSON object', () => {
    expect(ProfileBuilder.parseJson('{"name":"Dana"}')).toEqual({ name: 'Dana' });
  });

  it('reads JSON wrapped in a markdown fence', () => {
    const raw = 'Here you go:\n```json\n{"name":"Dana"}\n```\nHope that helps.';
    expect(ProfileBuilder.parseJson(raw)).toEqual({ name: 'Dana' });
  });

  it('repairs a trailing comma', () => {
    expect(ProfileBuilder.parseJson('{"skills":["Go",],}')).toEqual({ skills: ['Go'] });
  });

  it('returns null rather than throwing on unusable output', () => {
    expect(ProfileBuilder.parseJson('I cannot help with that.')).toBeNull();
    expect(ProfileBuilder.parseJson('')).toBeNull();
    expect(ProfileBuilder.parseJson(null)).toBeNull();
    expect(ProfileBuilder.parseJson('{"broken": [1, 2')).toBeNull();
  });

  it('refuses to distil with no documents', async () => {
    await expect(ProfileBuilder.distill('')).rejects.toThrow(/résumé|document/i);
  });
});

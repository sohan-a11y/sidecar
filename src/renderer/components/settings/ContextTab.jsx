import React, { useState, useRef } from 'react';
import StoryBank from './StoryBank';

const INTERVIEW_TYPES = [
  ['general', 'General'],
  ['behavioural', 'Behavioural'],
  ['technical', 'Technical'],
  ['system-design', 'System design']
];

const LENGTHS = [['brief', 'Brief'], ['normal', 'Normal'], ['detailed', 'Detailed']];
const TONES = [['neutral', 'Neutral'], ['conversational', 'Conversational'], ['formal', 'Formal']];
const ANSWER_LANGUAGES = [
  ['auto', 'Same as the question'], ['English', 'English'], ['Hindi', 'Hindi'],
  ['Telugu', 'Telugu'], ['Tamil', 'Tamil'], ['Spanish', 'Spanish'], ['French', 'French'],
  ['German', 'German'], ['Portuguese', 'Portuguese'], ['Japanese', 'Japanese']
];

const ACCEPT = '.pdf,.docx,.txt,.md,.markdown';

function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Documents in, profile out, plus the per-session interview setup.
 * The "no profile loaded" state is deliberately loud — the user must be able to tell
 * at a glance whether answers are personalised.
 */
export default function ContextTab({ sidecar, context, onContextChange, progressStage }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [showStories, setShowStories] = useState(false);
  const fileInput = useRef(null);

  if (!context) return <p className="setting-hint">Loading context…</p>;

  const { documents = [], profile, hasProfile, session } = context;

  const ingestFiles = async (files) => {
    setError('');
    for (const file of files) {
      setBusy(`Reading ${file.name}…`);
      try {
        const bytes = await readFileBytes(file);
        const res = await sidecar.context.ingest(file.name, bytes);
        if (!res.ok) setError(res.error);
      } catch (e) {
        setError(e.message);
      }
    }
    setBusy('');
    onContextChange(await sidecar.context.get());
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) await ingestFiles(files);
  };

  const handleDistill = async () => {
    setError('');
    setBusy('Building profile…');
    const res = await sidecar.context.distill();
    setBusy('');
    if (!res.ok) setError(res.error);
    onContextChange(await sidecar.context.get());
  };

  const removeDoc = async (id) => onContextChange(await sidecar.context.remove(id));
  const patchSession = async (patch) => onContextChange(await sidecar.context.setSession(patch));

  return (
    <>
      <div className="setting-group">
        <label className="setting-label">Your documents</label>

        <div
          className={`drop-zone ${dragging ? 'is-dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInput.current && fileInput.current.click()}
        >
          <span className="drop-zone-title">Drop your résumé here</span>
          <span className="drop-zone-sub">or click to choose — PDF, DOCX, TXT, MD · max 10 MB</span>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => ingestFiles(Array.from(e.target.files || []))}
          />
        </div>

        {documents.length > 0 && (
          <ul className="doc-list">
            {documents.map((d) => (
              <li key={d.id} className="doc-row">
                <span className="doc-name" title={d.preview}>{d.filename}</span>
                <span className="doc-meta">
                  {d.pages ? `${d.pages}p · ` : ''}{(d.chars / 1000).toFixed(1)}k chars
                  {d.truncated ? ' · truncated' : ''}
                </span>
                <button type="button" className="link-btn danger" onClick={() => removeDoc(d.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {(busy || progressStage) && <p className="setting-hint">{busy || `${progressStage}…`}</p>}
        {error && <p className="setting-warning">{error}</p>}
      </div>

      <div className="setting-group">
        <div className="model-picker-head">
          <label className="setting-label">Profile</label>
          <button
            type="button"
            className="link-btn"
            onClick={handleDistill}
            disabled={documents.length === 0 || !!busy}
          >
            {hasProfile ? 'Rebuild from documents' : 'Build profile'}
          </button>
        </div>

        {!hasProfile ? (
          <div className="profile-empty">
            <strong>No profile loaded.</strong> Answers will be generic and will not mention your
            experience. Add a résumé above, then build the profile.
          </div>
        ) : (
          <div className="profile-summary">
            <div className="profile-identity">
              <strong>{profile.name || 'Unnamed candidate'}</strong>
              {profile.headline ? <span> · {profile.headline}</span> : null}
            </div>
            <div className="profile-counts">
              <span>{profile.experience.length} roles</span>
              <span>{profile.skills.length} skills</span>
              <span>{profile.projects.length} projects</span>
              <span>{profile.stories.length} stories</span>
            </div>
            <button type="button" className="link-btn" onClick={() => setShowStories((v) => !v)}>
              {showStories ? 'Hide story bank' : 'Edit story bank'}
            </button>
          </div>
        )}
      </div>

      {showStories && hasProfile && (
        <StoryBank
          sidecar={sidecar}
          stories={profile.stories}
          onContextChange={onContextChange}
        />
      )}

      <div className="setting-group">
        <label className="setting-label">This session</label>

        <div className="input-field">
          <span className="field-prefix">Role</span>
          <input
            type="text"
            placeholder="Senior Backend Engineer"
            value={session.role}
            onChange={(e) => patchSession({ role: e.target.value })}
          />
        </div>

        <div className="input-field">
          <span className="field-prefix">Company</span>
          <input
            type="text"
            placeholder="Acme"
            value={session.company}
            onChange={(e) => patchSession({ company: e.target.value })}
          />
        </div>

        <textarea
          className="jd-textarea"
          rows="4"
          placeholder="Paste the job description here…"
          value={session.jdText}
          onChange={(e) => patchSession({ jdText: e.target.value })}
        />

        <div className="select-row">
          <label className="select-cell">
            <span>Interview</span>
            <select
              className="setting-select"
              value={session.interviewType}
              onChange={(e) => patchSession({ interviewType: e.target.value })}
            >
              {INTERVIEW_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label className="select-cell">
            <span>Length</span>
            <select
              className="setting-select"
              value={session.answerLength}
              onChange={(e) => patchSession({ answerLength: e.target.value })}
            >
              {LENGTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <div className="select-row">
          <label className="select-cell">
            <span>Tone</span>
            <select
              className="setting-select"
              value={session.tone}
              onChange={(e) => patchSession({ tone: e.target.value })}
            >
              {TONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label className="select-cell">
            <span>Answer in</span>
            <select
              className="setting-select"
              value={session.answerLanguage}
              onChange={(e) => patchSession({ answerLanguage: e.target.value })}
            >
              {ANSWER_LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <div className="context-actions">
          <button
            type="button"
            className="link-btn"
            onClick={async () => onContextChange(await sidecar.context.clear('session'))}
          >
            Clear session context
          </button>
          <button
            type="button"
            className="link-btn danger"
            onClick={async () => {
              if (window.confirm('Delete all documents, the profile and the story bank?')) {
                onContextChange(await sidecar.context.clear('all'));
              }
            }}
          >
            Delete all context data
          </button>
        </div>
      </div>
    </>
  );
}

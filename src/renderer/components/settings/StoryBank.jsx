import React, { useState } from 'react';

const BLANK = { id: '', title: '', situation: '', task: '', action: '', result: '', tags: [] };

const FIELDS = [
  ['situation', 'Situation'],
  ['task', 'Task'],
  ['action', 'Action'],
  ['result', 'Result']
];

/**
 * CRUD over the STAR story bank. Behavioural answers retrieve from here, so hand-editing
 * matters more than the résumé dump — the distilled version is a starting point, not gospel.
 */
export default function StoryBank({ sidecar, stories, onContextChange }) {
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const startNew = () => setEditing({ ...BLANK, id: `story_${Date.now()}` });

  const save = async () => {
    setError('');
    const res = await sidecar.context.saveStory(editing);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(null);
    onContextChange(res.view);
  };

  const remove = async (id) => {
    onContextChange(await sidecar.context.deleteStory(id));
    if (editing && editing.id === id) setEditing(null);
  };

  return (
    <div className="setting-group story-bank">
      <div className="model-picker-head">
        <label className="setting-label">Story bank</label>
        <button type="button" className="link-btn" onClick={startNew}>
          Add story
        </button>
      </div>

      {stories.length === 0 && !editing && (
        <p className="setting-hint">
          No stories yet. Behavioural answers fall back to the résumé bullets.
        </p>
      )}

      <ul className="story-list">
        {stories.map((s) => (
          <li key={s.id} className="story-row">
            <div className="story-main">
              <span className="story-title">{s.title || '(untitled)'}</span>
              {s.tags.length > 0 && (
                <span className="story-tags">{s.tags.map((t) => `#${t}`).join(' ')}</span>
              )}
            </div>
            <button type="button" className="link-btn" onClick={() => setEditing({ ...s })}>
              Edit
            </button>
            <button type="button" className="link-btn danger" onClick={() => remove(s.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      {editing && (
        <div className="story-editor">
          <div className="input-field">
            <span className="field-prefix">Title</span>
            <input
              type="text"
              placeholder="Shipped the migration nobody wanted to own"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
          </div>

          {FIELDS.map(([key, label]) => (
            <label key={key} className="story-field">
              <span>{label}</span>
              <textarea
                rows="2"
                value={editing[key]}
                onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
              />
            </label>
          ))}

          <div className="input-field">
            <span className="field-prefix">Tags</span>
            <input
              type="text"
              placeholder="leadership, conflict, scaling"
              value={editing.tags.join(', ')}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  tags: e.target.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                })
              }
            />
          </div>

          {error && <p className="setting-warning">{error}</p>}

          <div className="context-actions">
            <button type="button" className="link-btn" onClick={save}>
              Save story
            </button>
            <button type="button" className="link-btn danger" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

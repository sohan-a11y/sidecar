import React, { useState, useEffect } from 'react';

const RETENTIONS = [
  ['forever', 'Keep forever'],
  ['days', 'Keep for N days'],
  ['never', 'Never persist']
];

export default function SessionsTab({ sidecar, retention, onRetentionChange }) {
  const [sessions, setSessions] = useState([]);
  const [renaming, setRenaming] = useState(null);
  const [note, setNote] = useState('');

  const refresh = async () => setSessions(await sidecar.session.list());
  useEffect(() => {
    refresh();
  }, []);

  const exportSession = async (id, format) => {
    const res = await sidecar.session.export(id, format);
    if (res.ok) setNote(`Exported to ${res.path}`);
    else if (!res.cancelled) setNote(res.error || 'Export failed.');
  };

  return (
    <>
      <div className="setting-group">
        <label className="setting-label">Retention</label>
        <div className="provider-tabs">
          {RETENTIONS.map(([id, label]) => (
            <button
              key={id}
              className={`provider-tab-btn ${retention.retention === id ? 'active' : ''}`}
              onClick={() => onRetentionChange({ ...retention, retention: id })}
            >
              {label}
            </button>
          ))}
        </div>
        {retention.retention === 'days' && (
          <div className="input-field">
            <span className="field-prefix">Days</span>
            <input
              type="number"
              min="1"
              value={retention.retentionDays}
              onChange={(e) =>
                onRetentionChange({
                  ...retention,
                  retentionDays: Math.max(1, Number(e.target.value) || 1)
                })
              }
            />
          </div>
        )}
        <p className="setting-hint">
          Sessions are plain JSON in your user data folder. Nothing is uploaded anywhere.
        </p>
      </div>

      <div className="setting-group">
        <div className="model-picker-head">
          <label className="setting-label">Saved sessions</label>
          <button type="button" className="link-btn" onClick={refresh}>
            Refresh
          </button>
        </div>

        {sessions.length === 0 && <p className="setting-hint">No saved sessions yet.</p>}

        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id} className="session-row">
              <div className="session-main">
                {renaming === s.id ? (
                  <input
                    className="session-rename"
                    autoFocus
                    defaultValue={s.title}
                    onBlur={async (e) => {
                      setSessions(
                        await sidecar.session.rename(s.id, e.target.value.trim() || s.title)
                      );
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                  />
                ) : (
                  <span className="session-title" onDoubleClick={() => setRenaming(s.id)}>
                    {s.title}
                  </span>
                )}
                <span className="session-meta">
                  {new Date(s.startedAt).toLocaleString()} · {s.turnCount} turns · {s.answerCount}{' '}
                  answers
                  {s.endedAt ? '' : ' · in progress'}
                </span>
              </div>
              <div className="session-actions">
                <button type="button" className="link-btn" onClick={() => setRenaming(s.id)}>
                  Rename
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => exportSession(s.id, 'md')}
                >
                  MD
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => exportSession(s.id, 'txt')}
                >
                  TXT
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => exportSession(s.id, 'json')}
                >
                  JSON
                </button>
                <button
                  type="button"
                  className="link-btn danger"
                  onClick={async () => setSessions(await sidecar.session.remove(s.id))}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>

        {note && <p className="setting-hint">{note}</p>}

        <div className="context-actions">
          <button
            type="button"
            className="link-btn danger"
            onClick={async () => {
              if (window.confirm('Delete every saved session? This cannot be undone.')) {
                setSessions(await sidecar.session.removeAll());
              }
            }}
          >
            Delete all sessions
          </button>
        </div>
      </div>
    </>
  );
}

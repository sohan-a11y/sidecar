import React, { useState, useEffect } from 'react';

const DENSITIES = [['comfortable', 'Comfortable'], ['compact', 'Compact']];
const PLACEMENTS = [
  ['top-center', 'Top centre'], ['top-left', 'Top left'],
  ['top-right', 'Top right'], ['bottom-center', 'Bottom centre']
];

/** Capture target, region, and how the overlay presents itself. */
export default function CaptureTab({ sidecar, capture, overlay, onCaptureChange, onOverlayChange }) {
  const [sources, setSources] = useState([]);
  const [displays, setDisplays] = useState([]);
  const [shortcuts, setShortcuts] = useState({ actions: [], bindings: {}, conflicts: [] });
  const [capturing, setCapturing] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const [srcs, disp, keys] = await Promise.all([
      sidecar.capture.listSources(),
      sidecar.overlay.displays(),
      sidecar.shortcuts.list()
    ]);
    setSources(srcs);
    setDisplays(disp);
    setShortcuts(keys);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const pickRegion = async () => {
    onCaptureChange(await sidecar.capture.pickRegion());
  };

  /** Record the next chord the user presses, as an Electron accelerator. */
  const recordKey = (actionId) => (e) => {
    e.preventDefault();
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    const key = e.key;
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return;

    const named = { ' ': 'Space', Enter: 'Return', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down' };
    parts.push(named[key] || (key.length === 1 ? key.toUpperCase() : key));

    const accelerator = parts.join('+');
    setCapturing('');
    saveBindings({ ...shortcuts.bindings, [actionId]: accelerator });
  };

  const saveBindings = async (bindings) => {
    const result = await sidecar.shortcuts.set(bindings);
    setShortcuts((prev) => ({ ...prev, bindings: result.bindings, conflicts: result.conflicts }));
  };

  const conflictFor = (actionId) => shortcuts.conflicts.find((c) => c.action === actionId);

  return (
    <>
      <div className="setting-group">
        <div className="model-picker-head">
          <label className="setting-label">Capture source</label>
          <button type="button" className="link-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <div className="source-grid">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`source-card ${capture.sourceId === s.id || (!capture.sourceId && s.id === sources[0]?.id) ? 'active' : ''}`}
              onClick={() => onCaptureChange({ ...capture, sourceId: s.id })}
              title={s.name}
            >
              {s.thumbnail
                ? <img src={s.thumbnail} alt="" className="source-thumb" />
                : <div className="source-thumb source-thumb-empty" />}
              <span className="source-name">{s.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="setting-group">
        <label className="setting-label">Region</label>
        <p className="setting-hint">
          {capture.region
            ? `Cropped to ${Math.round(capture.region.width * 100)}% x ${Math.round(capture.region.height * 100)}% of the source.`
            : 'Capturing the whole source. Pick a region to send only the part that matters.'}
        </p>
        <div className="context-actions">
          <button type="button" className="link-btn" onClick={pickRegion}>Select region…</button>
          {capture.region && (
            <button
              type="button"
              className="link-btn danger"
              onClick={async () => onCaptureChange(await sidecar.capture.clearRegion())}
            >
              Clear region
            </button>
          )}
        </div>

        <div className="limit-row">
          <span className="limit-name">Send at most</span>
          <label className="limit-input">
            <span>px wide</span>
            <input
              type="number"
              min="480"
              step="160"
              value={capture.maxWidth}
              onChange={(e) => onCaptureChange({
                ...capture, maxWidth: Math.max(480, Number(e.target.value) || 1280)
              })}
            />
          </label>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={capture.skipUnchanged !== false}
            onChange={(e) => onCaptureChange({ ...capture, skipUnchanged: e.target.checked })}
          />
          <span>Skip the screenshot when the screen has not changed</span>
        </label>
      </div>

      <div className="setting-group">
        <label className="setting-label">Overlay</label>

        <div className="limit-row">
          <span className="limit-name">Opacity</span>
          <input
            type="range"
            min="0.25"
            max="1"
            step="0.05"
            className="slider"
            value={overlay.opacity}
            onChange={(e) => onOverlayChange({ ...overlay, opacity: Number(e.target.value) })}
          />
          <span className="limit-value">{Math.round(overlay.opacity * 100)}%</span>
        </div>

        <div className="limit-row">
          <span className="limit-name">Text size</span>
          <input
            type="range"
            min="0.85"
            max="1.4"
            step="0.05"
            className="slider"
            value={overlay.fontScale}
            onChange={(e) => onOverlayChange({ ...overlay, fontScale: Number(e.target.value) })}
          />
          <span className="limit-value">{Math.round(overlay.fontScale * 100)}%</span>
        </div>

        <div className="provider-tabs">
          {DENSITIES.map(([id, label]) => (
            <button
              key={id}
              className={`provider-tab-btn ${overlay.density === id ? 'active' : ''}`}
              onClick={() => onOverlayChange({ ...overlay, density: id })}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="setting-hint">Position and size are remembered across restarts.</p>
        <div className="select-row">
          {displays.map((d) => (
            <label className="select-cell" key={d.id}>
              <span>{d.label}{d.primary ? ' · primary' : ''}</span>
              <select
                className="setting-select"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) sidecar.overlay.placeOn(d.id, e.target.value);
                  e.target.value = '';
                }}
              >
                <option value="" disabled>move to…</option>
                {PLACEMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="setting-group">
        <label className="setting-label">Shortcuts</label>
        <p className="setting-hint">Click a shortcut, then press the combination you want.</p>
        {shortcuts.actions.map((action) => {
          const conflict = conflictFor(action.id);
          return (
            <div className="limit-row" key={action.id}>
              <span className="limit-name" title={action.description}>{action.label}</span>
              <button
                type="button"
                className={`shortcut-chip ${capturing === action.id ? 'recording' : ''} ${conflict ? 'conflict' : ''}`}
                onClick={() => setCapturing(action.id)}
                onKeyDown={capturing === action.id ? recordKey(action.id) : undefined}
                title={conflict ? conflict.reason : 'Click, then press a combination'}
              >
                {capturing === action.id ? 'press keys…' : (shortcuts.bindings[action.id] || 'unset')}
              </button>
            </div>
          );
        })}
        {shortcuts.conflicts.length > 0 && (
          <p className="setting-warning">
            {shortcuts.conflicts.map((c) => `${c.accelerator}: ${c.reason}`).join(' · ')}
          </p>
        )}
      </div>
    </>
  );
}

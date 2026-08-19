import React, { useId } from 'react';

/**
 * Free-text model field backed by a native datalist, so a 300-model router list stays
 * searchable without shipping a combobox library. Vision support is shown per model and
 * can be overridden by hand when the provider reports nothing useful.
 */
export default function ModelPicker({
  label,
  hint,
  value,
  models = [],
  loading = false,
  error = '',
  onChange,
  onRefresh,
  vision = null,
  visionOverride,
  onToggleVision,
  placeholder = 'model id'
}) {
  const listId = useId();
  const known = models.find((m) => m.id === value);
  const unknownModel = value && models.length > 0 && !known;

  return (
    <div className="model-picker">
      <div className="model-picker-head">
        <label className="setting-label">{label}</label>
        {onRefresh && (
          <button type="button" className="link-btn" onClick={onRefresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh list'}
          </button>
        )}
      </div>

      <div className="input-field">
        <input
          type="text"
          list={listId}
          spellCheck="false"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {vision !== null && (
          <span className={`capability-badge ${vision ? 'is-vision' : 'is-text'}`}>
            {vision ? 'vision' : 'text only'}
          </span>
        )}
      </div>

      <datalist id={listId}>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label !== m.id ? m.label : ''}
            {m.free ? ' · free' : ''}
            {m.vision ? ' · vision' : ''}
          </option>
        ))}
      </datalist>

      {onToggleVision && value && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={visionOverride === true}
            onChange={(e) => onToggleVision(e.target.checked ? true : undefined)}
          />
          <span>Force vision support for this model</span>
        </label>
      )}

      {unknownModel && (
        <p className="setting-warning">
          This model is not in the provider&apos;s current list. It may have been retired.
        </p>
      )}
      {error && <p className="setting-warning">{error}</p>}
      {hint && !error && <p className="setting-hint">{hint}</p>}
      {models.length > 0 && !error && (
        <p className="setting-hint">{models.length} models available</p>
      )}
    </div>
  );
}

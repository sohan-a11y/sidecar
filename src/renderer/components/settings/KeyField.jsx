import React from 'react';

/**
 * API key input. Main never sends key material to the renderer, so this field starts
 * empty even when a key is stored:
 *   left blank -> keep the stored key
 *   typed      -> replace it
 *   Clear      -> remove it (sends null)
 */
export default function KeyField({ label, placeholder, value, stored, onChange, onClear }) {
  return (
    <div className="key-field">
      <div className="input-field">
        <span className="field-prefix">{label}</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck="false"
          placeholder={stored ? '•••••••••• saved' : placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {stored && (
          <button type="button" className="link-btn danger" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Encrypts API keys at rest with Electron safeStorage (Keychain / DPAPI / libsecret).
 * Falls back to plaintext where the OS offers no backing store, and says so loudly —
 * see BUILD-PLAN 0.6. Never logs a key, sealed or otherwise.
 */
const PREFIX = 'enc.v1:';

class KeyStore {
  constructor() {
    this._warned = false;
  }

  _safeStorage() {
    try {
      // Required lazily: unavailable in unit tests and before app-ready.
      return require('electron').safeStorage;
    } catch (e) {
      return null;
    }
  }

  /** True when the OS can actually encrypt. */
  available() {
    const safeStorage = this._safeStorage();
    try {
      return !!safeStorage && safeStorage.isEncryptionAvailable();
    } catch (e) {
      return false;
    }
  }

  isSealed(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  /** Plaintext -> sealed string. Returns plaintext unchanged when encryption is unavailable. */
  seal(plain) {
    if (!plain) return '';
    if (this.isSealed(plain)) return plain;
    if (!this.available()) {
      if (!this._warned) {
        this._warned = true;
        console.warn('[KeyStore] OS encryption unavailable — API keys will be stored as plaintext.');
      }
      return plain;
    }
    try {
      return PREFIX + this._safeStorage().encryptString(plain).toString('base64');
    } catch (e) {
      console.error('[KeyStore] Encryption failed, storing plaintext:', e.message);
      return plain;
    }
  }

  /** Sealed string -> plaintext. Anything unsealed passes through (pre-0.6 files). */
  open(stored) {
    if (!stored) return '';
    if (!this.isSealed(stored)) return stored;
    if (!this.available()) {
      console.error('[KeyStore] Found an encrypted key but OS encryption is unavailable.');
      return '';
    }
    try {
      const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
      return this._safeStorage().decryptString(buf);
    } catch (e) {
      console.error('[KeyStore] Decryption failed — the key may have been written by another OS user.');
      return '';
    }
  }

  sealMap(map) {
    const out = {};
    for (const [k, v] of Object.entries(map || {})) out[k] = this.seal(v);
    return out;
  }

  openMap(map) {
    const out = {};
    for (const [k, v] of Object.entries(map || {})) out[k] = this.open(v);
    return out;
  }
}

module.exports = new KeyStore();

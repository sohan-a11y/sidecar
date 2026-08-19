const { globalShortcut, app } = require('electron');
const SettingsManager = require('./SettingsManager');

// Action id -> what it does and what it is called in the UI.
const ACTIONS = [
  { id: 'assist', label: 'Assist', description: 'Answer using the screen and conversation' },
  { id: 'code', label: 'Solve code on screen', description: 'Analyse the coding problem on screen' },
  { id: 'quickAssist', label: 'Start listening and assist', description: 'Turn capture on, then assist' },
  { id: 'toggleOverlay', label: 'Hide / show overlay', description: 'Hide the panel without ending the session' },
  { id: 'quit', label: 'Quit Sidecar', description: 'Close the app' }
];

/**
 * Global hotkeys, driven entirely by settings.
 * Every registration is checked: a shortcut another app already owns is reported rather
 * than silently doing nothing (BUILD-PLAN 6.2).
 */
class ShortcutsManager {
  constructor() {
    this.handlers = {};
    this.conflicts = [];
  }

  actions() {
    return ACTIONS.map((a) => ({ ...a }));
  }

  /**
   * @param {Record<string, Function>} handlers keyed by action id
   * @returns {Array<{action:string, accelerator:string, reason:string}>} conflicts
   */
  registerAll(handlers) {
    this.handlers = { ...this.handlers, ...handlers };
    return this.apply();
  }

  apply() {
    globalShortcut.unregisterAll();
    this.conflicts = [];

    const bindings = SettingsManager.get().shortcuts || {};
    const seen = new Map();

    for (const action of ACTIONS) {
      const accelerator = bindings[action.id];
      if (!accelerator) continue;

      // Two actions on one accelerator is a conflict we own, not the OS's fault.
      if (seen.has(accelerator)) {
        this.conflicts.push({
          action: action.id,
          accelerator,
          reason: `already bound to "${seen.get(accelerator)}"`
        });
        continue;
      }

      const handler = action.id === 'quit' ? () => app.quit() : this.handlers[action.id];
      if (!handler) continue;

      let registered = false;
      try {
        registered = globalShortcut.register(accelerator, handler);
      } catch (e) {
        registered = false;
      }

      if (registered) {
        seen.set(accelerator, action.label);
      } else {
        this.conflicts.push({
          action: action.id,
          accelerator,
          reason: 'another application already owns this shortcut'
        });
      }
    }

    return this.conflicts;
  }

  /** Is this accelerator free, ignoring whatever we already hold? */
  probe(accelerator) {
    if (!accelerator) return { ok: false, reason: 'empty' };
    const bindings = SettingsManager.get().shortcuts || {};
    const clash = Object.entries(bindings).find(([, value]) => value === accelerator);
    if (clash) return { ok: false, reason: `already used by "${clash[0]}"` };

    if (globalShortcut.isRegistered(accelerator)) {
      return { ok: false, reason: 'another application already owns this shortcut' };
    }
    return { ok: true };
  }

  getConflicts() {
    return this.conflicts;
  }

  unregisterAll() {
    globalShortcut.unregisterAll();
  }
}

module.exports = new ShortcutsManager();
module.exports.ACTIONS = ACTIONS;

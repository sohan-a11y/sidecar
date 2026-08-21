const { BrowserWindow, screen } = require('electron');
const path = require('path');
const os = require('os');
const settings = require('./SettingsManager');

const WINDOW_MODE = Object.freeze({
  PASSIVE: 'passive',
  INTERACTIVE: 'interactive'
});

class WindowManager {
  constructor() {
    this.window = null;
    this.regionWindow = null;
    this.regionPromise = null;
    this._resolveRegion = null;
    this._boundsTimer = null;
    this.currentMode = null;
  }

  applyContentProtection(targetWindow, label = 'window') {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return false;
    }

    const rawValue = String(process.env.SIDECAR_NO_PROTECT || '')
      .trim()
      .toLowerCase();

    const disabled = rawValue === '1' || rawValue === 'true';

    console.log(
      `[WindowManager] Content protection disabled for ${label}:`,
      disabled
    );

    if (disabled) {
      targetWindow.setContentProtection(false);
      return false;
    }

    try {
      // Opacity must already have been set by the caller.
      targetWindow.setContentProtection(true);

      let nativeResult = null;

      if (process.platform === 'win32') {
        const DisplayAdapter = require('../../DisplayAdapter');

        nativeResult = DisplayAdapter.protectWindow(targetWindow);

        const affinity = DisplayAdapter.checkWindowAffinity(targetWindow);

        console.log(
          `[WindowManager] ${label}:`,
          `native=${nativeResult}`,
          `affinity=${
            affinity === null
              ? 'unknown'
              : `0x${affinity.toString(16)}`
          }`
        );

        if (affinity !== 0x11) {
          console.error(
            `[WindowManager] Protection failed for ${label}. ` +
            `Expected affinity 0x11.`
          );

          return false;
        }
      }

      console.log(
        `[WindowManager] Protection active for ${label}.`
      );

      return true;
    } catch (error) {
      console.error(
        `[WindowManager] Failed to protect ${label}:`,
        error
      );

      return false;
    }
  }

  verifyContentProtection(targetWindow, label = 'window') {
    if (
      process.platform !== 'win32' ||
      !targetWindow ||
      targetWindow.isDestroyed()
    ) {
      return false;
    }

    try {
      const DisplayAdapter = require('../../DisplayAdapter');
      const affinity = DisplayAdapter.checkWindowAffinity(targetWindow);

      const expected = 0x11;
      const valid = affinity === expected;

      console.log(
        `[WindowManager] ${label} affinity verification:`,
        affinity === null
          ? 'unavailable'
          : `0x${affinity.toString(16)}`,
        valid ? 'PASS' : 'FAIL'
      );

      if (!valid) {
        console.error(
          `[WindowManager] ${label} is not excluded from capture. ` +
          `Expected 0x11, received ${
            affinity === null
              ? 'null'
              : `0x${affinity.toString(16)}`
          }.`
        );
      }

      return valid;
    } catch (error) {
      console.error(
        `[WindowManager] Could not verify ${label}:`,
        error.message
      );

      return false;
    }
  }

  createWindow() {
    const { workArea } = screen.getPrimaryDisplay();
    const overlay = settings.get().overlay || {};
    const bounds = this.validBounds(overlay.bounds);

    const width = bounds ? bounds.width : 720;
    const height = bounds ? bounds.height : 650;

    this.window = new BrowserWindow({
      width,
      height,
      x: bounds ? bounds.x : Math.round(workArea.x + (workArea.width - width) / 2),
      y: bounds ? bounds.y : workArea.y + 10,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: true,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
        webviewTag: true
      }
    });

    // Set visually required opacity state first
    this.window.setOpacity(1);

    // Apply content protection initially
    this.applyContentProtection(this.window, 'main overlay');

    const disableContentProtection = Boolean(
      process.env.SIDECAR_NO_PROTECT === '1' ||
      process.env.SIDECAR_NO_PROTECT === 'true'
    );

    if (process.platform === 'win32' && !disableContentProtection) {
      this._checkWindowsContentProtection();
    }

    if (process.platform === 'darwin') {
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      if (typeof this.window.setHiddenInMissionControl === 'function') {
        this.window.setHiddenInMissionControl(true);
      }
    }

    const development = process.env.NODE_ENV === 'development';

    if (development) {
      this.window.loadURL('http://localhost:5173');
    } else {
      this.window.loadFile(path.join(__dirname, '../../out/index.html'));
    }

    const debug = process.env.SIDECAR_DEBUG === '1';

    if (development || debug) {
      this.window.webContents.openDevTools({ mode: 'detach' });
    }

    this.applyOverlaySettings();
    this.trackBounds();
    this.registerWindowGuards();

    this.window.once('ready-to-show', () => {
      this.applyContentProtection(this.window, 'main overlay ready-to-show');
    });

    this.window.webContents.on('did-finish-load', () => {
      console.log('[WindowManager] Renderer finished loading');
      
      const { workArea } = screen.getPrimaryDisplay();
      this.window.setBounds({
        x: Math.round(workArea.x + (workArea.width - 720) / 2),
        y: workArea.y + 20,
        width: 720,
        height: 650
      });
      
      // applyPassiveMode sets opacity, shows the window,
      // and then applies content protection last.
      this.applyPassiveMode();

      // Delayed verification after the window has settled.
      setTimeout(() => {
        this.verifyContentProtection(
          this.window,
          'main overlay settled'
        );
      }, 1000);
    });

    this.window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
      console.error('[WindowManager] Page failed to load:', errorCode, errorDescription);
    });

    this.window.on('closed', () => {
      this.window = null;
      this.currentMode = null;
      if (this._boundsTimer) clearTimeout(this._boundsTimer);
    });

    return this.window;
  }

  registerWindowGuards() {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.setWindowOpenHandler(() => { return { action: 'deny' }; });
    this.window.webContents.on('will-navigate', (event, targetUrl) => {
      const currentUrl = this.window.webContents.getURL();
      if (currentUrl && targetUrl !== currentUrl) event.preventDefault();
    });
  }

  applyPassiveMode() {
    if (!this.window || this.window.isDestroyed()) {
      return false;
    }

    this.currentMode = WINDOW_MODE.PASSIVE;

    this.window.setIgnoreMouseEvents(true, { forward: true });
    this.window.setFocusable(false);
    this.window.setSkipTaskbar(true);
    this.window.setAlwaysOnTop(true, 'floating');

    // Set visual/window properties first.
    this.window.setOpacity(1);
    this.window.showInactive();

    // Apply protection last.
    this.applyContentProtection(
      this.window,
      'main overlay passive mode'
    );

    return true;
  }

  applyInteractiveMode() {
    if (!this.window || this.window.isDestroyed()) {
      return false;
    }

    this.currentMode = WINDOW_MODE.INTERACTIVE;

    this.window.setIgnoreMouseEvents(false);
    this.window.setFocusable(true);
    this.window.setSkipTaskbar(true);
    this.window.setAlwaysOnTop(true, 'floating');

    if (!this.window.isVisible()) {
      this.window.show();
    }

    // Apply protection after showing or changing styles.
    this.applyContentProtection(
      this.window,
      'main overlay interactive mode'
    );

    return true;
  }

  setMode(mode) {
    switch (mode) {
      case WINDOW_MODE.PASSIVE: return this.applyPassiveMode();
      case WINDOW_MODE.INTERACTIVE: return this.applyInteractiveMode();
      default: return false;
    }
  }

  getMode() { return this.currentMode; }

  setIgnoreMouseEvents(ignore) {
    if (!this.window || this.window.isDestroyed()) return false;
    if (ignore) return this.applyPassiveMode();
    return this.applyInteractiveMode();
  }

  _checkWindowsContentProtection() {
    try {
      const release = os.release();
      const parts = release.split('.');
      const build = parseInt(parts[2], 10) || 0;
      if (build < 19041) {
        const warning = 'Content protection is limited on this Windows version. Windows 10 version 2004 or later is recommended.';
        console.warn(`[WindowManager] ${warning}`);
        setTimeout(() => { this.send('status', { message: warning }); }, 3000);
      }
    } catch (error) {
      console.warn('[WindowManager] Could not determine Windows version:', error.message);
    }
  }

  validBounds(bounds) {
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return null;
    const intersectsDisplay = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return (bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y);
    });
    return intersectsDisplay ? bounds : null;
  }

  trackBounds() {
    const saveBounds = () => {
      if (this._boundsTimer) return;
      this._boundsTimer = setTimeout(() => {
        this._boundsTimer = null;
        if (!this.window || this.window.isDestroyed()) return;
        settings.set({ overlay: { bounds: this.window.getBounds() } });
      }, 800);
      if (this._boundsTimer.unref) this._boundsTimer.unref();
    };
    this.window.on('move', saveBounds);
    this.window.on('resize', saveBounds);
  }

  applyOverlaySettings() {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    const overlay = settings.get().overlay || {};

    const opacity = Math.min(
      1,
      Math.max(0.25, overlay.opacity || 1)
    );

    this.window.setOpacity(opacity);

    this.send('overlay:style', {
      fontScale: overlay.fontScale || 1,
      density: overlay.density || 'comfortable'
    });

    // setOpacity must happen before protection.
    this.applyContentProtection(
      this.window,
      'main overlay after visual settings'
    );
  }

  toggleVisibility() {
    if (!this.window || this.window.isDestroyed()) {
      return false;
    }

    const currentlyVisible = this.window.isVisible();

    if (currentlyVisible) {
      this.window.hide();
    } else {
      this.applyPassiveMode();
    }

    settings.set({
      overlay: {
        hidden: currentlyVisible
      }
    });

    return !currentlyVisible;
  }

  placeOn(displayId, position = 'top-center') {
    if (!this.window || this.window.isDestroyed()) return;
    const display = screen.getAllDisplays().find((item) => String(item.id) === String(displayId)) || screen.getPrimaryDisplay();
    const workArea = display.workArea;
    const { width, height } = this.window.getBounds();
    const positions = {
      'top-center': { x: workArea.x + Math.round((workArea.width - width) / 2), y: workArea.y + 10 },
      'top-left': { x: workArea.x + 10, y: workArea.y + 10 },
      'top-right': { x: workArea.x + workArea.width - width - 10, y: workArea.y + 10 },
      'bottom-center': { x: workArea.x + Math.round((workArea.width - width) / 2), y: workArea.y + workArea.height - height - 10 }
    };
    const target = positions[position] || positions['top-center'];
    this.window.setBounds({ ...target, width, height });
    settings.set({ overlay: { bounds: this.window.getBounds() } });
  }

  openRegionPicker() {
    if (this.regionWindow && !this.regionWindow.isDestroyed()) {
      this.regionWindow.focus();
      return this.regionPromise;
    }

    const { bounds } = screen.getPrimaryDisplay();

    this.regionWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true
      }
    });

    this.regionWindow.setAlwaysOnTop(true, 'screen-saver', 2);

    // Apply visual options first
    this.regionWindow.setOpacity(1);

    // Apply protection
    this.applyContentProtection(this.regionWindow, 'region picker');

    if (process.env.NODE_ENV === 'development') {
      this.regionWindow.loadURL('http://localhost:5173/region.html');
    } else {
      this.regionWindow.loadFile(path.join(__dirname, '../../out/region.html'));
    }

    this.regionPromise = new Promise((resolve) => { this._resolveRegion = resolve; });

    this.regionWindow.on('closed', () => {
      this.regionWindow = null;
      if (this._resolveRegion) {
        this._resolveRegion(null);
        this._resolveRegion = null;
      }
      this.applyPassiveMode();
    });

    return this.regionPromise;
  }

  resolveRegion(region) {
    if (this._resolveRegion) {
      this._resolveRegion(region);
      this._resolveRegion = null;
    }
    if (this.regionWindow && !this.regionWindow.isDestroyed()) {
      this.regionWindow.close();
    }
  }

  listDisplays() {
    const primaryDisplay = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((display, index) => ({
      id: String(display.id),
      label: `Display ${index + 1} (${display.size.width}x${display.size.height})`,
      primary: display.id === primaryDisplay.id
    }));
  }

  send(channel, payload) {
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  getWindow() { return this.window; }
}

const windowManager = new WindowManager();
windowManager.WINDOW_MODE = WINDOW_MODE;
module.exports = windowManager;

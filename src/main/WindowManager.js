const { BrowserWindow, screen } = require('electron');
const path = require('path');
const os = require('os');
const SettingsManager = require('./SettingsManager');

class WindowManager {
  constructor() {
    this.window = null;
  }

  createWindow() {
    const { workArea } = screen.getPrimaryDisplay();
    const overlay = SettingsManager.get().overlay || {};
    const saved = this.validBounds(overlay.bounds);

    const width = saved ? saved.width : 720;
    const height = saved ? saved.height : 650;

    this.window = new BrowserWindow({
      width: width,
      height: height,
      x: saved ? saved.x : Math.round(workArea.x + (workArea.width - width) / 2),
      y: saved ? saved.y : workArea.y + 10,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    // Best-effort content protection/invisibility from capture APIs
    const noProtect = !!process.env.SIDECAR_NO_PROTECT;
    this.window.setContentProtection(!noProtect);

    // Windows content-protection version check:
    // On Windows 10 v2004+ (build 19041+), Electron uses WDA_EXCLUDEFROMCAPTURE
    // which truly hides the window from capture. On older Windows, it falls back
    // to WDA_MONITOR which shows a black rectangle instead — weaker protection.
    if (process.platform === 'win32' && !noProtect) {
      this._checkWindowsContentProtection();
    }

    this.window.setAlwaysOnTop(true, 'screen-saver', 1);

    // macOS-specific workspace visibility features
    if (process.platform === 'darwin') {
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

      if (typeof this.window.setHiddenInMissionControl === 'function') {
        this.window.setHiddenInMissionControl(true);
      }
    }

    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      this.window.loadURL('http://localhost:5173');
    } else {
      this.window.loadFile(path.join(__dirname, '../../out/index.html'));
    }

    // Open DevTools automatically when SIDECAR_DEBUG=1 is set (works in production)
    const isDebug = process.env.SIDECAR_DEBUG === '1';
    if (isDev || isDebug) {
      this.window.webContents.openDevTools({ mode: 'detach' });
    }

    this.applyOverlaySettings();
    this.trackBounds();

    this.window.webContents.on('did-finish-load', () => {
      if (!SettingsManager.get().overlay.hidden) this.window.showInactive();
    });

    // Log load failures — critical for diagnosing white screen issues in production
    this.window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error(`[WindowManager] Page failed to load:`);
      console.error(`  Error code: ${errorCode}`);
      console.error(`  Description: ${errorDescription}`);
      console.error(`  URL: ${validatedURL}`);
    });

    // Forward renderer console.error messages to main process stdout
    this.window.webContents.on('console-message', (event, level, message, line, sourceId) => {
      // level: 0=verbose, 1=info, 2=warning, 3=error
      if (level >= 2) {
        const tag = level === 3 ? 'ERROR' : 'WARN';
        console.log(`[Renderer:${tag}] ${message} (${sourceId}:${line})`);
      }
    });

    this.window.webContents.on('render-process-gone', (event, details) => {
      console.error('[WindowManager] Renderer process crashed:', JSON.stringify(details));
    });

    return this.window;
  }

  /**
   * Check Windows version and warn if content protection may be limited.
   * Windows 10 v2004 = OS build 10.0.19041.
   * os.release() returns "10.0.19041" style strings on Windows.
   */
  _checkWindowsContentProtection() {
    try {
      const release = os.release(); // e.g. "10.0.19041"
      const parts = release.split('.');
      const buildNumber = parseInt(parts[2], 10) || 0;

      console.log(`[WindowManager] Windows detected — OS build: ${release} (build ${buildNumber})`);

      if (buildNumber < 19041) {
        const msg = 'Content protection is limited on this Windows version. '
          + 'For full screen-capture invisibility, Windows 10 version 2004 (build 19041) or later is required. '
          + 'On your current version, the overlay will appear as a black rectangle in screen captures rather than being fully hidden.';
        console.warn(`[WindowManager] ${msg}`);

        // Defer status message so the renderer has time to mount and listen
        setTimeout(() => {
          this.send('status', { message: msg });
        }, 3000);
      } else {
        console.log('[WindowManager] Windows build >= 19041 — full WDA_EXCLUDEFROMCAPTURE content protection active.');
      }
    } catch (e) {
      console.warn('[WindowManager] Could not determine Windows version for content-protection check:', e.message);
    }
  }

  /** Ignore a saved position that now falls outside every attached display. */
  validBounds(bounds) {
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return null;
    const fits = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return bounds.x < area.x + area.width
        && bounds.x + bounds.width > area.x
        && bounds.y < area.y + area.height
        && bounds.y + bounds.height > area.y;
    });
    return fits ? bounds : null;
  }

  /** Persist position and size, debounced — move events fire per pixel. */
  trackBounds() {
    const save = () => {
      if (this._boundsTimer) return;
      this._boundsTimer = setTimeout(() => {
        this._boundsTimer = null;
        if (!this.window || this.window.isDestroyed()) return;
        SettingsManager.set({ overlay: { bounds: this.window.getBounds() } });
      }, 800);
      if (this._boundsTimer.unref) this._boundsTimer.unref();
    };
    this.window.on('move', save);
    this.window.on('resize', save);
  }

  applyOverlaySettings() {
    if (!this.window || this.window.isDestroyed()) return;
    const overlay = SettingsManager.get().overlay || {};
    const opacity = Math.min(1, Math.max(0.25, overlay.opacity || 1));
    this.window.setOpacity(opacity);
    this.send('overlay:style', {
      fontScale: overlay.fontScale || 1,
      density: overlay.density || 'comfortable'
    });
  }

  /** Hide or show without touching capture or the session. */
  toggleVisibility() {
    if (!this.window || this.window.isDestroyed()) return false;
    const nowHidden = this.window.isVisible();
    if (nowHidden) this.window.hide();
    else this.window.showInactive();
    SettingsManager.set({ overlay: { hidden: nowHidden } });
    return !nowHidden;
  }

  /** Move the overlay to a named spot on a chosen display. */
  placeOn(displayId, position = 'top-center') {
    if (!this.window || this.window.isDestroyed()) return;
    const displays = screen.getAllDisplays();
    const display = displays.find((d) => String(d.id) === String(displayId)) || screen.getPrimaryDisplay();
    const area = display.workArea;
    const { width, height } = this.window.getBounds();

    const positions = {
      'top-center': { x: area.x + Math.round((area.width - width) / 2), y: area.y + 10 },
      'top-left': { x: area.x + 10, y: area.y + 10 },
      'top-right': { x: area.x + area.width - width - 10, y: area.y + 10 },
      'bottom-center': { x: area.x + Math.round((area.width - width) / 2), y: area.y + area.height - height - 10 }
    };
    const target = positions[position] || positions['top-center'];
    this.window.setBounds({ ...target, width, height });
    SettingsManager.set({ overlay: { bounds: this.window.getBounds() } });
  }

  /**
   * Open the transparent full-screen layer for picking a capture region.
   * Resolves with fractions of the screen, or null if cancelled.
   */
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
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    this.regionWindow.setAlwaysOnTop(true, 'screen-saver', 2);

    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) this.regionWindow.loadURL('http://localhost:5173/region.html');
    else this.regionWindow.loadFile(path.join(__dirname, '../../out/region.html'));

    this.regionPromise = new Promise((resolve) => { this._resolveRegion = resolve; });
    this.regionWindow.on('closed', () => {
      this.regionWindow = null;
      if (this._resolveRegion) {
        this._resolveRegion(null);
        this._resolveRegion = null;
      }
    });
    return this.regionPromise;
  }

  resolveRegion(region) {
    if (this._resolveRegion) {
      this._resolveRegion(region);
      this._resolveRegion = null;
    }
    if (this.regionWindow && !this.regionWindow.isDestroyed()) this.regionWindow.close();
  }

  listDisplays() {
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      label: `Display ${i + 1} (${d.size.width}x${d.size.height})`,
      primary: d.id === screen.getPrimaryDisplay().id
    }));
  }

  setIgnoreMouseEvents(ignore) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.setIgnoreMouseEvents(ignore, { forward: true });
    }
  }

  send(channel, data) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }

  getWindow() {
    return this.window;
  }
}

module.exports = new WindowManager();

const path = require('path');

let nativeModule = null;
const loadErrors = [];

const buildPaths = [
  path.join(__dirname, 'build', 'Release', 'display_affinity.node'),
  path.join(__dirname, 'build', 'Debug', 'display_affinity.node'),
  path.join(__dirname, '../build/Release/display_affinity.node'),
  path.join(__dirname, '../build/Debug/display_affinity.node'),
  path.join(__dirname, '../../build/Release/display_affinity.node'),
  path.join(__dirname, '../../build/Debug/display_affinity.node')
];

for (const buildPath of buildPaths) {
  try {
    nativeModule = require(buildPath);
    console.log(`[DisplayAdapter] Native module loaded from ${buildPath}`);
    break;
  } catch (error) {
    loadErrors.push(`${buildPath}: ${error.message}`);
  }
}

if (!nativeModule) {
  console.error(
    '[DisplayAdapter] Could not load native module:\n' +
    loadErrors.join('\n')
  );
}

/**
 * Excludes a window from composition capture (DLP protection) at the Win32 HWND level.
 * @param {import('electron').BrowserWindow} browserWindow - The Electron BrowserWindow instance.
 * @returns {boolean} - True if successfully enforced, false otherwise.
 */
function protectWindow(browserWindow) {
  if (process.platform !== 'win32') {
    console.warn('[DisplayAdapter] Display affinity protection is only supported on Windows.');
    return false;
  }

  if (!browserWindow || browserWindow.isDestroyed()) {
    console.error('[DisplayAdapter] Invalid or destroyed window reference.');
    return false;
  }

  if (!nativeModule) {
    console.error('[DisplayAdapter] Native display_affinity module is not loaded.');
    return false;
  }

  try {
    const handle = browserWindow.getNativeWindowHandle();
    if (!handle || handle.length === 0) {
      console.error('[DisplayAdapter] Native window handle could not be retrieved.');
      return false;
    }

    const success = nativeModule.EnforceDisplayAffinity(handle);
    if (success) {
      console.log('[DisplayAdapter] Windows Display Affinity exclusion (WDA_EXCLUDEFROMCAPTURE) successfully enforced.');
      return true;
    } else {
      console.error('[DisplayAdapter] SetWindowDisplayAffinity returned a failure code.');
      return false;
    }
  } catch (err) {
    console.error('[DisplayAdapter] Failed to enforce display affinity:', err.message);
    return false;
  }
}

/**
 * Reads back the Display Affinity value of a window from composition capture (DLP protection) at the Win32 HWND level.
 * @param {import('electron').BrowserWindow} browserWindow - The Electron BrowserWindow instance.
 * @returns {number|null} - The affinity value (e.g. 0x11 for WDA_EXCLUDEFROMCAPTURE), or null if failed.
 */
function checkWindowAffinity(browserWindow) {
  if (process.platform !== 'win32') {
    return null;
  }

  if (!browserWindow || browserWindow.isDestroyed()) {
    return null;
  }

  if (!nativeModule) {
    return null;
  }

  try {
    const handle = browserWindow.getNativeWindowHandle();
    if (!handle || handle.length === 0) {
      return null;
    }

    const value = nativeModule.GetWindowDisplayAffinity(handle);
    return value;
  } catch (err) {
    console.error('[DisplayAdapter] Failed to query display affinity:', err.message);
    return null;
  }
}

module.exports = {
  protectWindow,
  checkWindowAffinity
};

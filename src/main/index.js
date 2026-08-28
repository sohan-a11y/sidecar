const { app, session, desktopCapturer } = require("electron");
const WindowManager = require("./WindowManager");
const ShortcutsManager = require("./ShortcutsManager");
const IpcRouter = require("./IpcRouter");
const settings = require("./SettingsManager");

if (process.platform === "darwin" && app.dock) {
  app.dock.hide();
}

console.log(`[App] Sidecar starting on platform: ${process.platform} (${process.arch})`);

const ALLOWED_MEDIA_PERMISSIONS = new Set([
  "media",
  "microphone",
  "audioCapture",
  "videoCapture",
  "camera",
  "display-capture"
]);

function configureBrowserMediaSession() {
  const browserSession = session.fromPartition(
    "persist:browser-session"
  );

  browserSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const allowed = ALLOWED_MEDIA_PERMISSIONS.has(permission);

      console.log(
        "[BrowserMedia] Permission request:",
        {
          permission,
          allowed,
          url: webContents.getURL()
        }
      );

      callback(allowed);
    }
  );

  browserSession.setPermissionCheckHandler(
    (webContents, permission) => {
      return ALLOWED_MEDIA_PERMISSIONS.has(permission);
    }
  );

  browserSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      if (sources.length > 0) {
        callback({ video: sources[0], audio: "loopback" });
      } else {
        callback();
      }
    }).catch((err) => {
      console.error("[BrowserMedia] Display media request failed:", err);
      callback();
    });
  }, { useSystemPicker: false });
}

app.whenReady().then(() => {
  IpcRouter.initialize();

  const allowedPermissions = ["media", "microphone", "audioCapture", "display-capture"];
  const checkPermission = (perm) => allowedPermissions.includes(perm);

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(checkPermission(permission));
  });
  
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return checkPermission(permission);
  });

  configureBrowserMediaSession();

  const devCsp = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self' http://localhost:5173 http://localhost:* ws://localhost:*;";
  const prodCsp = "default-src 'self' file:; style-src 'self' 'unsafe-inline' file:; script-src 'self' file:; img-src 'self' data: file:; connect-src 'self';";
  const csp = process.env.NODE_ENV === "development" ? devCsp : prodCsp;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp]
      }
    });
  });

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      if (sources.length > 0) {
        console.log(`[App] Display media source selected: "${sources[0].name}" — audio: loopback`);
        callback({ video: sources[0], audio: "loopback" });
      } else {
        console.warn("[App] No display capture sources found.");
        callback();
      }
    }).catch((err) => {
      console.error("[App] Display media request failed:", err);
      callback();
    });
  }, { useSystemPicker: false });

  settings.set({ overlay: { hidden: false, bounds: null, opacity: 1 } });
  
  WindowManager.createWindow();

  const conflicts = ShortcutsManager.registerAll({
    assist: () => IpcRouter.executeMode("assist", ""),
    code: () => IpcRouter.executeMode("code", ""),
    quickAssist: () => IpcRouter.ensureListeningAndAssist(),
    toggleOverlay: () => WindowManager.toggleVisibility()
  });

  if (conflicts && conflicts.length > 0) {
    console.warn("[App] Shortcut conflicts:", conflicts.map(e => `${e.accelerator} (${e.reason})`).join(", "));
  }

  app.on("activate", () => {
    if (!WindowManager.getWindow()) {
      WindowManager.createWindow();
    }
  });
});

app.on("will-quit", () => {
  ShortcutsManager.unregisterAll();
  IpcRouter.shutdown();
});

app.on("window-all-closed", () => {
  app.quit();
});

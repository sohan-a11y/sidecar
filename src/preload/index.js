const { contextBridge, ipcRenderer } = require('electron');

// A channel the renderer is not listed here for cannot be subscribed to. Keep in sync
// with every WindowManager.send() call site.
const ALLOWED_EVENTS = [
  'llm:start',
  'llm:token',
  'llm:done',
  'llm:error',
  'status',
  'transcript',
  'capture:state',
  'usage',
  'settings:changed',
  'context:changed',
  'context:progress',
  'session:state',
  'auto-answer:fired',
  'llm:queue',
  'llm:replace-last',
  'thread:cleared',
  'overlay:style'
];

contextBridge.exposeInMainWorld('sidecar', {
  getSettings: () => ipcRenderer.invoke('sidecar:settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('sidecar:settings:set', patch),
  listModels: (providerId, options) =>
    ipcRenderer.invoke('sidecar:models:list', { providerId, ...(options || {}) }),
  getUsage: () => ipcRenderer.invoke('sidecar:usage:get'),

  context: {
    get: () => ipcRenderer.invoke('sidecar:context:get'),
    ingest: (name, bytes) => ipcRenderer.invoke('sidecar:context:ingest', { name, bytes }),
    remove: (id) => ipcRenderer.invoke('sidecar:context:remove', id),
    distill: () => ipcRenderer.invoke('sidecar:context:distill'),
    setProfile: (profile) => ipcRenderer.invoke('sidecar:context:profile:set', profile),
    saveStory: (story) => ipcRenderer.invoke('sidecar:context:story:save', story),
    deleteStory: (id) => ipcRenderer.invoke('sidecar:context:story:delete', id),
    setSession: (patch) => ipcRenderer.invoke('sidecar:context:session:set', patch),
    clear: (scope) => ipcRenderer.invoke('sidecar:context:clear', scope)
  },
  session: {
    state: () => ipcRenderer.invoke('sidecar:session:state'),
    transcript: () => ipcRenderer.invoke('sidecar:session:transcript'),
    start: (title) => ipcRenderer.invoke('sidecar:session:start', title),
    end: () => ipcRenderer.invoke('sidecar:session:end'),
    list: () => ipcRenderer.invoke('sidecar:session:list'),
    open: (id) => ipcRenderer.invoke('sidecar:session:open', id),
    rename: (id, title) => ipcRenderer.invoke('sidecar:session:rename', { id, title }),
    remove: (id) => ipcRenderer.invoke('sidecar:session:remove', id),
    removeAll: () => ipcRenderer.invoke('sidecar:session:remove-all'),
    export: (id, format) => ipcRenderer.invoke('sidecar:session:export', { id, format })
  },
  runMode: (payload) => ipcRenderer.send('sidecar:run-mode', payload),
  cancelAnswer: () => ipcRenderer.send('sidecar:llm:cancel'),
  regenerate: (preset) => ipcRenderer.send('sidecar:llm:regenerate', { preset }),
  newThread: () => ipcRenderer.send('sidecar:thread:new'),

  capture: {
    listSources: () => ipcRenderer.invoke('sidecar:capture:sources'),
    pickRegion: () => ipcRenderer.invoke('sidecar:capture:pick-region'),
    clearRegion: () => ipcRenderer.invoke('sidecar:capture:clear-region')
  },
  overlay: {
    apply: (patch) => ipcRenderer.invoke('sidecar:overlay:apply', patch),
    displays: () => ipcRenderer.invoke('sidecar:overlay:displays'),
    placeOn: (displayId, position) => ipcRenderer.invoke('sidecar:overlay:place', { displayId, position }),
    toggle: () => ipcRenderer.invoke('sidecar:overlay:toggle')
  },
  shortcuts: {
    list: () => ipcRenderer.invoke('sidecar:shortcuts:list'),
    set: (bindings) => ipcRenderer.invoke('sidecar:shortcuts:set', bindings),
    probe: (accelerator) => ipcRenderer.invoke('sidecar:shortcuts:probe', accelerator)
  },

  // Region picker window only.
  regionSelected: (region) => ipcRenderer.send('sidecar:capture:region-selected', region),
  regionCancel: () => ipcRenderer.send('sidecar:capture:region-cancel'),
  toggleListening: () => ipcRenderer.invoke('sidecar:toggle-listening'),
  sendAudioChunk: (source, arrayBuffer) => ipcRenderer.send('sidecar:audio-chunk', { source, arrayBuffer }),
  sendVadState: (source, state) => ipcRenderer.send('sidecar:vad', { source, state }),
  listSttEngines: () => ipcRenderer.invoke('sidecar:stt:engines'),
  autoAnswer: {
    get: () => ipcRenderer.invoke('sidecar:auto-answer:get'),
    toggle: (enabled) => ipcRenderer.invoke('sidecar:auto-answer:toggle', enabled)
  },
  setMouseIgnore: (ignore) => ipcRenderer.send('sidecar:mouse-ignore', ignore),
  openUrl: (url) => ipcRenderer.send('sidecar:open-url', url),
  log: (msg) => ipcRenderer.send('sidecar:log', msg),
  on: (channel, callback) => {
    if (ALLOWED_EVENTS.includes(channel)) {
      ipcRenderer.on(channel, (_event, data) => callback(data));
    }
  }
});

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
  'context:progress'
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
  runMode: (payload) => ipcRenderer.send('sidecar:run-mode', payload),
  toggleListening: () => ipcRenderer.invoke('sidecar:toggle-listening'),
  sendAudioChunk: (source, arrayBuffer) => ipcRenderer.send('sidecar:audio-chunk', { source, arrayBuffer }),
  setMouseIgnore: (ignore) => ipcRenderer.send('sidecar:mouse-ignore', ignore),
  openUrl: (url) => ipcRenderer.send('sidecar:open-url', url),
  log: (msg) => ipcRenderer.send('sidecar:log', msg),
  on: (channel, callback) => {
    if (ALLOWED_EVENTS.includes(channel)) {
      ipcRenderer.on(channel, (_event, data) => callback(data));
    }
  }
});

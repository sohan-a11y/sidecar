const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sidecar', {
  getSettings: () => ipcRenderer.invoke('sidecar:settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('sidecar:settings:set', patch),
  runMode: (payload) => ipcRenderer.send('sidecar:run-mode', payload),
  toggleListening: () => ipcRenderer.invoke('sidecar:toggle-listening'),
  sendAudioChunk: (source, arrayBuffer) => ipcRenderer.send('sidecar:audio-chunk', { source, arrayBuffer }),
  setMouseIgnore: (ignore) => ipcRenderer.send('sidecar:mouse-ignore', ignore),
  openUrl: (url) => ipcRenderer.send('sidecar:open-url', url),
  log: (msg) => ipcRenderer.send('sidecar:log', msg),
  on: (channel, callback) => {
    const allowed = ['llm:start', 'llm:token', 'llm:done', 'llm:error', 'status', 'transcript', 'capture:state'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_event, data) => callback(data));
    }
  }
});

const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('storyforgeClient', Object.freeze({
  http: Object.freeze({
    open: options => ipcRenderer.invoke('client-http:open', options),
    read: options => ipcRenderer.invoke('client-http:read', options),
    cancel: options => ipcRenderer.invoke('client-http:cancel', options),
  }),
  getState: () => ipcRenderer.invoke('client-update:state'),
  check: () => ipcRenderer.invoke('client-update:check'),
  download: () => ipcRenderer.invoke('client-update:download'),
  install: () => ipcRenderer.invoke('client-update:install'),
  diagnostics: () => ipcRenderer.invoke('client-diagnostics:read'),
  telemetryAllowed: () => ipcRenderer.invoke('client-diagnostics:allowed'),
  subscribe: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('client-update:changed', listener)
    return () => ipcRenderer.removeListener('client-update:changed', listener)
  },
}))

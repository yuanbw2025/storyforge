const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('storyforgeClient', Object.freeze({
  getState: () => ipcRenderer.invoke('client-update:state'),
  check: () => ipcRenderer.invoke('client-update:check'),
  download: () => ipcRenderer.invoke('client-update:download'),
  install: () => ipcRenderer.invoke('client-update:install'),
  diagnostics: () => ipcRenderer.invoke('client-diagnostics:read'),
  diagnosticContext: (/** @type {unknown} */ value) => ipcRenderer.invoke('client-diagnostics:context', value),
  telemetryAllowed: () => ipcRenderer.invoke('client-diagnostics:allowed'),
  subscribe: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('client-update:changed', listener)
    return () => ipcRenderer.removeListener('client-update:changed', listener)
  },
}))

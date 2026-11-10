export interface ClientUpdateState {
  platform: 'windows' | 'macos' | 'android'
  currentVersion: string
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  progress?: number
  error?: string
}
export interface ClientBridge {
  diagnosticContext?(value: { enabled: boolean; trail: import('../diagnostics/diagnostic-context').DiagnosticStep[] }): Promise<void>
  diagnostics?(): Promise<unknown[]>
  telemetryAllowed?(): Promise<boolean>
  getState(): Promise<ClientUpdateState>
  check(): Promise<ClientUpdateState>
  download(): Promise<ClientUpdateState>
  install(): Promise<ClientUpdateState>
  subscribe(listener: (state: ClientUpdateState) => void): (() => void) | Promise<() => void>
}
declare global { interface Window { storyforgeClient?: ClientBridge } }

export async function getClientBridge(): Promise<ClientBridge | undefined> {
  if (window.storyforgeClient) return window.storyforgeClient
  if (import.meta.env.MODE !== 'android') return undefined
  const { registerPlugin } = await import('@capacitor/core')
  const plugin = registerPlugin<ClientBridge & {
    addListener(event: string, listener: (state: ClientUpdateState) => void): Promise<{ remove(): Promise<void> }>
  }>('ClientUpdate')
  return {
    getState: () => plugin.getState(), check: () => plugin.check(),
    download: () => plugin.download(), install: () => plugin.install(),
    subscribe: async listener => {
      const handle = await plugin.addListener('state', listener)
      return () => { void handle.remove() }
    },
  }
}

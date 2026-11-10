import { parseFailureEvent } from '../diagnostics/failure-summary'
import { readRuntimeDiagnosticErrors, recordRuntimeDiagnosticEvent } from '../diagnostics/runtime-errors'
import { diagnosticContextEnabled, previousOperationTrail } from '../diagnostics/operation-trail'

export async function nativeTelemetryAllowed(): Promise<boolean> {
  if (window.storyforgeClient) return window.storyforgeClient.telemetryAllowed ? window.storyforgeClient.telemetryAllowed() : false
  if (import.meta.env.MODE === 'android') {
    const { registerPlugin } = await import('@capacitor/core')
    return (await registerPlugin<{ allowed(): Promise<{ allowed: boolean }> }>('ClientDiagnostics').allowed()).allowed === true
  }
  return import.meta.env.MODE === 'portable'
}

export async function collectNativeDiagnostics(): Promise<void> {
  let rows: unknown[] = []
  if (window.storyforgeClient?.diagnostics) rows = await window.storyforgeClient.diagnostics()
  else if (import.meta.env.MODE === 'android') {
    const { registerPlugin } = await import('@capacitor/core')
    rows = (await registerPlugin<{ read(): Promise<{ errors: unknown[] }> }>('ClientDiagnostics').read()).errors
  }
  if (!Array.isArray(rows)) return
  const previous = readRuntimeDiagnosticErrors()
  for (const value of rows.slice(-5)) {
    const row = parseFailureEvent(value)
    if (row && !row.details && diagnosticContextEnabled()) {
      const trail = previousOperationTrail(row.occurredAt)
      if (trail.length) row.details = { version: 1, code: 'native-exit', trail }
    }
    if (row && !previous.some(item => item.occurredAt === row.occurredAt && item.source === row.source && item.name === row.name)) recordRuntimeDiagnosticEvent(row)
  }
}

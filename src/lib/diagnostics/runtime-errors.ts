import { parseFailureEvent, safeErrorFrames, safeErrorName, type FailureEvent } from './failure-summary'
import { APP_BUILD_ID } from '../version'

export type RuntimeDiagnosticError = FailureEvent
export const RUNTIME_DIAGNOSTICS_KEY = 'storyforge-runtime-diagnostics-v1'
let installed = false
let loaded = false
let memory: FailureEvent[] = []

export function readRuntimeDiagnosticErrors(): FailureEvent[] {
  if (!loaded) try {
    loaded = true
    const raw = localStorage.getItem(RUNTIME_DIAGNOSTICS_KEY)
    if (raw && raw.length <= 40_000) {
      const rows: unknown = JSON.parse(raw)
      if (Array.isArray(rows)) {
        memory = rows.slice(-20).map(row => parseFailureEvent(row)).filter((row): row is FailureEvent => !!row)
        // Remove expired or malformed persisted entries when the app next opens.
        localStorage.setItem(RUNTIME_DIAGNOSTICS_KEY, JSON.stringify(memory))
      }
    }
  } catch { /* Storage denial cannot turn diagnostics into another application failure. */ }
  memory = memory.filter(row => !!parseFailureEvent(row))
  return memory.map(row => ({ ...row, frames: [...row.frames] }))
}

export function recordRuntimeDiagnosticError(value: unknown, source: FailureEvent['source']): void {
  const current = readRuntimeDiagnosticErrors()
  let name: unknown
  let stack: unknown
  try { if (value instanceof Error) { name = value.name; stack = value.stack } }
  catch { /* A hostile/lazy Error property cannot cause recursive error capture. */ }
  const row: FailureEvent = { occurredAt: new Date().toISOString(), source,
    name: safeErrorName(name), frames: safeErrorFrames(stack), build: APP_BUILD_ID }
  const previous = current[current.length - 1]
  if (previous && previous.source === row.source && previous.name === row.name
    && JSON.stringify(previous.frames) === JSON.stringify(row.frames)
    && Date.parse(row.occurredAt) - Date.parse(previous.occurredAt) < 1_000) return
  memory = [...current, row].slice(-20)
  try { localStorage.setItem(RUNTIME_DIAGNOSTICS_KEY, JSON.stringify(memory)) } catch { /* Keep the bounded in-memory copy. */ }
}

export function installRuntimeDiagnostics(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  readRuntimeDiagnosticErrors()
  window.addEventListener('error', event => recordRuntimeDiagnosticError(event.error, 'window.error'))
  window.addEventListener('unhandledrejection', event => recordRuntimeDiagnosticError(event.reason, 'unhandledrejection'))
  window.addEventListener('storage', event => {
    if (event.key === RUNTIME_DIAGNOSTICS_KEY || event.key === null) { memory = []; loaded = false }
  })
}

export function resetRuntimeDiagnostics(): void {
  memory = []
  loaded = true
  try { localStorage.removeItem(RUNTIME_DIAGNOSTICS_KEY) } catch { /* Best effort only. */ }
}

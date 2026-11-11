import { parseFailureEvent, safeErrorFrames, safeErrorName, type FailureEvent } from './failure-summary'
import { APP_BUILD_ID } from '../version'
import { diagnosticCode } from './diagnostic-context'
import { diagnosticContextEnabled, installOperationTrail, readOperationTrail } from './operation-trail'

export type RuntimeDiagnosticError = FailureEvent
export const RUNTIME_DIAGNOSTICS_KEY = 'storyforge-runtime-diagnostics-v1'
let installed = false
let loaded = false
let memory: FailureEvent[] = []
const listeners = new Set<(event: FailureEvent) => void>()
export function subscribeRuntimeDiagnostics(listener: (event: FailureEvent) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

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
  return memory.map(row => parseFailureEvent(diagnosticContextEnabled() ? row : { ...row, details: undefined })!).filter(Boolean)
}

export function recordRuntimeDiagnosticError(value: unknown, source: FailureEvent['source']): void {
  let name: unknown
  let stack: unknown
  try { if (value instanceof Error) { name = value.name; stack = value.stack } }
  catch { /* A hostile/lazy Error property cannot cause recursive error capture. */ }
  const row: FailureEvent = { occurredAt: new Date().toISOString(), source,
    name: safeErrorName(name), frames: safeErrorFrames(stack), build: APP_BUILD_ID,
    ...(diagnosticContextEnabled() ? { details: { version: 1, code: diagnosticCode(value), trail: readOperationTrail() } } : {}) }
  recordRuntimeDiagnosticEvent(row)
}

export function recordRuntimeDiagnosticEvent(value: FailureEvent): void {
  const row = parseFailureEvent(diagnosticContextEnabled() ? value : { ...value, details: undefined })
  if (!row) return
  const current = readRuntimeDiagnosticErrors()
  const previous = current[current.length - 1]
  if (previous && previous.source === row.source && previous.name === row.name
    && JSON.stringify(previous.frames) === JSON.stringify(row.frames)
    && Date.parse(row.occurredAt) - Date.parse(previous.occurredAt) < 1_000) return
  memory = [...current, row].slice(-20)
  try { localStorage.setItem(RUNTIME_DIAGNOSTICS_KEY, JSON.stringify(memory)) } catch { /* Keep the bounded in-memory copy. */ }
  for (const listener of listeners) { try { listener(row) } catch { /* Diagnostics never interrupt the author. */ } }
}

export function installRuntimeDiagnostics(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  installOperationTrail()
  readRuntimeDiagnosticErrors()
  window.addEventListener('diagnostic-context-change', () => {
    if (!diagnosticContextEnabled()) {
      memory = readRuntimeDiagnosticErrors().map(({ details: _, ...row }) => row)
      try { localStorage.setItem(RUNTIME_DIAGNOSTICS_KEY, JSON.stringify(memory)) } catch { /* Best effort removal. */ }
    }
  })
  window.addEventListener('error', (event: Event) => {
    if (event instanceof ErrorEvent) {
      // ErrorEvent may have no Error object (cross-origin scripts). Still keep a safe code location.
      if (event.error instanceof Error) recordRuntimeDiagnosticError(event.error, 'window.error')
      else recordRuntimeDiagnosticError(Object.assign(new Error(''), { stack: `Error\n${event.filename}:${event.lineno}:${event.colno}` }), 'window.error')
    } else if (event.target instanceof HTMLScriptElement || event.target instanceof HTMLLinkElement) {
      recordRuntimeDiagnosticError(new Error('Unable to preload CSS'), 'window.error')
    }
  }, true)
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

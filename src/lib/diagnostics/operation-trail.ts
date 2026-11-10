import { DIAGNOSTIC_ACTIONS, DIAGNOSTIC_AREAS, parseDiagnosticDetails, type DiagnosticStep } from './diagnostic-context'

export const DIAGNOSTIC_CONTEXT_KEY = 'storyforge-diagnostic-context-v1'
const TRAIL_KEY = 'storyforge-operation-trail-v1'
let trail: DiagnosticStep[] = []
let previousTrail: DiagnosticStep[] = []
let enabled = false
let installed = false
export function diagnosticContextEnabled(): boolean {
  try { return enabled && localStorage.getItem(DIAGNOSTIC_CONTEXT_KEY) === 'true' } catch { return false }
}
function syncNative() {
  try { void window.storyforgeClient?.diagnosticContext?.({ enabled: diagnosticContextEnabled(), trail: readOperationTrail() }).catch(() => {}) } catch { /* Optional diagnostics never block editing. */ }
}
export function setDiagnosticContextEnabled(value: boolean): boolean {
  enabled = false; trail = []; previousTrail = []
  try {
    localStorage.removeItem(TRAIL_KEY); localStorage.setItem(DIAGNOSTIC_CONTEXT_KEY, String(value)); enabled = value
    window.dispatchEvent(new Event('diagnostic-context-change')); syncNative(); return true
  }
  catch { syncNative(); return false }
}
export function previousOperationTrail(occurredAt: string): DiagnosticStep[] {
  return diagnosticContextEnabled() ? parseDiagnosticDetails({ version: 1, code: 'native-exit', trail: previousTrail }, occurredAt)?.trail ?? [] : []
}
export function readOperationTrail(now = Date.now()): DiagnosticStep[] {
  if (!diagnosticContextEnabled()) return []
  trail = parseDiagnosticDetails({ version: 1, code: 'unknown', trail }, new Date(now).toISOString())?.trail ?? []
  return trail.map(step => ({ ...step }))
}
export function recordOperation(action: DiagnosticStep['action'], now = Date.now()) {
  if (!diagnosticContextEnabled() || !DIAGNOSTIC_ACTIONS.includes(action)) return
  const segment = location.pathname.replace(/^\/storyforge\/?/, '/').split('/')[1]
  const area = segment === 'workspace' || segment === 'long' ? 'longform' : segment === 'play' || segment === 'openworld' ? 'player'
    : DIAGNOSTIC_AREAS.find(value => value === segment) ?? 'other'
  trail = [...readOperationTrail(now), { at: new Date(now).toISOString(), area, action }].slice(-20)
  try { localStorage.setItem(TRAIL_KEY, JSON.stringify(trail)) } catch { /* Bounded memory remains useful. */ }
  syncNative()
}
export function installOperationTrail() {
  if (installed) return
  installed = true
  try {
    enabled = localStorage.getItem(DIAGNOSTIC_CONTEXT_KEY) === 'true'
    const raw = localStorage.getItem(TRAIL_KEY)
    // Retain only for native events whose timestamps precede this startup, never new errors.
    const rows: unknown = raw && raw.length < 8192 ? JSON.parse(raw) : []
    const last = Array.isArray(rows) ? rows.at(-1) as { at?: unknown } | undefined : undefined
    const end = typeof last?.at === 'string' ? Date.parse(last.at) : NaN
    previousTrail = Number.isFinite(end) && end <= Date.now() && end >= Date.now() - 7 * 86400000
      ? parseDiagnosticDetails({ version: 1, code: 'unknown', trail: rows }, new Date(end).toISOString())?.trail ?? [] : []
    localStorage.removeItem(TRAIL_KEY)
  } catch { enabled = false; previousTrail = [] }
  // No input/change/keydown listeners. No DOM text, values, labels or target URL is read.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('button,a,[data-diagnostic-action]') : null
    if (!target) return
    const hint = target.getAttribute('data-diagnostic-action')
    const action = DIAGNOSTIC_ACTIONS.find(value => value === hint) ?? (target.tagName === 'A' ? 'navigate' : 'button')
    recordOperation(action)
  }, true)
  document.addEventListener('submit', () => recordOperation('submit'), true)
  window.addEventListener('popstate', () => recordOperation('navigate'))
  window.addEventListener('storage', event => {
    if (event.key === DIAGNOSTIC_CONTEXT_KEY || event.key === null) {
      trail = []; previousTrail = []; try { enabled = localStorage.getItem(DIAGNOSTIC_CONTEXT_KEY) === 'true' } catch { enabled = false }
      window.dispatchEvent(new Event('diagnostic-context-change')); syncNative()
    }
  })
  recordOperation('navigate'); syncNative()
}

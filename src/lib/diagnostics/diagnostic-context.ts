/** Closed technical vocabulary. Never derive labels from DOM text, URLs or author content. */
export const DIAGNOSTIC_AREAS = ['home', 'longform', 'short', 'world', 'script', 'comic', 'motion', 'ttrpg', 'chat', 'town', 'avg', 'adventure', 'settings', 'community', 'workshop', 'player', 'other'] as const
export const DIAGNOSTIC_ACTIONS = ['navigate', 'button', 'submit', 'save', 'generate', 'adopt', 'dismiss', 'retry', 'import', 'export', 'play', 'stop'] as const
export const DIAGNOSTIC_CODES = ['unknown', 'property-access', 'react-update-depth', 'resource-load', 'network', 'quota', 'abort', 'syntax', 'native-exit'] as const
export interface DiagnosticStep { at: string; area: typeof DIAGNOSTIC_AREAS[number]; action: typeof DIAGNOSTIC_ACTIONS[number] }
export interface DiagnosticDetails {
  version: 1
  code: typeof DIAGNOSTIC_CODES[number]
  trail: DiagnosticStep[]
  native?: { process: 'browser' | 'renderer' | 'GPU' | 'Utility' | 'unknown'; reason: 'crashed' | 'oom' | 'unresponsive' | 'uncaught' | 'interrupted'; exitCode?: number }
}
const member = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && values.includes(value as T)
export function parseDiagnosticDetails(value: unknown, occurredAt: string): DiagnosticDetails | undefined {
  if (!value || typeof value !== 'object') return
  const row = value as Record<string, unknown>, end = Date.parse(occurredAt)
  if (row.version !== 1 || !member(DIAGNOSTIC_CODES, row.code) || !Array.isArray(row.trail) || !Number.isFinite(end)) return
  let previous = end - 300_000
  const trail: DiagnosticStep[] = []
  for (const item of row.trail.slice(-20)) {
    if (!item || typeof item !== 'object') continue
    const step = item as Record<string, unknown>, time = typeof step.at === 'string' ? Date.parse(step.at) : NaN
    if (!Number.isFinite(time) || time < previous || time > end || !member(DIAGNOSTIC_AREAS, step.area) || !member(DIAGNOSTIC_ACTIONS, step.action)) continue
    previous = time; trail.push({ at: new Date(time).toISOString(), area: step.area, action: step.action })
  }
  const result: DiagnosticDetails = { version: 1, code: row.code, trail }
  if (row.native && typeof row.native === 'object') {
    const native = row.native as Record<string, unknown>
    if (member(['browser', 'renderer', 'GPU', 'Utility', 'unknown'] as const, native.process)
      && member(['crashed', 'oom', 'unresponsive', 'uncaught', 'interrupted'] as const, native.reason)) {
      result.native = { process: native.process, reason: native.reason }
      if (typeof native.exitCode === 'number' && Number.isInteger(native.exitCode) && Math.abs(native.exitCode) <= 2147483648) result.native.exitCode = native.exitCode
    }
  }
  return result
}
export function diagnosticCode(value: unknown): DiagnosticDetails['code'] {
  // Inspect transiently; never persist or send the message itself.
  let message = ''
  try { if (value instanceof Error) message = value.message.slice(0, 2048) } catch { return 'unknown' }
  if (/Maximum update depth|Minified React error #185\b/.test(message)) return 'react-update-depth'
  if (/Cannot (?:read|set) propert/.test(message)) return 'property-access'
  if (/dynamically imported module|Loading chunk|Unable to preload CSS/.test(message)) return 'resource-load'
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return 'network'
  if (/quota/i.test(message)) return 'quota'
  if (/abort/i.test(message)) return 'abort'
  return value instanceof SyntaxError ? 'syntax' : 'unknown'
}

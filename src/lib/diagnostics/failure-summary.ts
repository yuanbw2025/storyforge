/** Small, content-free handoff shared by the application and the official form. */
export const FAILURE_REPORT_FRAGMENT = '#storyforge-report='
export const FAILURE_FEEDBACK_URL = 'https://docs.storyforge-lab.com/feedback/bug'
export const FAILURE_SOURCES = ['react', 'window.error', 'unhandledrejection', 'bootstrap', 'launcher'] as const
export type FailureSource = typeof FAILURE_SOURCES[number]
const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'NetworkError', 'QuotaExceededError', 'SecurityError', 'AbortError', 'InvalidStateError', 'UnknownError', 'VersionError', 'DataCloneError', 'ConstraintError', 'DataError', 'NotFoundError', 'NotReadableError', 'TimeoutError', 'OperationError', 'NotAllowedError', 'OpenFailedError', 'UpgradeError', 'SchemaError', 'MissingAPIError', 'BulkError', 'ModifyError', 'TransactionInactiveError', 'ReadOnlyError', 'DatabaseClosedError'])
const BUILD = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]{1,40})?\+(?:[a-f0-9]{7,40}|local)$/
export const safeFailureBuild = (value: unknown): string => typeof value === 'string' && BUILD.test(value) ? value : 'unknown'

export interface FailureEvent {
  occurredAt: string
  source: FailureSource
  name: string
  frames: string[]
  build: string
}
export interface FailureSummary {
  format: 'storyforge-failure-summary'
  version: 1
  application: string
  platform: string
  browser: string
  errors: FailureEvent[]
  launcher: null | { occurredAt: string; kind: 'error' | 'interrupted'; code: string; build: string }
}

export function safeErrorName(name: unknown): string {
  return typeof name === 'string' && ERROR_NAMES.has(name) ? name : 'Error'
}

/** Exclude messages, function arguments, URL hosts/queries and absolute disk paths. */
export function safeErrorFrames(stack: unknown): string[] {
  if (typeof stack !== 'string') return []
  return stack.split('\n').slice(1, 9).flatMap(line => {
    const match = line.match(/(?:\/storyforge)?\/(?:assets|src)\/[A-Za-z0-9_./-]+\.(?:[cm]?js|tsx?)(?::\d+){1,2}(?=[)\s]|$)/)
      ?? line.match(/(?:^|[ (])([A-Za-z0-9_-]+\.[cm]?js(?::\d+){1,2})(?=[)\s]|$)/)
    const location = match?.[1] ?? match?.[0]
    return location ? [location.trim().slice(0, 160)] : []
  })
}

export function parseFailureEvent(value: unknown, now = Date.now()): FailureEvent | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.occurredAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(row.occurredAt)
    || !Number.isFinite(Date.parse(row.occurredAt)) || Date.parse(row.occurredAt) < now - 7 * 86_400_000
    || Date.parse(row.occurredAt) > now + 300_000 || !FAILURE_SOURCES.includes(row.source as FailureSource)) return null
  const frames = Array.isArray(row.frames) ? row.frames.filter((frame): frame is string => typeof frame === 'string') : []
  return { occurredAt: new Date(row.occurredAt).toISOString(), source: row.source as FailureSource,
    name: safeErrorName(row.name), build: safeFailureBuild(row.build), frames: safeErrorFrames('Error\n' + frames.join('\n')) }
}

/** Reconstruct allowlisted fields; never trust a handoff or persisted object as-is. */
export function parseFailureSummary(value: unknown): FailureSummary | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.format !== 'storyforge-failure-summary' || row.version !== 1
    || typeof row.application !== 'string' || !BUILD.test(row.application)
    || typeof row.platform !== 'string' || !['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'Other'].includes(row.platform)
    || typeof row.browser !== 'string' || !/^(?:Chrome|Edge|Firefox|Safari) \d{1,4}$|^Other$/.test(row.browser)
    || !Array.isArray(row.errors) || row.errors.length > 20) return null
  let launcher: FailureSummary['launcher'] = null
  if (row.launcher && typeof row.launcher === 'object') {
    const item = row.launcher as Record<string, unknown>
    if (typeof item.occurredAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(item.occurredAt)
      && Number.isFinite(Date.parse(item.occurredAt)) && Date.parse(item.occurredAt) >= Date.now() - 7 * 86_400_000
      && Date.parse(item.occurredAt) <= Date.now() + 300_000 && typeof item.kind === 'string' && ['error', 'interrupted'].includes(item.kind)
      && typeof item.code === 'string' && ['EADDRINUSE', 'EACCES', 'UNCAUGHT', 'INTERRUPTED', 'OTHER'].includes(item.code)) {
      launcher = { occurredAt: new Date(item.occurredAt).toISOString(), kind: item.kind as 'error' | 'interrupted', code: item.code, build: safeFailureBuild(item.build) }
    }
  }
  return { format: row.format, version: 1, application: row.application, platform: String(row.platform), browser: row.browser,
    errors: row.errors.map(item => parseFailureEvent(item)).filter((item): item is FailureEvent => !!item), launcher }
}

export function failureFeedbackLink(summary: FailureSummary): string {
  const safe = parseFailureSummary(summary)
  if (!safe) return FAILURE_FEEDBACK_URL
  // Keep the URL bounded even when a long session accumulated many failures.
  safe.errors = safe.errors.slice(-5).map(error => ({ ...error, frames: error.frames.slice(0, 3) }))
  return FAILURE_FEEDBACK_URL + FAILURE_REPORT_FRAGMENT + encodeURIComponent(JSON.stringify(safe))
}

export function readFailureHandoff(hash: string): FailureSummary | null {
  if (!hash.startsWith(FAILURE_REPORT_FRAGMENT) || hash.length > 16_000) return null
  try { return parseFailureSummary(JSON.parse(decodeURIComponent(hash.slice(FAILURE_REPORT_FRAGMENT.length)))) }
  catch { return null }
}

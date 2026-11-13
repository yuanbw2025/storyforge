import { CLIENT_AGREEMENT_KEY, clientAgreementRequired, clientAgreementAccepted } from './client-legal'
import { parseFailureEvent, type FailureEvent } from '../diagnostics/failure-summary'
import { subscribeRuntimeDiagnostics } from '../diagnostics/runtime-errors'
import { CLIENT_SUPPORT_URL, clientMetadata, type ClientMetadata } from './client-support'
import { diagnosticDetailsSupported, diagnosticWireError } from './diagnostic-wire'
import { setDiagnosticContextEnabled } from '../diagnostics/operation-trail'

export const TELEMETRY_KEY = 'storyforge-client-observability-v1'
const DAY = 86_400_000
const day = (time: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time))
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
interface Event { id: string; kind: 'active' | 'error'; occurredAt: string; client: ClientMetadata; error?: FailureEvent; attempts: number; extended?: boolean }
interface State { id: string; analytics: boolean; errors: boolean; decided: boolean; lastActive: string; nextAttempt: number; queue: Event[]; nativeSeen: FailureEvent[] }
const listeners = new Set<() => void>()
let available = false
let storageConsentBlocked = false
export const clientTelemetryAvailable = () => available
const notify = () => listeners.forEach(fn => fn())
export const subscribeTelemetryPreferences = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

function read(): State | null {
  try {
    const raw = localStorage.getItem(TELEMETRY_KEY)
    if (!raw || raw.length > 250_000) return null
    const value = JSON.parse(raw) as State
    if (!uuid(value.id)) return null
    const now = Date.now()
    const queue = Array.isArray(value.queue) ? value.queue.slice(-100).flatMap((event): Event[] => {
      if (!event || !uuid(event.id) || !['active', 'error'].includes(event.kind) || typeof event.occurredAt !== 'string'
        || !Number.isFinite(Date.parse(event.occurredAt)) || Date.parse(event.occurredAt) < now - 30 * DAY || Date.parse(event.occurredAt) > now + 300_000) return []
      const meta = event.client
      if (!meta || !/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]{1,40})?\+(?:[a-f0-9]{7,40}|local)$/.test(meta.build)
        || !['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'Other'].includes(meta.platform)
        || !['desktop', 'android', 'portable', 'web'].includes(meta.distribution)) return []
      const error = event.kind === 'error' ? parseFailureEvent(event.error) : null
      if (event.kind === 'error' && !error) return []
      if (event.kind === 'active' ? value.analytics !== true : value.errors !== true) return []
      return [{ id: event.id, kind: event.kind, occurredAt: new Date(event.occurredAt).toISOString(), client: { build: meta.build, platform: meta.platform, distribution: meta.distribution },
        ...(error ? { error } : {}), ...(typeof event.extended === 'boolean' ? { extended: event.extended } : {}), attempts: Number.isInteger(event.attempts) ? Math.max(0, Math.min(5, event.attempts)) : 0 }]
    }) : []
    // Native history (five rows) can outlive the rotating local summary. Keep
    // only already-consented allowlisted occurrences, within its seven-day TTL.
    const nativeSeen = value.errors === true && Array.isArray(value.nativeSeen)
      ? value.nativeSeen.slice(-20).map(row => parseFailureEvent(row, now))
        .filter((row): row is FailureEvent => !!row && row.source === 'native') : []
    return { id: value.id, analytics: value.analytics === true, errors: value.errors === true, decided: value.decided === true,
      lastActive: typeof value.lastActive === 'string' && /^\d{4}-\d\d-\d\d$/.test(value.lastActive) ? value.lastActive : '',
      nextAttempt: Number.isFinite(value.nextAttempt) ? Math.min(value.nextAttempt, now + DAY) : 0, queue, nativeSeen }
  } catch { return null }
}
function write(state: State) { try { localStorage.setItem(TELEMETRY_KEY, JSON.stringify(state)); return true } catch { return false } }
export function telemetryPreferences() { const state = read(); return { analytics: !storageConsentBlocked && (state?.analytics ?? false), errors: !storageConsentBlocked && (state?.errors ?? false), decided: state?.decided ?? false } }
let inflight: AbortController | null = null
export function setTelemetryPreferences(analytics: boolean, errors: boolean): boolean {
  inflight?.abort()
  const state = read() ?? { id: crypto.randomUUID(), analytics: false, errors: false, decided: false, lastActive: '', nextAttempt: 0, queue: [], nativeSeen: [] }
  state.analytics = analytics; state.errors = errors; state.decided = true
  state.queue = state.queue.filter(row => row.kind === 'active' ? analytics : errors)
  if (!errors) { state.nativeSeen = []; setDiagnosticContextEnabled(false) }
  const saved = write(state)
  // A failed opt-out must still stop this session; never reread an old opt-in and resume upload.
  storageConsentBlocked = !saved
  notify()
  return saved
}
export function recordClientActivity(now = Date.now()) {
  if (storageConsentBlocked || (clientAgreementRequired() && !clientAgreementAccepted())) return
  const state = read()
  if (!state?.analytics || document.visibilityState !== 'visible' || state.lastActive === day(now)) return
  state.lastActive = day(now)
  state.queue = [...state.queue, { id: crypto.randomUUID(), kind: 'active' as const, occurredAt: new Date(now).toISOString(), client: clientMetadata(), attempts: 0 }].slice(-100)
  write(state)
}
export function recordClientError(error: FailureEvent) {
  if (storageConsentBlocked || (clientAgreementRequired() && !clientAgreementAccepted())) return
  const state = read()
  if (!state?.errors) return
  const safe = parseFailureEvent(error)
  if (!safe) return
  const now = Date.now()
  const native = safe.source === 'native'
  const occurrenceKey = (row: FailureEvent) => JSON.stringify([row.occurredAt, row.source, row.name, row.build, row.frames])
  if (native && state.nativeSeen.some(row => occurrenceKey(row) === occurrenceKey(safe))) return
  // At most 20 pending errors; never collect arbitrary error messages or console logs.
  const recent = state.queue.filter(row => row.kind === 'error')
  if (recent.length >= 20 || (!native && recent.some(row => JSON.stringify(row.error?.frames) === JSON.stringify(safe.frames) && row.error?.name === safe.name && now - Date.parse(row.occurredAt) < 60_000))) return
  state.queue.push({ id: crypto.randomUUID(), kind: 'error', occurredAt: safe.occurredAt, client: clientMetadata(), error: safe, attempts: 0 })
  // Remember when queued, so unknown/failed receipts retain the original bounded
  // retry policy rather than reintroducing the same occurrence with a fresh ID.
  if (native) state.nativeSeen = [...state.nativeSeen, safe].slice(-20)
  write(state)
}
export async function flushClientTelemetry(): Promise<void> {
  if ((clientAgreementRequired() && !clientAgreementAccepted()) || storageConsentBlocked || inflight || !navigator.onLine) return
  const state = read()
  if (!state || state.nextAttempt > Date.now() || !state.queue.length) return
  let batch = state.queue.filter(row => row.attempts < 5).slice(0, 10)
  if (!batch.length) { state.queue = []; write(state); return }
  const controller = new AbortController(); inflight = controller
  const timer = setTimeout(() => controller.abort(new DOMException('Telemetry timeout', 'TimeoutError')), 10_000)
  try {
    const extended = batch.some(row => row.error?.details) ? await diagnosticDetailsSupported(CLIENT_SUPPORT_URL) : false
    if (controller.signal.aborted) return
    for (const row of batch) row.extended ??= extended
    const serialize = (rows: Event[]) => JSON.stringify({ version: 1, installationId: state.id,
      events: rows.map(({ attempts: _, extended: detailsAllowed, error, ...event }) => ({ ...event,
        ...(error ? { error: diagnosticWireError(error, detailsAllowed === true) } : {}) })) })
    let body = serialize(batch)
    // Enhanced context must fit the existing 32 KiB endpoint. Keep an ordered
    // prefix below 30 KiB; overflow retains its IDs, shape choice and attempts.
    while (new TextEncoder().encode(body).byteLength > 30 * 1024 && batch.length > 1) {
      batch = batch.slice(0, -1); body = serialize(batch)
    }
    if (new TextEncoder().encode(body).byteLength > 30 * 1024) return
    // Freeze the negotiated wire shape for retries with the same event IDs.
    // Capability negotiation yields: preserve reports added in the meantime.
    const negotiated = read()
    if (!negotiated || negotiated.id !== state.id) return
    const shapes = new Map(batch.map(row => [row.id, row.extended]))
    negotiated.queue = negotiated.queue.map(row => shapes.has(row.id) ? { ...row, extended: shapes.get(row.id) } : row)
    write(negotiated)
    const response = await fetch(CLIENT_SUPPORT_URL + '/events', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal,
      body })
    const result: unknown = await response.json().catch(() => null)
    const receipt = result as { accepted?: unknown; discarded?: unknown } | null
    const acknowledged = response.ok && Array.isArray(receipt?.accepted) && Array.isArray(receipt?.discarded)
      ? new Set([...receipt.accepted, ...receipt.discarded].filter(uuid)) : new Set<string>()
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429
    const current = read()
    if (!current || current.id !== state.id || controller.signal.aborted) return
    const sent = new Set(batch.map(row => row.id))
    current.queue = current.queue.filter(row => !acknowledged.has(row.id) && !(permanent && sent.has(row.id)))
      .map(row => sent.has(row.id) ? { ...row, attempts: row.attempts + 1 } : row).filter(row => row.attempts < 5)
    current.nextAttempt = Date.now() + (response.ok ? 60_000 : 5 * 60_000)
    write(current)
  } catch {
    const current = read()
    if (current && current.id === state.id && (!controller.signal.aborted || controller.signal.reason?.name === 'TimeoutError')) {
      const sent = new Set(batch.map(row => row.id))
      current.queue = current.queue.map(row => sent.has(row.id) ? { ...row, attempts: row.attempts + 1 } : row).filter(row => row.attempts < 5)
      current.nextAttempt = Date.now() + 5 * 60_000; write(current)
    }
  } finally { clearTimeout(timer); inflight = null }
}
export async function deleteClientTelemetry(): Promise<void> {
  const state = read()
  if (!state) return
  setTelemetryPreferences(false, false)
  const response = await fetch(CLIENT_SUPPORT_URL + '/forget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
    referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(15_000), body: JSON.stringify({ installationId: state.id }) })
  const receipt = await response.json().catch(() => null) as { deleted?: unknown } | null
  if (!response.ok || receipt?.deleted !== true) throw new Error('尚未确认删除。上传已关闭，请联网后重试。')
  // Retain the disabled choice while rotating the forgotten identity.
  const saved = write({ ...state, id: crypto.randomUUID(), analytics: false, errors: false, decided: true, queue: [], nativeSeen: [], lastActive: '', nextAttempt: 0 })
  storageConsentBlocked = !saved; notify()
  if (!saved) throw new Error('服务器明细已删除，但本机无法保存关闭选择。当前会话已停止自动上传；重启后请检查设置。')
}
let started = false
let stopTelemetry: (() => void) | undefined
export function stopClientTelemetry() { stopTelemetry?.(); stopTelemetry = undefined }
export function installClientTelemetry(allowed: boolean) {
  const mode = import.meta.env.MODE
  if (started || navigator.webdriver || ['test', 'showcase', 'adventure-player'].includes(mode)) return
  const source = !window.storyforgeClient && !['portable', 'android'].includes(mode)
  if (!source && (!allowed || import.meta.env.DEV || !['portable', 'android'].includes(mode))) return
  // Source runs record only bounded activity metadata. Keep any previously
  // saved disabled choice, including a successful deletion, across restarts.
  if (source && !read()?.decided && !setTelemetryPreferences(true, false)) return
  started = true
  available = true; notify()
  const tick = () => { recordClientActivity(); void flushClientTelemetry() }
  const unsubscribeErrors = source ? () => {} : subscribeRuntimeDiagnostics(recordClientError)
  const unsubscribePreferences = subscribeTelemetryPreferences(tick)
  window.addEventListener('online', tick)
  document.addEventListener('visibilitychange', tick)
  const storage = (event: StorageEvent) => { if (event.key === TELEMETRY_KEY || event.key === CLIENT_AGREEMENT_KEY || event.key === null) { inflight?.abort(); notify() } }
  const diagnosticChange = () => {
    inflight?.abort()
    const state = read()
    if (state) { state.queue = state.queue.map(row => row.error ? { ...row, error: diagnosticWireError(row.error, false), extended: false } : row); state.nativeSeen = state.nativeSeen.map(row => diagnosticWireError(row, false)); write(state) }
  }
  window.addEventListener('storage', storage)
  window.addEventListener('diagnostic-context-change', diagnosticChange)
  const interval = setInterval(tick, 60_000)
  stopTelemetry = () => {
    clearInterval(interval); unsubscribeErrors(); unsubscribePreferences()
    window.removeEventListener('online', tick); document.removeEventListener('visibilitychange', tick)
    window.removeEventListener('storage', storage); window.removeEventListener('diagnostic-context-change', diagnosticChange)
    inflight?.abort(); started = false; available = false
  }
  tick()
}
if (import.meta.hot) import.meta.hot.dispose(stopClientTelemetry)

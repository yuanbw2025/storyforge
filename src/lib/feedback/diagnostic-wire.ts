import { diagnosticContextEnabled } from '../diagnostics/operation-trail'
import type { FailureEvent } from '../diagnostics/failure-summary'

let supported: Promise<boolean> | undefined
export function diagnosticDetailsSupported(base: string): Promise<boolean> {
  if (!diagnosticContextEnabled()) return Promise.resolve(false)
  // Optional capability read must never prevent the original base report or retry it.
  supported ??= fetch(base + '/capabilities', { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(2000) })
    .then(async response => response.ok && (await response.json() as { diagnosticContext?: unknown }).diagnosticContext === 1).catch(() => false)
  return supported
}
export function diagnosticWireError(error: FailureEvent, extended: boolean): FailureEvent {
  const { details, ...base } = error
  return extended && diagnosticContextEnabled() && details ? { ...base, details } : base
}

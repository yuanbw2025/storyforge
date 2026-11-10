import { APP_BUILD_ID } from '../version'
import { safeFailureBuild, parseFailureEvent, type FailureEvent } from '../diagnostics/failure-summary'
import { diagnosticDetailsSupported, diagnosticWireError } from './diagnostic-wire'

export const CLIENT_SUPPORT_URL = 'https://storyforge-lab.com/v1/client-support'
export interface ClientMetadata {
  build: string
  platform: 'Windows' | 'macOS' | 'Linux' | 'Android' | 'iOS' | 'Other'
  distribution: 'desktop' | 'android' | 'portable' | 'web'
}
export interface ClientFeedback {
  version: 1
  id: string
  kind: 'bug' | 'feature'
  title: string
  description: string
  steps: string
  expected: string
  client: ClientMetadata
  diagnostics?: FailureEvent[]
}
export function clientMetadata(): ClientMetadata {
  const ua = navigator.userAgent
  return {
    build: APP_BUILD_ID,
    platform: /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other',
    distribution: window.storyforgeClient ? 'desktop' : import.meta.env.MODE === 'android' ? 'android' : import.meta.env.MODE === 'portable' ? 'portable' : 'web',
  }
}
export function feedbackDiagnostics(rows: FailureEvent[]): FailureEvent[] {
  return rows.map(row => parseFailureEvent(row)).filter((row): row is FailureEvent => !!row)
    .slice(-5).map(row => ({ ...row, frames: row.frames.slice(0, 3), build: safeFailureBuild(row.build) }))
}
export async function submitClientFeedback(body: ClientFeedback): Promise<string> {
  let wire = feedbackWires.get(body)
  if (!wire) {
    wire = diagnosticDetailsSupported(CLIENT_SUPPORT_URL).then(extended => ({ ...body, ...(body.diagnostics ? { diagnostics: body.diagnostics.map(row => diagnosticWireError(row, extended)) } : {}) }))
    feedbackWires.set(body, wire)
  }
  const negotiated = await wire
  const prepared = { ...negotiated, ...(negotiated.diagnostics ? { diagnostics: negotiated.diagnostics.map(row => diagnosticWireError(row, true)) } : {}) }
  // Manual reports are sent once per click. An unknown outcome retains the same id on retry.
  const response = await fetch(CLIENT_SUPPORT_URL + '/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
    referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(15_000), body: JSON.stringify(prepared),
  })
  const result: unknown = await response.json().catch(() => null)
  if (response.ok && result && typeof result === 'object' && 'accepted' in result && result.accepted === true
    && 'id' in result && result.id === body.id) return body.id
  const code = result && typeof result === 'object' && 'error' in result ? result.error : ''
  if (code === 'REMOVE_CREDENTIALS') throw new Error('内容中可能包含密钥，请删除凭证后重新提交。')
  if (response.status === 429) throw new Error('提交次数较多，请稍后重试；填写内容已保留。')
  if (response.status === 409) throw new Error('回执与本次内容不一致，请修改内容后重新提交。')
  throw new Error('未收到提交成功回执。内容已保留；重试相同内容会使用同一编号。')
}
const feedbackWires = new WeakMap<ClientFeedback, Promise<ClientFeedback>>()

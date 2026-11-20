import { rememberFeedback, acknowledgeFeedback } from './followup-storage'
import { APP_BUILD_ID } from '../version'
import { safeFailureBuild, parseFailureEvent, type FailureEvent } from '../diagnostics/failure-summary'
import { diagnosticDetailsSupported, diagnosticWireError } from './diagnostic-wire'
import type { FeedbackImage } from './attachments'

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
  details?: {
    module: string
    browser: string
    actual: string
    model: string
    requestType: string
    workflow: string
    workaround: string
    references: string
    extra: string
  }
  followup?: { token: string }
  attachments?: FeedbackImage[]
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
    wire = (async () => {
      if (body.details || body.attachments?.length || body.followup) {
        const response = await fetch(CLIENT_SUPPORT_URL + '/capabilities', { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(2000) })
        const capabilities = response.ok ? await response.json() as { feedbackForm?: number; feedbackImages?: number; feedbackFollowup?: number } : null
        if (((body.details || body.attachments?.length) && capabilities?.feedbackForm !== 2) || (body.attachments?.length && capabilities?.feedbackImages !== 1)) throw new Error('反馈服务尚未支持完整表单或截图，草稿已保留。请稍后重试。')
        if (body.followup && capabilities?.feedbackFollowup !== 1) throw new Error('反馈服务尚未支持进展跟进。草稿已保留，可取消接收进展后按原方式提交。')
      }
      const extended = await diagnosticDetailsSupported(CLIENT_SUPPORT_URL)
      return { ...body, ...(body.diagnostics ? { diagnostics: body.diagnostics.map(row => diagnosticWireError(row, extended)) } : {}) }
    })()
    feedbackWires.set(body, wire)
  }
  const negotiated = await wire.catch(error => { feedbackWires.delete(body); throw error })
  const prepared = { ...negotiated, ...(negotiated.diagnostics ? { diagnostics: negotiated.diagnostics.map(row => diagnosticWireError(row, true)) } : {}) }
  // Manual reports are sent once per click. An unknown outcome retains the same id on retry.
  if (body.followup) await rememberFeedback(body.id, body.followup.token, body.title)
  const response = await fetch(CLIENT_SUPPORT_URL + '/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
    referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(15_000), body: JSON.stringify(prepared),
  })
  const result: unknown = await response.json().catch(() => null)
  if (response.ok && result && typeof result === 'object' && 'accepted' in result && result.accepted === true
    && 'id' in result && result.id === body.id
    && (!body.attachments?.length || ('attachmentCount' in result && result.attachmentCount === body.attachments.length))) {
    // The credential was durably saved before POST. A failed acknowledgment
    // write leaves a queryable pending receipt rather than resubmitting content.
    if (body.followup) await acknowledgeFeedback(body.id).catch(() => undefined)
    return body.id
  }
  const code = result && typeof result === 'object' && 'error' in result ? result.error : ''
  if (code === 'REMOVE_CREDENTIALS') throw new Error('内容中可能包含密钥，请删除凭证后重新提交。')
  if (response.status === 429) throw new Error('提交次数较多，请稍后重试；填写内容已保留。')
  if (response.status === 409) throw new Error('回执与本次内容不一致，请修改内容后重新提交。')
  throw new Error('未收到提交成功回执。内容已保留；重试相同内容会使用同一编号。')
}
const feedbackWires = new WeakMap<ClientFeedback, Promise<ClientFeedback>>()

import { assertGenerationAvailable } from '../showcase/policy'
import type { ChatMessage } from '../types'
import type { TokenUsage } from './logger'
import type { ChatResult } from './client'
import { sha256Text } from './chapter-memory/text-normalization'

export const CODEX_BASE_URL = '/storyforge/local-codex/v1'
export const CODEX_REQUEST_HASH_ALGORITHM_V1 = 'sha256-json-request-v1' as const
export const CODEX_DURABLE_RECEIPT_RETENTION_V1 = 'until-owner-ack-v1' as const
/** Reference to one local wire request, never a proof of candidate adoption. */
export interface CodexRequestRefV1 {
  version: 1; provider: 'codex'; requestId: string; model: string
  requestHash: string; requestHashAlgorithm: typeof CODEX_REQUEST_HASH_ALGORITHM_V1
}
export interface CodexStatus { state: 'ready' | 'login-required' | 'wrong-auth'; label?: string; plan?: string; message?: string; version?: string }
export interface CodexModel { id: string; label: string; isDefault: boolean }
export interface CodexReceipt {
  id: string; model: string; createdAt: number
  status: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  text: string; dispatched: boolean; error?: string; usage?: TokenUsage
  requestHash?: string; requestHashAlgorithm?: typeof CODEX_REQUEST_HASH_ALGORITHM_V1
  receiptRetention?: typeof CODEX_DURABLE_RECEIPT_RETENTION_V1; ownerAcknowledgedAt?: number
}
export function isLocalCodexHost(): boolean {
  return import.meta.env.MODE !== 'android' && typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
}
export async function codexRequest<T>(path: string, body?: unknown): Promise<T> {
  assertGenerationAvailable()
  if (!isLocalCodexHost()) throw new Error('Codex 订阅连接需要本机运行 StoryForge；线上静态站点不能直接调用本机登录。')
  let response: Response
  try {
    response = await fetch(`${CODEX_BASE_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit',
      headers: { 'X-StoryForge-Codex': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45_000),
    })
  } catch { throw new Error('本机 Codex 服务未响应。已提交的请求可能仍在运行，请到设置中的请求记录检查；不会自动重发。') }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('本机连接服务不可用。请更新 StoryForge 并运行 npm run dev 或 npm run preview；保持原来的地址和端口以访问原有手稿。')
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Codex 服务返回 HTTP ${response.status}`)
  return data as T
}

function assertRequestRef(binding: CodexRequestRefV1): void {
  if (!binding || binding.version !== 1 || binding.provider !== 'codex'
    || typeof binding.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(binding.requestId)
    || typeof binding.model !== 'string' || !binding.model.trim() || binding.model.length > 200
    || binding.requestHashAlgorithm !== CODEX_REQUEST_HASH_ALGORITHM_V1 || !/^[a-f0-9]{64}$/.test(binding.requestHash)
    || Object.keys(binding).length !== 6) throw new Error('原 Codex 请求引用不完整，不能读取或重发。')
}
/** One read of the same exact request. No inference POST, cancellation, replay,
 * raw parsing or product write is authorized by this lookup. */
export async function readBoundCodexReceiptV1(binding: CodexRequestRefV1): Promise<CodexReceipt> {
  assertRequestRef(binding)
  const receipt = await codexRequest<CodexReceipt>(`/requests/${binding.requestId}`)
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.id !== binding.requestId || receipt.model !== binding.model
    || receipt.requestHashAlgorithm !== binding.requestHashAlgorithm || receipt.requestHash !== binding.requestHash
    || !Number.isFinite(receipt.createdAt) || typeof receipt.text !== 'string' || typeof receipt.dispatched !== 'boolean'
    || (receipt.receiptRetention !== undefined && receipt.receiptRetention !== CODEX_DURABLE_RECEIPT_RETENTION_V1)
    || (receipt.ownerAcknowledgedAt !== undefined && !Number.isFinite(receipt.ownerAcknowledgedAt))
    || !['accepted', 'running', 'completed', 'failed', 'cancelled', 'unknown'].includes(receipt.status)) {
    throw new Error('本机回执与原冻结 Codex 请求不一致；请保留原记录，不会重发。')
  }
  return receipt
}

/** Call only after the original owner durably saved the exact receipt. This
 * releases transport retention, never authorizes candidate/adoption success. */
export async function acknowledgeBoundCodexReceiptV1(input: {
  request: CodexRequestRefV1; rawResponseHash: string; confirmation: 'owner-record-saved-v1'
}): Promise<{ id: string; acknowledged: true; acknowledgedAt: number; status: CodexReceipt['status'] }> {
  assertRequestRef(input.request)
  if (input.confirmation !== 'owner-record-saved-v1' || !/^[a-f0-9]{64}$/.test(input.rawResponseHash)) {
    throw new Error('需要原作品保存准确回执后才能交接。')
  }
  const value = await codexRequest<{ id: string; acknowledged: true; acknowledgedAt: number; status: CodexReceipt['status'] }>(`/requests/${input.request.requestId}/acknowledge`, {
    decision: input.confirmation, model: input.request.model, requestHash: input.request.requestHash, rawResponseHash: input.rawResponseHash,
  })
  if (!value || value.id !== input.request.requestId || value.acknowledged !== true || !Number.isFinite(value.acknowledgedAt)
    || !['completed', 'failed', 'cancelled', 'unknown'].includes(value.status)) throw new Error('原回执交接返回不完整，请核对原记录；不会重发生成。')
  return value
}

/** One ID, one submission. Polling reads receipts; it never resubmits inference. */
export async function* streamCodex(
  messages: ChatMessage[], model: string, signal?: AbortSignal, result?: ChatResult, outputSchema?: Record<string, unknown>, responseFormat?: 'json_object',
): AsyncGenerator<string> {
  if (result) result.requestLifecycle = { phase: 'pre-dispatch', responseStatus: null }
  if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
  const status = await codexRequest<CodexStatus>('/status')
  if (status.state !== 'ready') throw new Error(status.message || '请在设置中连接本机 Codex 的 ChatGPT 登录。')
  if (!model.trim()) throw new Error('请先刷新 Codex 模型目录并选择模型。')
  const id = crypto.randomUUID()
  const onPrepared = result?.onCodexRequestPrepared
  // Freeze exact wire bytes before an async persistence hook. A caller changing
  // its message/schema objects while that hook waits must not change the POST.
  const wire = JSON.stringify({ id, model, messages, ...(onPrepared ? { receiptRetention: CODEX_DURABLE_RECEIPT_RETENTION_V1 } : {}),
    ...(outputSchema ? { outputSchema } : {}), ...(responseFormat ? { responseFormat } : {}) })
  const binding: Readonly<CodexRequestRefV1> = Object.freeze({ version: 1, provider: 'codex', requestId: id, model,
    requestHash: await sha256Text(wire), requestHashAlgorithm: CODEX_REQUEST_HASH_ALGORITHM_V1 })
  if (result) result.localCodexRequest = binding
  let terminal = false; let submitted = false; let observed = ''
  const cancel = () => { if (submitted && !terminal) void codexRequest(`/requests/${id}/cancel`, {}).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    await onPrepared?.(binding)
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
    // A lost acceptance response is an unknown result, never pre-dispatch safe-to-retry.
    submitted = true
    if (result) result.requestLifecycle = { phase: 'request-dispatched', responseStatus: null }
    await codexRequest('/requests', JSON.parse(wire))
    while (true) {
      if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
      const receipt = onPrepared ? await readBoundCodexReceiptV1(binding) : await codexRequest<CodexReceipt>(`/requests/${id}`)
      if (receipt.usage && result) result.usage = receipt.usage
      if (['failed', 'cancelled', 'unknown'].includes(receipt.status)) {
        terminal = true
        // Preserve unknown delivery on interrupted turns so durable callers cannot auto-replay.
        throw new Error(`${receipt.error || 'Codex 生成未完成。'}（请求 ${id}）`)
      }
      if (receipt.status === 'completed') {
        terminal = true
        if (!receipt.text.trim()) throw new Error('Codex 返回空内容。')
        if (result) { result.requestLifecycle = { phase: 'response-observed', responseStatus: 200 }; result.finishReason = 'stop' }
      }
      if (!receipt.text.startsWith(observed)) throw new Error('Codex 输出版本发生变化，请从请求记录检查结果。')
      if (receipt.text.length > observed.length) { const delta = receipt.text.slice(observed.length); observed = receipt.text; yield delta }
      if (terminal) return
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  } finally { cancel(); signal?.removeEventListener('abort', cancel) }
}

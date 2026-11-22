import { assertGenerationAvailable } from '../showcase/policy'
import type { ChatMessage } from '../types'
import type { TokenUsage } from './logger'
import type { ChatResult } from './client'
import { CodexTerminalFailureV1Schema } from './codex-terminal-failure'
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
  providerTurn?: { threadId: string; turnId: string; status: 'completed' | 'failed' | 'interrupted' }
  requestHash?: string; requestHashAlgorithm?: typeof CODEX_REQUEST_HASH_ALGORITHM_V1
  receiptRetention?: typeof CODEX_DURABLE_RECEIPT_RETENTION_V1; ownerAcknowledgedAt?: number
}
export function isLocalCodexHost(): boolean {
  return import.meta.env.MODE !== 'android' && typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
}
export async function codexRequest<T>(path: string, body?: unknown): Promise<T> {
  return codexSerializedRequest<T>(path, body === undefined ? undefined : JSON.stringify(body))
}

/** Shared host/headers/error boundary; prepared native requests keep exact bytes. */
async function codexSerializedRequest<T>(path: string, wire?: string): Promise<T> {
  assertGenerationAvailable()
  if (!isLocalCodexHost()) throw new Error('Codex 订阅连接需要本机运行 StoryForge；线上静态站点不能直接调用本机登录。')
  let response: Response
  try {
    response = await fetch(`${CODEX_BASE_URL}${path}`, {
      method: wire === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit',
      headers: { 'X-StoryForge-Codex': '1', ...(wire === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(wire === undefined ? {} : { body: wire }), signal: AbortSignal.timeout(45_000),
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

export class ModelDispatchGuardRejectedV1 extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : '模型请求未通过本地来源校验，未发送。')
    this.name = 'ModelDispatchGuardRejectedV1'
  }
}

export function modelDispatchWasCancelledV1(result?: ChatResult): boolean {
  return result?.modelDispatchGuardCancelled === true && result.requestLifecycle?.phase === 'pre-dispatch'
}

export async function assertModelDispatchGuardV1(result: ChatResult, signal?: AbortSignal): Promise<void> {
  try {
    signal?.throwIfAborted()
    await result.beforeModelDispatch?.()
    signal?.throwIfAborted()
  } catch (cause) {
    if (signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {
      result.modelDispatchGuardCancelled = true
      signal?.throwIfAborted()
      throw cause
    }
    throw new ModelDispatchGuardRejectedV1(cause)
  }
}

/** One ID, one submission. Polling reads receipts; it never resubmits inference. */
/** Host-only preparation is distinct from the legacy reference policy argument. */
export interface NativeCodexAssessmentContextV2 { readonly nativeAssessmentV2: unique symbol }
export interface NativePreparedRequestV2Handle { readonly nativePreparedV2: unique symbol }
const nativeAssessmentV2 = new WeakMap<NativeCodexAssessmentContextV2, { id: string; model: string; preparedWire?: string; dispatched?: true }>()
const nativePreparedV2 = new WeakMap<NativePreparedRequestV2Handle, {
  context: NativeCodexAssessmentContextV2; wire: string; binding: Readonly<CodexRequestRefV1>
}>()
function nativeOpaqueV2<T extends object>(): T {
  return Object.freeze(Object.defineProperty(Object.create(null), 'toJSON', {
    value: () => { throw new Error('本机准备句柄不得序列化。') },
  })) as T
}
export async function freezeNativeCodexAssessmentV2(model: string): Promise<NativeCodexAssessmentContextV2> {
  const status = await codexRequest<CodexStatus>('/status')
  if (status.state !== 'ready') throw new Error('请先连接本机 Codex 登录。')
  if (!model.trim() || model.length > 200) throw new Error('本机 Codex 模型身份无效。')
  const context = nativeOpaqueV2<NativeCodexAssessmentContextV2>()
  nativeAssessmentV2.set(context, { id: crypto.randomUUID(), model })
  return context
}
/** Pure synchronous serializer used by both range assessment and final prepare. */
export function serializeNativeCodexAssessmentV2(
  context: NativeCodexAssessmentContextV2, messages: readonly ChatMessage[],
  outputSchema?: Record<string, unknown>, responseFormat?: 'json_object',
): string {
  const state = nativeAssessmentV2.get(context)
  if (!state) throw new Error('本机请求准备身份无效。')
  if (responseFormat && outputSchema) throw new Error('不能同时声明两种本机结构协议。')
  return JSON.stringify({ id: state.id, model: state.model, messages,
    receiptRetention: CODEX_DURABLE_RECEIPT_RETENTION_V1,
    ...(outputSchema ? { outputSchema } : {}), ...(responseFormat ? { responseFormat } : {}) })
}
export async function prepareNativeCodexRequestV2(
  context: NativeCodexAssessmentContextV2, messages: readonly ChatMessage[],
  outputSchema?: Record<string, unknown>, responseFormat?: 'json_object',
): Promise<{ handle: NativePreparedRequestV2Handle; wire: string; binding: Readonly<CodexRequestRefV1> }> {
  const state = nativeAssessmentV2.get(context)
  if (!state) throw new Error('本机请求准备身份无效。')
  const wire = serializeNativeCodexAssessmentV2(context, messages, outputSchema, responseFormat)
  if (state.dispatched || state.preparedWire !== undefined && state.preparedWire !== wire) throw new Error('同一本机请求身份不能改绑或重发。')
  state.preparedWire = wire
  const binding: Readonly<CodexRequestRefV1> = Object.freeze({ version: 1, provider: 'codex',
    requestId: state.id, model: state.model, requestHash: await sha256Text(wire), requestHashAlgorithm: CODEX_REQUEST_HASH_ALGORITHM_V1 })
  const handle = nativeOpaqueV2<NativePreparedRequestV2Handle>()
  nativePreparedV2.set(handle, { context, wire, binding })
  return { handle, wire, binding }
}

export async function* streamCodex(
  messages: ChatMessage[], model: string, signal?: AbortSignal, result?: ChatResult, outputSchema?: Record<string, unknown>, responseFormat?: 'json_object', capacityPolicy?: 'reference-service', preparedRequestV2?: NativePreparedRequestV2Handle,
): AsyncGenerator<string> {
  if (result) {
    result.requestLifecycle = { phase: 'pre-dispatch', responseStatus: null }
    delete result.terminalFailure
    delete result.modelDispatchGuardCancelled
  }
  if (signal?.aborted) {
    if (result?.beforeModelDispatch) {
      result.modelDispatchGuardCancelled = true
      signal.throwIfAborted()
    }
    throw new DOMException('请求已取消', 'AbortError')
  }
  const prepared = preparedRequestV2 ? nativePreparedV2.get(preparedRequestV2) : undefined
  if (preparedRequestV2 && (!prepared || nativeAssessmentV2.get(prepared.context)?.dispatched || capacityPolicy
    || prepared.binding.model !== model
    || serializeNativeCodexAssessmentV2(prepared.context, messages, outputSchema, responseFormat) !== prepared.wire)) {
    throw new Error('本机冻结请求与实际派发参数不一致，未发送。')
  }
  if (!prepared) {
    const status = await codexRequest<CodexStatus>('/status')
    if (status.state !== 'ready') throw new Error(status.message || '请在设置中连接本机 Codex 的 ChatGPT 登录。')
    if (!model.trim()) throw new Error('请先刷新 Codex 模型目录并选择模型。')
  }
  const id = prepared?.binding.requestId ?? crypto.randomUUID()
  const onPrepared = result?.onCodexRequestPrepared
  const wire = prepared?.wire ?? JSON.stringify({ id, model, messages, ...(onPrepared ? { receiptRetention: CODEX_DURABLE_RECEIPT_RETENTION_V1 } : {}),
    ...(outputSchema ? { outputSchema } : {}), ...(responseFormat ? { responseFormat } : {}), ...(capacityPolicy ? { capacityPolicy } : {}) })
  const binding: Readonly<CodexRequestRefV1> = prepared?.binding ?? Object.freeze({ version: 1, provider: 'codex', requestId: id, model,
    requestHash: await sha256Text(wire), requestHashAlgorithm: CODEX_REQUEST_HASH_ALGORITHM_V1 })
  if (result) result.localCodexRequest = binding
  let terminal = false; let submitted = false; let observed = ''
  const cancel = () => { if (submitted && !terminal) void codexRequest(`/requests/${id}/cancel`, {}).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    await onPrepared?.(binding)
    if (result?.beforeModelDispatch) await assertModelDispatchGuardV1(result, signal)
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
    // A lost acceptance response is an unknown result, never pre-dispatch safe-to-retry.
    if (prepared) {
      const assessment = nativeAssessmentV2.get(prepared.context)
      if (!assessment || assessment.dispatched) throw new Error('原本机请求已经进入派发，不能重发。')
      assessment.dispatched = true
    }
    submitted = true
    if (result) result.requestLifecycle = { phase: 'request-dispatched', responseStatus: null }
    if (prepared) await codexSerializedRequest('/requests', wire)
    else await codexRequest('/requests', JSON.parse(wire))
    while (true) {
      if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
      const receipt = onPrepared || prepared ? await readBoundCodexReceiptV1(binding) : await codexRequest<CodexReceipt>(`/requests/${id}`)
      if (receipt.usage && result) result.usage = receipt.usage
      if (['failed', 'cancelled', 'unknown'].includes(receipt.status)) {
        terminal = true
        // Only a matching dispatched request with a consistent provider turn is definitive.
        // Bridge-local errors, old receipts, lost connections and mismatches stay unknown.
        if (result && receipt.id === id && receipt.model === model && receipt.dispatched === true
          && (receipt.status === 'failed' && receipt.providerTurn?.status === 'failed'
            || receipt.status === 'cancelled' && receipt.providerTurn?.status === 'interrupted')) {
          const failure = CodexTerminalFailureV1Schema.safeParse({version: 1, provider: 'codex', requestId: id, model,
            providerTurn: {threadId: receipt.providerTurn.threadId, turnId: receipt.providerTurn.turnId, status: receipt.providerTurn.status}})
          if (failure.success) result.terminalFailure = failure.data
        }
        // The dispatched boundary still prevents automatic inference replay, even with a receipt.
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

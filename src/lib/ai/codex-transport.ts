import type { ChatMessage } from '../types'
import type { TokenUsage } from './logger'
import type { ChatResult } from './client'

export const CODEX_BASE_URL = '/storyforge/local-codex/v1'
export interface CodexStatus { state: 'ready' | 'login-required' | 'wrong-auth'; label?: string; plan?: string; message?: string; version?: string }
export interface CodexModel { id: string; label: string; isDefault: boolean }
export interface CodexReceipt {
  id: string; model: string; createdAt: number
  status: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  text: string; dispatched: boolean; error?: string; usage?: TokenUsage
}
export function isLocalCodexHost(): boolean {
  return typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
}
export async function codexRequest<T>(path: string, body?: unknown): Promise<T> {
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
  let terminal = false; let submitted = false; let observed = ''
  const cancel = () => { if (submitted && !terminal) void codexRequest(`/requests/${id}/cancel`, {}).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
    // A lost acceptance response is an unknown result, never pre-dispatch safe-to-retry.
    submitted = true
    if (result) result.requestLifecycle = { phase: 'request-dispatched', responseStatus: null }
    await codexRequest('/requests', { id, model, messages, ...(outputSchema ? { outputSchema } : {}), ...(responseFormat ? { responseFormat } : {}) })
    while (true) {
      if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
      const receipt = await codexRequest<CodexReceipt>(`/requests/${id}`)
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

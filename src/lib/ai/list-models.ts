/**
 * OpenAI-compatible model list helper.
 * GET buildOpenAIEndpoint(baseUrl, 'models') — same base/proxy path as chat.
 */
import { buildOpenAIEndpoint } from './openai-endpoint'

export type ListModelsConfig = {
  baseUrl: string
  apiKey: string
  provider?: string
  model?: string
}

export type ListModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; message: string }

const LIST_TIMEOUT_MS = 15_000

/** Short, non-overconfident hint by status class (list /models only). */
function chineseStatusHint(status: number): string {
  if (status === 401 || status === 403) return '认证或权限失败'
  if (status === 404) return '接口不存在'
  if (status >= 500) return '服务端错误'
  if (status === 429) return '请求过于频繁'
  return ''
}

/**
 * From OpenAI-like `{ data: Array }` extract unique non-empty string ids
 * from each item's `id` or fallback `name`. Sort with localeCompare.
 * Wrong shape → [].
 */
export function parseOpenAIModelsResponse(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const data = (json as { data?: unknown }).data
  if (!Array.isArray(data)) return []

  const seen = new Set<string>()
  const out: string[] = []

  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { id?: unknown; name?: unknown }
    let id: string | null = null
    if (typeof rec.id === 'string' && rec.id.trim()) {
      id = rec.id.trim()
    } else if (typeof rec.name === 'string' && rec.name.trim()) {
      id = rec.name.trim()
    }
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }

  out.sort((a, b) => a.localeCompare(b))
  return out
}

/**
 * List models via OpenAI-compatible GET /models.
 * Does not mutate config. Chinese-friendly errors on network/HTTP failure.
 */
export async function listOpenAIModels(
  config: ListModelsConfig,
): Promise<ListModelsResult> {
  const url = buildOpenAIEndpoint(config.baseUrl, 'models')
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`
    }

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers,
    })

    if (response.ok) {
      let json: unknown
      try {
        json = await response.json()
      } catch {
        return { ok: true, models: [] }
      }
      return { ok: true, models: parseOpenAIModelsResponse(json) }
    }

    const status = response.status
    let detail = ''
    try {
      const bodyText = await response.text()
      try {
        const errJson = JSON.parse(bodyText) as {
          error?: { message?: string }
          message?: string
          error_msg?: string
        }
        if (errJson.error?.message) detail = errJson.error.message
        else if (errJson.message) detail = errJson.message
        else if (errJson.error_msg) detail = errJson.error_msg
        else if (bodyText.length > 0 && bodyText.length < 200) detail = bodyText
      } catch {
        if (bodyText.length > 0 && bodyText.length < 200) detail = bodyText
      }
    } catch {
      // ignore body read failures
    }

    const hint = chineseStatusHint(status)
    // Always keep HTTP status in the final message (detail/hint may omit it).
    const parts = [`HTTP ${status}`]
    if (detail) parts.push(detail)
    if (hint) parts.push(hint)
    return { ok: false, message: parts.join(' · ') }
  } catch (err: unknown) {
    const error = err as Error
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      return {
        ok: false,
        message:
          '网络错误 — 可能原因：1) 网络不通 2) 该平台不支持浏览器直接调用(CORS) 3) Base URL 错误',
      }
    }
    if (error.name === 'AbortError') {
      return { ok: false, message: '请求超时' }
    }
    return { ok: false, message: error.message || '未知错误' }
  } finally {
    clearTimeout(timeoutId)
  }
}

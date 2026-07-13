import { buildOpenAIEndpoint } from './openai-endpoint'

interface FetchOpenAIModelsOptions {
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export async function fetchOpenAIModels({
  baseUrl,
  apiKey = '',
  timeoutMs = 10_000,
  fetchImpl = fetch,
}: FetchOpenAIModelsOptions): Promise<string[]> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(buildOpenAIEndpoint(baseUrl, 'models'), {
      method: 'GET',
      signal: controller.signal,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    })

    if (!response.ok) {
      throw new Error(`模型列表请求失败（HTTP ${response.status}）`)
    }

    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) {
      throw new Error('模型列表响应格式无效，服务需兼容 OpenAI /v1/models')
    }

    const models = (body as { data: unknown[] }).data
      .map(item => item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map(id => id.trim())

    return [...new Set(models)].sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('刷新模型列表超时，请确认本地模型服务已启动')
    }
    if (error instanceof TypeError) {
      throw new Error('无法连接模型服务，请检查 Base URL、服务状态或 CORS 设置')
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}


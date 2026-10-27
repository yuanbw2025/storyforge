import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIConfig } from '../../src/lib/types/ai'

const base: AIConfig = { provider: 'poe', baseUrl: 'https://api.poe.com/v1', model: 'GPT-4o', apiKey: 'synthetic-only', temperature: 0.3, maxTokens: 1024 }

async function client(config: AIConfig) {
  vi.resetModules()
  const { useAIConfigStore } = await import('../../src/stores/ai-config')
  useAIConfigStore.setState({ config, taskRoutes: {} })
  return import('../../src/lib/ai/client')
}

function sse(withUsage: boolean) {
  const chunks = ['data: {"choices":[{"delta":{"content":"合成协议回执"},"finish_reason":null}]}', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}']
  if (withUsage) chunks.push('data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}')
  chunks.push('data: [DONE]')
  return new Response(chunks.join('\n\n') + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
}

afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.resetModules() })

describe('issue218 · 官方兼容端点输出预算与流式用量', () => {
  it.each([
    ['poe', 'https://api.poe.com/v1'],
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'], ['gemini', '/gemini-proxy/v1beta/openai'],
  ] as const)('仅实际支持的官方目标请求并读取 usage-only SSE：%s %s', async (provider, baseUrl) => {
    const config = { ...base, provider, baseUrl, model: provider === 'gemini' ? 'gemini-3.5-flash' : base.model }
    const { streamChat } = await client(config)
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => sse(JSON.parse(String(init.body)).stream_options?.include_usage === true))
    vi.stubGlobal('fetch', fetch)
    const result: import('../../src/lib/ai/client').StreamResult = {}
    let text = ''
    for await (const chunk of streamChat([{ role: 'user', content: '合成请求' }], config, undefined, result)) text += chunk
    expect(text).toBe('合成协议回执')
    expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('Poe 已配置的正数预算实际发送且记录，保留原采样策略', async () => {
    const config = { ...base }
    const { chat, resolveRequestConfig, describeResolvedAIRequestSettingsV1 } = await client(config)
    let body: Record<string, unknown> = {}
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body))
      return new Response('{"choices":[{"message":{"content":"合成协议回执"},"finish_reason":"stop"}]}')
    })
    vi.stubGlobal('fetch', fetch)
    await chat([{ role: 'user', content: '合成请求' }], config)
    expect(body.max_tokens).toBe(1024)
    expect(body).not.toHaveProperty('temperature')
    const observed = describeResolvedAIRequestSettingsV1(resolveRequestConfig(config), false)
    expect(observed.requested.maxTokens).toBe(1024)
    expect(observed.parameters.max_tokens).toBe(1024)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['https://example.invalid/private/v1', 'https://api.poe.com.example.invalid/v1', '/poe-proxy/v1'])('私有或未登记的 Poe 地址不继承官方新参数：%s', async baseUrl => {
    const config = { ...base, baseUrl }
    const { streamChat } = await client(config)
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body).not.toHaveProperty('stream_options')
      expect(body).not.toHaveProperty('max_tokens')
      expect(body).not.toHaveProperty('temperature')
      return sse(false)
    })
    vi.stubGlobal('fetch', fetch)
    const result: import('../../src/lib/ai/client').StreamResult = {}
    for await (const _chunk of streamChat([{ role: 'user', content: '合成请求' }], config, undefined, result)) { /* drain */ }
    expect(result.usage).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('Poe 的零预算保留原服务默认含义，不发送零或新的上限', async () => {
    const config = { ...base, maxTokens: 0 }
    const { chat } = await client(config)
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).not.toHaveProperty('max_tokens')
      return new Response('{"choices":[{"message":{"content":"合成协议回执"},"finish_reason":"stop"}]}')
    })
    vi.stubGlobal('fetch', fetch)
    await expect(chat([{ role: 'user', content: '合成请求' }], config)).resolves.toBe('合成协议回执')
    expect(config.maxTokens).toBe(0)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('私有 Gemini 保留原正数预算和采样合同，不注入官方 usage 标志', async () => {
    const config: AIConfig = { ...base, provider: 'gemini', baseUrl: 'https://example.invalid/private/v1', model: 'gemini-3.5-flash' }
    const { streamChat } = await client(config)
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body).toMatchObject({ max_tokens: 1024, temperature: 0.3 })
      expect(body).not.toHaveProperty('stream_options')
      return sse(false)
    })
    vi.stubGlobal('fetch', fetch)
    const result: import('../../src/lib/ai/client').StreamResult = {}
    for await (const _chunk of streamChat([{ role: 'user', content: '合成请求' }], config, undefined, result)) { /* drain */ }
    expect(result.usage).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('请求 usage 后服务仍未提供时保持未知，不推算实际账单', async () => {
    const { streamChat } = await client(base)
    vi.stubGlobal('fetch', vi.fn(async () => sse(false)))
    const result: import('../../src/lib/ai/client').StreamResult = {}
    for await (const _chunk of streamChat([{ role: 'user', content: '合成请求' }], base, undefined, result)) { /* drain */ }
    expect(result.usage).toBeUndefined()
  })

  it('Poe 拒绝参数时保留 400，不剥预算或隐藏重发', async () => {
    const { chat } = await client(base)
    const fetch = vi.fn(async () => new Response('{"error":{"message":"synthetic parameter rejection"}}', { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    await expect(chat([{ role: 'user', content: '合成请求' }], base)).rejects.toThrow(/400/)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(base.maxTokens).toBe(1024)
  })
})

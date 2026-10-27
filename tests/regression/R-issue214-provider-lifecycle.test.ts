import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIConfig } from '../../src/lib/types/ai'

const key = 'storyforge-ai-config'
const saved: AIConfig = { provider: 'gemini', model: 'gemini-3.6-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: '', temperature: 0.3, maxTokens: 1024 }

async function freshStore() {
  vi.resetModules()
  return (await import('../../src/stores/ai-config')).useAIConfigStore
}

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('issue214 · 作者模型与提供商生命周期', () => {
  it('新模型可保存为预设，刷新和重新应用后保持 ID 与 endpoint，不串用凭据', async () => {
    const store = await freshStore()
    store.getState().setConfig({ ...saved, apiKey: 'synthetic-session-only' })
    expect(store.getState().config.model).toBe(saved.model)
    const id = store.getState().saveAsPreset('合成兼容性预设')
    const reloaded = await freshStore()
    reloaded.getState().applyPreset(id)
    expect(reloaded.getState().config).toMatchObject({ ...saved, apiKey: 'synthetic-session-only' })
    expect(JSON.parse(localStorage.getItem(key)!).apiKey).toBe('')
  })

  it.each([
    saved,
    { ...saved, model: 'author-chosen-model-not-in-catalog', baseUrl: 'https://example.invalid/author-gateway/v9' },
    { ...saved, model: 'gemini-2.0-flash' },
  ])('启动恢复保留作者记录：$model', async config => {
    const raw = JSON.stringify(config)
    localStorage.setItem(key, raw)
    sessionStorage.setItem('storyforge-ai-api-key-session', 'synthetic-session-only')
    const store = await freshStore()
    expect(store.getState().config).toMatchObject({ ...config, apiKey: 'synthetic-session-only' })
    expect(localStorage.getItem(key)).toBe(raw)
  })

  it('新 Claude 型号的 SSE 正文、实际 usage 和请求参数回执保持一致', async () => {
    const store = await freshStore()
    const config: AIConfig = { ...saved, provider: 'claude', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'synthetic-only' }
    store.setState({ config, taskRoutes: {} })
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body).toMatchObject({ model: config.model, stream: true, max_tokens: 1024, stream_options: { include_usage: true } })
      expect(body).not.toHaveProperty('temperature')
      return new Response([
        'data: {"choices":[{"delta":{"content":"合成回执"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}',
        'data: [DONE]',
      ].join('\n\n') + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetch)
    const { streamChat, resolveRequestConfig, describeResolvedAIRequestSettingsV1 } = await import('../../src/lib/ai/client')
    const result: import('../../src/lib/ai/client').StreamResult = {}
    let text = ''
    for await (const chunk of streamChat([{ role: 'user', content: '合成协议回归' }], config, undefined, result)) text += chunk
    expect(text).toBe('合成回执')
    expect(result.usage).toMatchObject({ inputTokens: 2, outputTokens: 3 })
    const receipt = describeResolvedAIRequestSettingsV1(resolveRequestConfig(config), true)
    expect(receipt.requested.temperature).toBe(0.3)
    expect(receipt.parameters).not.toHaveProperty('temperature')
    expect(receipt.model).toBe(config.model)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('作者保留的退役 ID 收到 404 时不换型号或隐藏重发', async () => {
    const store = await freshStore()
    const config: AIConfig = { ...saved, provider: 'claude', model: 'claude-sonnet-4-20250514', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'synthetic-only' }
    store.setState({ config, taskRoutes: {} })
    const fetch = vi.fn(async () => new Response('{"error":{"message":"synthetic retired model"}}', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    const { chat } = await import('../../src/lib/ai/client')
    const result: import('../../src/lib/ai/client').ChatResult = {}
    await expect(chat([{ role: 'user', content: '合成协议回归' }], config, undefined, undefined, result)).rejects.toThrow(/404/)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(config.model).toBe('claude-sonnet-4-20250514')
    expect(result.requestLifecycle).toMatchObject({ phase: 'response-observed', responseStatus: 404 })
  })

  it('作者清空模型输入时保留未完成状态，不偷偷换回预设模型', async () => {
    const store = await freshStore()
    store.getState().setConfig({ ...saved, model: '' })
    expect(store.getState().config.model).toBe('')
  })

  it('新建 Claude 配置可以完成合成请求，不再以已退役默认 ID 发请求', async () => {
    const store = await freshStore()
    store.getState().switchProvider('claude')
    store.getState().setConfig({ apiKey: 'synthetic-claude-only' })
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (body.model === 'claude-sonnet-4-20250514') return new Response(JSON.stringify({ error: { message: 'synthetic retired model' } }), { status: 404 })
      return new Response(JSON.stringify({ choices: [{ message: { content: '合成回执' }, finish_reason: 'stop' }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    const { chat } = await import('../../src/lib/ai/client')
    await expect(chat([{ role: 'user', content: '合成协议回归' }], store.getState().config)).resolves.toBe('合成回执')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['https://api.anthropic.com/v1', 'claude-sonnet-5-5', false],
    ['/claude-proxy/v1', 'claude-sonnet-5-5', false],
    ['https://api.anthropic.com/v1', 'claude-sonnet-4-6', true],
    ['https://example.invalid/v1', 'claude-sonnet-5-5', true],
    ['https://api.anthropic.com.example.invalid/v1', 'claude-sonnet-5-5', true],
  ] as const)('采样参数按官方目标与型号处理：%s / %s', async (baseUrl, model, keepsTemperature) => {
    const store = await freshStore()
    const config: AIConfig = { ...saved, provider: 'claude', baseUrl, model }
    store.setState({ config, taskRoutes: {} })
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body.model).toBe(model)
      expect(body.max_tokens).toBe(1024)
      expect(body.temperature).toBe(keepsTemperature ? 0.3 : undefined)
      return new Response(JSON.stringify({ choices: [{ message: { content: '合成回执' }, finish_reason: 'stop' }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    const { chat } = await import('../../src/lib/ai/client')
    await expect(chat([{ role: 'user', content: '合成协议回归' }], config)).resolves.toBe('合成回执')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.getState().config).toEqual(config)
  })
})

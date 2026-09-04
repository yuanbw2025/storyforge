import { afterEach, describe, expect, it, vi } from 'vitest'
import { getModelPreset } from '../../src/lib/ai/context-budget'
import { PROVIDER_MODELS, PROVIDER_PRESETS } from '../../src/lib/types'

const CONFIG_KEY = 'storyforge-ai-config'
const SESSION_KEY = 'storyforge-ai-api-key-session'
const PRESET_SESSION_KEYS = 'storyforge-ai-preset-api-keys-session'
const REMEMBER_KEY = 'storyforge-ai-api-key-remember'

async function freshStore() {
  vi.resetModules()
  const mod = await import('../../src/stores/ai-config')
  return mod.useAIConfigStore
}

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('R-AI-CONFIG · API Key 存储策略', () => {
  it('默认只把 API Key 存入 sessionStorage,localStorage 配置不落 key', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-session' })

    expect(useAIConfigStore.getState().rememberApiKey).toBe(false)
    expect(sessionStorage.getItem(SESSION_KEY)).toBe('sk-session')
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').apiKey).toBe('')
    expect(localStorage.getItem(REMEMBER_KEY)).toBe('false')
  })

  it('显式记住本机时才把 API Key 写入 localStorage', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setRememberApiKey(true)
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-local' })

    expect(useAIConfigStore.getState().rememberApiKey).toBe(true)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').apiKey).toBe('sk-local')
    expect(localStorage.getItem(REMEMBER_KEY)).toBe('true')
  })

  it('没有当前显式记住标记时拒绝读取 localStorage 中的残留 API Key', async () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      provider: 'deepseek',
      apiKey: 'sk-residual',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      temperature: 0.7,
      maxTokens: 0,
    }))

    const useAIConfigStore = await freshStore()

    expect(useAIConfigStore.getState().rememberApiKey).toBe(false)
    expect(useAIConfigStore.getState().config.apiKey).toBe('')
  })

  it('session-only 模式保存预设时不把当前 API Key 写进预设 localStorage', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-session' })
    useAIConfigStore.getState().saveAsPreset('会话预设')

    const presets = JSON.parse(localStorage.getItem('storyforge-ai-presets') || '[]')
    expect(presets[0].config.apiKey).toBe('')
  })

  it('session-only 模式按预设隔离 API Key，跨 provider 切换和刷新都不串用', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({
      provider: 'agnes',
      model: 'agnes-2.5-flash',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      apiKey: 'agnes-session-key',
    })
    const agnesId = useAIConfigStore.getState().saveAsPreset('Agnes')
    useAIConfigStore.getState().setConfig({
      provider: 'doubao',
      model: 'doubao-1-5-pro-32k-250115',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'doubao-session-key',
    })
    const doubaoId = useAIConfigStore.getState().saveAsPreset('豆包文本')

    const persistedPresets = JSON.parse(localStorage.getItem('storyforge-ai-presets') || '[]')
    expect(persistedPresets.map((preset: { config: { apiKey: string } }) => preset.config.apiKey)).toEqual(['', ''])
    expect(JSON.parse(sessionStorage.getItem(PRESET_SESSION_KEYS) || '{}')).toEqual({
      [agnesId]: 'agnes-session-key',
      [doubaoId]: 'doubao-session-key',
    })

    useAIConfigStore.getState().applyPreset(agnesId)
    expect(useAIConfigStore.getState().config.apiKey).toBe('agnes-session-key')
    useAIConfigStore.getState().applyPreset(doubaoId)
    expect(useAIConfigStore.getState().config.apiKey).toBe('doubao-session-key')

    const reloadedStore = await freshStore()
    reloadedStore.getState().applyPreset(agnesId)
    expect(reloadedStore.getState().config.apiKey).toBe('agnes-session-key')
    reloadedStore.getState().applyPreset(doubaoId)
    expect(reloadedStore.getState().config.apiKey).toBe('doubao-session-key')
    reloadedStore.getState().deletePreset(doubaoId)
    expect(JSON.parse(sessionStorage.getItem(PRESET_SESSION_KEYS) || '{}')).toEqual({
      [agnesId]: 'agnes-session-key',
    })
  })

  it('缺少预设会话 Key 时不跨 provider 继承当前 Key', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({
      provider: 'doubao',
      model: 'doubao-1-5-pro-32k-250115',
      apiKey: '',
    })
    const doubaoId = useAIConfigStore.getState().saveAsPreset('无 Key 豆包')
    useAIConfigStore.getState().setConfig({
      provider: 'agnes',
      model: 'agnes-2.5-flash',
      apiKey: 'agnes-only-key',
    })

    useAIConfigStore.getState().applyPreset(doubaoId)

    expect(useAIConfigStore.getState().config.provider).toBe('doubao')
    expect(useAIConfigStore.getState().config.apiKey).toBe('')
  })

  it('应用预设后修改配置仍保留可覆盖的来源预设，官方 provider 只保存当前登记模型', async () => {
    const useAIConfigStore = await freshStore()
    const id = useAIConfigStore.getState().saveAsPreset('主力配置')
    useAIConfigStore.getState().applyPreset(id)
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://example.com/v1', model: 'new-model' })

    expect(useAIConfigStore.getState().activePresetId).toBeNull()
    expect(useAIConfigStore.getState().editingPresetId).toBe(id)

    useAIConfigStore.getState().updatePresetFromCurrent(id)
    const preset = useAIConfigStore.getState().presets.find(p => p.id === id)
    expect(preset?.config.baseUrl).toBe('https://example.com/v1')
    expect(preset?.config.model).toBe(PROVIDER_PRESETS.deepseek?.model)
    expect(useAIConfigStore.getState().activePresetId).toBe(id)
  })

  it('上下文窗口即时持久化，修改模型和切换 provider 不会静默清除', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ contextWindow: 2_100_000 })
    useAIConfigStore.getState().setConfig({ model: 'custom-model' })
    useAIConfigStore.getState().switchProvider('ollama')

    expect(useAIConfigStore.getState().config.contextWindow).toBe(2_100_000)
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').contextWindow).toBe(2_100_000)

    const reloadedStore = await freshStore()
    expect(reloadedStore.getState().config.contextWindow).toBe(2_100_000)
  })

  it('保存和应用预设时明确采用预设中的上下文窗口', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ contextWindow: 131_072 })
    const id = useAIConfigStore.getState().saveAsPreset('128K 本地模型')
    useAIConfigStore.getState().setConfig({ contextWindow: 2_100_000 })
    useAIConfigStore.getState().applyPreset(id)

    expect(useAIConfigStore.getState().config.contextWindow).toBe(131_072)
    expect(useAIConfigStore.getState().presets.find(preset => preset.id === id)?.config.contextWindow).toBe(131_072)
  })

  it('LongCat provider 使用官方 OpenAI 兼容端点和 1M 上下文预设', async () => {
    expect(PROVIDER_PRESETS.longcat?.baseUrl).toBe('https://api.longcat.chat/openai/v1')
    expect(PROVIDER_PRESETS.longcat?.model).toBe('LongCat-2.0')
    expect(PROVIDER_MODELS.longcat?.[0]?.value).toBe('LongCat-2.0')

    const preset = getModelPreset('longcat', 'LongCat-2.0')
    expect(preset.maxContext).toBe(1_000_000)
    expect(preset.maxOutput).toBe(128_000)

    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().switchProvider('longcat')
    expect(useAIConfigStore.getState().config.baseUrl).toBe('https://api.longcat.chat/openai/v1')
    expect(useAIConfigStore.getState().config.model).toBe('LongCat-2.0')
  })

  it('Agnes provider 使用当前官方模型 ID 和上下文预设', async () => {
    expect(PROVIDER_PRESETS.agnes?.baseUrl).toBe('https://apihub.agnes-ai.com/v1')
    expect(PROVIDER_PRESETS.agnes?.model).toBe('agnes-2.5-flash')
    expect(PROVIDER_MODELS.agnes?.map(model => model.value)).toEqual([
      'agnes-2.5-flash',
      'agnes-2.5-pro',
      'agnes-2.5-pro-alpha',
      'agnes-2.0-flash',
    ])

    expect(getModelPreset('agnes', 'agnes-2.5-flash')).toMatchObject({
      maxContext: 524_288,
      maxOutput: 65_536,
    })
    expect(getModelPreset('agnes', 'agnes-2.5-pro').maxContext).toBe(524_288)
    expect(getModelPreset('agnes', 'agnes-2.0-flash').maxContext).toBe(262_144)

    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().switchProvider('agnes')
    expect(useAIConfigStore.getState().config.baseUrl).toBe('https://apihub.agnes-ai.com/v1')
    expect(useAIConfigStore.getState().config.model).toBe('agnes-2.5-flash')
  })

  it('DeepSeek、Gemini 与 NVIDIA 使用 2026-08 官方端点、模型 ID 和窗口', async () => {
    expect(PROVIDER_PRESETS.deepseek).toMatchObject({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash',
    })
    expect(PROVIDER_MODELS.deepseek?.map(model => model.value)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ])
    expect(getModelPreset('deepseek', 'deepseek-v4-pro')).toMatchObject({
      maxContext: 1_000_000,
      maxOutput: 384_000,
    })

    expect(PROVIDER_PRESETS.gemini).toMatchObject({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.5-flash',
    })
    expect(PROVIDER_MODELS.gemini?.map(model => model.value)).toContain('gemini-3.5-flash')
    expect(getModelPreset('gemini', 'gemini-3.5-flash')).toMatchObject({
      maxContext: 1_048_576,
      maxOutput: 65_536,
    })

    expect(PROVIDER_PRESETS.nvidia).toMatchObject({
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      model: 'mistralai/mistral-nemotron',
    })
    expect(PROVIDER_MODELS.nvidia?.map(model => model.value)).toEqual(expect.arrayContaining([
      'deepseek-ai/deepseek-v4-flash-0731',
      'minimaxai/minimax-m3',
    ]))
    expect(getModelPreset('nvidia', 'deepseek-ai/deepseek-v4-flash-0731')).toMatchObject({
      maxContext: 1_000_000,
      maxOutput: 384_000,
    })
  })

  it('加载时拒绝官方提供商未登记的模型 ID 并回到当前默认模型', async () => {
    localStorage.setItem(REMEMBER_KEY, 'true')
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      provider: 'deepseek',
      apiKey: 'deepseek-key',
      model: 'retired-model-id',
      baseUrl: 'https://api.deepseek.com/v1',
      temperature: 0.7,
      maxTokens: 0,
    }))
    const useAIConfigStore = await freshStore()
    expect(useAIConfigStore.getState().config.model).toBe('deepseek-v4-flash')
    expect(useAIConfigStore.getState().config.apiKey).toBe('deepseek-key')
  })

  it('Agnes 模型 ID 大小写不匹配时拒绝猜测并回到当前默认模型', async () => {
    localStorage.setItem(REMEMBER_KEY, 'true')
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      provider: 'agnes',
      apiKey: 'agnes-key',
      model: 'AGNES-NOT-REGISTERED',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      temperature: 0.7,
      maxTokens: 0,
    }))

    const useAIConfigStore = await freshStore()

    expect(useAIConfigStore.getState().config.model).toBe('agnes-2.5-flash')
    expect(useAIConfigStore.getState().config.apiKey).toBe('agnes-key')
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')).toMatchObject({
      provider: 'agnes',
      apiKey: 'agnes-key',
      model: 'agnes-2.5-flash',
    })
    expect(getModelPreset('agnes', 'AGNES-NOT-REGISTERED').maxContext).toBe(524_288)
  })

  it('豆包 provider 只接受当前方舟在线推理模型', async () => {
    expect(PROVIDER_PRESETS.doubao?.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3')
    expect(PROVIDER_PRESETS.doubao?.model).toBe('doubao-1-5-pro-32k-250115')
    expect(PROVIDER_MODELS.doubao?.map(model => model.value)).toEqual([
      'doubao-1-5-pro-32k-250115',
      'deepseek-v4-flash-ga-260731',
      'deepseek-v4-pro-260425',
      'deepseek-v4-flash-260425',
    ])
    expect(getModelPreset('doubao', 'doubao-1-5-pro-32k-250115')).toMatchObject({
      maxContext: 32_000,
      maxOutput: 4_096,
    })
    expect(getModelPreset('doubao', 'deepseek-v4-flash-ga-260731')).toMatchObject({
      maxContext: 128_000,
      maxOutput: 8_192,
    })
    expect(getModelPreset('doubao', 'deepseek-v4-pro-260425')).toMatchObject({
      maxContext: 128_000,
      maxOutput: 16_384,
    })

    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      provider: 'doubao',
      apiKey: '',
      model: 'retired-model-id',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      temperature: 0.7,
      maxTokens: 0,
    }))
    const useAIConfigStore = await freshStore()
    expect(useAIConfigStore.getState().config.model).toBe('doubao-1-5-pro-32k-250115')
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').model).toBe('doubao-1-5-pro-32k-250115')
  })
})

describe('R-AI-CONFIG · 连接测试错误分类', () => {
  it('成功时明确说明只是最小连接，不把短请求冒充任务级可用', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ apiKey: 'provider-test' })

    const result = await useAIConfigStore.getState().testConnection()

    expect(result.ok).toBe(true)
    expect(result.message).toContain('最小连接成功')
    expect(result.message).toContain('不代表长输出或批量评测额度')
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({ max_tokens: 32 })
  })

  it('解析 Gemini 数组错误并明确区分地区限制与模型或 Key 错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify([{
        error: {
          code: 400,
          message: 'User location is not supported for the API use.',
          status: 'FAILED_PRECONDITION',
        },
      }]),
    }))
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ provider: 'gemini', apiKey: 'gemini-test' })

    const result = await useAIConfigStore.getState().testConnection()

    expect(result.ok).toBe(false)
    expect(result.message).toContain('请求所在地不在该平台 API 支持范围内')
    expect(result.message).not.toContain('API Key 无效')
  })
  it('把方舟 403 AccountOverdueError 识别为账户欠费而不是 Key 权限不足', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({
        error: {
          code: 'AccountOverdueError',
          message: 'The request failed because your account has an overdue balance.',
        },
      }),
    }))
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ apiKey: 'ark-test' })

    const result = await useAIConfigStore.getState().testConnection()

    expect(result.ok).toBe(false)
    expect(result.statusCode).toBe(403)
    expect(result.message).toContain('账户存在逾期欠费')
    expect(result.message).not.toContain('API Key 权限不足')
  })

  it('不把 HTTP 402 余额不足误报为连接成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => JSON.stringify({ error: { message: 'insufficient balance' } }),
    }))
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ apiKey: 'ark-test' })

    const result = await useAIConfigStore.getState().testConnection()

    expect(result.ok).toBe(false)
    expect(result.statusCode).toBe(402)
    expect(result.message).toContain('账户余额不足')
    expect(result.message).not.toContain('连接成功')
  })
})

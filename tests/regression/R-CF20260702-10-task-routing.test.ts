import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { AIConfig, AIConfigPreset } from '../../src/lib/types'
import {
  classifyAITask,
  resolveAIConfigForTask,
} from '../../src/lib/ai/task-routing'

const globalConfig: AIConfig = {
  provider: 'deepseek',
  apiKey: 'global-key',
  model: 'deepseek-v4-flash',
  baseUrl: 'https://global.example/v1',
  temperature: 0.7,
  maxTokens: 0,
}

function preset(id: string, config: Partial<AIConfig> = {}): AIConfigPreset {
  return {
    id,
    name: id,
    config: {
      ...globalConfig,
      provider: 'custom',
      apiKey: '',
      model: `${id}-model`,
      baseUrl: `https://${id}.example/v1`,
      ...config,
    },
  }
}

describe('R-CF20260702-10 · task classification and resolution', () => {
  it.each([
    ['chapter.content', 'creation'],
    ['outline.volume', 'creation'],
    ['worldview.dimension', 'creation'],
    ['state.extract', 'extraction'],
    ['chapter.memory', 'extraction'],
    ['foreshadow.structure', 'extraction'],
    ['ai.restructure', 'extraction'],
    ['import.parse-chunk', 'extraction'],
    ['reference.analysis', 'analysis'],
    ['style.learn', 'analysis'],
    ['review.quality', 'review'],
    ['chapter.deai', 'review'],
    ['scene.verify', 'review'],
  ] as const)('classifies %s as %s', (category, taskKind) => {
    expect(classifyAITask(category)).toBe(taskKind)
  })

  it('leaves unknown categories on the global model', () => {
    expect(classifyAITask('plugin.future-action')).toBeNull()
    const resolved = resolveAIConfigForTask({
      category: 'plugin.future-action',
      requestedConfig: globalConfig,
      globalConfig,
      presets: [preset('creation')],
      routes: { creation: 'creation' },
    })
    expect(resolved.config).toBe(globalConfig)
    expect(resolved.presetId).toBeNull()
  })

  it('routes all four task kinds through existing presets and preserves call maxTokens', () => {
    const presets = [
      preset('creation'),
      preset('extraction'),
      preset('analysis'),
      preset('review'),
    ]
    const routes = {
      creation: 'creation',
      extraction: 'extraction',
      analysis: 'analysis',
      review: 'review',
    } as const

    const cases = [
      ['chapter.content', 'creation'],
      ['state.extract', 'extraction'],
      ['reference.analysis', 'analysis'],
      ['review.quality', 'review'],
    ] as const

    for (const [category, presetId] of cases) {
      const resolved = resolveAIConfigForTask({
        category,
        requestedConfig: { ...globalConfig, maxTokens: 16_384 },
        globalConfig,
        presets,
        routes,
        explicitOverrides: { maxTokens: 16_384 },
      })
      expect(resolved.presetId).toBe(presetId)
      expect(resolved.config.model).toBe(`${presetId}-model`)
      expect(resolved.config.maxTokens).toBe(16_384)
    }
  })

  it('falls back when a route references a deleted preset or a cloud preset without its own key', () => {
    const missingPreset = resolveAIConfigForTask({
      category: 'review.quality',
      requestedConfig: globalConfig,
      globalConfig,
      presets: [],
      routes: { review: 'deleted' },
    })
    expect(missingPreset.config).toBe(globalConfig)
    expect(missingPreset.fallbackReason).toBe('missing-preset')

    const cloudWithoutKey = preset('cloud', {
      provider: 'gemini',
      apiKey: '',
      baseUrl: 'https://gemini.example/v1',
    })
    const missingKey = resolveAIConfigForTask({
      category: 'reference.summary',
      requestedConfig: globalConfig,
      globalConfig,
      presets: [cloudWithoutKey],
      routes: { analysis: 'cloud' },
    })
    expect(missingKey.config).toBe(globalConfig)
    expect(missingKey.fallbackReason).toBe('missing-api-key')
  })
})

describe('R-CF20260702-10 · route storage and client boundary', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    vi.resetModules()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  it('persists route bindings and removes bindings when their preset is deleted', async () => {
    const { useAIConfigStore, TASK_ROUTES_KEY } = await import('../../src/stores/ai-config')
    const id = useAIConfigStore.getState().saveAsPreset('写作模型')
    useAIConfigStore.getState().setTaskRoute('creation', id)

    expect(JSON.parse(localStorage.getItem(TASK_ROUTES_KEY) || '{}')).toEqual({ creation: id })

    vi.resetModules()
    const fresh = await import('../../src/stores/ai-config')
    expect(fresh.useAIConfigStore.getState().taskRoutes).toEqual({ creation: id })

    fresh.useAIConfigStore.getState().deletePreset(id)
    expect(fresh.useAIConfigStore.getState().taskRoutes).toEqual({})
    expect(JSON.parse(localStorage.getItem(TASK_ROUTES_KEY) || '{}')).toEqual({})
  })

  it('routes a real chat request and logs the actual provider, model and task kind', async () => {
    const routed = preset('local-writer', {
      provider: 'ollama',
      model: 'qwen-local',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      maxTokens: 2_048,
      contextWindow: 131_072,
    })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://localhost:11434/v1/chat/completions')
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('qwen-local')
      expect(body.max_tokens).toBe(8_192)
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { useAIConfigStore } = await import('../../src/stores/ai-config')
    useAIConfigStore.setState({
      config: globalConfig,
      presets: [routed],
      taskRoutes: { creation: routed.id },
    })
    const { chat } = await import('../../src/lib/ai/client')
    await expect(chat(
      [{ role: 'user', content: 'write' }],
      { ...globalConfig, maxTokens: 8_192 },
      { category: 'chapter.content', projectId: 7 },
    )).resolves.toBe('ok')

    await vi.waitFor(async () => {
      const entry = await db.aiUsageLog.toCollection().last()
      expect(entry).toMatchObject({
        projectId: 7,
        category: 'chapter.content',
        provider: 'ollama',
        model: 'qwen-local',
        taskKind: 'creation',
        inputTokens: 11,
        outputTokens: 7,
      })
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

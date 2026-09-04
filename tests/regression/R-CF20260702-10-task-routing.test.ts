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
    ['style.calibrate', 'creation'],
    ['review.quality', 'review'],
    ['chapter.deai', 'review'],
    ['scene.verify', 'review'],
    ['agent.readonly', 'review'],
    ['agent.orchestrator', 'agent-orchestrator'],
    ['agent.world-origin', 'agent-world-origin'],
    ['agent.character', 'agent-character'],
    ['agent.inspiration', 'agent-inspiration'],
    ['agent.outline', 'agent-outline'],
    ['agent.prose', 'agent-prose'],
    ['node.creation', 'creation'],
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

  it('routes every主 Agent role independently without changing manual creation routing', () => {
    const presets = [
      preset('manual-creation'),
      preset('planner'),
      preset('world'),
      preset('character'),
      preset('inspiration'),
      preset('outline'),
      preset('prose'),
    ]
    const routes = {
      creation: 'manual-creation',
      'agent-orchestrator': 'planner',
      'agent-world-origin': 'world',
      'agent-character': 'character',
      'agent-inspiration': 'inspiration',
      'agent-outline': 'outline',
      'agent-prose': 'prose',
    } as const
    const cases = [
      ['chapter.content', 'manual-creation'],
      ['agent.orchestrator', 'planner'],
      ['agent.world-origin', 'world'],
      ['agent.character', 'character'],
      ['agent.inspiration', 'inspiration'],
      ['agent.outline', 'outline'],
      ['agent.prose', 'prose'],
    ] as const
    for (const [category, presetId] of cases) {
      const resolved = resolveAIConfigForTask({
        category,
        requestedConfig: globalConfig,
        globalConfig,
        presets,
        routes,
      })
      expect(resolved.taskKind).toBe(category === 'chapter.content' ? 'creation' : `agent-${category.slice(6)}`)
      expect(resolved.presetId).toBe(presetId)
      expect(resolved.config.model).toBe(`${presetId}-model`)
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

  it('持久化主 Agent 角色路由并拒绝未登记的路由键', async () => {
    const { useAIConfigStore, TASK_ROUTES_KEY } = await import('../../src/stores/ai-config')
    const id = useAIConfigStore.getState().saveAsPreset('正文 Agent 模型')
    useAIConfigStore.getState().setTaskRoute('agent-prose', id)
    const stored = JSON.parse(localStorage.getItem(TASK_ROUTES_KEY) || '{}')
    expect(stored).toEqual({ 'agent-prose': id })

    localStorage.setItem(TASK_ROUTES_KEY, JSON.stringify({
      creation: id,
      'agent-prose': id,
      'future-unknown-route': id,
    }))
    vi.resetModules()
    const fresh = await import('../../src/stores/ai-config')
    expect(fresh.useAIConfigStore.getState().taskRoutes).toEqual({
      creation: id,
      'agent-prose': id,
    })
  })

  it('persists safe Agent context profiles and sanitizes unknown values', async () => {
    const {
      AGENT_CONTEXT_PROFILES_KEY,
      useAIConfigStore,
    } = await import('../../src/stores/ai-config')
    expect(useAIConfigStore.getState().agentContextProfiles['agent-prose']).toBe('balanced')
    useAIConfigStore.getState().setAgentContextProfile('agent-prose', 'lean')
    expect(JSON.parse(localStorage.getItem(AGENT_CONTEXT_PROFILES_KEY) || '{}')['agent-prose']).toBe('lean')

    localStorage.setItem(AGENT_CONTEXT_PROFILES_KEY, JSON.stringify({
      'agent-prose': 'lean',
      'agent-outline': 'unbounded',
      'future-agent': 'full',
    }))
    vi.resetModules()
    const fresh = await import('../../src/stores/ai-config')
    expect(fresh.useAIConfigStore.getState().agentContextProfiles).toMatchObject({
      'agent-prose': 'lean',
      'agent-outline': 'balanced',
    })
    expect(fresh.useAIConfigStore.getState().agentContextProfiles).not.toHaveProperty('future-agent')
  })

  it('persists a bounded Agent team budget profile and falls back to balanced', async () => {
    const {
      AGENT_TEAM_BUDGET_PROFILE_KEY,
      useAIConfigStore,
    } = await import('../../src/stores/ai-config')
    expect(useAIConfigStore.getState().agentTeamBudgetProfile).toBe('balanced')
    useAIConfigStore.getState().setAgentTeamBudgetProfile('economy')
    expect(localStorage.getItem(AGENT_TEAM_BUDGET_PROFILE_KEY)).toBe('economy')

    localStorage.setItem(AGENT_TEAM_BUDGET_PROFILE_KEY, 'unlimited')
    vi.resetModules()
    const fresh = await import('../../src/stores/ai-config')
    expect(fresh.useAIConfigStore.getState().agentTeamBudgetProfile).toBe('balanced')
  })

  it('persists a bounded creative quality mode and falls back to balanced', async () => {
    const {
      CREATIVE_QUALITY_MODE_KEY,
      useAIConfigStore,
    } = await import('../../src/stores/ai-config')
    expect(useAIConfigStore.getState().creativeQualityMode).toBe('balanced')
    useAIConfigStore.getState().setCreativeQualityMode('economy')
    expect(localStorage.getItem(CREATIVE_QUALITY_MODE_KEY)).toBe('economy')

    localStorage.setItem(CREATIVE_QUALITY_MODE_KEY, 'unlimited')
    vi.resetModules()
    const fresh = await import('../../src/stores/ai-config')
    expect(fresh.useAIConfigStore.getState().creativeQualityMode).toBe('balanced')
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

  it('routes through an inactive session-only preset without leaking its Key to localStorage', async () => {
    const { useAIConfigStore } = await import('../../src/stores/ai-config')
    useAIConfigStore.getState().setConfig({
      provider: 'agnes',
      model: 'agnes-2.5-flash',
      baseUrl: 'https://agnes-route.invalid/v1',
      apiKey: 'agnes-session-route-key',
    })
    const agnesId = useAIConfigStore.getState().saveAsPreset('Agnes 审查')
    useAIConfigStore.getState().setTaskRoute('review', agnesId)
    useAIConfigStore.getState().setConfig({
      provider: 'doubao',
      model: 'doubao-1-5-pro-32k-250115',
      baseUrl: 'https://doubao-global.invalid/v1',
      apiKey: 'doubao-current-key',
    })
    expect(JSON.parse(localStorage.getItem('storyforge-ai-presets') || '[]')[0].config.apiKey).toBe('')

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://agnes-route.invalid/v1/chat/completions')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer agnes-session-route-key')
      expect(JSON.parse(String(init?.body)).model).toBe('agnes-2.5-flash')
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { chat } = await import('../../src/lib/ai/client')

    await expect(chat(
      [{ role: 'user', content: 'review' }],
      useAIConfigStore.getState().config,
      { category: 'review.quality' },
    )).resolves.toBe('ok')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

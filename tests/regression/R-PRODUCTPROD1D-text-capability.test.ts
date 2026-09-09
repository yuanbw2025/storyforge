import { describe, expect, it, vi } from 'vitest'
import {
  ConfiguredProductionTextCallErrorV1,
  hashConfiguredTextEndpointRouteV1,
  inspectConfiguredTextCapabilityV1,
  resolveConfiguredTextCapabilityV1,
  runConfiguredProductionTextV1,
  runConfiguredProductionTextWithOutcomeV1,
} from '../../src/lib/product-production/capabilities'
import { AICompletionResponseErrorV1 } from '../../src/lib/ai/completion-response'
import {
  evaluateProductProductionAuthorizationReadinessV1,
  type ProductProductionCapabilityReadinessV1,
} from '../../src/lib/product-production/service'
import type { AIConfig } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'

const configured: AIConfig = {
  provider: 'agnes', apiKey: 'never-export-this-key', model: 'agnes-2.0-flash',
  baseUrl: 'https://apihub.agnes-ai.com/v1', temperature: 0.7, maxTokens: 0,
}

describe('R-PRODUCTPROD-1D · reuse existing text provider configuration', () => {
  const readiness = (overrides: Partial<ProductProductionCapabilityReadinessV1> = {}): ProductProductionCapabilityReadinessV1 => ({
    text: {
      ready: true, provider: 'agnes', model: 'agnes-2.0-flash',
      endpointOrigin: 'https://apihub.agnes-ai.com', credentialSource: 'existing-ai-config',
      credentialPresent: true, issue: null,
    },
    image: {
      ready: true, provider: 'agnes', model: 'agnes-image-2.1-flash',
      endpointOrigin: 'https://apihub.agnes-ai.com', credentialSource: 'existing-ai-config',
      credentialPresent: true, issue: null,
    },
    mediaRelayConfigured: false, mediaRelayReady: false, mediaRelayOrigin: null,
    mediaRelayIssue: '外部媒体可信中继尚未由部署方配置。',
    ...overrides,
  })

  it('Agnes 图片复用同一全局配置；只有真正缺失的冻结 capability 才在 Build 前阻断', () => {
    const requiredImage = {
      requirementKey: 'media.visual', mediaClass: 'image' as const, operation: 'generate' as const,
      adapterFamily: 'image-generation', minimumCapabilityVersion: '1', allowedDataClasses: ['world-selection'],
      maximumRequestCost: null, maximumTotalCost: null, rightsPolicyVersion: 'storyforge-rights-v1',
      capabilityHash: 'a'.repeat(64), required: true,
    }
    const agnesImageReady = evaluateProductProductionAuthorizationReadinessV1({
      brief: { capabilityRequirements: [requiredImage] }, readiness: readiness(),
    })
    expect(agnesImageReady).toEqual({
      ready: true, blockerCode: null, blockerMessages: [], requiredMediaRequirementKeys: ['media.visual'],
    })
    const blocked = evaluateProductProductionAuthorizationReadinessV1({
      brief: { capabilityRequirements: [requiredImage] },
      readiness: readiness({
        image: {
          ...readiness().image, ready: false,
          issue: '全局 AI 提供商当前不是 Agnes，无法复用同一配置生成图片。',
        },
      }),
    })
    expect(blocked).toEqual({
      ready: false, blockerCode: 'capability-unbound',
      blockerMessages: ['全局 AI 提供商当前不是 Agnes，无法复用同一配置生成图片。'],
      requiredMediaRequirementKeys: ['media.visual'],
    })
    const allowed = evaluateProductProductionAuthorizationReadinessV1({
      brief: { capabilityRequirements: [requiredImage] },
      readiness: readiness({
        mediaRelayConfigured: true, mediaRelayReady: true,
        mediaRelayOrigin: 'https://media.storyforge.example', mediaRelayIssue: null,
      }),
    })
    expect(allowed).toMatchObject({ ready: true, blockerCode: null })
  })

  it('预检只返回全局 provider 身份与就绪状态，不暴露 Key', () => {
    const readiness = inspectConfiguredTextCapabilityV1({
      projectId: 1,
      category: 'product-production.content',
    }, { resolveConfig: () => configured })
    expect(readiness).toEqual({
      ready: true,
      provider: 'agnes',
      model: 'agnes-2.0-flash',
      endpointOrigin: 'https://apihub.agnes-ai.com',
      credentialSource: 'existing-ai-config',
      credentialPresent: true,
      issue: null,
    })
    expect(JSON.stringify(readiness)).not.toContain(configured.apiKey)
    expect(JSON.stringify(readiness)).not.toMatch(/authorization|bearer/i)
  })

  it('从现有配置生成去敏 binding receipt，不产生第二套 Key 配置', async () => {
    const resolved = await resolveConfiguredTextCapabilityV1({
      projectId: 1, category: 'product-production.content', requirementKey: 'text.runtime-package',
    }, { resolveConfig: () => configured, now: () => 100 })
    expect(resolved.config).toBe(configured)
    expect(resolved.receipt).toMatchObject({
      provider: 'agnes', model: 'agnes-2.0-flash', endpointOrigin: 'https://apihub.agnes-ai.com',
      credentialSource: 'existing-ai-config', credentialPresent: true, boundAt: 100,
    })
    expect(JSON.stringify(resolved.receipt)).not.toContain(configured.apiKey)
    expect(JSON.stringify(resolved.receipt)).not.toMatch(/api[-_]?key|authorization|bearer/i)
  })

  it('Creator 冻结身份与最终 capability resolution 原子比对，不接受异步间隙里的配置替换', async () => {
    const endpointRouteHash = await hashConfiguredTextEndpointRouteV1('https://apihub.agnes-ai.com/v1')
    const changed = { ...configured, model: 'agnes-2.0-reasoner' }
    await expect(resolveConfiguredTextCapabilityV1({
      projectId: 1,
      category: 'product-production',
      requirementKey: 'text.runtime-package',
      expectedProviderIdentity: {
        provider: configured.provider,
        model: configured.model,
        endpointOrigin: 'https://apihub.agnes-ai.com',
        endpointRouteHash,
        temperature: configured.temperature,
        configuredMaxTokens: configured.maxTokens,
        contextWindow: null,
      },
    }, { resolveConfig: () => changed })).rejects.toThrow(/Creator 授权快照不一致/)

    await expect(resolveConfiguredTextCapabilityV1({
      projectId: 1,
      category: 'product-production',
      requirementKey: 'text.runtime-package',
      expectedProviderIdentity: {
        provider: configured.provider,
        model: configured.model,
        endpointOrigin: 'https://apihub.agnes-ai.com',
        endpointRouteHash,
        temperature: configured.temperature,
        configuredMaxTokens: configured.maxTokens,
        contextWindow: null,
      },
    }, {
      resolveConfig: () => ({
        ...configured,
        baseUrl: 'https://apihub.agnes-ai.com/v1?route=other',
      }),
    })).rejects.toThrow(/Creator 授权快照不一致/)

    await expect(resolveConfiguredTextCapabilityV1({
      projectId: 1,
      category: 'product-production',
      requirementKey: 'text.runtime-package',
      expectedProviderIdentity: {
        provider: configured.provider,
        model: configured.model,
        endpointOrigin: 'https://apihub.agnes-ai.com',
        endpointRouteHash,
        temperature: configured.temperature,
        configuredMaxTokens: configured.maxTokens,
        contextWindow: null,
      },
    }, {
      resolveConfig: () => ({ ...configured, contextWindow: 0 }),
    })).resolves.toMatchObject({ receipt: { model: configured.model } })
  })

  it('正式调用沿用同一 resolved config，并把 key 只交给既有 chat 边界', async () => {
    const runAI = vi.fn(async () => '{"ok":true}')
    const result = await runConfiguredProductionTextV1({
      projectId: 7, category: 'product-production.content', requirementKey: 'text.runtime-package',
      messages: [{ role: 'user', content: '生成已授权游戏内容' }], maximumOutputTokens: 2_000,
    }, { resolveConfig: () => configured, runAI, now: () => 101 })
    expect(result.output).toBe('{"ok":true}')
    expect(runAI).toHaveBeenCalledWith(
      [{ role: 'user', content: '生成已授权游戏内容' }],
      configured,
      { category: 'product-production.content', projectId: 7, maxTokens: 2_000 },
      undefined,
      undefined,
    )
    expect(JSON.stringify(result.bindingReceipt)).not.toContain(configured.apiKey)
  })

  it('底层 chat 复用 capability 已解析路由，不在 dispatch 前按可变全局路由二次改道', async () => {
    const before = useAIConfigStore.getState()
    const rerouted: AIConfig = {
      ...configured,
      provider: 'openai',
      model: 'must-not-be-used',
      apiKey: 'must-not-be-used-key',
      baseUrl: 'https://route-race.invalid/v1',
    }
    useAIConfigStore.setState({
      config: rerouted,
      presets: [{ id: 'route-race', name: 'race', config: rerouted }],
      taskRoutes: { creation: 'route-race' },
    })
    const fetchProvider = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    try {
      const result = await runConfiguredProductionTextV1({
        projectId: 7,
        category: 'product-production',
        requirementKey: 'text.runtime-package',
        messages: [{ role: 'user', content: '使用已解析能力' }],
        maximumOutputTokens: 2_000,
      }, { resolveConfig: () => configured, now: () => 101 })

      expect(result.output).toBe('{"ok":true}')
      expect(String(fetchProvider.mock.calls[0]?.[0])).toContain('apihub.agnes-ai.com')
      expect(String(fetchProvider.mock.calls[0]?.[0])).not.toContain('route-race.invalid')
    } finally {
      fetchProvider.mockRestore()
      useAIConfigStore.setState({
        config: before.config,
        presets: before.presets,
        taskRoutes: before.taskRoutes,
      })
    }
  })

  it('文字开放世界各专用 Skill 只能复用 Build 授权时的 product-production 路由', async () => {
    const incorrectlyRouted: AIConfig = {
      ...configured,
      provider: 'openai', model: 'wrong-specialized-route', apiKey: 'wrong-route-secret',
      baseUrl: 'https://wrong-route.invalid/v1',
    }
    const resolveConfig = vi.fn((category: string) => (
      category === 'product-production' ? configured : incorrectlyRouted
    ))
    const frozen = await resolveConfiguredTextCapabilityV1({
      projectId: 7, category: 'product-production', requirementKey: 'text.runtime-package',
    }, { resolveConfig, now: () => 100 })
    resolveConfig.mockClear()
    const runAI = vi.fn(async () => '{"ok":true}')

    const result = await runConfiguredProductionTextV1({
      projectId: 7,
      category: 'text-open-world.production.mainline',
      requirementKey: 'text.runtime-package',
      expectedCapabilityHash: frozen.receipt.capabilityHash,
      messages: [{ role: 'user', content: '生成已授权主线' }],
      maximumOutputTokens: 2_000,
    }, { resolveConfig, runAI, now: () => 101 })

    expect(resolveConfig).toHaveBeenCalledTimes(1)
    expect(resolveConfig).toHaveBeenCalledWith('product-production')
    expect(runAI).toHaveBeenCalledWith(
      [{ role: 'user', content: '生成已授权主线' }],
      configured,
      { category: 'product-production', projectId: 7, maxTokens: 2_000 },
      undefined,
      undefined,
    )
    expect(result.bindingReceipt.capabilityHash).toBe(frozen.receipt.capabilityHash)
  })

  it('冻结 binding hash 已过期时在发送任何模型请求前失败', async () => {
    const runAI = vi.fn(async () => '{"should":"never-run"}')
    await expect(runConfiguredProductionTextV1({
      projectId: 7,
      category: 'text-open-world.production.semantic-review',
      requirementKey: 'text.runtime-package',
      expectedCapabilityHash: 'f'.repeat(64),
      messages: [{ role: 'user', content: '不得发送的请求' }],
      maximumOutputTokens: 2_000,
    }, { resolveConfig: () => configured, runAI, now: () => 102 })).rejects.toThrow(
      /provider binding 与授权 capability 不一致/,
    )
    expect(runAI).not.toHaveBeenCalled()
  })

  it.each([
    ['请求路径', { baseUrl: 'https://apihub.agnes-ai.com/v2' }],
    ['请求查询参数', { baseUrl: 'https://apihub.agnes-ai.com/v1?route=other' }],
    ['温度', { temperature: 0.2 }],
    ['配置输出上限', { maxTokens: 4_096 }],
    ['上下文窗口', { contextWindow: 128_000 }],
  ] as const)('冻结后改变%s会在模型 dispatch 前失败', async (_label, changed) => {
    const frozen = await resolveConfiguredTextCapabilityV1({
      projectId: 7,
      category: 'product-production',
      requirementKey: 'text.runtime-package',
    }, { resolveConfig: () => configured, now: () => 100 })
    const runAI = vi.fn(async () => '{"should":"never-run"}')
    await expect(runConfiguredProductionTextV1({
      projectId: 7,
      category: 'product-production',
      requirementKey: 'text.runtime-package',
      expectedCapabilityHash: frozen.receipt.capabilityHash,
      messages: [{ role: 'user', content: '不得发送的请求' }],
      maximumOutputTokens: 2_000,
    }, {
      resolveConfig: () => ({ ...configured, ...changed }),
      runAI,
      now: () => 101,
    })).rejects.toThrow(/provider binding 与授权 capability 不一致/)
    expect(runAI).not.toHaveBeenCalled()
  })

  it('没有现有配置时明确阻塞，不静默切 provider 或要求生产页另存 Key', async () => {
    await expect(resolveConfiguredTextCapabilityV1({
      projectId: 1, category: 'product-production.content', requirementKey: 'text.runtime-package',
    }, { resolveConfig: () => ({ ...configured, apiKey: '' }) })).rejects.toThrow(/设置.*API Key/)
  })

  it('显式区分未 dispatch、已观察响应及请求结果未知，不靠错误类型猜测', async () => {
    const base = {
      projectId: 7,
      category: 'text-open-world.production.mainline',
      requirementKey: 'text.runtime-package',
      messages: [{ role: 'user' as const, content: '生成已授权主线' }],
      maximumOutputTokens: 2_000,
    }

    const notDispatched = await runConfiguredProductionTextWithOutcomeV1(base, {
      resolveConfig: () => ({ ...configured, apiKey: '' }),
      runAI: async () => '{"never":true}',
    }).catch(error => error)
    expect(notDispatched).toBeInstanceOf(ConfiguredProductionTextCallErrorV1)
    expect(notDispatched).toHaveProperty('outcome', { kind: 'not-dispatched' })

    const responseObserved = await runConfiguredProductionTextWithOutcomeV1(base, {
      resolveConfig: () => configured,
      runAI: async (_messages, _config, _meta, _signal, result) => {
        if (result) {
          result.requestLifecycle = { phase: 'response-observed', responseStatus: 200 }
          result.usage = { inputTokens: 77, outputTokens: 9, totalTokens: 86 }
        }
        throw new AICompletionResponseErrorV1('empty', 'safe-summary')
      },
    }).catch(error => error)
    expect(responseObserved).toBeInstanceOf(ConfiguredProductionTextCallErrorV1)
    expect(responseObserved).toHaveProperty('outcome', {
      kind: 'response-observed',
      responseStatus: 200,
      usage: { inputTokens: 77, outputTokens: 9 },
    })

    const resultUnknown = await runConfiguredProductionTextWithOutcomeV1(base, {
      resolveConfig: () => configured,
      runAI: async () => { throw new Error('socket closed after send') },
    }).catch(error => error)
    expect(resultUnknown).toBeInstanceOf(ConfiguredProductionTextCallErrorV1)
    expect(resultUnknown).toHaveProperty('outcome', { kind: 'result-unknown' })
  })
})

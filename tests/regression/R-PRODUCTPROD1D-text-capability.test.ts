import { describe, expect, it, vi } from 'vitest'
import {
  inspectConfiguredTextCapabilityV1,
  resolveConfiguredTextCapabilityV1,
  runConfiguredProductionTextV1,
} from '../../src/lib/product-production/capabilities'
import {
  evaluateProductProductionAuthorizationReadinessV1,
  type ProductProductionCapabilityReadinessV1,
} from '../../src/lib/product-production/service'
import type { AIConfig } from '../../src/lib/types'

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

  it('没有现有配置时明确阻塞，不静默切 provider 或要求生产页另存 Key', async () => {
    await expect(resolveConfiguredTextCapabilityV1({
      projectId: 1, category: 'product-production.content', requirementKey: 'text.runtime-package',
    }, { resolveConfig: () => ({ ...configured, apiKey: '' }) })).rejects.toThrow(/设置.*API Key/)
  })
})

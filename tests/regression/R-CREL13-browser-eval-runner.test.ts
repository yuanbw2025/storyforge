import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  cleanupStrandedCreativeReliabilityWorkspacesV1,
  createCreativeReliabilityBrowserDependenciesV1,
} from '../../src/lib/evals/creative-reliability/browser'
import { CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1 } from '../../src/lib/evals/creative-reliability/fixtures'
import type { AIConfig } from '../../src/lib/types'

function storyArc(name: string) {
  return {
    name,
    type: 'main',
    description: '主角在明确期限内面对阻力、作出不可逆选择并改变局面。',
    stages: [
      { title: '触发', description: '规则造成迫近危机，主角必须采取行动。', keyEvents: ['确认危机'] },
      { title: '升级', description: '第一次行动带来代价，并迫使主角改变方案。', keyEvents: ['承担后果'] },
      { title: '选择', description: '主角在硬规则内作出不可逆选择并承受新压力。', keyEvents: ['完成选择'] },
    ],
  }
}

describe.sequential('R-CREL13 · 浏览器真实调用适配器', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  it('经正式注册表播种、调用生产 CREL 1+1 路径、独立验证并清理隔离项目', async () => {
    const generatorConfig: AIConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      model: 'generator-test',
      temperature: 0.55,
      maxTokens: 6_000,
      contextWindow: 128_000,
    }
    const verifierConfig: AIConfig = {
      ...generatorConfig,
      provider: 'custom',
      model: 'verifier-test',
    }
    let generationCalls = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      const prompt = body.messages.map(message => message.content).join('\n')
      const verifierCall = prompt.includes('中文故事策划评测员')
      const creativeCall = prompt.includes('当前执行 story-arcs Skill')
      let content: string
      if (verifierCall) {
        content = JSON.stringify({
          semanticScore: 0.88,
          causalCoherence: 0.86,
          specificity: 0.82,
          matchedRequiredFactIds: ['f1', 'f2', 'f3'],
          missingRequiredFactIds: [],
          safetyPassed: true,
          narrativeProgressed: true,
          infodumpOnly: false,
        })
      } else if (creativeCall) {
        generationCalls += 1
        content = JSON.stringify({ storyArcs: [storyArc('CREL 候选')] })
      } else {
        generationCalls += 1
        const { type: _type, ...legacy } = storyArc('旧入口候选')
        content = JSON.stringify(legacy)
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const dependencies = createCreativeReliabilityBrowserDependenciesV1({
      generatorConfig,
      verifierConfig,
    })
    const fixture = CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1[0]
    const identity = { provider: 'openai', model: 'generator-test', promptVersion: 'paired-v1' }
    const legacy = await dependencies.generate({
      fixture,
      variant: 'legacy-direct',
      identity,
      parameters: { temperature: 0.55, maxOutputTokens: 6_000 },
    })
    const current = await dependencies.generate({
      fixture,
      variant: 'creative-reliability',
      identity,
      parameters: { temperature: 0.55, maxOutputTokens: 6_000 },
    })
    const verified = await dependencies.verify({
      fixture,
      variant: 'creative-reliability',
      generation: current,
      identity: { provider: 'custom', model: 'verifier-test', promptVersion: 'verifier-v1' },
    })

    expect(legacy).toMatchObject({ status: 'legacy-ready', artifactModelCalls: 1, adoptable: true })
    expect(current).toMatchObject({ status: 'ready', artifactModelCalls: 1, adoptable: true })
    expect(current.calls[0]).toMatchObject({ purpose: 'generate', usage: { usageSource: 'provider' } })
    expect(verified).toMatchObject({
      status: 'succeeded',
      safetyPassed: true,
      narrativeProgressed: true,
      infodumpOnly: false,
    })
    expect(generationCalls).toBe(2)
    expect(await db.projects.filter(project => project.name.startsWith('[CREL-EVAL] ')).count()).toBe(0)
    expect(await cleanupStrandedCreativeReliabilityWorkspacesV1()).toBe(0)
  })

  it('独立 verifier 被输出上限截断时保留 finish reason，不伪造成功评分', async () => {
    const config: AIConfig = {
      provider: 'doubao',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      model: 'deepseek-v4-pro-test',
      temperature: 0,
      maxTokens: 3_000,
      contextWindow: 128_000,
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"semanticScore":0.8' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 200, completion_tokens: 3_000, total_tokens: 3_200 },
    }), { status: 200 })))
    const fixture = CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1[0]
    const dependencies = createCreativeReliabilityBrowserDependenciesV1({
      generatorConfig: config,
      verifierConfig: config,
    })
    const verified = await dependencies.verify({
      fixture,
      variant: 'creative-reliability',
      generation: {
        variant: 'creative-reliability',
        status: 'ready',
        presentedText: JSON.stringify([storyArc('待验证候选')]),
        outputHash: '0'.repeat(64),
        editableArtifact: true,
        adoptable: true,
        artifactModelCalls: 1,
        calls: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          costUsd: null,
          usageSource: 'provider',
        },
        issueCodes: [],
      },
      identity: { provider: 'doubao', model: config.model, promptVersion: 'verifier-v1' },
    })

    expect(verified.status).toBe('protocol-failed')
    expect(verified.assessmentHash).toBeNull()
    expect(verified.calls[0]).toMatchObject({
      status: 'protocol-failed',
      failureCode: 'finish_reason_length',
      usage: { outputTokens: 3_000, usageSource: 'provider' },
    })
  })
})

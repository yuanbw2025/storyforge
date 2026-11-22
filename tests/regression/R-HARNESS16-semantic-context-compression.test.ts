import { describe, expect, it, vi } from 'vitest'
import {
  createAgentContextCompressionSessionV1,
  extractContextCompressionAnchorsV1,
  type ContextCompressionAnchorV1,
} from '../../src/lib/agent/context-compression'
import {
  getAgentSkillV1,
  resolveAgentSkillInputStateV1,
  validateAgentSkillContextEvidenceV1,
  type AgentSkillContextCompressionPolicyV1,
} from '../../src/lib/agent/skill-registry'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import {
  createContextManifestFromAssemblyV1,
  parseContextManifestV1,
  verifyContextManifestIntegrityV1,
} from '../../src/lib/agent/run/context-manifest'
import { estimateTokens } from '../../src/lib/ai/context-budget'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { db } from '../../src/lib/db/schema'
import type { AIConfig, ChatMessage } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const CONFIG: AIConfig = {
  provider: 'openai',
  apiKey: 'test',
  baseUrl: 'https://example.invalid/v1',
  model: 'gpt-4o-mini',
  temperature: 0.2,
  maxTokens: 4_000,
}

function sourceText(repetitions = 1_050): string {
  return [
    '【潮门规则】潮门开启必须由守灯人敲钟，其他人不得触碰潮汐钟。',
    '主角在第一章尚未知晓沈灯隐瞒的旧港秘密，后续获知前不能据此行动。',
    '海历3021年，盐城议会只允许每十年开启一次潮门。',
    `背景记录：${'潮汐推移形成盐晶层。'.repeat(repetitions)}`,
  ].join('\n')
}

function validResponse(anchors: readonly ContextCompressionAnchorV1[]): string {
  return JSON.stringify({
    version: 1,
    summary: '潮门由守灯人按固定周期开启；本章必须维持主角尚未知情的认知边界。',
    coveredAnchorIds: anchors.map(anchor => anchor.id),
    evidenceQuotes: anchors.map(anchor => ({ anchorId: anchor.id, quote: anchor.quote })),
  })
}

function session(input: {
  content: string
  targetTokens: number
  complete: (messages: ChatMessage[]) => Promise<string>
  policy?: AgentSkillContextCompressionPolicyV1
  budget?: AgentTeamBudgetTracker
  requiredFutureModelCalls?: number
}) {
  const skill = getAgentSkillV1('world-origin.worldview-field', 'world-origin')
  return createAgentContextCompressionSessionV1({
    policy: input.policy ?? skill.contextCompression,
    config: CONFIG,
    projectId: 1,
    authorRequest: '依据既有设定补全世界来源',
    routingCategory: 'agent.world-origin',
    runtime: {
      budget: input.budget ?? new AgentTeamBudgetTracker('balanced'),
      requiredFutureModelCalls: input.requiredFutureModelCalls ?? 1,
      complete: input.complete,
    },
  })
}

function transformInput(content: string, targetTokens: number) {
  return {
    source: {
      key: 'worldview',
      label: '世界观',
      layer: 'L2' as const,
      budgetTokens: 8_000,
      protectedFromTrim: false,
    },
    content,
    originalTokens: estimateTokens(content),
    sourceBudgetTokens: targetTokens,
    inputBudgetTokens: 8_000,
  }
}

describe('R-HARNESS16 · 语义压缩、锚点保真与单来源回退', () => {
  it('显式服务容量策略在已有八次调用后仍允许必要压缩，并保留锚点与实耗', async () => {
    const content = sourceText()
    const targetTokens = 1_400
    const anchors = extractContextCompressionAnchorsV1({ content, targetTokens })
    const budget = new AgentTeamBudgetTracker('service-capacity')
    for (let index = 0; index < 8; index++) {
      const reservation = budget.reserveCall({
        label: `此前已完成调用 ${index + 1}`,
        messages: [{ role: 'user', content: '已登记的任务材料' }],
        maxOutputTokens: 1,
      })
      budget.settleCall(reservation, '已完成')
    }
    const complete = vi.fn(async () => validResponse(anchors))
    const transformed = await session({ content, targetTokens, complete, budget,
      requiredFutureModelCalls: 2 }).sourceTransformer(transformInput(content, targetTokens))

    expect(complete).toHaveBeenCalledOnce()
    expect(transformed).toMatchObject({ delivery: 'compressed',
      compression: { outcome: 'verified', attempts: 1, coveredAnchorCount: anchors.length } })
    for (const anchor of anchors) expect(transformed!.content).toContain(anchor.quote)
    expect(budget.snapshot()).toMatchObject({ profile: 'service-capacity', calls: 9 })
  })

  it('普通零调用快照及伪造的服务标签不能授予服务容量模式的压缩调用', async () => {
    const content = sourceText()
    const targetTokens = 1_400
    for (const profile of ['balanced', 'service-capacity'] as const) {
      const budget = new AgentTeamBudgetTracker('balanced')
      const original = budget.snapshot()
      const snapshot = vi.spyOn(budget, 'snapshot').mockReturnValue({ ...original, profile, maxCalls: 0 })
      const complete = vi.fn(async () => '不得被调用')
      try {
        const transformed = await session({ content, targetTokens, complete, budget })
          .sourceTransformer(transformInput(content, targetTokens))
        expect(complete).not.toHaveBeenCalled()
        expect(transformed?.compression).toMatchObject({ outcome: 'fallback', attempts: 0 })
      } finally {
        snapshot.mockRestore()
      }
    }
  })

  it('旧有限策略耗尽后仍不得追加压缩模型调用', async () => {
    const content = sourceText()
    const targetTokens = 1_400
    const budget = new AgentTeamBudgetTracker('balanced')
    for (let index = 0; index < budget.policy.maxCalls; index++) {
      const reservation = budget.reserveCall({ label: '旧有限任务已完成调用',
        messages: [{ role: 'user', content: '原冻结任务材料' }], maxOutputTokens: 1 })
      budget.settleCall(reservation, '已完成')
    }
    const complete = vi.fn(async () => '不得被调用')
    const transformed = await session({ content, targetTokens, complete, budget })
      .sourceTransformer(transformInput(content, targetTokens))
    expect(complete).not.toHaveBeenCalled()
    expect(transformed?.compression).toMatchObject({ outcome: 'fallback', attempts: 0 })
  })

  it('服务容量策略不将未知派发结果转换成自动重发', async () => {
    const content = sourceText()
    const targetTokens = 1_400
    const budget = new AgentTeamBudgetTracker('service-capacity')
    const complete = vi.fn(async () => { throw new Error('unknown transport outcome') })
    const transformed = await session({ content, targetTokens, complete, budget })
      .sourceTransformer(transformInput(content, targetTokens))
    expect(complete).toHaveBeenCalledOnce()
    expect(transformed?.compression).toMatchObject({ outcome: 'fallback', attempts: 1 })
    expect(budget.snapshot().calls).toBe(1)
  })

  it('经模型压缩后仍逐字保留规则、时间与认知边界，并进入 Skill/Manifest durable 证据', async () => {
    const content = sourceText()
    const targetTokens = 1_400
    const anchors = extractContextCompressionAnchorsV1({ content, targetTokens })
    const budget = new AgentTeamBudgetTracker('balanced')
    const complete = vi.fn(async () => validResponse(anchors))
    const compression = session({ content, targetTokens, complete, budget })
    const transformed = await compression.sourceTransformer(transformInput(content, targetTokens))

    expect(complete).toHaveBeenCalledOnce()
    expect(transformed).toMatchObject({
      delivery: 'compressed',
      compression: {
        outcome: 'verified',
        fallback: 'none',
        attempts: 1,
        requiredAnchorCount: anchors.length,
        coveredAnchorCount: anchors.length,
      },
    })
    expect(estimateTokens(transformed!.content!)).toBeLessThanOrEqual(targetTokens)
    for (const anchor of anchors) expect(transformed!.content).toContain(anchor.quote)
    expect(budget.snapshot().calls).toBe(1)

    const inputTokens = estimateTokens(transformed!.content!)
    const sourceEvidence = [{
      key: 'worldview',
      status: 'included' as const,
      delivery: 'compressed' as const,
      originalTokens: estimateTokens(content),
      inputTokens,
      compression: transformed!.compression,
    }]
    const skill = getAgentSkillV1('world-origin.worldview-field', 'world-origin')
    const result = {
      included: ['worldview'],
      omitted: [],
      trimmed: [],
      sourceEvidence,
      totalInputTokens: inputTokens,
      inputBudget: 8_000,
    }
    const evidence = {
      profile: 'balanced' as const,
      included: result.included,
      omitted: result.omitted,
      trimmed: result.trimmed,
      sourceEvidence,
      inputState: resolveAgentSkillInputStateV1(skill, [result]),
      estimatedInputTokens: inputTokens,
      inputBudgetTokens: 8_000,
    }
    expect(() => validateAgentSkillContextEvidenceV1(skill, evidence)).not.toThrow()

    const assembled = {
      text: transformed!.content!,
      segments: [{
        label: '世界观',
        layer: 'L2' as const,
        content: transformed!.content!,
        tokens: inputTokens,
        trimmable: true,
      }],
      included: ['worldview'],
      omitted: [],
      trimmed: [],
      sourceEvidence,
      totalInputTokens: inputTokens,
      inputBudget: 8_000,
      overBudgetBeforeTrim: false,
      overBudgetAfterTrim: false,
    }
    const manifest = await createContextManifestFromAssemblyV1({
      runId: 16,
      stepId: 'semantic-compression',
      attempt: 1,
      projectId: 1,
      worldGroupId: null,
      declaredSourceKeys: ['worldview'],
      assembled,
      readerVersion: 'assemble-context-h16',
    })
    expect(manifest.sources[0]).toMatchObject({
      delivery: 'compressed',
      compression: { outcome: 'verified', artifactHash: transformed!.compression.artifactHash },
    })
    expect(JSON.stringify(manifest)).not.toContain('盐晶层')
    expect(await verifyContextManifestIntegrityV1(manifest)).toBe(true)
    expect(() => parseContextManifestV1({
      ...manifest,
      sources: [{
        ...manifest.sources[0],
        compression: { ...manifest.sources[0].compression, coveredAnchorCount: 0 },
      }],
    })).toThrow('完整覆盖锚点')
  })

  it('锚点漏失会触发至多一次修复，第二次合格产物才可交付', async () => {
    const content = sourceText()
    const targetTokens = 1_400
    const anchors = extractContextCompressionAnchorsV1({ content, targetTokens })
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        version: 1,
        summary: '遗漏锚点的压缩摘要。',
        coveredAnchorIds: [],
        evidenceQuotes: [],
      }))
      .mockResolvedValueOnce(validResponse(anchors))
    const compression = session({ content, targetTokens, complete })
    const transformed = await compression.sourceTransformer(transformInput(content, targetTokens))

    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1][0][1].content).toContain('compression-anchor-coverage-incomplete')
    expect(transformed?.compression).toMatchObject({ outcome: 'verified', attempts: 2 })
  })

  it('两次压缩都失败时只升级当前单一来源全文，且不允许超过两倍源预算', async () => {
    const targetTokens = 1_400
    const content = sourceText(120)
    expect(estimateTokens(content)).toBeGreaterThan(1_600)
    expect(estimateTokens(content)).toBeLessThanOrEqual(targetTokens * 2)
    const complete = vi.fn(async () => '{"version":1,"summary":"坏结构"}')
    const compression = session({ content, targetTokens, complete })
    const transformed = await compression.sourceTransformer(transformInput(content, targetTokens))

    expect(complete).toHaveBeenCalledTimes(2)
    expect(transformed).toMatchObject({
      content,
      delivery: 'full',
      allowSourceBudgetOverflow: true,
      compression: {
        outcome: 'fallback',
        fallback: 'full-source',
        attempts: 2,
      },
    })

    const oversized = sourceText(300)
    const oversizedCompression = session({ content: oversized, targetTokens, complete })
    const degraded = await oversizedCompression.sourceTransformer(transformInput(oversized, targetTokens))
    expect(degraded).toMatchObject({
      compression: {
        outcome: 'fallback',
        fallback: 'deterministic-truncation',
      },
    })
    expect(degraded?.content).toBeUndefined()
  })

  it('团队调用额度不足时不发起压缩模型调用，并为正式生成保留预算', async () => {
    const budget = new AgentTeamBudgetTracker('balanced')
    for (let index = 0; index < 5; index += 1) {
      const reservation = budget.reserveCall({
        label: `既有调用 ${index}`,
        messages: [{ role: 'user', content: 'x' }],
        maxOutputTokens: 1,
      })
      budget.settleCall(reservation, 'y')
    }
    const content = sourceText(120)
    const complete = vi.fn(async () => '不应调用')
    const compression = session({
      content,
      targetTokens: 1_400,
      complete,
      budget,
      requiredFutureModelCalls: 2,
    })
    const transformed = await compression.sourceTransformer(transformInput(content, 1_400))

    expect(complete).not.toHaveBeenCalled()
    expect(budget.snapshot().calls).toBe(5)
    expect(transformed?.compression).toMatchObject({
      outcome: 'fallback',
      fallback: 'full-source',
      attempts: 0,
      failureCode: 'compression-budget-unavailable',
    })
  })

  it('assembleContext 只在正式 reader 读出原文后应用压缩，不允许伪造 sourceHash', async () => {
    await db.delete()
    await db.open()
    const projectId = (await seedCurrentWorkspace('Semantic compression')).scope.projectId
    const content = sourceText(1_100)
    const inputBudgetTokens = 1_400
    const anchors = extractContextCompressionAnchorsV1({ content, targetTokens: inputBudgetTokens })
    const policy: AgentSkillContextCompressionPolicyV1 = {
      ...getAgentSkillV1('world-origin.worldview-field', 'world-origin').contextCompression,
      sourceKeys: ['manualText'],
    }
    const compression = session({
      content,
      targetTokens: inputBudgetTokens,
      complete: async () => validResponse(anchors),
      policy,
    })
    const assembled = await assembleContext({
      projectId,
      sourceKeys: ['manualText'],
      manualSourceText: content,
      inputBudgetTokens,
      sourceBudgetScale: 0.1,
      sourceTransformer: compression.sourceTransformer,
    })
    expect(assembled.sourceEvidence?.[0]).toMatchObject({
      status: 'included',
      delivery: 'compressed',
      compression: { outcome: 'verified' },
    })

    const forged = session({
      content,
      targetTokens: inputBudgetTokens,
      complete: async () => validResponse(anchors),
      policy,
    })
    await expect(assembleContext({
      projectId,
      sourceKeys: ['manualText'],
      manualSourceText: content,
      inputBudgetTokens,
      sourceBudgetScale: 0.1,
      sourceTransformer: async source => {
        const result = await forged.sourceTransformer(source)
        return result ? {
          ...result,
          compression: { ...result.compression, sourceHash: '0'.repeat(64) },
        } : result
      },
    })).rejects.toThrow('转换证据无效')
    db.close()
  })
})

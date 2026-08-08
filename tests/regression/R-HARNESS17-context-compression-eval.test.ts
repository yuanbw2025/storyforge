import { describe, expect, it, vi } from 'vitest'
import {
  buildContextCompressionEvalMessagesV1,
  buildContextCompressionEvalSourceV1,
  evaluateContextCompressionNonInferiorityV1,
  H17_CONTEXT_COMPRESSION_THRESHOLDS,
  runContextCompressionEvalMatrixV1,
  runContextCompressionEvalVariantV1,
  verifyContextCompressionEvalRecordV1,
} from '../../src/lib/evals/context-compression/runner'
import { getFixtures } from '../../src/lib/evals/long-consistency/fixtures'
import type { AIConfig, ChatMessage } from '../../src/lib/types'

const CONFIG: AIConfig = {
  provider: 'openai',
  apiKey: 'test-only',
  baseUrl: 'https://example.invalid/v1',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 4_000,
}

function compressionResponse(messages: readonly ChatMessage[]): string {
  const match = messages[1]?.content.match(
    /【必须覆盖的逐字锚点】(\[[\s\S]*?\])\n\n【待压缩原文】/u,
  )
  if (!match) throw new Error('测试无法读取 H17 压缩锚点')
  const anchors = JSON.parse(match[1]) as Array<{ id: string; quote: string }>
  return JSON.stringify({
    version: 1,
    summary: '保留当前世界、角色边界和上一章连续性事实；未来计划与异世界档案仅作为禁止泄漏边界。',
    coveredAnchorIds: anchors.map(anchor => anchor.id),
    evidenceQuotes: anchors.map(anchor => ({ anchorId: anchor.id, quote: anchor.quote })),
  })
}

const VALID_OUTPUT = '林砚把青铜铃藏在左袖，按三短一长敲响暗号，全程不叫名字，完成了账册交接。'

describe('R-HARNESS17 · 同模型上下文交付对照与非劣门', () => {
  it('三种变体使用同 provider/model/生成预算，并分别记录生成缩减与压缩总成本', async () => {
    const fixture = getFixtures('development')[0]
    const seen: Array<{ phase: string; provider: string; model: string; maxTokens: number }> = []
    const call = vi.fn(async (messages: ChatMessage[], config: AIConfig, phase: 'compression' | 'generation') => {
      seen.push({ phase, provider: config.provider, model: config.model, maxTokens: config.maxTokens })
      return { output: phase === 'compression' ? compressionResponse(messages) : VALID_OUTPUT }
    })
    const records = await runContextCompressionEvalMatrixV1({
      fixtures: [fixture],
      split: 'development',
      contextTargetTokens: 900,
      generationMaxTokens: 1_200,
      config: CONFIG,
      call,
      persist: false,
    })

    expect(records.map(record => record.variant)).toEqual([
      'full-source',
      'deterministic-truncation',
      'semantic-compression',
    ])
    expect(records.map(record => record.aggregate.modelCalls)).toEqual([1, 1, 2])
    expect(records[1].results[0]).toMatchObject({ delivery: 'truncated' })
    expect(records[2].results[0]).toMatchObject({
      delivery: 'compressed',
      compression: { outcome: 'verified', fallback: 'none' },
    })
    expect(records[2].aggregate.generationInputTokens).toBeLessThan(records[0].aggregate.generationInputTokens)
    expect(records[2].aggregate.compressionInputTokens).toBeGreaterThan(0)
    expect(records[2].aggregate.totalInputTokens).toBeGreaterThan(records[2].aggregate.generationInputTokens)
    expect(seen.every(item => item.provider === CONFIG.provider && item.model === CONFIG.model)).toBe(true)
    expect(seen.filter(item => item.phase === 'generation').map(item => item.maxTokens)).toEqual([1200, 1200, 1200])
    for (const record of records) expect(await verifyContextCompressionEvalRecordV1(record)).toBe(true)
    expect(await verifyContextCompressionEvalRecordV1({
      ...records[2],
      aggregate: { ...records[2].aggregate, modelCalls: 99 },
    })).toBe(false)

    const gate = evaluateContextCompressionNonInferiorityV1({ full: records[0], semantic: records[2] })
    expect(gate).toMatchObject({ passed: true, failures: [] })
    expect(gate.generationInputReduction).toBeGreaterThanOrEqual(
      H17_CONTEXT_COMPRESSION_THRESHOLDS.minimumGenerationInputReduction,
    )
    expect(gate.totalInputMultiplier).toBeGreaterThan(1)
  })

  it('模型可见输入不包含答案标签，确定性截断会丢失远端连续性而语义压缩使用真实生产锚点', () => {
    const fixture = getFixtures('development')[0]
    const source = buildContextCompressionEvalSourceV1(fixture)
    const visible = buildContextCompressionEvalMessagesV1({ fixture, deliveredContext: source })
      .map(message => message.content)
      .join('\n')

    expect(source.indexOf('【上一章连续性事实】')).toBeGreaterThan(source.indexOf('【长篇历史背景记录】'))
    expect(visible).not.toContain('requiredFacts')
    expect(visible).not.toContain('matchedRequiredFacts')
    expect(visible).not.toContain('为自动验收')
  })

  it('质量、泄漏、缩减或压缩回退任一越界都会阻止发布门通过', async () => {
    const fixture = getFixtures('development')[0]
    const call = async (messages: ChatMessage[], _config: AIConfig, phase: 'compression' | 'generation') => ({
      output: phase === 'compression' ? compressionResponse(messages) : VALID_OUTPUT,
    })
    const [full] = await runContextCompressionEvalMatrixV1({
      fixtures: [fixture],
      split: 'development',
      contextTargetTokens: 900,
      generationMaxTokens: 1_200,
      config: CONFIG,
      call,
      persist: false,
    })
    const semantic = await runContextCompressionEvalVariantV1({
      fixtures: [fixture],
      variant: 'semantic-compression',
      split: 'development',
      contextTargetTokens: 900,
      generationMaxTokens: 1_200,
      config: CONFIG,
      call,
    })
    const failed = {
      ...semantic,
      aggregate: {
        ...semantic.aggregate,
        requiredFactRecall: 0,
        constraintRecall: 0,
        futureLeakageRate: 1,
        wrongWorldLeakageRate: 1,
        generationInputTokens: full.aggregate.generationInputTokens,
        fallbackRate: 1,
      },
    }
    expect(evaluateContextCompressionNonInferiorityV1({ full, semantic: failed })).toEqual({
      passed: false,
      failures: [
        'required-fact-noninferiority',
        'constraint-noninferiority',
        'future-leakage',
        'wrong-world-leakage',
        'generation-input-reduction',
        'compression-fallback',
      ],
      generationInputReduction: 0,
      totalInputMultiplier: semantic.aggregate.totalInputTokens / full.aggregate.totalInputTokens,
    })
  })

  it('压缩产物无法通过验证时不伪造 semantic 对照记录', async () => {
    const fixture = getFixtures('development')[0]
    const call = vi.fn(async (_messages: ChatMessage[], _config: AIConfig, phase: 'compression' | 'generation') => ({
      output: phase === 'compression' ? '{"version":1,"summary":"坏结构"}' : VALID_OUTPUT,
    }))
    await expect(runContextCompressionEvalVariantV1({
      fixtures: [fixture],
      variant: 'semantic-compression',
      split: 'development',
      contextTargetTokens: 900,
      generationMaxTokens: 1_200,
      config: CONFIG,
      call,
    })).rejects.toThrow('语义压缩未交付可比较上下文')
    expect(call).toHaveBeenCalledTimes(2)
  })
})

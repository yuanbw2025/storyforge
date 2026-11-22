import { describe, expect, it } from 'vitest'
import type { GenerationNode } from '../../src/lib/generation/generation-node'
import { prepareGenerationNode } from '../../src/lib/generation/generation-node'
import { runBudgetedGenerationNode } from '../../src/lib/agent/team-execution'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import {
  parseStructuredOutputV1,
  parseStructuredOutputRunEvidenceV1,
  StructuredOutputPipelineErrorV1,
  StructuredOutputRepairFailedErrorV1,
} from '../../src/lib/agent/structured-output-pipeline'
import type { ChatMessage } from '../../src/lib/types'
import { classifyAgentRunFailureV1 } from '../../src/lib/agent/run/failure-policy'

interface Output { field: string; value: string }

function createNode(input: {
  outputs?: Array<string | Error>
  gateCode?: string
  seenMessages?: ChatMessage[][]
  maxChars?: number
}): GenerationNode<{ context: string }, Output> {
  let call = 0
  return {
    id: 'weh0e:test-node',
    kind: 'weh0e.structured',
    editableInput: true,
    assembleInput: value => [{ role: 'user', content: `正式上下文：${value.context}` }],
    run: async messages => {
      input.seenMessages?.push(messages)
      const raw = input.outputs?.[call++] ?? '{"field":"races","value":"潮民"}'
      if (raw instanceof Error) throw raw
      return parseStructuredOutputV1({
        raw,
        contract: {
          version: 1,
          schemaId: 'weh0e-test.v1',
          target: 'worldviews.races',
          root: 'object',
          maxChars: input.maxChars ?? 10_000,
          allowedRootFields: ['field', 'value'],
          requiredRootFields: ['field', 'value'],
        },
        parse: value => {
          const source = value as Record<string, unknown>
          if (source.field !== 'races') throw new Error('field 不在允许范围。')
          if (typeof source.value !== 'string') throw new Error('字段 value 必须是字符串。')
          return { field: source.field, value: source.value }
        },
      })
    },
    gate: output => input.gateCode
      ? { status: 'blocked', issues: [{ code: input.gateCode, message: `gate:${input.gateCode}` }] }
      : { status: output.value ? 'pass' : 'blocked', issues: [] },
  }
}

describe('WEH-0E structured output execution', () => {
  it('round-trips complete structured evidence above the old readback cap without weakening identity checks', async () => {
    const value = '文'.repeat(240_001) + '证据完整尾标'
    const raw = JSON.stringify({ field: 'races', value })
    // V1 forward admission still uses the exact caller-declared boundary.
    const node = createNode({ outputs: [raw], maxChars: raw.length })
    const result = await runBudgetedGenerationNode({
      node, prepared: prepareGenerationNode(node, { context: 'isolated long evidence fixture' }),
      budget: new AgentTeamBudgetTracker('expanded'), callLabel: 'long evidence roundtrip', maxOutputTokens: 1024,
    })
    const evidence = result.structuredOutputEvidence!
    const restored = parseStructuredOutputRunEvidenceV1(JSON.parse(JSON.stringify(evidence)))
    expect(result.output.value).toBe(value)
    expect(restored).toEqual(evidence)
    expect(restored.attempts[0].evidence.originalText).toBe(raw)
    expect(restored.attempts[0].evidence.normalizedText).toBe(raw)
    expect(restored.version).toBe(1)

    const wrongType = JSON.parse(JSON.stringify(evidence))
    wrongType.attempts[0].evidence.originalText = 123
    expect(() => parseStructuredOutputRunEvidenceV1(wrongType)).toThrow('evidence')
    const wrongTarget = JSON.parse(JSON.stringify(evidence))
    wrongTarget.attempts[0].evidence.target = 'worldviews.history'
    expect(() => parseStructuredOutputRunEvidenceV1(wrongTarget)).toThrow('evidence')
    const wrongCall = JSON.parse(JSON.stringify(evidence))
    wrongCall.attempts[0].callIndex = 2
    expect(() => parseStructuredOutputRunEvidenceV1(wrongCall)).toThrow('身份')
    const wrongShape = JSON.parse(JSON.stringify(evidence))
    wrongShape.attempts[0].evidence.contractShape.requiredRootFields.push('outside-allowed-fields')
    expect(() => parseStructuredOutputRunEvidenceV1(wrongShape)).toThrow('contractShape')
  })

  it('只确定性转义字符串内误写的引号，不把截断 JSON 静默补全为成功', async () => {
    const seenMessages: ChatMessage[][] = []
    const quoteNode = createNode({
      outputs: ['{"field":"races","value":"上层称为"听潮人"，围绕"母汐"竞争"}'],
      seenMessages,
    })
    const result = await runBudgetedGenerationNode({
      node: quoteNode,
      prepared: prepareGenerationNode(quoteNode, { context: '上下文' }),
      budget: new AgentTeamBudgetTracker('balanced'),
      callLabel: '引号修复',
      maxOutputTokens: 1_000,
    })
    expect(result.output.value).toBe('上层称为"听潮人"，围绕"母汐"竞争')
    expect(seenMessages).toHaveLength(1)
    expect(result.structuredOutputEvidence?.attempts[0].evidence.normalizationSteps)
      .toContain('escape-unescaped-json-quotes')
    expect(result.structuredOutputEvidence?.attempts[0].evidence.originalText)
      .toContain('"听潮人"')

    const truncatedNode = createNode({
      outputs: ['{"field":"races","value":"潮民', '{"field":"races","value":"潮民'],
    })
    await expect(runBudgetedGenerationNode({
      node: truncatedNode,
      prepared: prepareGenerationNode(truncatedNode, { context: '上下文' }),
      budget: new AgentTeamBudgetTracker('balanced'),
      callLabel: '截断拒绝',
      maxOutputTokens: 1_000,
    })).rejects.toBeInstanceOf(StructuredOutputRepairFailedErrorV1)
  })

  it('非法 JSON 只额外 repair 一次，并把 raw/attempt 证据带回', async () => {
    const seenMessages: ChatMessage[][] = []
    const node = createNode({
      outputs: ['{"field":"races"', '{"field":"races","value":"潮民"}'],
      seenMessages,
    })
    const prepared = prepareGenerationNode(node, { context: '不应进入 repair 的完整项目材料' })
    const budget = new AgentTeamBudgetTracker('balanced')

    const result = await runBudgetedGenerationNode({
      node, prepared, budget, callLabel: '结构测试', maxOutputTokens: 1_000,
    })

    expect(result.output).toEqual({ field: 'races', value: '潮民' })
    expect(seenMessages).toHaveLength(2)
    expect(seenMessages[1].map(item => item.content).join('\n')).not.toContain('完整项目材料')
    expect(seenMessages[1].map(item => item.content).join('\n')).toContain(
      '根对象只允许直接包含这些字段：field、value。不得增加外层包装字段。',
    )
    expect(seenMessages[1].map(item => item.content).join('\n')).toContain(
      '根对象必须包含这些字段：field、value。',
    )
    expect(result.structuredOutputEvidence?.attempts).toHaveLength(2)
    expect(result.structuredOutputEvidence?.attempts[0].evidence.originalText).toBe('{"field":"races"')
    expect(result.structuredOutputEvidence?.repair?.result).toBe('repaired')
    expect(parseStructuredOutputRunEvidenceV1(
      JSON.parse(JSON.stringify(result.structuredOutputEvidence)),
    )).toEqual(result.structuredOutputEvidence)
    expect(budget.snapshot()).toMatchObject({ calls: 2, canonRetries: 1 })
  })

  it('持久化证据拒绝指纹、状态或 repair 身份被篡改', async () => {
    const node = createNode({ outputs: ['{"field":"races"', '{"field":"races","value":"潮民"}'] })
    const result = await runBudgetedGenerationNode({
      node,
      prepared: prepareGenerationNode(node, { context: '上下文' }),
      budget: new AgentTeamBudgetTracker('balanced'),
      callLabel: '证据恢复',
      maxOutputTokens: 1_000,
    })
    const tampered = JSON.parse(JSON.stringify(result.structuredOutputEvidence))
    tampered.attempts[0].evidence.issues[0].fingerprint = '00000000'
    expect(() => parseStructuredOutputRunEvidenceV1(tampered)).toThrow('issues[0]')

    const missingRepair = JSON.parse(JSON.stringify(result.structuredOutputEvidence))
    missingRepair.repair = null
    expect(() => parseStructuredOutputRunEvidenceV1(missingRepair)).toThrow('缺少 repair 身份')

    const invalidShape = JSON.parse(JSON.stringify(result.structuredOutputEvidence))
    invalidShape.attempts[0].evidence.contractShape.requiredRootFields.push('unknown')
    expect(() => parseStructuredOutputRunEvidenceV1(invalidShape)).toThrow('contractShape')
  })

  it('第二次相同结构失败后停止，不产生第三次调用并保留两版 raw', async () => {
    const node = createNode({ outputs: ['{"field":"races"', '{"field":"races"'] })
    const prepared = prepareGenerationNode(node, { context: '上下文' })
    const budget = new AgentTeamBudgetTracker('balanced')

    let caught: StructuredOutputRepairFailedErrorV1 | null = null
    try {
      await runBudgetedGenerationNode({
        node, prepared, budget, callLabel: '结构测试', maxOutputTokens: 1_000,
      })
    } catch (error) {
      caught = error as StructuredOutputRepairFailedErrorV1
    }

    expect(caught).toBeInstanceOf(StructuredOutputRepairFailedErrorV1)
    expect(caught?.runEvidence.attempts.map(item => item.evidence.originalText))
      .toEqual(['{"field":"races"', '{"field":"races"'])
    expect(caught?.runEvidence.status).toBe('manual-repair')
    expect(budget.snapshot().calls).toBe(2)
    await expect(classifyAgentRunFailureV1(caught)).resolves.toMatchObject({
      code: 'structured_output_repair_exhausted',
      retryable: false,
      action: 'pause-for-author',
    })
  })

  it('provider、取消、scope、permission、stale 和超长错误不自动重发', async () => {
    const provider = createNode({ outputs: [new Error('provider unavailable')] })
    const providerBudget = new AgentTeamBudgetTracker('balanced')
    await expect(runBudgetedGenerationNode({
      node: provider,
      prepared: prepareGenerationNode(provider, { context: '上下文' }),
      budget: providerBudget,
      callLabel: 'provider',
      maxOutputTokens: 1_000,
    })).rejects.toThrow('provider unavailable')
    expect(providerBudget.snapshot().calls).toBe(1)

    const cancelled = createNode({ outputs: [new DOMException('cancelled', 'AbortError')] })
    const cancelledBudget = new AgentTeamBudgetTracker('balanced')
    await expect(runBudgetedGenerationNode({
      node: cancelled,
      prepared: prepareGenerationNode(cancelled, { context: '上下文' }),
      budget: cancelledBudget,
      callLabel: 'cancelled',
      maxOutputTokens: 1_000,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelledBudget.snapshot().calls).toBe(1)

    const scoped = createNode({ gateCode: 'scope-leak' })
    const scopedBudget = new AgentTeamBudgetTracker('balanced')
    await expect(runBudgetedGenerationNode({
      node: scoped,
      prepared: prepareGenerationNode(scoped, { context: '上下文' }),
      budget: scopedBudget,
      callLabel: 'scope',
      maxOutputTokens: 1_000,
    })).rejects.toBeInstanceOf(StructuredOutputPipelineErrorV1)
    expect(scopedBudget.snapshot().calls).toBe(1)

    for (const gateCode of ['permission-denied', 'stale-candidate']) {
      const blocked = createNode({ gateCode })
      const blockedBudget = new AgentTeamBudgetTracker('balanced')
      await expect(runBudgetedGenerationNode({
        node: blocked,
        prepared: prepareGenerationNode(blocked, { context: '上下文' }),
        budget: blockedBudget,
        callLabel: gateCode,
        maxOutputTokens: 1_000,
      })).rejects.toBeInstanceOf(StructuredOutputPipelineErrorV1)
      expect(blockedBudget.snapshot().calls).toBe(1)
    }

    const oversized = createNode({
      outputs: ['{"field":"races","value":"潮民"}'],
      maxChars: 10,
    })
    const oversizedBudget = new AgentTeamBudgetTracker('balanced')
    await expect(runBudgetedGenerationNode({
      node: oversized,
      prepared: prepareGenerationNode(oversized, { context: '上下文' }),
      budget: oversizedBudget,
      callLabel: 'length',
      maxOutputTokens: 1_000,
    })).rejects.toMatchObject({ retryable: false })
    expect(oversizedBudget.snapshot().calls).toBe(1)
  })
})

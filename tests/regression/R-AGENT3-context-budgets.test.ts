import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  evidenceFromContextResult,
  mergeContextEvidence,
  resolveAgentContextPolicy,
  sanitizeAgentContextProfiles,
  splitAgentContextPolicy,
} from '../../src/lib/agent/context-policy'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

describe('AGENT-1 27.1-e · 领域上下文预算与输入证据', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('旧配置默认均衡，未知档位不会突破安全闭集', () => {
    expect(sanitizeAgentContextProfiles(null)).toMatchObject({
      'agent-world-origin': 'balanced',
      'agent-character': 'balanced',
      'agent-inspiration': 'balanced',
      'agent-outline': 'balanced',
      'agent-prose': 'balanced',
    })
    expect(sanitizeAgentContextProfiles({
      'agent-prose': 'lean',
      'agent-outline': 'unbounded',
      future: 'full',
    })).toMatchObject({
      'agent-prose': 'lean',
      'agent-outline': 'balanced',
    })
  })

  it('每个领域的精简/均衡/完整预算严格递增，完整档也只有登记上限', () => {
    for (const role of [
      'agent-world-origin',
      'agent-character',
      'agent-inspiration',
      'agent-outline',
      'agent-prose',
    ] as const) {
      const lean = resolveAgentContextPolicy(role, 'lean')
      const balanced = resolveAgentContextPolicy(role, 'balanced')
      const full = resolveAgentContextPolicy(role, 'full')
      expect(lean.sourceBudgetScale).toBeLessThan(balanced.sourceBudgetScale)
      expect(balanced.sourceBudgetScale).toBeLessThan(full.sourceBudgetScale)
      expect(lean.maxInputTokens).toBeLessThan(balanced.maxInputTokens)
      expect(balanced.maxInputTokens).toBeLessThan(full.maxInputTokens)
      expect(full.sourceBudgetScale).toBe(1)
    }
  })

  it('一个领域的多个读取工具拆分同一总预算，不会各自重复拿满', () => {
    const policy = resolveAgentContextPolicy('agent-character', 'balanced')
    const split = splitAgentContextPolicy(policy, [18_000, 10_500])
    expect(split).toHaveLength(2)
    expect(split.reduce((sum, item) => sum + item.maxInputTokens, 0)).toBe(policy.maxInputTokens)
    expect(split[0].maxInputTokens).toBeGreaterThan(split[1].maxInputTokens)
    expect(split.every(item => item.sourceBudgetScale === policy.sourceBudgetScale)).toBe(true)
  })

  it('领域上限与模型窗口取较小值，源比例只能收窄登记预算', async () => {
    const projectId = (await seedCurrentWorkspace('Context budget')).scope.projectId
    const text = '潮'.repeat(80_000)
    const compact = await assembleContext({
      projectId,
      sourceKeys: ['manualText'],
      manualSourceText: text,
      inputBudgetMaxTokens: 12_000,
      sourceBudgetScale: 0.1,
    })
    expect(compact.inputBudget).toBe(12_000)
    expect(compact.totalInputTokens).toBeLessThanOrEqual(10_000)
    expect(compact.text).toContain('该上下文源已按预算截断')

    const clamped = await assembleContext({
      projectId,
      sourceKeys: ['manualText'],
      manualSourceText: text,
      inputBudgetTokens: 120_000,
      sourceBudgetScale: 4,
    })
    expect(clamped.totalInputTokens).toBeLessThanOrEqual(100_000)
  })

  it('输入证据合并时保留档位、预算和去重后的真实来源', () => {
    const first = evidenceFromContextResult('balanced', {
      included: ['worldview'],
      omitted: ['codex'],
      trimmed: [],
      totalInputTokens: 500,
      inputBudget: 1000,
    })
    expect(first).toMatchObject({
      profile: 'balanced',
      estimatedInputTokens: 500,
      inputBudgetTokens: 1000,
    })

    expect(mergeContextEvidence('lean', [
      {
        included: ['worldview', 'characters'],
        omitted: ['codex'],
        trimmed: [],
        totalInputTokens: 700,
        inputBudget: 1000,
      },
      {
        included: ['characters'],
        omitted: ['codex', 'relations'],
        trimmed: ['historical'],
        totalInputTokens: 300,
        inputBudget: 800,
      },
    ])).toEqual({
      profile: 'lean',
      included: ['worldview', 'characters'],
      omitted: ['codex', 'relations'],
      trimmed: ['historical'],
      estimatedInputTokens: 1000,
      inputBudgetTokens: 1800,
    })
  })
})

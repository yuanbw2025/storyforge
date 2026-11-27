import { describe, expect, it } from 'vitest'
import { compressionOutputBudgetV1 } from '../../src/lib/agent/context-compression'

describe('B20c · 压缩输出预算按真实溢出而非固定 3k', () => {
  it('大来源：输出预算跟随摘要目标 + JSON 信封，不被 Skill 3k 上限压死', () => {
    const budget = compressionOutputBudgetV1({ summaryTargetTokens: 9_000, envelopeTokens: 1_200, policyMaxOutputTokens: 3_000 })
    expect(budget).toBe(10_264)
    expect(budget).toBeGreaterThan(3_000)
  })

  it('小来源：仍保留 Skill 策略值作为可用工作窗口，不把答案挤到不可用', () => {
    expect(compressionOutputBudgetV1({ summaryTargetTokens: 40, envelopeTokens: 10, policyMaxOutputTokens: 3_000 })).toBe(3_000)
  })

  it('策略值非法或未设时不制造 0 预算', () => {
    expect(compressionOutputBudgetV1({ summaryTargetTokens: 800, envelopeTokens: 100, policyMaxOutputTokens: 0 })).toBe(964)
    expect(compressionOutputBudgetV1({ summaryTargetTokens: 800, envelopeTokens: 100, policyMaxOutputTokens: Number.NaN })).toBe(964)
  })
})

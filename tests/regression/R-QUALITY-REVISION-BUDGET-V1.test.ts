import { describe, expect, it } from 'vitest'
import { qualityRevisionCallForecastTokensV1 } from '../../src/lib/agent/run/quality-revision-durable'

describe('B20b · 范围修订会计预测按冻结合同归位', () => {
  it('作者显式上限优先，直接作为该轮预留预测', () => {
    expect(qualityRevisionCallForecastTokensV1(9_000, 32_000)).toBe(9_000)
  })

  it('自动（0/未设）时取冻结合同的每轮份额，而不是孤立字面量', () => {
    // 现行合同 maxOutputTokens = 32_000、两步（修订 + 复核）→ 每轮 16_000。
    expect(qualityRevisionCallForecastTokensV1(0, 32_000)).toBe(16_000)
    // 合同变化时预测随之变化，不再固定。
    expect(qualityRevisionCallForecastTokensV1(0, 40_000)).toBe(20_000)
    expect(qualityRevisionCallForecastTokensV1(0, 12_000, 3)).toBe(4_000)
  })

  it('没有可用合同时明确失败，不静默退化成 1 token 或 0', () => {
    expect(() => qualityRevisionCallForecastTokensV1(0, 0)).toThrow('修订轮次缺少可用的会计预算')
    expect(() => qualityRevisionCallForecastTokensV1(0, Number.NaN)).toThrow('修订轮次缺少可用的会计预算')
  })
})

import { describe, expect, it } from 'vitest'
import {
  computeKnownCostUsd,
  knownModelPrice,
} from '../../src/lib/ai/usage-log'

describe('CREL-2 · 费用证据不得伪造供应商价格', () => {
  it('只为显式登记价格的模型生成费用证据', () => {
    expect(knownModelPrice('deepseek-chat')).toEqual({ input: 0.27, output: 1.1 })
    expect(computeKnownCostUsd('deepseek-chat', 1_000_000, 1_000_000)).toBeCloseTo(1.37)

    expect(knownModelPrice('agnes-2.5-flash')).toBeNull()
    expect(computeKnownCostUsd('agnes-2.5-flash', 2_000, 3_000)).toBeNull()
    expect(knownModelPrice('private-local-model')).toBeNull()
  })
})

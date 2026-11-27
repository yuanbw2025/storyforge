import { afterEach, describe, expect, it } from 'vitest'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { aiTownDirectorInputBudgetV1 } from '../../src/lib/ai-town/director-harness'

describe('B37 · AI 小镇导演输入预算跟随已证实容量（固定 20k 仅为下限）', () => {
  afterEach(() => resetModelCapacityForTestsV1())

  it('已证实大容量模型：预算高于原 20k 参考，不再被固定额度压住居民状态/事件/记忆', async () => {
    const budget = await aiTownDirectorInputBudgetV1({
      aiConfig: { provider: 'deepseek', model: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com/v1', apiKey: 'isolated-only',
        maxTokens: 8_000, temperature: 0 },
      projectId: 1, category: 'runtime.prose.ai-town-director', outputReservation: 16_000,
    })
    expect(budget).toBeGreaterThan(20_000)
  })

  it('未知/保守容量或注入 adapter：不低于原 20k 参考', async () => {
    const unknown = await aiTownDirectorInputBudgetV1({
      aiConfig: { provider: 'custom', model: 'unknown-conservative-model',
        baseUrl: 'https://isolated.invalid/v1', apiKey: 'isolated-only',
        contextWindow: 262_144, maxTokens: 8_000, temperature: 0 },
      projectId: 1, category: 'runtime.prose.ai-town-director', outputReservation: 16_000,
    })
    expect(unknown).toBeGreaterThanOrEqual(20_000)
    expect(await aiTownDirectorInputBudgetV1({
      projectId: 1, category: 'runtime.prose.ai-town-director', outputReservation: 16_000,
    })).toBe(20_000)
  })
})

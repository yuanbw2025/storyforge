import { afterEach, describe, expect, it } from 'vitest'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { chatRuntimeInputBudgetV1 } from '../../src/lib/character-interaction/harness'

describe('B36 · 角色运行时输入预算跟随已证实容量（固定 16k 仅为下限）', () => {
  afterEach(() => resetModelCapacityForTestsV1())

  it('已证实大容量模型：预算高于原 16k 参考，不再被固定额度截断历史/记忆', async () => {
    const budget = await chatRuntimeInputBudgetV1({
      aiConfig: { provider: 'deepseek', model: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com/v1', apiKey: 'isolated-only',
        maxTokens: 8_000, temperature: 0 },
      projectId: 1, category: 'runtime.character.interaction-reply', outputReservation: 16_000,
    })
    expect(budget).toBeGreaterThan(16_000)
  })

  it('未知/保守容量：不低于原 16k 参考', async () => {
    const budget = await chatRuntimeInputBudgetV1({
      aiConfig: { provider: 'custom', model: 'unknown-conservative-model',
        baseUrl: 'https://isolated.invalid/v1', apiKey: 'isolated-only',
        contextWindow: 262_144, maxTokens: 8_000, temperature: 0 },
      projectId: 1, category: 'runtime.character.interaction-reply', outputReservation: 16_000,
    })
    expect(budget).toBeGreaterThanOrEqual(16_000)
  })
})

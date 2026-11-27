import { afterEach, describe, expect, it } from 'vitest'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { screenplayStageInputBudgetV1 } from '../../src/lib/screenplay/durable-production'
import { useAIConfigStore } from '../../src/stores/ai-config'

const previous = useAIConfigStore.getState()

describe('B31a · 剧本改编阶段输入预算跟随已证实容量（固定值仅为下限）', () => {
  afterEach(() => { useAIConfigStore.setState(previous, true); resetModelCapacityForTestsV1() })

  it('已证实大容量模型：预算高于原 48k 参考，不再被固定应用额度压住来源', async () => {
    const budget = await screenplayStageInputBudgetV1({
      aiConfig: { provider: 'deepseek', model: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com/v1', apiKey: 'isolated-only',
        maxTokens: 8_000, temperature: 0 },
      projectId: 1, category: 'screenplay.scene-card', outputReservation: 32_000,
    })
    expect(budget).toBeGreaterThan(48_000)
  })

  it('未知/保守容量：不低于原 48k 参考，且不放大作者显式上限', async () => {
    useAIConfigStore.setState({
      config: { provider: 'custom', model: 'unknown-conservative-model',
        baseUrl: 'https://isolated.invalid/v1', apiKey: 'isolated-only',
        contextWindow: 262_144, maxTokens: 4_000, temperature: 0 },
      presets: [], taskRoutes: {},
    })
    const budget = await screenplayStageInputBudgetV1({
      projectId: 1, category: 'screenplay.scene-card', outputReservation: 8_000,
    })
    expect(budget).toBeGreaterThanOrEqual(48_000)
  })
})

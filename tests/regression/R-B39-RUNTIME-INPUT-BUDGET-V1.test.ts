import type { AIConfig } from '../../src/lib/types'
import { afterEach, describe, expect, it } from 'vitest'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { adventureRuntimeInputBudgetV1 } from '../../src/lib/adventure/harness'
import { openWorldRuntimeInputBudgetV1 } from '../../src/lib/open-world/harness'
import { openWorldEvolutionRuntimeInputBudgetV1 } from '../../src/lib/open-world/evolution-harness'

const evidenced: AIConfig = { provider: 'deepseek', model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com/v1', apiKey: 'isolated-only', maxTokens: 8_000, temperature: 0 }
const unknown: AIConfig = { provider: 'custom', model: 'unknown-conservative-model',
  baseUrl: 'https://isolated.invalid/v1', apiKey: 'isolated-only', contextWindow: 262_144,
  maxTokens: 8_000, temperature: 0 }

describe('B39 · runtime harness 输入预算跟随已证实容量（固定 16k 仅为下限）', () => {
  afterEach(() => resetModelCapacityForTestsV1())

  it.each([
    ['adventure', adventureRuntimeInputBudgetV1],
    ['open-world', openWorldRuntimeInputBudgetV1],
    ['open-world-evolution', openWorldEvolutionRuntimeInputBudgetV1],
  ] as const)('%s：已证实大容量 >16k，未知/缺省 >=16k', async (_label, budget) => {
    await expect(budget({ aiConfig: evidenced, projectId: 1, category: 'runtime.test', outputReservation: 16_000 }))
      .resolves.toBeGreaterThan(16_000)
    await expect(budget({ aiConfig: unknown, projectId: 1, category: 'runtime.test', outputReservation: 16_000 }))
      .resolves.toBeGreaterThanOrEqual(16_000)
    await expect(budget({ projectId: 1, category: 'runtime.test', outputReservation: 16_000 })).resolves.toBe(16_000)
  })
})

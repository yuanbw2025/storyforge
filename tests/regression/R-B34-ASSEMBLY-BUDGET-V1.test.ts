import { afterEach, describe, expect, it } from 'vitest'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import {
  WORLDVIEW_EXPAND_DEFAULT_INPUT_TOKENS_V1,
  worldviewExpandInputBudgetV1,
  frozenWorldviewExpandInputBudgetV1,
} from '../../src/lib/agent/run/worldview-expand-durable'
import {
  WORLD_MAP_DEFAULT_INPUT_TOKENS_V1,
  worldMapInputBudgetV1,
  frozenWorldMapInputBudgetV1,
} from '../../src/lib/agent/run/world-map-config-durable'

const evidenced = { provider: 'deepseek', model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com/v1', apiKey: 'isolated-only', maxTokens: 8_000, temperature: 0 }
const unknown = { provider: 'custom', model: 'unknown-conservative-model',
  baseUrl: 'https://isolated.invalid/v1', apiKey: 'isolated-only', contextWindow: 262_144,
  maxTokens: 8_000, temperature: 0 }

describe('B34 · 扩写/世界地图装配预算跟随已证实容量（固定值仅下限）', () => {
  afterEach(() => resetModelCapacityForTestsV1())

  it('扩写：已证实大容量 > 32k，未知/缺省 >= 32k；冻结合同可重核', async () => {
    await expect(worldviewExpandInputBudgetV1({
      aiConfig: evidenced, projectId: 1, outputReservation: 8_000,
    })).resolves.toBeGreaterThan(WORLDVIEW_EXPAND_DEFAULT_INPUT_TOKENS_V1)
    await expect(worldviewExpandInputBudgetV1({
      aiConfig: unknown, projectId: 1, outputReservation: 8_000,
    })).resolves.toBeGreaterThanOrEqual(WORLDVIEW_EXPAND_DEFAULT_INPUT_TOKENS_V1)
    expect(await worldviewExpandInputBudgetV1({ projectId: 1, outputReservation: 8_000 }))
      .toBe(WORLDVIEW_EXPAND_DEFAULT_INPUT_TOKENS_V1)
    expect(frozenWorldviewExpandInputBudgetV1({ contract: { budget: { maxInputTokens: 919_600 } } } as never))
      .toBe(919_600)
  })

  it('世界地图：已证实大容量 > 30k，未知/缺省 >= 30k；冻结合同可重核', async () => {
    await expect(worldMapInputBudgetV1({
      aiConfig: evidenced, projectId: 1, outputReservation: 8_000,
    })).resolves.toBeGreaterThan(WORLD_MAP_DEFAULT_INPUT_TOKENS_V1)
    await expect(worldMapInputBudgetV1({
      aiConfig: unknown, projectId: 1, outputReservation: 8_000,
    })).resolves.toBeGreaterThanOrEqual(WORLD_MAP_DEFAULT_INPUT_TOKENS_V1)
    expect(await worldMapInputBudgetV1({ projectId: 1, outputReservation: 8_000 }))
      .toBe(WORLD_MAP_DEFAULT_INPUT_TOKENS_V1)
    expect(frozenWorldMapInputBudgetV1({ contract: { budget: { maxInputTokens: 919_600 } } } as never))
      .toBe(919_600)
  })
})

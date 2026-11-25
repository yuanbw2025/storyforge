import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getModelCapacityV1, modelInputBudgetV1, resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { useAIConfigStore } from '../../src/stores/ai-config'
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

describe('B34 · 扩写/世界地图装配预算跟随实际路由的已证实容量', () => {
  let previous: Pick<ReturnType<typeof useAIConfigStore.getState>, 'config' | 'presets' | 'taskRoutes'>
  beforeEach(() => {
    const state = useAIConfigStore.getState()
    previous = { config: state.config, presets: state.presets, taskRoutes: state.taskRoutes }
    useAIConfigStore.setState({ config: unknown, presets: [], taskRoutes: {} })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"models":[]}', {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
  })
  afterEach(() => { resetModelCapacityForTestsV1(); useAIConfigStore.setState(previous); vi.restoreAllMocks() })

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

  it.each([
    ['扩写', worldviewExpandInputBudgetV1, WORLDVIEW_EXPAND_DEFAULT_INPUT_TOKENS_V1],
    ['地图', worldMapInputBudgetV1, WORLD_MAP_DEFAULT_INPUT_TOKENS_V1],
  ] as const)('%s 使用实际创作预设容量而非全局模型', async (_name, budget, fallback) => {
    useAIConfigStore.setState({
      config: unknown,
      presets: [{ id: 'creation', name: '隔离创作路由', config: evidenced }],
      taskRoutes: { creation: 'creation' },
    })
    await expect(budget({ aiConfig: unknown, projectId: 1, outputReservation: 8_000 }))
      .resolves.toBeGreaterThan(fallback)
    useAIConfigStore.setState({ taskRoutes: {} })
    await expect(budget({ aiConfig: unknown, projectId: 1, outputReservation: 8_000 }))
      .resolves.toBe(fallback)
  })

  it.each([
    ['扩写', worldviewExpandInputBudgetV1],
    ['地图', worldMapInputBudgetV1],
  ] as const)('%s 不用旧缺省放大已证实的小窗口', async (_name, budget) => {
    const capacity = { ...getModelCapacityV1(evidenced), totalWindow: 16_384, outputLimit: 4_096 }
    const config = { ...evidenced, modelCapacity: capacity }
    await expect(budget({ aiConfig: config, projectId: 1, outputReservation: 4_096 }))
      .resolves.toBe(modelInputBudgetV1(capacity, 4_096).inputBudget)
  })
})

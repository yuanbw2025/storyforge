import { describe, expect, it } from 'vitest'
import { worldMapDraftDispatchConfigV1 } from '../../src/lib/agent/run/world-map-config-durable'
import type { AIConfig } from '../../src/lib/types'

const base: AIConfig = {
  provider: 'openai',
  apiKey: 'k',
  baseUrl: 'https://example.invalid/v1',
  model: 'm',
  temperature: 0.4,
  maxTokens: 0,
  contextWindow: 128_000,
}

describe('B20a 第五片 · 世界地图草稿派发：会计/治理上限与作者选择分离', () => {
  it('自动（0）保持自动，不再被伪造成固定 6k 派发上限', () => {
    expect(worldMapDraftDispatchConfigV1({ ...base, maxTokens: 0 }, 6_000).maxTokens).toBe(0)
    expect(worldMapDraftDispatchConfigV1({ ...base, maxTokens: 0 }, null).maxTokens).toBe(0)
  })

  it('作者显式上限受冻结合同上限收窄；合同无上限时保持显式值', () => {
    expect(worldMapDraftDispatchConfigV1({ ...base, maxTokens: 9_000 }, 6_000).maxTokens).toBe(6_000)
    expect(worldMapDraftDispatchConfigV1({ ...base, maxTokens: 4_000 }, 6_000).maxTokens).toBe(4_000)
    expect(worldMapDraftDispatchConfigV1({ ...base, maxTokens: 9_000 }, null).maxTokens).toBe(9_000)
  })
})

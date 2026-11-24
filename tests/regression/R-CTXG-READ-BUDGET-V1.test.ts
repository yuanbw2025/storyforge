import { describe, expect, it } from 'vitest'
import { WORLD_QUERY_TOOL_SCHEMA_V1 } from '../../src/lib/agent/world-query-tool-schema'
import { WORLD_QUERY_LIMITS_V1 } from '../../src/lib/context-gateway/world-query-contract'

describe('B20b 首片 · 叙事查询读数按任务策略而非固定 10k', () => {
  it('工具最大读数与 Provider 合同上限一致，不再停在 10000', () => {
    const maxTokens = (WORLD_QUERY_TOOL_SCHEMA_V1.properties as Record<string, { minimum?: number; maximum?: number }>).maxTokens
    expect(WORLD_QUERY_LIMITS_V1.maxTokens).toBe(100_000)
    expect(maxTokens.maximum).toBe(WORLD_QUERY_LIMITS_V1.maxTokens)
    // 下限保持 1024：单次目录查询仍需要足以容纳分页元数据的空间。
    expect(maxTokens.minimum).toBe(1024)
  })

  it('Provider 合同仍是有界上限，不是无限制读取', () => {
    expect(WORLD_QUERY_LIMITS_V1.maxRecords).toBe(500)
    expect(WORLD_QUERY_LIMITS_V1.maxEvidenceBytes).toBe(4 * 1024 * 1024)
    expect(Number.isSafeInteger(WORLD_QUERY_LIMITS_V1.maxTokens)).toBe(true)
  })
})

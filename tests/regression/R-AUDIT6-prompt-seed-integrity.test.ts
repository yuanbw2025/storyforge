import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import { NOVEL_PROMPT_LIBRARY_SEEDS } from '../../src/lib/ai/prompt-library-seeds'

function seedDigest(): string {
  return createHash('sha256').update(JSON.stringify(SYSTEM_PROMPT_SEEDS)).digest('hex')
}

describe('AUDIT-6 · 提示词领域拆分完整性', () => {
  it('聚合后的模板数量、顺序和内容保持逐字段一致', () => {
    expect(SYSTEM_PROMPT_SEEDS).toHaveLength(86)
    expect(NOVEL_PROMPT_LIBRARY_SEEDS).toHaveLength(118)
    expect(SYSTEM_PROMPT_SEEDS.length + NOVEL_PROMPT_LIBRARY_SEEDS.length).toBe(204)
    expect(seedDigest()).toBe('ab87774fdda1e803d32ce0fb8dd850fe399280dde41e2b8717cd9aeca5f56ed1')
  })
})

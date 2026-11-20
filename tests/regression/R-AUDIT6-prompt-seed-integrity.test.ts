import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'

function seedDigest(): string {
  return createHash('sha256').update(JSON.stringify(SYSTEM_PROMPT_SEEDS)).digest('hex')
}

describe('AUDIT-6 · 提示词领域拆分完整性', () => {
  it('聚合后的模板数量、顺序和内容保持逐字段一致', () => {
    expect(SYSTEM_PROMPT_SEEDS).toHaveLength(101)
    // 保留主干5种准备动作及创作方法，另加入4个拆书/参考模板。
    // WORLD-1 导入分类、STORY-1 中途重规划、FB-5 互动校准与 CM-1
    // 增量融合边界与 Q06 章节任务/承接/作者停笔约束都属于有序系统模板契约。
    expect(seedDigest()).toBe('fb4791fb2223bca0a666c960f3a2307ffb2e4c2b23ec273ab9f4823d03975b51')
  })

  it('分块导入把固定分类目录放在变化的块序号和滚动上下文之前，保留可缓存前缀', () => {
    const template = SYSTEM_PROMPT_SEEDS.find(seed => seed.moduleKey === 'import.parse-chunk')!
    const catalogAt = template.systemPrompt.indexOf('{{codexCategoryCatalog}}')
    const chunkAt = template.systemPrompt.indexOf('{{chunkIndex}}')
    const contextAt = template.systemPrompt.indexOf('{{knownContext}}')
    expect(catalogAt).toBeGreaterThan(0)
    expect(catalogAt).toBeLessThan(chunkAt)
    expect(catalogAt).toBeLessThan(contextAt)
  })
})

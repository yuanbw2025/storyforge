import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'

function seedDigest(): string {
  return createHash('sha256').update(JSON.stringify(SYSTEM_PROMPT_SEEDS.filter(seed => !['history.timeline', 'history.overview', 'history.calendar'].includes(seed.moduleKey)))).digest('hex')
}

describe('AUDIT-6 · 提示词领域拆分完整性', () => {
  it('聚合后的模板数量、顺序和内容保持逐字段一致', () => {
    expect(SYSTEM_PROMPT_SEEDS).toHaveLength(100)
    // 五种准备动作注册独立模板；本轮创作方法进入可编辑内置正文。
    // WORLD-1 导入分类、STORY-1 中途重规划、FB-5 互动校准与 CM-1
    // 增量融合边界与 Q06 章节任务/承接/作者停笔约束都属于有序系统模板契约。
    // 容量修复允许摘要随信息量伸缩、词条完整提取，并清理已退休的历史词条变量。
    expect(SYSTEM_PROMPT_SEEDS.filter(seed => ['history.timeline', 'history.overview', 'history.calendar'].includes(seed.moduleKey)).map(seed => seed.name)).toEqual(['内置-历史事件起草', '内置-历史总述起草', '内置-纪年体系起草'])
    // The previous 97 templates keep their exact prior bytes and order.
    expect(seedDigest()).toBe('d7fe2e09a6f334806bdd5bdf756caea7925476b3bb2ebc60d0a67e473b9048f4')
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

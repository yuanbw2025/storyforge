/**
 * 词条搜索打分 · 全字匹配 + 单字相关性
 */
import { describe, it, expect } from 'vitest'
import { scoreCodexEntry } from '../../src/lib/codex/search'

describe('Codex 搜索打分', () => {
  it('全字匹配分数最高,且名称命中 > 仅字段命中', () => {
    const nameHit = scoreCodexEntry('落日城', '', '', '落日')      // 名称含"落日"
    const fieldHit = scoreCodexEntry('王都', '', '落日余晖', '落日') // 仅字段含"落日"
    expect(nameHit).toBeGreaterThan(fieldHit)
    expect(fieldHit).toBeGreaterThan(0)
  })

  it('单字相关性:模糊记忆也能命中,按命中字数排序', () => {
    const two = scoreCodexEntry('落日谷', '', '', '落日')   // "落"+"日" 都在名里
    const one = scoreCodexEntry('落霞城', '', '', '落日')   // 只有"落"在名里
    const zero = scoreCodexEntry('青云门', '', '', '落日')  // 都不在
    expect(two).toBeGreaterThan(one)
    expect(one).toBeGreaterThan(0)
    expect(zero).toBe(0)
  })

  it('空查询返回 0', () => {
    expect(scoreCodexEntry('任意', '', '', '')).toBe(0)
    expect(scoreCodexEntry('任意', '', '', '   ')).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { mergeUnified } from '../../src/lib/import/unified-merge'
import type { UnifiedParseResult } from '../../src/lib/types'

/**
 * R-import-dedup：导入分块合并去重。
 *
 * 背景（社区反馈）：整本书导入「项目参考·深度」后，世界观页面同一段设定重复十几遍、
 * 角色表堆到几百条重复角色、大纲重复。根因是 mergeUnified 逐块无脑拼接 / push、
 * 且 reference 模式不走 chunk-writer 的去重。这里锁死合并层的去重行为。
 */
describe('R-import-dedup: mergeUnified deduplicates across chunks', () => {
  it('世界观：相同段落只保留一份，不同段落照常追加', () => {
    let acc: UnifiedParseResult = {}
    const chunk: UnifiedParseResult = {
      worldview: { worldOrigin: '主角夏浔穿越大明洪武二十八年。' },
    }
    // 三块都吐出同一段（分块重述），应只留一份
    acc = mergeUnified(acc, chunk)
    acc = mergeUnified(acc, chunk)
    acc = mergeUnified(acc, chunk)
    expect(acc.worldview?.worldOrigin).toBe('主角夏浔穿越大明洪武二十八年。')

    // 新段落照常追加
    acc = mergeUnified(acc, { worldview: { worldOrigin: '锦衣卫是皇帝亲军。' } })
    expect(acc.worldview?.worldOrigin).toBe(
      '主角夏浔穿越大明洪武二十八年。\n\n锦衣卫是皇帝亲军。',
    )
    // 再次重复第一段仍不重复
    acc = mergeUnified(acc, { worldview: { worldOrigin: '主角夏浔穿越大明洪武二十八年。' } })
    expect(acc.worldview?.worldOrigin?.split('\n\n')).toHaveLength(2)
  })

  it('角色：同名去重，保留信息最全的一条', () => {
    let acc: UnifiedParseResult = {}
    acc = mergeUnified(acc, {
      characters: [{ name: '夏浔', role: 'protagonist' }],
    })
    // 后一块吐出信息更全的同名角色 → 替换
    acc = mergeUnified(acc, {
      characters: [
        { name: '夏浔', role: 'protagonist', shortDescription: '穿越到明代的现代人', background: '锦衣卫百户' },
        { name: '张十三', role: 'supporting' },
      ],
    })
    // 再来一块重复且信息更少 → 不覆盖
    acc = mergeUnified(acc, {
      characters: [{ name: '夏浔', role: 'protagonist' }, { name: '张十三', role: 'supporting' }],
    })

    expect(acc.characters).toHaveLength(2)
    const xiaxun = acc.characters?.find(c => c.name === '夏浔')
    expect(String(xiaxun?.background)).toBe('锦衣卫百户')
    expect(acc.characters?.filter(c => c.name === '张十三')).toHaveLength(1)
  })

  it('大纲：标题+摘要完全相同的节点去重，不同节点保留', () => {
    let acc: UnifiedParseResult = {}
    const node = { title: '第一章', summary: '夏浔穿越' }
    acc = mergeUnified(acc, { outline: [node] })
    acc = mergeUnified(acc, { outline: [node] }) // 分块重叠重复
    acc = mergeUnified(acc, { outline: [{ title: '第二章', summary: '入锦衣卫' }] })

    expect(acc.outline).toHaveLength(2)
    expect(acc.outline?.map(n => n.title)).toEqual(['第一章', '第二章'])
  })

  it('写作技法：按设计分块拼接（不去重，保留每块视图）', () => {
    let acc: UnifiedParseResult = {}
    acc = mergeUnified(acc, { writingTechniques: { narrativeTechnique: '第一块视角分析' } })
    acc = mergeUnified(acc, { writingTechniques: { narrativeTechnique: '第二块视角分析' } })
    expect((acc.writingTechniques as Record<string, string>).narrativeTechnique).toBe(
      '第一块视角分析\n\n第二块视角分析',
    )
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeUnified } from '../../src/lib/import/unified-merge'

describe('R-GF: golden-finger import classification', () => {
  it('moves a generic golden-finger pseudo character into the only protagonist abilities', () => {
    const normalized = normalizeUnified({
      worldview: {},
      characters: [
        {
          name: '林尘',
          roleWeight: 'main',
          moralAxis: 'neutral',
          orderAxis: 'neutral',
          shortDescription: '落魄少年',
          abilities: '基础剑术',
        },
        {
          name: '金手指设定',
          roleWeight: 'secondary',
          moralAxis: 'neutral',
          orderAxis: 'neutral',
          shortDescription: '识海中的熟练度面板',
          abilities: '消耗灵气推演功法',
          motivation: '每次推演都需要付出寿元代价',
        },
      ],
    })

    expect(normalized.characters).toHaveLength(1)
    expect(normalized.characters?.[0].name).toBe('林尘')
    expect(String(normalized.characters?.[0].abilities)).toContain('基础剑术')
    expect(String(normalized.characters?.[0].abilities)).toContain('金手指设定')
    expect(String(normalized.characters?.[0].abilities)).toContain('熟练度面板')
    expect(normalized.worldview?.itemDesign).toBeUndefined()
  })

  it('routes generic system/item concepts to worldview.itemDesign when owner is unclear', () => {
    const normalized = normalizeUnified({
      worldview: { itemDesign: '法器分天地玄黄四阶。' },
      characters: [
        {
          name: '随身系统',
          roleWeight: 'secondary',
          moralAxis: 'neutral',
          orderAxis: 'neutral',
          shortDescription: '任务面板与奖励规则',
          abilities: '发布任务并兑换奖励',
        },
      ],
    })

    expect(normalized.characters).toEqual([])
    expect(normalized.worldview?.itemDesign).toContain('法器分天地玄黄四阶')
    expect(normalized.worldview?.itemDesign).toContain('随身系统')
    expect(normalized.worldview?.itemDesign).toContain('任务面板')
  })

  it('keeps anthropomorphized system spirits as real characters', () => {
    const normalized = normalizeUnified({
      characters: [
        {
          name: '系统精灵小白',
          roleWeight: 'secondary',
          moralAxis: 'neutral',
          orderAxis: 'neutral',
          shortDescription: '会吐槽的引导者',
          personality: '毒舌但护短',
        },
      ],
    })

    expect(normalized.characters).toHaveLength(1)
    expect(normalized.characters?.[0].name).toBe('系统精灵小白')
  })
})

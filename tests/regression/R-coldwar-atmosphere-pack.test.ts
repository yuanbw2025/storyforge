import { describe, expect, it } from 'vitest'
import {
  buildGenreConstraintContext,
  getGenreMetadata,
} from '../../src/lib/ai/genre-metadata'
import { GENRE_PACKS, GENRE_PACK_SEEDS } from '../../src/lib/ai/prompt-seeds-genre-packs'
import { CROSS_SETTING_SOURCE_KEYS } from '../../src/lib/ai/cross-setting-context'
import {
  buildAlignmentFixPrompt,
  parseAlignmentResult,
} from '../../src/lib/ai/adapters/settings-alignment-adapter'
import { GENRE_OPTIONS } from '../../src/lib/types/project'
import { NEAR_MODERN_TECH_CEILING_SUMMARY } from '../../src/lib/ai/near-modern-tech-reference'

describe('冷战氛围包 · 注册与约束', () => {
  it('coldwar 出现在项目流派与题材包切换目录', () => {
    expect(GENRE_OPTIONS.some(o => o.value === 'coldwar')).toBe(true)
    expect(GENRE_PACKS.some(p => p.id === 'coldwar')).toBe(true)
    expect(getGenreMetadata('coldwar')?.label).toBe('冷战氛围')
  })

  it('题材包含五套 coldwar 提示词种子', () => {
    const seeds = GENRE_PACK_SEEDS.filter(s => s.genres?.includes('coldwar'))
    expect(seeds).toHaveLength(5)
    expect(seeds.map(s => s.moduleKey).sort()).toEqual([
      'chapter.content',
      'character.generate',
      'outline.volume',
      'story.generate',
      'worldview.dimension',
    ].sort())
  })

  it('题材约束注入近现代科技上限，且不复刻地球冷战史指令', () => {
    const context = buildGenreConstraintContext('coldwar')
    expect(context).toContain('【题材约束：冷战氛围】')
    expect(context).toContain(NEAR_MODERN_TECH_CEILING_SUMMARY.slice(0, 20))
    expect(context).toContain('前数字时代')
    expect(context).toMatch(/不.*复刻地球冷战|不要复刻地球冷战/)
    expect(context).not.toMatch(/杜鲁门主义|苏联解体|1947/)
    expect(context).toContain('勿堆砌地球冷战专名')
  })
})

describe('全局协调 / 设定对齐接线', () => {
  it('CROSS_SETTING_SOURCE_KEYS 为稳定单一事实源且长度为 13', () => {
    expect(CROSS_SETTING_SOURCE_KEYS).toHaveLength(13)
    expect(new Set(CROSS_SETTING_SOURCE_KEYS).size).toBe(13)
  })

  it('parseAlignmentResult 解析矛盾列表', () => {
    const result = parseAlignmentResult(JSON.stringify({
      overview: '有一处矛盾',
      conflicts: [{
        domainA: '世界观',
        domainB: '角色',
        severity: 'critical',
        contentA: 'A',
        contentB: 'B',
        reason: '冲突',
        suggestion: '改其中一处',
      }],
    }))
    expect(result?.conflicts).toHaveLength(1)
    expect(result?.overview).toBe('有一处矛盾')
  })

  it('buildAlignmentFixPrompt 可用且引用矛盾原文', () => {
    const messages = buildAlignmentFixPrompt({
      allSettings: '设定全文',
      conflict: {
        domainA: '世界观',
        domainB: '力量体系',
        severity: 'warning',
        contentA: '月亮潮汐',
        contentB: '血脉觉醒',
        reason: '来源互斥',
        suggestion: '统一为一种来源',
      },
    })
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.content).toContain('月亮潮汐')
    expect(messages[1]?.content).toContain('血脉觉醒')
  })
})

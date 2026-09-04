import { describe, expect, it } from 'vitest'
import {
  parseLifecycleActivityReferences,
  projectCharacterLifecycles,
  type LifecycleCatalogEntry,
} from '../../src/lib/consistency/lifecycle-boundary'
import type { Chapter, Character, OutlineNode } from '../../src/lib/types'
import type { TemporalFact } from '../../src/lib/types/temporal-fact'

function fixtures() {
  const outlineNodes: OutlineNode[] = [
    { id: 1, projectId: 1, parentId: null, type: 'volume', title: '卷一', summary: '', order: 0, createdAt: 1, updatedAt: 1 },
    ...[1, 2, 3, 4, 5, 6, 7].map(index => ({
      id: 10 + index, projectId: 1, parentId: 1, type: 'chapter' as const,
      title: `第${index}章`, summary: '', order: index - 1, createdAt: 1, updatedAt: 1,
    })),
  ]
  const chapters: Chapter[] = [1, 2, 3, 4, 5, 6, 7].map(index => ({
    id: 20 + index, projectId: 1, outlineNodeId: 10 + index, title: `第${index}章`,
    content: '', wordCount: 0, status: 'draft', order: 100 - index,
    notes: '', createdAt: 1, updatedAt: 1,
  }))
  const characters: Character[] = [
    {
      id: 7, projectId: 1, name: '林飞',
      roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
      shortDescription: '', appearance: '', personality: '', background: '',
      motivation: '', abilities: '', relationships: '', arc: '',
      homeWorldGroupId: 8, createdAt: 1, updatedAt: 1,
    },
    {
      id: 9, projectId: 1, name: '顾舟',
      roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: '', appearance: '', personality: '', background: '',
      motivation: '', abilities: '', relationships: '', arc: '',
      homeWorldGroupId: 99, createdAt: 1, updatedAt: 1,
    },
  ]
  const fact = (over: Partial<TemporalFact>): TemporalFact => ({
    id: 31, projectId: 1, worldGroupId: 8, characterId: 7, subjectName: '林飞',
    predicate: 'aliveStatus', factKind: 'state', value: '死亡',
    sourceType: 'chapter', sourceChapterId: 23, sourceQuote: '林飞停止了呼吸。',
    validFromChapterId: 23, validToChapterId: null,
    status: 'confirmed', locked: false, createdAt: 1, updatedAt: 1,
    ...over,
  })
  return { outlineNodes, chapters, characters, fact }
}

describe('CONSISTENCY-4 · 存亡时序边界', () => {
  it('按规范大纲章序投影，排除目标章自身死亡并隔离世界', () => {
    const { outlineNodes, chapters, characters, fact } = fixtures()
    const facts = [
      fact({}),
      fact({
        id: 32, characterId: 9, subjectName: '顾舟', worldGroupId: 99,
        sourceChapterId: 22, validFromChapterId: 22,
      }),
    ]
    expect(projectCharacterLifecycles({
      facts, characters, outlineNodes, chapters, chapterId: 23, worldGroupId: 8,
    })).toEqual([])
    expect(projectCharacterLifecycles({
      facts, characters, outlineNodes, chapters, chapterId: 25, worldGroupId: 8,
    })).toMatchObject([{ characterId: 7, status: 'dead' }])
  })

  it('superseded 死亡在复活前仍是历史 Canon，复活后切换为 alive', () => {
    const { outlineNodes, chapters, characters, fact } = fixtures()
    const death = fact({
      status: 'superseded',
      validToChapterId: 26,
    })
    const revival = fact({
      id: 33,
      value: 'alive',
      sourceChapterId: 26,
      sourceQuote: '林飞重新睁开双眼。',
      validFromChapterId: 26,
      status: 'confirmed',
      createdAt: 2,
      updatedAt: 2,
    })
    expect(projectCharacterLifecycles({
      facts: [death, revival], characters, outlineNodes, chapters, chapterId: 25, worldGroupId: 8,
    })).toMatchObject([{ status: 'dead' }])
    expect(projectCharacterLifecycles({
      facts: [death, revival], characters, outlineNodes, chapters, chapterId: 27, worldGroupId: 8,
    })).toMatchObject([{ status: 'alive' }])
  })

  it('闭集解析拒绝幻觉角色、非正常活动类型和不存在的正文引文', () => {
    const catalog: LifecycleCatalogEntry[] = [{
      characterId: 7, characterName: '林飞', status: 'dead',
      factId: 31, effectiveChapterId: 23,
    }]
    const text = '众人把林飞的遗物放在桌上。'
    const parsed = parseLifecycleActivityReferences(JSON.stringify({
      lifecycleReferences: [
        { characterId: 99, activityType: 'normal-activity', quote: text },
        { characterId: 7, activityType: 'corpse-reference', quote: text },
        { characterId: 7, activityType: 'normal-activity', quote: '林飞推门而入。' },
      ],
    }), text, catalog)
    expect(parsed).toEqual([])
  })
})

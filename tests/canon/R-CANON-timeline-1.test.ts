import { describe, expect, it } from 'vitest'
import {
  checkCharacterLifecycleBoundary,
  parseLifecycleActivityReferences,
  projectCharacterLifecycles,
  type LifecycleCatalogEntry,
} from '../../src/lib/consistency/lifecycle-boundary'
import type { Chapter, Character, OutlineNode } from '../../src/lib/types'
import type { TemporalFact } from '../../src/lib/types/temporal-fact'

function timelineFixture() {
  const outlineNodes: OutlineNode[] = [
    { id: 1, projectId: 1, parentId: null, type: 'volume', title: '卷一', summary: '', order: 0, createdAt: 1, updatedAt: 1 },
    ...[1, 2, 3, 4, 5].map(index => ({
      id: 10 + index, projectId: 1, parentId: 1, type: 'chapter' as const,
      title: `第${index}章`, summary: '', order: index - 1, createdAt: 1, updatedAt: 1,
    })),
  ]
  const chapters: Chapter[] = [1, 2, 3, 4, 5].map(index => ({
    id: 20 + index, projectId: 1, outlineNodeId: 10 + index, title: `第${index}章`,
    content: '', wordCount: 0, status: 'draft', order: 6 - index,
    notes: '', createdAt: 1, updatedAt: 1,
  }))
  const characters: Character[] = [{
    id: 7, projectId: 1, name: '林飞',
    roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
    shortDescription: '', appearance: '', personality: '', background: '',
    motivation: '', abilities: '', relationships: '', arc: '',
    createdAt: 1, updatedAt: 1,
  }]
  const death: TemporalFact = {
    id: 31, projectId: 1, characterId: 7, subjectName: '林飞',
    predicate: 'aliveStatus', factKind: 'state', value: 'dead',
    sourceType: 'chapter', sourceChapterId: 23, sourceQuote: '林飞停止了呼吸。',
    validFromChapterId: 23, validToChapterId: null,
    status: 'confirmed', locked: false, createdAt: 1, updatedAt: 1,
  }
  return { outlineNodes, chapters, characters, death }
}

describe('CANON 覆盖基线 · 角色存亡时序', () => {
  it('R-CANON-timeline-1 · 第三章死亡角色在第五章正常活动时确定性命中', () => {
    const fixture = timelineFixture()
    const projected = projectCharacterLifecycles({
      facts: [fixture.death],
      characters: fixture.characters,
      outlineNodes: fixture.outlineNodes,
      chapters: fixture.chapters,
      chapterId: 25,
    })
    expect(projected).toMatchObject([{
      characterId: 7,
      characterName: '林飞',
      status: 'dead',
    }])

    const text = '林飞推门走进议事厅，亲手展开了地图。'
    const catalog: LifecycleCatalogEntry[] = [{
      characterId: 7,
      characterName: '林飞',
      status: 'dead',
      factId: 31,
      effectiveChapterId: 23,
    }]
    const references = parseLifecycleActivityReferences(JSON.stringify({
      findings: [],
      lifecycleReferences: [{
        characterId: 7,
        activityType: 'normal-activity',
        quote: text,
      }],
    }), text, catalog)
    const findings = checkCharacterLifecycleBoundary(text, references, projected)

    expect(findings).toMatchObject([{
      category: '角色存亡时序',
      severity: 'hard',
      quote: text,
      evidence: [{ sourceType: 'canon', sourceId: 31, quote: '林飞停止了呼吸。' }],
    }])
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import {
  checkCognitionBoundary,
  formatCognitionCatalog,
  parseCognitionReferences,
  projectCharacterKnowledge,
} from '../../src/lib/knowledge-ledger/knowledge-ledger'
import {
  detachKnowledgeForDeletedChapters,
  remapKnowledgeCharacterRefs,
} from '../../src/lib/knowledge-ledger/lifecycle'
import type { Chapter, KnowledgeLedgerEntry, OutlineNode } from '../../src/lib/types'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const now = 1_720_000_000_000

function chapter(id: number, outlineNodeId: number, order: number): Chapter {
  return {
    id, projectId: 1, outlineNodeId, title: `第${order + 1}章`, content: '',
    wordCount: 0, status: 'draft', order, notes: '', createdAt: now, updatedAt: now,
  }
}

function node(id: number, parentId: number | null, type: OutlineNode['type'], order: number): OutlineNode {
  return {
    id, projectId: 1, worldGroupId: 10, parentId, type,
    title: `${type}-${id}`, summary: '', order, createdAt: now, updatedAt: now,
  }
}

function event(
  id: number,
  action: KnowledgeLedgerEntry['action'],
  sourceChapterId: number | null,
  overrides: Partial<KnowledgeLedgerEntry> = {},
): KnowledgeLedgerEntry {
  return {
    id, projectId: 1, worldGroupId: 10, characterId: 7, characterName: '林飞',
    knowledgeKey: 'enemy.true_identity', statement: '黑衣人是城主',
    action, sourceType: sourceChapterId == null ? 'manual' : 'chapter',
    sourceChapterId, status: 'confirmed', createdAt: now + id, updatedAt: now + id,
    ...overrides,
  }
}

describe('CONSISTENCY-2 · 角色认知事件账本', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('按规范章序投影，严格排除当前章，并支持误认、纠正与遗忘', () => {
    const outlineNodes = [
      node(100, null, 'volume', 0),
      node(101, 100, 'chapter', 0),
      node(102, 100, 'chapter', 1),
      node(103, 100, 'chapter', 2),
      node(104, 100, 'chapter', 3),
    ]
    // 故意让 Chapter.order 与规范大纲顺序冲突。
    const chapters = [chapter(1, 101, 99), chapter(2, 102, 0), chapter(3, 103, 1), chapter(4, 104, 2)]
    const entries = [
      event(1, 'mislearn', 1, { belief: '黑衣人是商会会长' }),
      event(2, 'correct', 2),
      event(3, 'forget', 3),
      event(4, 'learn', 4),
      event(5, 'learn', 1, { status: 'candidate', knowledgeKey: 'ignored.candidate' }),
      event(6, 'learn', 1, { worldGroupId: 11, knowledgeKey: 'other.world' }),
    ]

    expect(projectCharacterKnowledge({
      entries, outlineNodes, chapters, chapterId: 2, worldGroupId: 10, characterId: 7,
    })[0]).toMatchObject({ state: 'mistaken', belief: '黑衣人是商会会长' })
    expect(projectCharacterKnowledge({
      entries, outlineNodes, chapters, chapterId: 3, worldGroupId: 10, characterId: 7,
    })[0]).toMatchObject({ state: 'known', statement: '黑衣人是城主' })
    expect(projectCharacterKnowledge({
      entries, outlineNodes, chapters, chapterId: 4, worldGroupId: 10, characterId: 7,
    })).toEqual([])
  })

  it('只对正文逐字引用做闭集硬检测，已知命题不报错', () => {
    const text = '林飞断言黑衣人就是城主。'
    const reference = {
      characterId: 7, characterName: '林飞',
      knowledgeKey: 'enemy.true_identity', quote: '林飞断言黑衣人就是城主。',
    }
    expect(checkCognitionBoundary(text, [reference], [])).toMatchObject([{
      category: '角色认知边界',
      severity: 'hard',
      quote: reference.quote,
    }])
    expect(checkCognitionBoundary(text, [{ ...reference, quote: '并不存在的引文' }], [])).toEqual([])
    expect(checkCognitionBoundary(text, [reference], [{
      characterId: 7, characterName: '林飞', knowledgeKey: 'enemy.true_identity',
      statement: '黑衣人是城主', state: 'known', belief: null, evidence: [event(1, 'learn', 1)],
    }])).toEqual([])
  })

  it('认知引用解析只接受闭集 key 与正文逐字引文', () => {
    const catalog = [{
      characterId: 7, characterName: '林飞',
      knowledgeKey: 'enemy.true_identity', statement: '黑衣人是城主',
    }]
    expect(formatCognitionCatalog(catalog)).toContain('characterId=7')
    const raw = JSON.stringify({
      findings: [],
      cognitionReferences: [
        { characterId: 7, knowledgeKey: 'enemy.true_identity', quote: '林飞知道黑衣人是城主。' },
        { characterId: 7, knowledgeKey: 'invented.key', quote: '林飞知道黑衣人是城主。' },
        { characterId: 7, knowledgeKey: 'enemy.true_identity', quote: '不是正文原文' },
      ],
    })
    expect(parseCognitionReferences(raw, '林飞知道黑衣人是城主。', catalog)).toEqual([{
      characterId: 7, characterName: '林飞',
      knowledgeKey: 'enemy.true_identity', quote: '林飞知道黑衣人是城主。',
    }])
  })

  it('adopt 强制把外部 confirmed 输入降为 candidate', async () => {
    const projectId = await seedCurrentProject({
      name: '认知账本', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const characterId = await db.characters.add({
      projectId, name: '林飞', roleWeight: 'main', moralAxis: 'neutral',
      orderAxis: 'neutral', homeWorldGroupId: null, isCrossWorld: false,
      createdAt: now, updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(projectId)

    const result = await adopt({
      projectId,
      target: 'knowledgeLedger',
      mode: 'add',
      data: {
        characterId, characterName: '林飞', knowledgeKey: 'secret.door',
        statement: '密门在书架后', action: 'learn', sourceType: 'manual',
        status: 'confirmed',
      },
    })
    expect(result.written).toHaveLength(1)
    expect((await db.knowledgeLedger.toArray())[0]).toMatchObject({
      projectId, characterId, status: 'candidate',
    })
  })

  it('角色合并/删除和章节删除保留记录并安全降级', async () => {
    const projectId = await seedCurrentProject({
      name: '生命周期', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const id = await db.knowledgeLedger.add({
      ...event(1, 'learn', 31),
      id: undefined, projectId, characterId: 7,
    }) as number

    await remapKnowledgeCharacterRefs({
      projectId, fromCharacterId: 7, toCharacterId: 8, toName: '林飞·正名',
    })
    expect(await db.knowledgeLedger.get(id)).toMatchObject({
      characterId: 8, characterName: '林飞·正名', status: 'confirmed',
    })

    await detachKnowledgeForDeletedChapters([31])
    expect(await db.knowledgeLedger.get(id)).toMatchObject({
      sourceChapterId: null, status: 'source-missing',
    })

    await remapKnowledgeCharacterRefs({ projectId, fromCharacterId: 8 })
    expect(await db.knowledgeLedger.get(id)).toMatchObject({
      characterId: null, characterName: '林飞·正名', status: 'source-missing',
    })
  })

  it('characterKnowledge 上下文只注入目标章之前的已确认认知', async () => {
    const projectId = await seedCurrentProject({
      name: '上下文', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const characterId = await db.characters.add({
      projectId, name: '林飞', roleWeight: 'main', moralAxis: 'neutral',
      orderAxis: 'neutral', homeWorldGroupId: null, isCrossWorld: false,
      createdAt: now, updatedAt: now,
    } as any) as number
    const volumeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'volume', title: '卷一', summary: '',
      order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const firstNode = await db.outlineNodes.add({
      projectId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '',
      order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const secondNode = await db.outlineNodes.add({
      projectId, parentId: volumeId, type: 'chapter', title: '第二章', summary: '',
      order: 1, createdAt: now, updatedAt: now,
    } as any) as number
    const firstChapter = await db.chapters.add({
      projectId, outlineNodeId: firstNode, title: '第一章', content: '',
      wordCount: 0, status: 'draft', order: 9, notes: '', createdAt: now, updatedAt: now,
    } as any) as number
    const secondChapter = await db.chapters.add({
      projectId, outlineNodeId: secondNode, title: '第二章', content: '',
      wordCount: 0, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    } as any) as number
    await db.knowledgeLedger.add({
      projectId, characterId, characterName: '林飞', knowledgeKey: 'door.location',
      statement: '密门在书架后', action: 'learn', sourceType: 'chapter',
      sourceChapterId: firstChapter, status: 'confirmed', createdAt: now, updatedAt: now,
    })
    await finalizeCurrentFixtureV1(projectId)

    const atFirst = await assembleContext({
      projectId, chapterId: firstChapter, characterId,
      sourceKeys: ['characterKnowledge'],
    })
    const atSecond = await assembleContext({
      projectId, chapterId: secondChapter, characterId,
      sourceKeys: ['characterKnowledge'],
    })
    expect(atFirst.text).not.toContain('密门在书架后')
    expect(atSecond.text).toContain('林飞知道[door.location]：密门在书架后')
  })
})

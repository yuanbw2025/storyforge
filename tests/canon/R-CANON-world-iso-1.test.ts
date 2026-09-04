import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { rebuildChapterChunks, retrieveChunks } from '../../src/lib/retrieval/retrieval'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const now = Date.now()

describe('CANON 覆盖基线 · 世界隔离', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('R-CANON-world-iso-1 · 检索输入不会召回其它世界的角色片段', async () => {
    const projectId = await seedCurrentProject({
      name: 'CANON 世界隔离',
      genres: [],
      description: '',
      targetWordCount: 0,
      enableMultiWorld: true,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const volumeId = await db.outlineNodes.add({
      projectId,
      parentId: null,
      type: 'volume',
      title: '卷一',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const chapterIds: number[] = []
    for (let index = 0; index < 2; index++) {
      const outlineNodeId = await db.outlineNodes.add({
        projectId,
        parentId: volumeId,
        type: 'chapter',
        title: `第${index + 1}章`,
        summary: '',
        order: index,
        createdAt: now,
        updatedAt: now,
      } as any) as number
      chapterIds.push(await db.chapters.add({
        projectId,
        outlineNodeId,
        title: `第${index + 1}章`,
        content: index === 0 ? '异界角色苍岚抵达王城。' : '当前章。',
        wordCount: 0,
        status: 'draft',
        order: index,
        notes: '',
        createdAt: now,
        updatedAt: now,
      } as any) as number)
    }
    await finalizeCurrentFixtureV1(projectId)

    const sourceChapter = await db.chapters.get(chapterIds[0])
    await rebuildChapterChunks({
      projectId,
      chapter: sourceChapter!,
      worldGroupId: 99,
      knownEntities: ['苍岚'],
    })

    const retrieved = await retrieveChunks({
      projectId,
      currentChapterId: chapterIds[1],
      worldGroupId: 7,
      queryTerms: ['苍岚'],
    })

    expect(retrieved).toEqual([])
  })
})

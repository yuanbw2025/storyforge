import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { NOVEL_PROMPT_LIBRARY_SEEDS } from '../../src/lib/ai/prompt-library-seeds'
import { adoptPromptLibraryChapterOutput } from '../../src/lib/editor/prompt-library-chapter-adoption'
import type { Project } from '../../src/lib/types'

describe('Prompt 资产库章节采纳真实链路', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('真实执行快照、adopt、事实 stale、检索块和层级摘要重建', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '真实采纳链路', genre: 'xuanhuan', genres: ['xuanhuan'], status: 'drafting',
      description: '', targetWordCount: 100_000, enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as Project) as number
    const project = await db.projects.get(projectId) as Project
    const volumeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0, createdAt: now, updatedAt: now,
    }) as number
    const nodeId = await db.outlineNodes.add({
      projectId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '新证据出现', order: 0, createdAt: now, updatedAt: now,
    }) as number
    const chapterId = await db.chapters.add({
      projectId, outlineNodeId: nodeId, title: '第一章', content: '<p>林舟仍持有旧证据。</p>',
      wordCount: 10, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    }) as number
    const factId = await db.temporalFacts.add({
      projectId, subjectName: '林舟', predicate: 'held_item', factKind: 'state', value: '旧证据',
      sourceType: 'chapter', sourceChapterId: chapterId, sourceQuote: '仍持有旧证据',
      validFromChapterId: chapterId, status: 'confirmed', locked: false, createdAt: now, updatedAt: now,
    } as any) as number
    await db.retrievalChunks.add({
      projectId, worldGroupId: null, sourceChapterId: chapterId, chunkIndex: 0,
      text: '旧检索内容', keywords: [], embedding: null, embeddingModel: null,
      sourceTextHash: 'old', createdAt: now,
    })

    const seed = NOVEL_PROMPT_LIBRARY_SEEDS.find(item => item.library?.assetId === 'P11-B')!
    const result = await adoptPromptLibraryChapterOutput({
      project,
      template: { ...seed, createdAt: now, updatedAt: now },
      run: {
        assetId: 'P11-B', projectId, chapterId, outlineNodeId: nodeId, worldGroupId: null,
        output: '林舟烧掉证据。\n火光映亮窗户。', completedAt: now,
      },
    })

    expect(result).toMatchObject({ chapterId, demotedFacts: 1, warnings: [] })
    expect(await db.snapshots.count()).toBe(1)
    expect(await db.chapters.get(chapterId)).toMatchObject({
      content: '<p>林舟烧掉证据。</p><p>火光映亮窗户。</p>',
      wordCount: 14,
    })
    expect((await db.temporalFacts.get(factId))?.status).toBe('stale')
    const chunks = await db.retrievalChunks.where('sourceChapterId').equals(chapterId).toArray()
    expect(chunks.map(chunk => chunk.text).join('\n')).toContain('林舟烧掉证据')
    expect(chunks.map(chunk => chunk.text).join('\n')).not.toContain('旧检索内容')
    expect(await db.narrativeSummaryNodes.where('projectId').equals(projectId).count()).toBeGreaterThan(0)
  })
})

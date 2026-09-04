/**
 * R-06: deleteNode 绕过 deleteChapter → emotionBeatCards 残留
 *
 * R-06：节点删除级联反例。
 *
 * 反例:
 *   旧 deleteNode 用 db.chapters.bulkDelete() 直接删章节,
 *   绕过了 deleteChapter 内部的 emotionBeatCards 级联清理 →
 *   删大纲节点后,章节关联的情感节拍卡残留成孤儿。
 *
 * 期望(P0-7 修复后):
 *   章节删除统一走 chapter store 的 cascadeDeleteChapters(单一入口);
 *   删大纲节点后,chapters / detailedOutlines / emotionBeatCards 全部清空。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useOutlineStore } from '../../src/stores/outline'
import { useChapterStore } from '../../src/stores/chapter'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

describe('R-06: deleteNode 级联 emotionBeatCards', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('删大纲节点后,章节 + 细纲 + 情感节拍卡全部清空', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: 'R-06', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number

    // 建大纲节点(章节类型)
    const nodeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'chapter',
      title: '第一章', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number

    // 挂在该节点上的正文章节
    const chapterId = await db.chapters.add({
      projectId, outlineNodeId: nodeId,
      title: '第一章', content: '正文', summary: '',
      wordCount: 2, status: 'draft', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number

    // 挂在该节点上的细纲
    await db.detailedOutlines.add({
      projectId, outlineNodeId: nodeId, scenes: [] as any,
      createdAt: now, updatedAt: now,
    } as any)

    // 挂在该章节上的情感节拍卡(旧 deleteNode 会漏删这个)
    await db.emotionBeatCards.add({
      projectId, chapterId, beats: [] as any, overallArc: '',
      createdAt: now, updatedAt: now,
    } as any)
    const factId = await db.temporalFacts.add({
      projectId, subjectName: '林飞', predicate: 'location', factKind: 'state', value: '洛阳',
      sourceType: 'chapter', sourceChapterId: chapterId,
      validFromChapterId: chapterId, validToChapterId: chapterId,
      status: 'confirmed', locked: false, createdAt: now, updatedAt: now,
    } as any) as number
    await db.retrievalChunks.add({
      projectId, sourceChapterId: chapterId, chunkIndex: 0, text: '正文',
      keywords: [], embedding: null, embeddingModel: null,
      sourceTextHash: 'hash', createdAt: now,
    } as any)
    await db.narrativeSummaryNodes.add({
      projectId, worldGroupId: null, level: 'chapter',
      sourceChapterId: chapterId, sourceOutlineNodeId: nodeId,
      title: '第一章', summary: '正文摘要', keywords: [],
      sourceHash: 'hash', status: 'verified', generatedBy: 'system-rollup',
      createdAt: now, updatedAt: now,
    } as any)
    await finalizeCurrentFixtureV1(projectId)

    // 加载到内存(模拟真实使用)
    await useChapterStore.getState().loadAll(projectId)
    await useOutlineStore.getState().loadAll(projectId)

    // 验证准备齐全
    expect(await db.chapters.count()).toBe(1)
    expect(await db.detailedOutlines.count()).toBe(1)
    expect(await db.emotionBeatCards.count()).toBe(1)

    // 执行:删大纲节点
    await useOutlineStore.getState().deleteNode(nodeId)

    // 断言:全部清空
    expect(await db.outlineNodes.count(), 'outlineNodes 应清空').toBe(0)
    expect(await db.chapters.count(), 'chapters 应清空').toBe(0)
    expect(await db.detailedOutlines.count(), 'detailedOutlines 应清空').toBe(0)
    expect(
      await db.emotionBeatCards.count(),
      'emotionBeatCards 应清空(旧 deleteNode 在这里漏删)',
    ).toBe(0)
    const fact = await db.temporalFacts.get(factId)
    expect(fact).toBeTruthy()
    expect(fact?.sourceChapterId).toBeNull()
    expect(fact?.validFromChapterId).toBeNull()
    expect(fact?.validToChapterId).toBeNull()
    expect(fact?.status).toBe('invalid-range') // 删章不自动改时序，进入具体异常复核
    expect(await db.retrievalChunks.where('sourceChapterId').equals(chapterId).count()).toBe(0)
    expect(await db.narrativeSummaryNodes.where('sourceChapterId').equals(chapterId).count()).toBe(0)

    // 断言:章节 store 内存也同步移除
    expect(
      useChapterStore.getState().chapters.find(c => c.id === chapterId),
      'chapter store 内存应移除该章节',
    ).toBeUndefined()
  })

  it('删带子节点的卷,递归级联清理所有后代章节与节拍卡', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: 'R-06b', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number

    // 卷
    const volId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'volume',
      title: '第一卷', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number

    // 卷下两章
    const makeChapter = async (order: number) => {
      const nodeId = await db.outlineNodes.add({
        projectId, parentId: volId, type: 'chapter',
        title: `第${order + 1}章`, summary: '', order,
        createdAt: now, updatedAt: now,
      } as any) as number
      const chId = await db.chapters.add({
        projectId, outlineNodeId: nodeId, title: `第${order + 1}章`,
        content: '正文', summary: '', wordCount: 2, status: 'draft', order,
        createdAt: now, updatedAt: now,
      } as any) as number
      await db.emotionBeatCards.add({
        projectId, chapterId: chId, beats: [] as any, overallArc: '',
        createdAt: now, updatedAt: now,
      } as any)
    }
    await makeChapter(0)
    await makeChapter(1)
    await finalizeCurrentFixtureV1(projectId)

    expect(await db.chapters.count()).toBe(2)
    expect(await db.emotionBeatCards.count()).toBe(2)

    await useChapterStore.getState().loadAll(projectId)
    await useOutlineStore.getState().loadAll(projectId)

    // 删卷(递归删两个子章节节点)
    await useOutlineStore.getState().deleteNode(volId)

    expect(await db.outlineNodes.count(), '所有节点清空').toBe(0)
    expect(await db.chapters.count(), '所有章节清空').toBe(0)
    expect(await db.emotionBeatCards.count(), '所有节拍卡清空(递归级联)').toBe(0)
  })
})

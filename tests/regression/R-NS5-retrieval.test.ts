/**
 * R-NS5-retrieval · 叙事感知检索（NS-5）
 * 守卫：切块+关键词、按 hash 复用/重建、关键词召回、未来章不泄漏、世界隔离、按时间重组。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  splitIntoChunks,
  extractKeywords,
  rebuildChapterChunks,
  rebuildProjectRetrievalChunks,
  rebuildProjectNarrativeSummaries,
  readNarrativeSummaryContext,
  retrieveChunks,
} from '../../src/lib/retrieval/retrieval'
import { useChapterStore } from '../../src/stores/chapter'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const now = Date.now()
async function seedChapters(texts: string[]) {
  const createdWorkspaceV1 = await seedCurrentWorkspace('P', { genres: ['x'], targetWordCount: 0 })
  const scope = createdWorkspaceV1.scope
  const pid = scope.projectId
  const vol = await db.outlineNodes.add({ projectId: pid, workId: scope.workId, parentId: null, type: 'volume', title: '卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chaps: number[] = []
  for (let i = 0; i < texts.length; i++) {
    const n = await db.outlineNodes.add({ projectId: pid, workId: scope.workId, parentId: vol, type: 'chapter', title: `第${i + 1}章`, summary: '', order: i, createdAt: now, updatedAt: now } as any) as number
    const c = await db.chapters.add({ projectId: pid, workId: scope.workId, outlineNodeId: n, title: `第${i + 1}章`, content: texts[i], wordCount: 0, status: 'draft', order: i, notes: '', createdAt: now, updatedAt: now } as any) as number
    chaps.push(c)
  }
  await finalizeCurrentFixtureV1(pid)
  return { pid, scope, chaps }
}

describe('NS-5 · retrieval', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('切块与关键词抽取', () => {
    expect(splitIntoChunks('').length).toBe(0)
    expect(splitIntoChunks('一段\n二段\n三段').length).toBeGreaterThan(0)
    expect(extractKeywords('林飞拿起青铜铃', ['林飞', '苏禾', '青铜铃'])).toEqual(expect.arrayContaining(['林飞', '青铜铃']))
  })

  it('正文未变复用、变了重建', async () => {
    const { pid, chaps } = await seedChapters(['林飞在洛阳。'])
    const ch = await db.chapters.get(chaps[0])
    const r1 = await rebuildChapterChunks({ projectId: pid, chapter: ch!, knownEntities: ['林飞'] })
    expect(r1.rebuilt).toBe(true)
    const r2 = await rebuildChapterChunks({ projectId: pid, chapter: ch!, knownEntities: ['林飞'] })
    expect(r2.rebuilt).toBe(false) // hash 相同复用
    await db.chapters.update(chaps[0], { content: '林飞到了北境。' })
    const ch2 = await db.chapters.get(chaps[0])
    const r3 = await rebuildChapterChunks({ projectId: pid, chapter: ch2!, knownEntities: ['林飞'] })
    expect(r3.rebuilt).toBe(true) // 正文变→重建
  })

  it('关键词召回 + 未来章不泄漏', async () => {
    const { pid, chaps } = await seedChapters([
      '第一章：林飞在洛阳被预言只剩十六年阳寿。',
      '第二章：林飞前往北境。',
      '第三章：林飞抵达轮回沙海。', // 当前章(未来)
    ])
    for (const c of chaps) {
      const ch = await db.chapters.get(c)
      await rebuildChapterChunks({ projectId: pid, chapter: ch!, knownEntities: ['林飞'] })
    }
    // 在写第3章时召回（currentChapter = chaps[2]）
    const got = await retrieveChunks({ projectId: pid, currentChapterId: chaps[2], queryTerms: ['林飞'], topK: 5 })
    const sources = got.map(r => r.chunk.sourceChapterId)
    expect(sources).toContain(chaps[0])
    expect(sources).toContain(chaps[1])
    expect(sources).not.toContain(chaps[2]) // 当前/未来章不召回
  })

  it('当前项目缺少派生索引时先为已写章节切块，再可召回', async () => {
    const { pid, scope, chaps } = await seedChapters([
      '第一章：林飞把青铜铃交给苏禾保管。',
      '第二章：当前要写苏禾归还铃铛。',
    ])
    await db.characters.add({
      projectId: pid,
      worldId: scope.worldId,
      name: '苏禾',
      roleWeight: 'secondary',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      shortDescription: '',
      appearance: '',
      personality: '',
      background: '',
      motivation: '',
      abilities: '',
      relationships: '',
      arc: '',
      createdAt: now,
      updatedAt: now,
    } as any)
    const categoryId = await db.codexCategories.add({ projectId: pid, name: '器物', order: 0, createdAt: now, updatedAt: now } as any) as number
    await db.codexEntries.add({ projectId: pid, categoryId, name: '青铜铃', order: 0, createdAt: now, updatedAt: now } as any)
    await finalizeCurrentFixtureV1(pid)

    expect(await db.retrievalChunks.where('projectId').equals(pid).count()).toBe(0)
    const built = await rebuildProjectRetrievalChunks({ projectId: pid })
    expect(built.chapters).toBe(2)
    expect(built.chunks).toBeGreaterThan(0)
    const got = await retrieveChunks({ projectId: pid, currentChapterId: chaps[1], queryTerms: ['苏禾', '青铜铃'] })
    expect(got.map(r => r.chunk.sourceChapterId)).toContain(chaps[0])
    expect(got.map(r => r.chunk.text).join('\n')).toContain('青铜铃')
  })

  it('层级摘要树：重建章→卷→全书，并按当前章只注入 verified 前文', async () => {
    const { pid, chaps } = await seedChapters([
      '第一章：林飞把青铜铃交给苏禾保管。',
      '第二章：苏禾带着青铜铃进入北境。',
      '第三章：当前章。',
    ])

    const built = await rebuildProjectNarrativeSummaries({ projectId: pid })
    expect(built.chapterNodes).toBe(3)
    expect(built.volumeNodes).toBe(1)
    expect(built.bookNodes).toBe(1)

    const nodes = await db.narrativeSummaryNodes.where('projectId').equals(pid).toArray()
    expect(nodes.some(node => node.level === 'book' && node.summary.includes('青铜铃'))).toBe(true)

    const ctx = await readNarrativeSummaryContext({ projectId: pid, currentChapterId: chaps[2] })
    expect(ctx).toContain('全书')
    expect(ctx).toContain('本卷')
    expect(ctx).toContain('青铜铃')
    expect(ctx).not.toContain('第三章：当前章') // 当前/未来章正文不注入
  })

  it('层级摘要 stale 防线：正文修改后旧摘要节点不再注入', async () => {
    const { pid, chaps } = await seedChapters([
      '第一章：林飞把青铜铃交给苏禾保管。',
      '第二章：当前章。',
    ])
    await useChapterStore.getState().loadAll(pid)
    await rebuildProjectNarrativeSummaries({ projectId: pid })

    await useChapterStore.getState().updateChapter(chaps[0], {
      content: '第一章：旧物已删除。',
      wordCount: 8,
    })

    const stale = await db.narrativeSummaryNodes.where('projectId').equals(pid).filter(node => node.status === 'stale').toArray()
    expect(stale.length).toBeGreaterThan(0)
    const ctx = await readNarrativeSummaryContext({ projectId: pid, currentChapterId: chaps[1] })
    expect(ctx).not.toContain('青铜铃')
  })

  it('世界隔离：别的世界的块不召回', async () => {
    const { pid, chaps } = await seedChapters(['第一章：林飞在洛阳。', '第二章：当前。'])
    const ch0 = await db.chapters.get(chaps[0])
    await rebuildChapterChunks({ projectId: pid, chapter: ch0!, worldGroupId: 99, knownEntities: ['林飞'] })
    const got = await retrieveChunks({ projectId: pid, currentChapterId: chaps[1], worldGroupId: 7, queryTerms: ['林飞'] })
    expect(got.length).toBe(0) // 块在世界99，当前世界7 → 不召回
  })
})

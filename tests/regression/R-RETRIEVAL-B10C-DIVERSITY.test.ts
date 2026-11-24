/**
 * R-RETRIEVAL-B10C · 长尾召回章多样性
 * 守卫：同一章的高分块不得独占 top-K 名额；晚/低频章的证据块仍可被召回；
 * 返回总数恒为 min(topK, 命中块数)；单章场景退化为原始全局 top-K。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { rebuildChapterChunks, retrieveChunks } from '../../src/lib/retrieval/retrieval'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const now = Date.now()

async function seedChapters(texts: string[]) {
  const createdWorkspaceV1 = await seedCurrentWorkspace('B10C', { genres: ['x'], targetWordCount: 0 })
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

describe('B10c · retrieveChunks 章多样性长尾召回', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close() })

  it('高频章不得独占名额：单章多块时仍轮次交错，晚章低频块可被召回', async () => {
    // 第1章长正文切成 6+ 个块且每块同时命中两个查询词（高频高分章）；
    // 第2、3章各只有一块命中低分（长尾证据）。旧全局 top-K 会全部取第1章。
    const noisyChapter = Array.from({ length: 18 }, (_, i) => `第${i + 1}段：守灯人擦拭青铜铃并记录灯谱，潮水在礁石间起落。`.repeat(5)).join('\n')
    const { pid, scope, chaps } = await seedChapters([
      noisyChapter,
      '守灯人在邮局把青铜铃托付给邮差。',
      '多年后，潮汐钟与青铜铃在同一张航海图上出现。',
      '当前章：守灯人翻开航海图准备出海。',
    ])
    for (const id of chaps) {
      const chapter = await db.chapters.get(id)
      await rebuildChapterChunks({ projectId: pid, chapter: chapter!, knownEntities: ['青铜铃', '灯谱'] })
    }
    const got = await retrieveChunks({
      projectId: pid, scope, currentChapterId: chaps[3], queryTerms: ['青铜铃', '灯谱'], topK: 6,
    })
    expect(got).toHaveLength(6)
    const byChapter = new Map<number, number>()
    for (const row of got) byChapter.set(row.chunk.sourceChapterId, (byChapter.get(row.chunk.sourceChapterId) ?? 0) + 1)
    // 高频章占满后剩余名额；每个命中章的最佳块都先于任何章的第二块入选。
    expect(byChapter.get(chaps[0])!).toBe(4)
    // 晚/低频章（第2、3章）的证据块进入召回，不被高分章挤出。
    expect(byChapter.get(chaps[1])).toBe(1)
    expect(byChapter.get(chaps[2])).toBe(1)
  })

  it('返回总数与单章退化行为不变', async () => {
    const single = '守灯人擦拭青铜铃并记录灯谱。守灯人再次擦拭青铜铃。守灯人第三次擦拭青铜铃。'
    const { pid, scope, chaps } = await seedChapters([
      single,
      '守灯人在邮局把青铜铃托付给邮差。',
      '当前章：守灯人准备出海。',
    ])
    for (const id of chaps) {
      const chapter = await db.chapters.get(id)
      await rebuildChapterChunks({ projectId: pid, chapter: chapter!, knownEntities: ['青铜铃'] })
    }
    const got = await retrieveChunks({
      projectId: pid, scope, currentChapterId: chaps[2], queryTerms: ['青铜铃'], topK: 6,
    })
    // 命中块不足 topK 时返回全部命中块；总数不受交错影响。
    expect(got.length).toBeGreaterThan(0)
    expect(got.length).toBeLessThanOrEqual(6)
    expect(got.every(row => row.chunk.sourceChapterId !== chaps[2])).toBe(true)
    // 结果按章序→块序重组。
    const orders = got.map(row => row.chunk.sourceChapterId)
    const sorted = [...orders].sort((a, b) => chaps.indexOf(a) - chaps.indexOf(b))
    expect(orders).toEqual(sorted)
  })
})

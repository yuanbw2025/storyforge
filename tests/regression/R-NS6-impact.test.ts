/**
 * R-NS6-impact · 正文修改 stale 传播 + 影响分析（NS-6）
 * 守卫：源自该章、证据失效的已确认事实标记 stale；不动 locked/候选；不删事实；影响列后续章。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { propagateChapterEditStale, analyzeEditImpact, buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const now = Date.now()
async function seed() {
  const pid = await seedCurrentProject({ name: 'P', genres: ['x'], description: '', targetWordCount: 0, enableMultiWorld: false, createdAt: now, updatedAt: now } as any) as number
  const vol = await db.outlineNodes.add({ projectId: pid, parentId: null, type: 'volume', title: '卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chaps: number[] = []
  for (let i = 0; i < 3; i++) {
    const n = await db.outlineNodes.add({ projectId: pid, parentId: vol, type: 'chapter', title: `第${i + 1}章`, summary: '', order: i, createdAt: now, updatedAt: now } as any) as number
    const c = await db.chapters.add({ projectId: pid, outlineNodeId: n, title: `第${i + 1}章`, content: `第${i + 1}章正文`, wordCount: 0, status: 'draft', order: i, notes: '', createdAt: now, updatedAt: now } as any) as number
    chaps.push(c)
  }
  await finalizeCurrentFixtureV1(pid)
  return { pid, chaps }
}
const addFact = async (pid: number, chapterId: number, over: any) => {
  const id = await db.temporalFacts.add({ projectId: pid, subjectName: '林飞', predicate: 'location', factKind: 'state', value: '洛阳', sourceType: 'chapter', sourceChapterId: chapterId, sourceQuote: '林飞在洛阳', validFromChapterId: chapterId, status: 'confirmed', locked: false, createdAt: now, updatedAt: now, ...over } as any)
  await finalizeCurrentFixtureV1(pid)
  return id
}

describe('NS-6 · 影响分析与 stale 传播', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('证据失效的已确认事实 → 降级候选；证据仍在的不动', async () => {
    const { pid, chaps } = await seed()
    await db.chapters.update(chaps[0], { content: '林飞在洛阳街头。苏禾未现身。' })
    const fGone = await addFact(pid, chaps[0], { value: '北境', sourceQuote: '林飞登基' }) as number   // 引文不在正文
    const fKeep = await addFact(pid, chaps[0], { value: '洛阳', sourceQuote: '林飞在洛阳' }) as number  // 引文仍在
    const r = await propagateChapterEditStale(pid, chaps[0])
    expect(r.demotedFacts).toBe(1)
    expect((await db.temporalFacts.get(fGone))!.status).toBe('stale')       // 具体异常状态
    expect((await db.temporalFacts.get(fKeep))!.status).toBe('confirmed')   // 不动
  })

  it('locked 与候选不被降级；事实不被删除', async () => {
    const { pid, chaps } = await seed()
    await db.chapters.update(chaps[0], { content: '无关正文。' })
    const fLocked = await addFact(pid, chaps[0], { sourceQuote: '消失的引文', locked: true }) as number
    const fCand = await addFact(pid, chaps[0], { sourceQuote: '消失的引文', status: 'candidate' }) as number
    await propagateChapterEditStale(pid, chaps[0])
    expect((await db.temporalFacts.get(fLocked))!.status).toBe('confirmed') // locked 不动
    expect((await db.temporalFacts.get(fCand))!.status).toBe('candidate')   // 候选不动
    expect(await db.temporalFacts.count()).toBe(2)                          // 不删
  })

  it('影响分析:列源自该章的事实 + 后续章', async () => {
    const { pid, chaps } = await seed()
    await addFact(pid, chaps[1], {})
    const impact = await analyzeEditImpact(pid, chaps[1])
    expect(impact.factsFromChapter.length).toBe(1)
    expect(impact.downstreamChapterIds).toEqual([chaps[2]])   // 只列第3章(在第2章之后)
    expect(impact.downstreamChapterIds).not.toContain(chaps[0])
  })

  it('影响图绑定正文 hash，并列出事实、后续章节和派生节点', async () => {
    const { pid, chaps } = await seed()
    const factId = await addFact(pid, chaps[0], {}) as number
    const graph = await buildEditImpactGraphV1(pid, chaps[0])
    expect(graph.source.recordId).toBe(chaps[0])
    expect(graph.source.sourceTextHash).toHaveLength(64)
    expect(graph.staleFactIds).toEqual([])
    expect(graph.downstreamChapterIds).toEqual([chaps[1], chaps[2]])
    expect(graph.nodes.some(node => node.kind === 'fact' && node.recordId === factId)).toBe(true)
    expect(graph.edges.some(edge => edge.relation === 'chronological-downstream')).toBe(true)
    const same = await buildEditImpactGraphV1(pid, chaps[0])
    expect(same.graphHash).toBe(graph.graphHash)
    await db.chapters.update(chaps[0], { content: '正文发生变化。' })
    const changed = await buildEditImpactGraphV1(pid, chaps[0])
    expect(changed.graphHash).not.toBe(graph.graphHash)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { executeImpactAuthorReviewV1 } from '../../src/lib/agent/run/impact-review-durable'

async function seed(): Promise<{ scope: WorkspaceScope; chapterId: number; worldGroupId: number }> {
  const now = Date.now()
  const projectId = await db.projects.add({ name: '作者复核', genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '', targetWordCount: 100_000, worldCode: 'review', worldVersion: 1, createdAt: now, updatedAt: now } as any) as number
  const worldId = await db.worlds.add({ projectId, code: 'review', name: '主世界', description: '', currentVersion: 1, createdAt: now, updatedAt: now }) as number
  const workId = await db.works.add({ projectId, worldId, title: '作者复核', description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({ projectId, name: '主世界', order: 0, createdAt: now, updatedAt: now }) as number
  const outlineNodeId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: null, type: 'chapter', title: '第一章', summary: '旧章纲', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapterId = await db.chapters.add({ projectId, workId, outlineNodeId, title: '第一章', content: '<p>潮声穿过旧港。</p>', wordCount: 8, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now } as any) as number
  await db.retrievalChunks.add({ projectId, workId, worldGroupId, sourceChapterId: chapterId, chunkIndex: 0, text: '旧正文', keywords: [], embedding: null, embeddingModel: null, sourceTextHash: '0'.repeat(64), createdAt: now } as any)
  await db.narrativeSummaryNodes.add({ projectId, workId, worldGroupId, level: 'chapter', sourceChapterId: chapterId, sourceOutlineNodeId: outlineNodeId, title: '第一章', summary: '旧摘要', keywords: [], sourceHash: '0'.repeat(64), status: 'verified', generatedBy: 'test', createdAt: now, updatedAt: now } as any)
  return { scope: { projectId, worldId, workId }, chapterId, worldGroupId }
}

describe.sequential('R-HARNESS50 · 作者确认项复核 durable run', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只记录作者决定并签发 receipt，不写正文或大纲', async () => {
    const fixture = await seed()
    const graph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
    const plan = await buildImpactRemediationPlanV1(graph)
    const item = plan.items.find(candidate => candidate.mode === 'author-confirmed')!
    const result = await executeImpactAuthorReviewV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan,
      itemId: item.id,
      decision: 'needs-manual-action',
      note: '作者确认需要打开事实账本进一步核对。',
    })
    expect(result.reused).toBe(false)
    expect(result.snapshot.projection.state).toBe('completed')
    expect(result.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await db.chapters.get(fixture.chapterId))?.content).toContain('潮声')
    expect((await db.outlineNodes.get(1))?.summary).toBe('旧章纲')
    expect(result.snapshot.events.some(event => event.type === 'adoption.committed')).toBe(false)
  })

  it('相同计划、项目和决定幂等复用 review run', async () => {
    const fixture = await seed()
    const graph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
    const plan = await buildImpactRemediationPlanV1(graph)
    const item = plan.items.find(candidate => candidate.mode === 'author-confirmed')!
    const input = { scope: fixture.scope, worldGroupId: fixture.worldGroupId, plan, itemId: item.id, decision: 'acknowledged' as const, note: '已复核，当前不改正式数据。' }
    const first = await executeImpactAuthorReviewV1(input)
    const second = await executeImpactAuthorReviewV1({ ...input, note: '再次点击时不伪造一条新理由。' })
    expect(second.reused).toBe(true)
    expect(second.snapshot.run.id).toBe(first.snapshot.run.id)
    expect(second.output.note).toBe(input.note)
    expect(await db.agentRuns.where('projectId').equals(fixture.scope.projectId).count()).toBe(1)
  })

  it('影响图变化但正文未变化时不复用旧 receipt', async () => {
    const fixture = await seed()
    const graph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
    const plan = await buildImpactRemediationPlanV1(graph)
    const item = plan.items.find(candidate => candidate.mode === 'author-confirmed')!
    const input = {
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan,
      itemId: item.id,
      decision: 'acknowledged' as const,
      note: '已复核当前影响项。',
    }
    await executeImpactAuthorReviewV1(input)
    await db.temporalFacts.add({
      projectId: fixture.scope.projectId,
      workId: fixture.scope.workId,
      subjectName: '港口',
      predicate: '状态',
      factKind: 'state',
      value: '繁忙',
      sourceType: 'chapter',
      sourceChapterId: fixture.chapterId,
      status: 'confirmed',
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    await expect(executeImpactAuthorReviewV1(input)).rejects.toThrow('影响复核计划已过期')
    expect(await db.agentRuns.where('projectId').equals(fixture.scope.projectId).count()).toBe(1)
  })

  it('正文变化、非作者项或空理由均阻断', async () => {
    const fixture = await seed()
    const graph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
    const plan = await buildImpactRemediationPlanV1(graph)
    const authorItem = plan.items.find(candidate => candidate.mode === 'author-confirmed')!
    await db.chapters.update(fixture.chapterId, { content: '<p>作者改写。</p>' })
    await expect(executeImpactAuthorReviewV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId, plan, itemId: authorItem.id, decision: 'acknowledged', note: '复核' })).rejects.toThrow('来源正文 hash 已变化')
    const freshGraph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
    const freshPlan = await buildImpactRemediationPlanV1(freshGraph)
    const deterministic = freshPlan.items.find(candidate => candidate.mode === 'deterministic')!
    await expect(executeImpactAuthorReviewV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId, plan: freshPlan, itemId: deterministic.id, decision: 'acknowledged', note: '复核' })).rejects.toThrow('作者确认项')
    await expect(executeImpactAuthorReviewV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId, plan: freshPlan, itemId: authorItem.id, decision: 'acknowledged', note: '' })).rejects.toThrow('复核理由')
  })
})

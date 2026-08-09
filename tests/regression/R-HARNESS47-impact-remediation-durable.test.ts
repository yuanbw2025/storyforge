import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { executeImpactRemediationV1 } from '../../src/lib/agent/run/impact-remediation-durable'

async function seed(): Promise<{ scope: WorkspaceScope; chapterId: number; worldGroupId: number }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '影响重建', genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 100_000, worldCode: 'impact-remediation', worldVersion: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({ projectId, code: 'impact-remediation', name: '主世界', description: '', currentVersion: 1, createdAt: now, updatedAt: now }) as number
  const workId = await db.works.add({ projectId, worldId, title: '影响重建', description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({ projectId, name: '主世界', order: 0, createdAt: now, updatedAt: now }) as number
  const volumeId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
  const outlineNodeId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '旧章纲', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapterId = await db.chapters.add({
    projectId, workId, outlineNodeId, title: '第一章', content: '<p>潮声穿过旧港。</p>', wordCount: 8, status: 'draft', order: 0,
    notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  await db.retrievalChunks.add({
    projectId, workId, worldGroupId, sourceChapterId: chapterId, chunkIndex: 0, text: '旧正文', keywords: [],
    embedding: null, embeddingModel: null, sourceTextHash: '0'.repeat(64), createdAt: now,
  } as any)
  await db.narrativeSummaryNodes.add({
    projectId, workId, worldGroupId, level: 'chapter', sourceChapterId: chapterId, sourceOutlineNodeId: outlineNodeId,
    title: '第一章', summary: '旧摘要', keywords: [], sourceHash: '0'.repeat(64), status: 'verified', generatedBy: 'test', createdAt: now, updatedAt: now,
  } as any)
  return { scope: { projectId, worldId, workId }, chapterId, worldGroupId }
}

async function planFor(fixture: Awaited<ReturnType<typeof seed>>) {
  const graph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
  return buildImpactRemediationPlanV1(graph)
}

describe.sequential('R-HARNESS47 · 确定性影响重建 durable run', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('只重建检索/摘要派生缓存，写入终态 receipt，正文与章纲不变', async () => {
    const fixture = await seed()
    const plan = await planFor(fixture)
    expect(plan.counts.deterministic).toBe(2)
    const beforeOutline = await db.outlineNodes.get(2)
    const result = await executeImpactRemediationV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan,
    })
    expect(result.reused).toBe(false)
    expect(result.receiptHash).toHaveLength(64)
    expect(result.snapshot.projection.state).toBe('completed')
    expect((await db.chapters.get(fixture.chapterId))?.content).toContain('潮声')
    expect((await db.outlineNodes.get(beforeOutline?.id))?.summary).toBe('旧章纲')
    expect((await db.retrievalChunks.where('sourceChapterId').equals(fixture.chapterId).toArray())[0].sourceTextHash).not.toBe('0'.repeat(64))
    expect((await db.narrativeSummaryNodes.where('sourceChapterId').equals(fixture.chapterId).toArray())[0].summary).toContain('潮声')
    expect(result.snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
  })

  it('同一计划重复执行复用已完成 run，不重复创建 durable run', async () => {
    const fixture = await seed()
    const plan = await planFor(fixture)
    const first = await executeImpactRemediationV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId, plan })
    const second = await executeImpactRemediationV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId, plan })
    expect(second.reused).toBe(true)
    expect(second.snapshot.run.id).toBe(first.snapshot.run.id)
    expect(await db.agentRuns.where('projectId').equals(fixture.scope.projectId).count()).toBe(1)
  })

  it('正文 hash 变化时拒绝旧计划，且不创建执行 run', async () => {
    const fixture = await seed()
    const plan = await planFor(fixture)
    await db.chapters.update(fixture.chapterId, { content: '<p>作者重新改写。</p>' })
    await expect(executeImpactRemediationV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId, plan })).rejects.toThrow('来源正文 hash 已变化')
    expect(await db.agentRuns.where('projectId').equals(fixture.scope.projectId).count()).toBe(0)
  })

  it('没有确定性项目时拒绝执行，不把作者确认项目自动写回', async () => {
    const fixture = await seed()
    const graph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
    const plan = await buildImpactRemediationPlanV1({
      ...graph,
      nodes: graph.nodes.filter(node => node.kind === 'changed-source'),
      edges: [],
      graphHash: 'f'.repeat(64),
    })
    await expect(executeImpactRemediationV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId, plan })).rejects.toThrow('没有可确定性重建')
    expect(await db.agentRuns.where('projectId').equals(fixture.scope.projectId).count()).toBe(0)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { replanImpactRemediationV1 } from '../../src/lib/consistency/impact-remediation-replan'

async function seed(): Promise<{ scope: WorkspaceScope; chapterId: number }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '影响计划重跑', genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 100_000, worldCode: 'impact-replan', worldVersion: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({ projectId, code: 'impact-replan', name: '主世界', description: '', currentVersion: 1, createdAt: now, updatedAt: now }) as number
  const workId = await db.works.add({ projectId, worldId, title: '影响计划重跑', description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({ projectId, name: '主世界', order: 0, createdAt: now, updatedAt: now }) as number
  const outlineNodeId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: null, type: 'chapter', title: '第一章', summary: '旧章纲', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapterId = await db.chapters.add({ projectId, workId, outlineNodeId, title: '第一章', content: '<p>潮声穿过旧港。</p>', wordCount: 8, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now } as any) as number
  return { scope: { projectId, worldId, workId }, chapterId }
}

describe.sequential('R-HARNESS49 · 影响处理 stale/replan', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('正文变化后重建新图和新计划，不写入正文或大纲', async () => {
    const fixture = await seed()
    const originalGraph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
    const originalPlan = await buildImpactRemediationPlanV1(originalGraph)
    await db.chapters.update(fixture.chapterId, { content: '<p>作者重新写过潮门。</p>' })

    const result = await replanImpactRemediationV1({
      scope: fixture.scope,
      previousPlan: originalPlan,
      reason: 'source-stale',
    })

    expect(result.changed).toBe(true)
    expect(result.previousPlanHash).toBe(originalPlan.planHash)
    expect(result.graph.source.sourceTextHash).not.toBe(originalPlan.source.sourceTextHash)
    expect(result.plan.source.sourceTextHash).toBe(result.graph.source.sourceTextHash)
    expect((await db.chapters.get(fixture.chapterId))?.content).toContain('重新写过')
    expect((await db.outlineNodes.get(1))?.summary).toBe('旧章纲')
  })

  it('来源未变化时重规划是幂等的，不创建第二套计划语义', async () => {
    const fixture = await seed()
    const graph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
    const plan = await buildImpactRemediationPlanV1(graph)
    const result = await replanImpactRemediationV1({ scope: fixture.scope, previousPlan: plan })
    expect(result.changed).toBe(false)
    expect(result.plan.planHash).toBe(plan.planHash)
    expect(result.graph.graphHash).toBe(graph.graphHash)
  })

  it('损坏或跨表旧计划在重规划前阻断', async () => {
    const fixture = await seed()
    const graph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
    const plan = await buildImpactRemediationPlanV1(graph)
    await expect(replanImpactRemediationV1({
      scope: fixture.scope,
      previousPlan: { ...plan, planHash: 'bad' },
    })).rejects.toThrow('旧影响处理计划无效')
  })
})

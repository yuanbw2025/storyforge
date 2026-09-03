import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactHandoffV2 } from '../../src/lib/consistency/impact-handoff'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { validateCurrentImpactHandoffV2 } from '../../src/lib/agent/run/impact-handoff-durable'
import { executeImpactAuthorReviewV1 } from '../../src/lib/agent/run/impact-review-durable'

async function seed(): Promise<{
  scope: WorkspaceScope
  chapterId: number
  outlineNodeId: number
  worldGroupId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({ name: '交接验签', genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '', targetWordCount: 100_000,createdAt: now, updatedAt: now } as any) as number
  const worldId = await db.worlds.add({ projectId, code: 'handoff', name: '主世界', description: '', currentVersion: 1, createdAt: now, updatedAt: now }) as number
  const workId = await db.works.add({ projectId, worldId, title: '交接验签', description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({ projectId, name: '主世界', order: 0, createdAt: now, updatedAt: now }) as number
  const outlineNodeId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: null, type: 'chapter', title: '第一章', summary: '旧章纲', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapterId = await db.chapters.add({ projectId, workId, outlineNodeId, title: '第一章', content: '<p>潮声穿过旧港。</p>', wordCount: 8, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now } as any) as number
  return { scope: { projectId, worldId, workId }, chapterId, outlineNodeId, worldGroupId }
}

async function createHandoff(fixture: Awaited<ReturnType<typeof seed>>) {
  const graph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
  const plan = await buildImpactRemediationPlanV1(graph)
  const item = plan.items.find(candidate => candidate.mode === 'author-confirmed')!
  const review = await executeImpactAuthorReviewV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    plan,
    itemId: item.id,
    decision: 'needs-manual-action',
    note: '需要进入人工入口核对。',
  })
  return {
    plan,
    item,
    handoff: buildImpactHandoffV2({
      plan,
      itemId: item.id,
      decision: 'needs-manual-action',
      reviewRunId: review.snapshot.run.id,
      reviewReceiptHash: review.receiptHash,
      sourceOutlineNodeId: fixture.outlineNodeId,
    }),
  }
}

describe.sequential('R-HARNESS54 · 人工影响交接 durable 验签', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只有当前计划的真实 needs-manual-action 回执可以打开交接', async () => {
    const fixture = await seed()
    const created = await createHandoff(fixture)
    const validated = await validateCurrentImpactHandoffV2({ scope: fixture.scope, handoff: created.handoff })
    expect(validated?.plan.planHash).toBe(created.plan.planHash)
    expect(validated?.review).toMatchObject({
      runId: created.handoff.reviewRunId,
      receiptHash: created.handoff.reviewReceiptHash,
      output: { itemId: created.item.id, decision: 'needs-manual-action' },
    })
    expect(validated?.target).toEqual({
      table: created.item.table,
      recordId: created.item.recordId,
      moduleRecordId: fixture.outlineNodeId,
    })
  })

  it('格式正确但伪造的 run/receipt、旧决定和 stale 正文全部 fail closed', async () => {
    const fixture = await seed()
    const created = await createHandoff(fixture)
    await expect(validateCurrentImpactHandoffV2({
      scope: fixture.scope,
      handoff: { ...created.handoff, reviewRunId: created.handoff.reviewRunId + 99 },
    })).resolves.toBeNull()
    await expect(validateCurrentImpactHandoffV2({
      scope: fixture.scope,
      handoff: { ...created.handoff, reviewReceiptHash: 'f'.repeat(64) },
    })).resolves.toBeNull()

    await executeImpactAuthorReviewV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan: created.plan,
      itemId: created.item.id,
      decision: 'acknowledged',
      note: '复核后确认不再需要人工处理。',
    })
    await expect(validateCurrentImpactHandoffV2({ scope: fixture.scope, handoff: created.handoff })).resolves.toBeNull()

    const next = await createHandoff(fixture)
    await db.chapters.update(fixture.chapterId, { content: '<p>潮声之外又响起钟声。</p>' })
    await expect(validateCurrentImpactHandoffV2({ scope: fixture.scope, handoff: next.handoff })).resolves.toBeNull()
  })

  it('另一作品不能回放或显示当前作品的人工交接', async () => {
    const source = await seed()
    const created = await createHandoff(source)
    const other = await seed()
    await expect(validateCurrentImpactHandoffV2({
      scope: other.scope,
      handoff: created.handoff,
    })).resolves.toBeNull()
  })
})

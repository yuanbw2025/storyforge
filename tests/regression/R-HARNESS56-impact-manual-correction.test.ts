import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactHandoffV2 } from '../../src/lib/consistency/impact-handoff'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { executeImpactAuthorReviewV1 } from '../../src/lib/agent/run/impact-review-durable'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  beginImpactManualCorrectionV1,
  completeImpactManualCorrectionV1,
} from '../../src/lib/agent/run/impact-manual-correction-durable'
import { seedCurrentProject } from '../helpers/current-workspace'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

async function seed(name = '人工修正证明'): Promise<{
  scope: WorkspaceScope
  chapterId: number
  outlineNodeId: number
  worldGroupId: number
}> {
  const now = Date.now()
  const projectId = await seedCurrentProject({
    name, genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 100_000,
    createdAt: now, updatedAt: now,
  } as any) as number
  const { worldId, workId } = await resolveWorkspaceScope(projectId)
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'chapter', title: '第一章',
    summary: '旧章纲', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, workId, outlineNodeId, title: '第一章', content: '<p>潮声穿过旧港。</p>',
    wordCount: 8, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  await finalizeCurrentFixtureV1(projectId)
  return { scope: { projectId, worldId, workId }, chapterId, outlineNodeId, worldGroupId }
}

async function handoffForOutline(fixture: Awaited<ReturnType<typeof seed>>) {
  const graph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
  const plan = await buildImpactRemediationPlanV1(graph)
  const item = plan.items.find(candidate => (
    candidate.mode === 'author-confirmed'
    && candidate.table === 'outlineNodes'
    && candidate.recordId === fixture.outlineNodeId
  ))!
  expect(item).toBeTruthy()
  const review = await executeImpactAuthorReviewV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    plan,
    itemId: item.id,
    decision: 'needs-manual-action',
    note: '需要在现有大纲面板中人工修正。',
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

describe.sequential('R-HARNESS56 · 人工修正完成证明', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('导航只建立 paused pre-state，合法保存后才签发 terminal receipt', async () => {
    const fixture = await seed()
    const created = await handoffForOutline(fixture)
    const started = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    expect(started.reused).toBe(false)
    expect(started.snapshot.projection.state).toBe('paused')
    expect(started.snapshot.projection.terminalReceiptHash).toBeUndefined()
    expect(started.snapshot.events.some(event => event.type === 'adoption.committed')).toBe(false)

    await expect(completeImpactManualCorrectionV1({
      scope: fixture.scope,
      handoff: created.handoff,
    })).rejects.toThrow('正式状态没有变化')

    // title 同时进入 impact graph，证明合法修正即使让旧图 stale 也能按冻结基线完成。
    await db.outlineNodes.update(fixture.outlineNodeId, {
      title: '作者修正后的第一章', summary: '作者修正后的章纲', updatedAt: Date.now(),
    })
    const completed = await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    expect(completed.reused).toBe(false)
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(completed.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(completed.targetPostStateHash).not.toBe(completed.targetPreStateHash)
    expect(completed.snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
    expect(completed.snapshot.events.some(event => event.type === 'adoption.committed')).toBe(false)
  })

  it('刷新恢复同一个 child Run，完成后也幂等复用', async () => {
    const fixture = await seed()
    const created = await handoffForOutline(fixture)
    const first = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    const recovered = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    expect(recovered.reused).toBe(true)
    expect(recovered.snapshot.run.id).toBe(first.snapshot.run.id)
    expect(await db.agentRuns.where('projectId').equals(fixture.scope.projectId).count()).toBe(2)

    await db.outlineNodes.update(fixture.outlineNodeId, { summary: '刷新后保存', updatedAt: Date.now() })
    const completed = await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    const replayed = await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    expect(replayed.reused).toBe(true)
    expect(replayed.snapshot.run.id).toBe(completed.snapshot.run.id)
    expect(replayed.receiptHash).toBe(completed.receiptHash)
  })

  it('仅 updatedAt、修改错误记录和删除目标都不能完成', async () => {
    const fixture = await seed()
    const created = await handoffForOutline(fixture)
    await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    await db.outlineNodes.update(fixture.outlineNodeId, { updatedAt: Date.now() + 1000 })
    await expect(completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
      .rejects.toThrow('正式状态没有变化')

    const wrongId = await db.outlineNodes.add({
      projectId: fixture.scope.projectId,
      workId: fixture.scope.workId,
      worldGroupId: fixture.worldGroupId,
      parentId: null,
      type: 'chapter',
      title: '错误目标',
      summary: '',
      order: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any) as number
    await db.outlineNodes.update(wrongId, { summary: '只改了错误记录' })
    await expect(completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
      .rejects.toThrow('正式状态没有变化')

    await db.outlineNodes.delete(fixture.outlineNodeId)
    await expect(completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
      .rejects.toThrow('目标已删除')
  })

  it('父 review 被新决定覆盖后，即使目标变化也拒绝旧完成证明', async () => {
    const fixture = await seed()
    const created = await handoffForOutline(fixture)
    await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    await executeImpactAuthorReviewV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan: created.plan,
      itemId: created.item.id,
      decision: 'acknowledged',
      note: '新的作者决定覆盖旧人工交接。',
    })
    await db.outlineNodes.update(fixture.outlineNodeId, { summary: '此修改不属于旧交接', updatedAt: Date.now() })
    await expect(completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
      .rejects.toThrow('已被覆盖')
  })

  it('另一 Work 不能恢复，检查点载荷篡改后 fail closed', async () => {
    const fixture = await seed()
    const created = await handoffForOutline(fixture)
    const started = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    const other = await seed('另一作品')
    await expect(beginImpactManualCorrectionV1({ scope: other.scope, handoff: created.handoff })).rejects.toThrow()

    const checkpoint = await db.agentRunCheckpoints.where('runId').equals(started.snapshot.run.id).last()
    await db.agentRunCheckpoints.update(checkpoint!.id!, {
      resumePayloadJson: JSON.stringify({ version: 1, kind: 'impact-manual-correction-baseline', portable: false }),
    })
    await expect(beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
      .rejects.toThrow('恢复载荷哈希不匹配')
  })

  it('终验后目标再变会 stale receipt，不继续冒充 fresh 完成', async () => {
    const fixture = await seed()
    const created = await handoffForOutline(fixture)
    const started = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    await db.outlineNodes.update(fixture.outlineNodeId, { summary: '第一次合法修正', updatedAt: Date.now() })
    await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    await db.outlineNodes.update(fixture.outlineNodeId, { summary: '终验后的第二次变化', updatedAt: Date.now() + 1 })
    await expect(beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
      .rejects.toThrow('完成证明已过期')
    const run = await db.agentRuns.get(started.snapshot.run.id)
    expect(run?.status).toBe('running')
    expect(run?.terminalReceiptHash).toBeNull()
  })

  it('项目导入后待处理基线取消，completed receipt 则明确 stale', async () => {
    const pendingFixture = await seed('待处理导入')
    const pendingHandoff = await handoffForOutline(pendingFixture)
    await beginImpactManualCorrectionV1({ scope: pendingFixture.scope, handoff: pendingHandoff.handoff })
    const pendingImportedId = await importProjectJSON(await exportProjectJSON(pendingFixture.scope.projectId))
    const pendingRuns = await db.agentRuns.where('projectId').equals(pendingImportedId).toArray()
    const pendingCorrection = pendingRuns.find(run => run.parentRunId != null)!
    expect(pendingCorrection.status).toBe('cancelled')
    const pendingEvents = await db.agentRunEvents.where('runId').equals(pendingCorrection.id!).sortBy('sequence')
    expect(JSON.parse(pendingEvents.at(-1)!.payloadJson)).toEqual({
      reason: 'project-import-nonportable-checkpoint',
    })

    const completeFixture = await seed('已完成导入')
    const completeHandoff = await handoffForOutline(completeFixture)
    const started = await beginImpactManualCorrectionV1({ scope: completeFixture.scope, handoff: completeHandoff.handoff })
    await db.outlineNodes.update(completeFixture.outlineNodeId, { summary: '导出前修正', updatedAt: Date.now() })
    await completeImpactManualCorrectionV1({ scope: completeFixture.scope, handoff: completeHandoff.handoff })
    const completedRun = await db.agentRuns.get(started.snapshot.run.id)
    expect(completedRun?.status).toBe('completed')
    const completeImportedId = await importProjectJSON(await exportProjectJSON(completeFixture.scope.projectId))
    const completeRuns = await db.agentRuns.where('projectId').equals(completeImportedId).toArray()
    const importedCorrection = completeRuns.find(run => run.parentRunId != null)!
    expect(importedCorrection.status).toBe('running')
    expect(importedCorrection.terminalReceiptHash).toBeNull()
  })

  it('工作区只在作者显式验证时完成，不把导航当作修正', () => {
    const source = readFileSync('src/pages/WorkspacePage.tsx', 'utf8')
    expect(source).toContain('beginImpactManualCorrectionV1({ scope, handoff: parsed })')
    expect(source).toContain('completeImpactManualCorrectionV1({ scope, handoff: impactHandoff })')
    expect(source).toContain('验证已保存修正')
    expect(source).toContain('导航或仅打开记录不会被视为完成')
    expect(source).toContain("setImpactCorrectionStatus('completed')")
  })
})

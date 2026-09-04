import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactHandoffV2 } from '../../src/lib/consistency/impact-handoff'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { executeImpactAuthorReviewV1, readCurrentImpactAuthorReviewStateV1 } from '../../src/lib/agent/run/impact-review-durable'
import { beginImpactManualCorrectionV1, completeImpactManualCorrectionV1 } from '../../src/lib/agent/run/impact-manual-correction-durable'
import {
  executeImpactPostCorrectionReplanV1,
  readCurrentImpactPostCorrectionReplanV1,
  type ImpactPostCorrectionReplanBoundaryV1,
} from '../../src/lib/agent/run/impact-post-correction-replan-durable'
import { staleAgentRunVerificationV1 } from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

async function seed(): Promise<{
  scope: WorkspaceScope
  sourceChapterId: number
  secondChapterId: number
  sourceOutlineNodeId: number
  factId: number
  sourceStoryCoreId: number
  worldGroupId: number
}> {
  const now = Date.now()
  const { scope } = await seedCurrentWorkspace('修正后重规划')
  const { projectId } = scope
  const worldGroupId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const sourceOutlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId, worldGroupId, parentId: null, type: 'chapter', title: '第一章', summary: '潮门开启',
    order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const secondOutlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId, worldGroupId, parentId: null, type: 'chapter', title: '第二章', summary: '钟楼回应',
    order: 1, createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const sourceChapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId, outlineNodeId: sourceOutlineNodeId, title: '第一章', content: '<p>潮门开启。</p>',
    wordCount: 6, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const secondChapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId, outlineNodeId: secondOutlineNodeId, title: '第二章', content: '<p>钟楼回应。</p>',
    wordCount: 6, status: 'draft', order: 1, notes: '', createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const sourceStoryCoreId = await db.storyCores.add(stampNewRecord(scope, 'storyCores', {
    projectId, theme: '潮门与钟楼的回应',
    createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const factId = await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', {
    projectId, worldGroupId, locationId: null, subjectName: '潮门',
    predicate: 'state', factKind: 'state', value: '开启', validFromChapterId: sourceChapterId, validToChapterId: null,
    sourceType: 'chapter', sourceChapterId, sourceQuote: '潮门开启', status: 'confirmed', locked: false,
    createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  return {
    scope, sourceChapterId, secondChapterId,
    sourceOutlineNodeId, factId, sourceStoryCoreId, worldGroupId,
  }
}

async function beginFactCorrection(fixture: Awaited<ReturnType<typeof seed>>) {
  const graph = await buildEditImpactGraphV1(fixture.scope, fixture.sourceChapterId)
  const plan = await buildImpactRemediationPlanV1(graph)
  const item = plan.items.find(candidate => candidate.table === 'temporalFacts' && candidate.recordId === fixture.factId)!
  const review = await executeImpactAuthorReviewV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    plan,
    itemId: item.id,
    decision: 'needs-manual-action',
    note: '需要人工修正这条事实。',
  })
  const handoff = buildImpactHandoffV2({
    plan,
    itemId: item.id,
    decision: 'needs-manual-action',
    reviewRunId: review.snapshot.run.id,
    reviewReceiptHash: review.receiptHash,
    sourceOutlineNodeId: fixture.sourceOutlineNodeId,
  })
  await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff })
  return { graph, plan, item, handoff }
}

describe.sequential('R-HARNESS57 · 人工修正后的 stale/replan', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('目标内容变化但同一影响项仍存在时保守标为 remaining', async () => {
    const fixture = await seed()
    const started = await beginFactCorrection(fixture)
    await db.temporalFacts.update(fixture.factId, { value: '半开启', updatedAt: Date.now() })
    const correction = await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: started.handoff })
    const result = await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff: started.handoff })

    expect(result.output.manualCorrectionReceiptHash).toBe(correction.receiptHash)
    expect(result.output.targetPostStateHash).toBe(correction.targetPostStateHash)
    expect(result.output.remainingItemIds).toContain(started.item.id)
    expect(result.output.resolvedItemIds).not.toContain(started.item.id)
    expect(result.output.newItemIds).toEqual([])
    expect(result.snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
    expect(result.snapshot.events.some(event => event.type === 'adoption.committed')).toBe(false)
  })

  it('旧项真实消失才 resolved，当前图新增稳定项才 new', async () => {
    const fixture = await seed()
    const started = await beginFactCorrection(fixture)
    await db.temporalFacts.update(fixture.factId, {
      sourceChapterId: fixture.secondChapterId,
      sourceRecordTable: 'storyCores',
      sourceStoryCoreId: fixture.sourceStoryCoreId,
      updatedAt: Date.now(),
    })
    await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: started.handoff })
    const result = await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff: started.handoff })
    expect(result.output.resolvedItemIds).toContain(started.item.id)
    expect(result.output.remainingItemIds).not.toContain(started.item.id)
    expect(result.output.newItemIds).toEqual([])
  })

  it('同一事实新增来源记录时只把新 source-record 项列为 new', async () => {
    const fixture = await seed()
    const started = await beginFactCorrection(fixture)
    await db.temporalFacts.update(fixture.factId, {
      value: '开启并绑定主线',
      sourceRecordTable: 'storyCores',
      sourceStoryCoreId: fixture.sourceStoryCoreId,
      updatedAt: Date.now(),
    })
    await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: started.handoff })
    const result = await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff: started.handoff })
    expect(result.output.remainingItemIds).toContain(started.item.id)
    expect(result.output.newItemIds).toContain(`impact-remediation:source-record:storyCores:${fixture.sourceStoryCoreId}`)
  })

  it('重复执行与来源编辑器恢复都复用同一 child Run，旧 review 不再冒充当前', async () => {
    const fixture = await seed()
    const started = await beginFactCorrection(fixture)
    await db.temporalFacts.update(fixture.factId, { value: '作者修正', updatedAt: Date.now() })
    await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: started.handoff })
    const first = await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff: started.handoff })
    const replay = await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff: started.handoff })
    const recovered = await readCurrentImpactPostCorrectionReplanV1({ scope: fixture.scope, chapterId: fixture.sourceChapterId })
    expect(replay.reused).toBe(true)
    expect(replay.snapshot.run.id).toBe(first.snapshot.run.id)
    expect(recovered?.receiptHash).toBe(first.receiptHash)
    await expect(readCurrentImpactAuthorReviewStateV1({
      scope: fixture.scope,
      chapterId: fixture.sourceChapterId,
    })).resolves.toBeNull()
  })

  it('每个 durable 边界中断后均沿同一 child Run 收敛', async () => {
    const fixture = await seed()
    const started = await beginFactCorrection(fixture)
    await db.temporalFacts.update(fixture.factId, { value: '可恢复修正', updatedAt: Date.now() })
    await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: started.handoff })
    const boundaries: ImpactPostCorrectionReplanBoundaryV1[] = [
      'run.created',
      'step.scheduled',
      'step.started',
      'context.assembled',
      'checkpoint.created',
      'step.succeeded',
      'verification.started',
      'verification.accepted',
    ]
    for (const boundary of boundaries) {
      await expect(executeImpactPostCorrectionReplanV1({
        scope: fixture.scope,
        handoff: started.handoff,
        onDurableBoundary: reached => {
          if (reached === boundary) throw new Error(`interrupt:${boundary}`)
        },
      })).rejects.toThrow(`interrupt:${boundary}`)
    }
    const completed = await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff: started.handoff })
    expect(completed.reused).toBe(true)
    const replanRuns = (await db.agentRuns.where('projectId').equals(fixture.scope.projectId).toArray())
      .filter(run => run.parentRelation?.startsWith('impact-post-correction-replan:'))
    expect(replanRuns).toHaveLength(1)
    expect(replanRuns[0].terminalReceiptHash).toBe(completed.receiptHash)
  })

  it('父人工修正 receipt stale 后，来源恢复不会接受孤立的新计划', async () => {
    const fixture = await seed()
    const started = await beginFactCorrection(fixture)
    await db.temporalFacts.update(fixture.factId, { value: '作者修正', updatedAt: Date.now() })
    const correction = await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: started.handoff })
    const result = await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff: started.handoff })
    await staleAgentRunVerificationV1({
      scope: fixture.scope,
      runId: correction.snapshot.run.id,
      reason: '测试父回执过期',
    })
    await expect(readCurrentImpactPostCorrectionReplanV1({
      scope: fixture.scope,
      chapterId: fixture.sourceChapterId,
    })).resolves.toBeNull()
    expect((await db.agentRuns.get(result.snapshot.run.id))?.terminalReceiptHash).toBeNull()
  })

  it('重规划完成后目标再次变化会 stale，检查点篡改会 fail closed', async () => {
    const fixture = await seed()
    const started = await beginFactCorrection(fixture)
    await db.temporalFacts.update(fixture.factId, { value: '第一次修正', updatedAt: Date.now() })
    await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: started.handoff })
    const result = await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff: started.handoff })
    const checkpoint = await db.agentRunCheckpoints.where('runId').equals(result.snapshot.run.id).last()
    await db.agentRunCheckpoints.update(checkpoint!.id!, { resumePayloadJson: JSON.stringify({ version: 1 }) })
    await expect(readCurrentImpactPostCorrectionReplanV1({
      scope: fixture.scope,
      chapterId: fixture.sourceChapterId,
    })).resolves.toBeNull()

    // Restore by starting from a separate fixture, then prove target freshness.
    const second = await seed()
    const secondStarted = await beginFactCorrection(second)
    await db.temporalFacts.update(second.factId, { value: '第一次修正', updatedAt: Date.now() })
    await completeImpactManualCorrectionV1({ scope: second.scope, handoff: secondStarted.handoff })
    const current = await executeImpactPostCorrectionReplanV1({ scope: second.scope, handoff: secondStarted.handoff })
    await db.temporalFacts.update(second.factId, { value: '终验后再次变化', updatedAt: Date.now() + 1 })
    await expect(readCurrentImpactPostCorrectionReplanV1({
      scope: second.scope,
      chapterId: second.sourceChapterId,
    })).resolves.toBeNull()
    expect((await db.agentRuns.get(current.snapshot.run.id))?.terminalReceiptHash).toBeNull()
  })

  it('项目导入后 completed replan receipt 明确 stale，不复活物理 ID', async () => {
    const fixture = await seed()
    const started = await beginFactCorrection(fixture)
    await db.temporalFacts.update(fixture.factId, { value: '导出前修正', updatedAt: Date.now() })
    await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: started.handoff })
    await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff: started.handoff })
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.scope.projectId))
    const runs = await db.agentRuns.where('projectId').equals(importedId).toArray()
    const replanned = runs.find(run => run.parentRelation?.startsWith('impact-post-correction-replan:'))!
    expect(replanned.status).toBe('running')
    expect(replanned.terminalReceiptHash).toBeNull()
  })

  it('工作区终验后立即 replan，来源编辑器恢复并展示三类计数', () => {
    const workspace = readFileSync('src/pages/WorkspacePage.tsx', 'utf8')
    const editor = readFileSync('src/components/editor/ChapterEditor.tsx', 'utf8')
    expect(workspace).toContain('executeImpactPostCorrectionReplanV1({ scope, handoff: impactHandoff })')
    expect(workspace).toContain('executeImpactPostCorrectionReplanV1({ scope, handoff: parsed })')
    expect(workspace).toContain('修正已验证并重新规划')
    expect(editor).toContain('readCurrentImpactPostCorrectionReplanV1')
    expect(editor).toContain('已解决 ${postCorrectionState.output.resolvedItemIds.length} 项')
    expect(editor).toContain('仍需处理 ${postCorrectionState.output.remainingItemIds.length} 项')
    expect(editor).toContain('新增 ${postCorrectionState.output.newItemIds.length} 项')
  })
})

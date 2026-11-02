import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import * as events from '../../src/lib/agent/run/event-store'
import * as receipts from '../../src/lib/agent/run/verification-receipt'
import { beginAgentRunRecoveryV1, completeAgentRunRecoveryV1 } from '../../src/lib/agent/run/checkpoint'
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
  afterEach(() => { vi.restoreAllMocks(); db.close() })

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

  for (const boundary of ['step.succeeded', 'verification.started', 'verification.accepted'] as const) {
    for (const afterCommit of [false, true]) {
      it(`终验 ${boundary} ${afterCommit ? 'append 后中断' : 'append 前中断'} 后沿原确认恢复且零模型`, async () => {
        const fixture = await seed()
        const created = await handoffForOutline(fixture)
        const started = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
        await db.outlineNodes.update(fixture.outlineNodeId, { summary: '作者首次确认的保存结果' })
        const append = events.appendAgentRunEventV1
        const appendTerminal = events.appendAgentRunEventWithSettlementInTransactionV1
        const spy = boundary === 'verification.accepted'
          ? vi.spyOn(events, 'appendAgentRunEventWithSettlementInTransactionV1').mockImplementation(async input => {
              if (input.snapshot.run.id !== started.snapshot.run.id || input.event.type !== boundary) return appendTerminal(input)
              if (afterCommit) await appendTerminal(input)
              throw new Error(`interrupt:${boundary}`)
            })
          : vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => {
              if (input.runId !== started.snapshot.run.id || input.type !== boundary) return append(input)
              if (afterCommit) await append(input)
              throw new Error(`interrupt:${boundary}`)
            })
        await expect(completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
          .rejects.toThrow(`interrupt:${boundary}`)
        spy.mockRestore()
        const refreshed = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
        expect(refreshed.snapshot.run.id).toBe(started.snapshot.run.id)
        expect(refreshed.baseline.completionPostStateHash).toMatch(/^[a-f0-9]{64}$/)
        const completed = await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
        expect(completed.snapshot.projection.state).toBe('completed')
        expect(completed.targetPostStateHash).toBe(refreshed.baseline.completionPostStateHash)
        expect(completed.snapshot.events.filter(event => event.type === 'step.succeeded')).toHaveLength(1)
        expect(completed.snapshot.events.filter(event => event.type === 'verification.accepted')).toHaveLength(1)
        expect(completed.snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
      })
    }
  }

  it('首次完成确认冻结后目标再改，恢复不得用新的当前值补签', async () => {
    const fixture = await seed()
    const created = await handoffForOutline(fixture)
    await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    await db.outlineNodes.update(fixture.outlineNodeId, { summary: '第一次已保存修正' })
    const original = events.appendAgentRunEventV1
    const spy = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => {
      if (input.type === 'step.succeeded') throw new Error('interrupt:before-step')
      return original(input)
    })
    await expect(completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
      .rejects.toThrow('interrupt:before-step')
    spy.mockRestore()
    const frozen = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    await db.outlineNodes.update(fixture.outlineNodeId, { summary: '中断后另一次作者修改' })
    await expect(completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
      .rejects.toThrow('完成确认后再次变化')
    const latest = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    expect(latest.baseline.completionPostStateHash).toBe(frozen.baseline.completionPostStateHash)
    expect(latest.snapshot.projection.terminalReceiptHash).toBeUndefined()
  })

  it('receipt 纯哈希等待期间目标变化，最终原生围栏拒绝旧 post-state 而不签发回执', async () => {
    const fixture = await seed()
    const created = await handoffForOutline(fixture)
    const started = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    await db.outlineNodes.update(fixture.outlineNodeId, { summary: '作者首次确认的结果' })
    const original = receipts.createVerificationReceiptV1
    const spy = vi.spyOn(receipts, 'createVerificationReceiptV1').mockImplementation(async input => {
      const receipt = await original(input)
      if (input.runId === started.snapshot.run.id) {
        await db.outlineNodes.update(fixture.outlineNodeId, { summary: '最后哈希窗口内保存的另一版本' })
      }
      return receipt
    })
    await expect(completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
      .rejects.toThrow('终验前再次变化')
    spy.mockRestore()
    const run = await events.readAgentRunV1(fixture.scope, started.snapshot.run.id)
    expect(run.projection.terminalReceiptHash).toBeUndefined()
    expect(run.events.some(event => event.type === 'verification.accepted')).toBe(false)
    expect((await db.outlineNodes.get(fixture.outlineNodeId))?.summary).toBe('最后哈希窗口内保存的另一版本')
    await expect(completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
      .rejects.toThrow('完成确认后再次变化')
  })

  it('旧 running 状态没有冻结完成确认或成功步骤后态，不从当前目标补造', async () => {
    const fixture = await seed()
    const created = await handoffForOutline(fixture)
    const started = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    const recovery = await beginAgentRunRecoveryV1({ scope: fixture.scope, runId: started.snapshot.run.id })
    await completeAgentRunRecoveryV1({
      scope: fixture.scope, runId: started.snapshot.run.id, checkpointHash: recovery.checkpointHash,
    })
    await db.outlineNodes.update(fixture.outlineNodeId, { summary: '不能证明是旧请求选择的值' })
    await expect(completeImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff }))
      .rejects.toThrow('缺少冻结 post-state')
    const refreshed = await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff: created.handoff })
    expect(refreshed.baseline.completionPostStateHash).toBeUndefined()
    expect(refreshed.snapshot.projection.terminalReceiptHash).toBeUndefined()
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

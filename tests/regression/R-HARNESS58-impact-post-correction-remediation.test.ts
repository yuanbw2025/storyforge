import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactHandoffV2 } from '../../src/lib/consistency/impact-handoff'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { executeImpactAuthorReviewV1 } from '../../src/lib/agent/run/impact-review-durable'
import { beginImpactManualCorrectionV1, completeImpactManualCorrectionV1 } from '../../src/lib/agent/run/impact-manual-correction-durable'
import { executeImpactPostCorrectionReplanV1 } from '../../src/lib/agent/run/impact-post-correction-replan-durable'
import { executeImpactPostCorrectionRemediationV1 } from '../../src/lib/agent/run/impact-post-correction-remediation-durable'
import type { ImpactRemediationBoundaryV1 } from '../../src/lib/agent/run/impact-remediation-durable'
import { staleAgentRunVerificationV1 } from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

async function seed() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '修正后确定性重建', genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 100_000, worldCode: `h58-${now}`, worldVersion: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `h58-${now}`, name: '主世界', description: '', currentVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: '修正后确定性重建', description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }) as number
  const volumeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'volume', title: '第一卷', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '潮门开启',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, workId, outlineNodeId, title: '第一章', content: '<p>潮门开启，钟声穿过旧港。</p>',
    wordCount: 13, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  const factId = await db.temporalFacts.add({
    projectId, workId, worldGroupId, subjectType: 'location', subjectId: null, subjectName: '潮门',
    predicate: 'state', value: '开启', validFromChapterId: chapterId, validToChapterId: null,
    sourceChapterId: chapterId, sourceQuote: '潮门开启', sourceTextHash: '', status: 'confirmed', locked: false,
    createdAt: now, updatedAt: now,
  } as any) as number
  await db.retrievalChunks.add({
    projectId, workId, worldGroupId, sourceChapterId: chapterId, chunkIndex: 0, text: '旧正文', keywords: [],
    embedding: null, embeddingModel: null, sourceTextHash: '0'.repeat(64), createdAt: now,
  } as any)
  await db.narrativeSummaryNodes.add({
    projectId, workId, worldGroupId, level: 'chapter', sourceChapterId: chapterId, sourceOutlineNodeId: outlineNodeId,
    title: '第一章', summary: '旧摘要', keywords: [], sourceHash: '0'.repeat(64), status: 'stale',
    generatedBy: 'test', createdAt: now, updatedAt: now,
  } as any)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldGroupId, outlineNodeId, chapterId, factId,
  }
}

async function prepare(fixture: Awaited<ReturnType<typeof seed>>) {
  const graph = await buildEditImpactGraphV1(fixture.scope, fixture.chapterId)
  const plan = await buildImpactRemediationPlanV1(graph)
  const item = plan.items.find(candidate => candidate.table === 'temporalFacts' && candidate.recordId === fixture.factId)!
  expect(plan.items.some(candidate => candidate.action === 'rebuild-retrieval')).toBe(true)
  expect(plan.items.some(candidate => candidate.action === 'rebuild-summary')).toBe(true)
  const review = await executeImpactAuthorReviewV1({
    scope: fixture.scope, worldGroupId: fixture.worldGroupId, plan, itemId: item.id,
    decision: 'needs-manual-action', note: '人工修正事实后继续派生重建。',
  })
  const handoff = buildImpactHandoffV2({
    plan, itemId: item.id, decision: 'needs-manual-action', reviewRunId: review.snapshot.run.id,
    reviewReceiptHash: review.receiptHash, sourceOutlineNodeId: fixture.outlineNodeId,
  })
  await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff })
  await db.temporalFacts.update(fixture.factId, { value: '半开启', updatedAt: Date.now() + 1 })
  await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff })
  const replan = await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff })
  return { replan }
}

describe.sequential('R-HARNESS58 · 修正后计划驱动确定性重建', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只写派生缓存，并把 H57 receipt/output 精确绑定为 child lineage', async () => {
    const fixture = await seed()
    const { replan } = await prepare(fixture)
    const factBefore = await db.temporalFacts.get(fixture.factId)
    const result = await executeImpactPostCorrectionRemediationV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      sourceChapterId: fixture.chapterId, expectedReplan: replan,
    })
    expect(result.snapshot.run.parentRunId).toBe(replan.snapshot.run.id)
    expect(result.snapshot.run.parentReceiptHash).toBe(replan.receiptHash)
    expect(result.snapshot.run.parentArtifactHash).toBe(replan.output.outputHash)
    expect(result.snapshot.run.parentRelation).toBe(`impact-remediation-after-replan:${replan.output.outputHash}`)
    expect(result.output.retrieval.count).toBeGreaterThan(0)
    expect(result.output.summaries.chapterNodes).toBeGreaterThan(0)
    expect(result.output.outputHash).toHaveLength(64)
    expect((await db.temporalFacts.get(fixture.factId))?.value).toBe(factBefore?.value)
    expect(result.snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
    expect(result.snapshot.events.some(event => event.type === 'adoption.committed')).toBe(false)
  })

  it('重复执行复用同一 child 和真实输出检查点，不退化为零计数', async () => {
    const fixture = await seed()
    const { replan } = await prepare(fixture)
    const first = await executeImpactPostCorrectionRemediationV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      sourceChapterId: fixture.chapterId, expectedReplan: replan,
    })
    const replay = await executeImpactPostCorrectionRemediationV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      sourceChapterId: fixture.chapterId, expectedReplan: replan,
    })
    expect(replay.reused).toBe(true)
    expect(replay.snapshot.run.id).toBe(first.snapshot.run.id)
    expect(replay.output).toEqual(first.output)
    const children = (await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
      .filter(run => run.parentRelation === `impact-remediation-after-replan:${replan.output.outputHash}`)
    expect(children).toHaveLength(1)
  })

  it('包括派生写入后/输出检查点前在内的每个 durable 边界都沿同一 child 收敛', async () => {
    const fixture = await seed()
    const { replan } = await prepare(fixture)
    const boundaries: ImpactRemediationBoundaryV1[] = [
      'run.created', 'step.scheduled', 'step.started', 'context.assembled', 'baseline.checkpoint',
      'derived.rebuilt', 'output.checkpoint', 'step.succeeded', 'verification.started', 'verification.accepted',
    ]
    for (const boundary of boundaries) {
      await expect(executeImpactPostCorrectionRemediationV1({
        scope: fixture.scope, worldGroupId: fixture.worldGroupId,
        sourceChapterId: fixture.chapterId, expectedReplan: replan,
        onDurableBoundary: reached => {
          if (reached === boundary) throw new Error(`interrupt:${boundary}`)
        },
      })).rejects.toThrow(`interrupt:${boundary}`)
    }
    const completed = await executeImpactPostCorrectionRemediationV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      sourceChapterId: fixture.chapterId, expectedReplan: replan,
    })
    expect(completed.reused).toBe(true)
    expect(await db.retrievalChunks.where('sourceChapterId').equals(fixture.chapterId).count()).toBe(completed.output.retrieval.count)
    const children = (await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
      .filter(run => run.parentRelation === `impact-remediation-after-replan:${replan.output.outputHash}`)
    expect(children).toHaveLength(1)
  })

  it('执行前 H57 父回执或当前目标过期时 fail closed，不创建 child', async () => {
    const fixture = await seed()
    const { replan } = await prepare(fixture)
    await staleAgentRunVerificationV1({ scope: fixture.scope, runId: replan.snapshot.run.id, reason: '测试父回执过期' })
    await expect(executeImpactPostCorrectionRemediationV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      sourceChapterId: fixture.chapterId, expectedReplan: replan,
    })).rejects.toThrow('重规划已过期')
    expect((await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
      .filter(run => run.parentRelation?.startsWith('impact-remediation-after-replan:'))).toHaveLength(0)
  })

  it('调用方篡改 frozen H57 output 时 fail closed，不把伪造 artifact 接进 lineage', async () => {
    const fixture = await seed()
    const { replan } = await prepare(fixture)
    const tampered = {
      ...replan,
      output: { ...replan.output, plan: { ...replan.output.plan, graphHash: 'f'.repeat(64) } },
    }
    await expect(executeImpactPostCorrectionRemediationV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      sourceChapterId: fixture.chapterId, expectedReplan: tampered,
    })).rejects.toThrow('重规划输出已损坏')
    expect((await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
      .filter(run => run.parentRelation?.startsWith('impact-remediation-after-replan:'))).toHaveLength(0)
  })

  it('completed H58 导入后明确 stale，不把物理 lineage/output checkpoint 当作当前证据', async () => {
    const fixture = await seed()
    const { replan } = await prepare(fixture)
    await executeImpactPostCorrectionRemediationV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      sourceChapterId: fixture.chapterId, expectedReplan: replan,
    })
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.parentRelation?.startsWith('impact-remediation-after-replan:'))!
    expect(imported.status).toBe('running')
    expect(imported.terminalReceiptHash).toBeNull()
  })

  it('编辑器只在当前 plan 匹配时走 H58 入口，普通 H47 保持兼容', () => {
    const editor = readFileSync('src/components/editor/ChapterEditor.tsx', 'utf8')
    expect(editor).toContain('impactPostCorrectionReplan?.output.plan.planHash === plan.planHash')
    expect(editor).toContain('executeImpactPostCorrectionRemediationV1({')
    expect(editor).toContain(': await executeImpactRemediationV1({')
  })
})

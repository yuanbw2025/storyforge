import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildImpactHandoffV2 } from '../../src/lib/consistency/impact-handoff'
import { buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { db } from '../../src/lib/db/schema'
import {
  beginImpactManualCorrectionV1,
  completeImpactManualCorrectionV1,
} from '../../src/lib/agent/run/impact-manual-correction-durable'
import { executeImpactPostCorrectionReplanV1 } from '../../src/lib/agent/run/impact-post-correction-replan-durable'
import { executeImpactAuthorReviewV1 } from '../../src/lib/agent/run/impact-review-durable'
import {
  adoptImpactStoryTimelineRegenerationCandidateV1,
  generateImpactStoryTimelineRegenerationCandidateV1,
  readCompletedImpactStoryTimelineRegenerationsV1,
  readImpactStoryTimelineRegenerationReadinessV1,
  readPendingImpactStoryTimelineRegenerationCandidateV1,
  rejectImpactStoryTimelineRegenerationCandidateV1,
  type ImpactStoryTimelineRegenerationAdoptionBoundaryV1,
} from '../../src/lib/agent/run/impact-story-timeline-regeneration-durable'
import { staleAgentRunVerificationV1 } from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'

const VALID_OUTPUT = JSON.stringify({
  storyTime: '潮汐纪元第七日黄昏',
  importance: 3,
  description: '潮门只开启一半，钟声穿过旧港，但船队尚不能完整通行。',
  reason: '作者已把上游事实从完全开启修正为半开启，年表描述必须保留阻滞状态。',
  evidenceRefs: ['章节正文', '目标故事年表事件'],
})

async function seed(label = 'h79') {
  const now = Date.now()
  const created = await seedCurrentWorkspace(`年表影响重建-${label}`)
  const { projectId, worldId, workId } = created.scope
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }) as number
  const volumeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'volume', title: '第一卷', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const sourceOutlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '潮门异动',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const sourceChapterId = await db.chapters.add({
    projectId, workId, outlineNodeId: sourceOutlineNodeId, title: '第一章',
    content: '<p>潮门只开启一半，钟声穿过旧港，守门人确认船队仍无法完整通行。</p>',
    wordCount: 31, status: 'revised', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  const targetOutlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '第二章', summary: '旧港封锁',
    order: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const targetChapterId = await db.chapters.add({
    projectId, workId, outlineNodeId: targetOutlineNodeId, title: '第二章',
    content: '<p>侦察队抵达旧港，确认潮门只开启一半，船队仍无法完整通行。</p>',
    wordCount: 27, status: 'revised', order: 1, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  const factId = await db.temporalFacts.add({
    projectId, workId, worldGroupId, subjectType: 'location', subjectId: null, subjectName: '潮门',
    predicate: 'state', value: '完全开启', validFromChapterId: sourceChapterId, validToChapterId: null,
    sourceChapterId, sourceQuote: '潮门', sourceTextHash: '', status: 'confirmed', locked: false,
    createdAt: now, updatedAt: now,
  } as any) as number
  const eventId = await db.storyTimelineEvents.add({
    projectId, workId, title: '潮门开启', storyTime: '潮汐纪元第七日', importance: 2,
    description: '潮门完全开启，船队恢复通行。', chapterId: targetChapterId,
    chapterTitle: '第二章', order: 0, createdAt: now,
  } as any) as number
  await stampCurrentFixtureResourceUidsV1(projectId)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId,
    worldGroupId,
    sourceOutlineNodeId,
    sourceChapterId,
    targetChapterId,
    factId,
    eventId,
  }
}

async function prepare(
  fixture: Awaited<ReturnType<typeof seed>>,
  options: { dependencyDecision?: 'acknowledged' | 'needs-manual-action' | null } = {},
) {
  const graph = await buildEditImpactGraphV1(fixture.scope, fixture.sourceChapterId)
  const plan = await buildImpactRemediationPlanV1(graph)
  const factItem = plan.items.find(item => item.table === 'temporalFacts' && item.recordId === fixture.factId)!
  const review = await executeImpactAuthorReviewV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    plan,
    itemId: factItem.id,
    decision: 'needs-manual-action',
    note: '把潮门状态修正为半开启后重新规划。',
  })
  const handoff = buildImpactHandoffV2({
    plan,
    itemId: factItem.id,
    decision: 'needs-manual-action',
    reviewRunId: review.snapshot.run.id,
    reviewReceiptHash: review.receiptHash,
    sourceOutlineNodeId: fixture.sourceOutlineNodeId,
  })
  await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff })
  await db.temporalFacts.update(fixture.factId, { value: '半开启', updatedAt: Date.now() + 1 })
  await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff })
  const replan = await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff })
  const item = replan.output.plan.items.find(candidate => (
    candidate.table === 'storyTimelineEvents' && candidate.recordId === fixture.eventId
  ))!
  expect(replan.output.remainingItemIds).toContain(item.id)
  const dependencyItem = replan.output.plan.items.find(candidate => item.dependencyNodeIds.includes(candidate.nodeId))!
  const dependencyDecision = options.dependencyDecision === undefined ? 'acknowledged' : options.dependencyDecision
  const dependencyReview = dependencyDecision
    ? await executeImpactAuthorReviewV1({
        scope: fixture.scope,
        worldGroupId: fixture.worldGroupId,
        plan: replan.output.plan,
        itemId: dependencyItem.id,
        decision: dependencyDecision,
        note: dependencyDecision === 'acknowledged'
          ? '当前正文已经复核，可据此修订既有年表事件。'
          : '当前正文仍需人工处理，暂不允许修订年表。',
      })
    : null
  return { replan, item, dependencyItem, dependencyReview }
}

describe.sequential('R-HARNESS79 · H57 单事件故事年表受控重建', { timeout: 30_000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只经登记 Context 调一次模型，绑定 H57 child 且确认前正式事件零写入', async () => {
    const fixture = await seed()
    const { replan, item } = await prepare(fixture)
    let prompt = ''
    const generated = await generateImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope,
      expectedReplan: replan,
      itemId: item.id,
      runAI: async messages => { prompt = messages.map(message => message.content).join('\n'); return VALID_OUTPUT },
    })
    expect(prompt).toContain('侦察队抵达旧港')
    expect(prompt).toContain('#' + fixture.eventId + ' 潮门开启')
    expect(prompt).toContain('HARNESS-79 严格输出协议')
    expect(generated.snapshot.run.parentRunId).toBe(replan.snapshot.run.id)
    expect(generated.snapshot.run.parentReceiptHash).toBe(replan.receiptHash)
    expect(generated.snapshot.run.parentArtifactHash).toBe(replan.output.outputHash)
    expect(generated.candidate.dependencyProofs).toHaveLength(1)
    expect(generated.snapshot.contract.permissions).toEqual({
      contextSourceKeys: ['chapterContent', 'storyTimelineTarget'],
      writeTargets: [{
        table: 'storyTimelineEvents',
        fields: ['storyTime', 'importance', 'description'],
        mode: 'author-confirmed',
      }],
    })
    expect(generated.snapshot.contract.scope.chapterIds).toEqual([
      fixture.sourceChapterId,
      fixture.targetChapterId,
    ])
    expect((await db.storyTimelineEvents.get(fixture.eventId))?.description).toContain('完全开启')
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')

    const completed = await adoptImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope,
      runId: generated.snapshot.run.id,
    })
    const formal = await db.storyTimelineEvents.get(fixture.eventId)
    expect(formal).toMatchObject({
      id: fixture.eventId,
      title: '潮门开启',
      chapterId: fixture.targetChapterId,
      chapterTitle: '第二章',
      order: 0,
      storyTime: '潮汐纪元第七日黄昏',
      importance: 3,
      description: '潮门只开启一半，钟声穿过旧港，但船队尚不能完整通行。',
    })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(completed.receiptHash).toHaveLength(64)
    expect(await readImpactStoryTimelineRegenerationReadinessV1({
      scope: fixture.scope,
      expectedReplan: replan,
      itemId: item.id,
    })).toMatchObject({ ready: true })
  })

  it('直接依赖缺失或仍需人工处理时模型调用与 H79 Run 都为零', async () => {
    for (const dependencyDecision of [null, 'needs-manual-action'] as const) {
      const fixture = await seed(`dependency-${dependencyDecision ?? 'missing'}`)
      const { replan, item } = await prepare(fixture, { dependencyDecision })
      let calls = 0
      await expect(generateImpactStoryTimelineRegenerationCandidateV1({
        scope: fixture.scope,
        expectedReplan: replan,
        itemId: item.id,
        runAI: async () => { calls++; return VALID_OUTPUT },
      })).rejects.toThrow('依赖未就绪')
      expect(calls).toBe(0)
      expect((await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
        .filter(row => row.parentRelation?.startsWith('impact-generative-target:'))).toHaveLength(0)
      expect((await db.storyTimelineEvents.get(fixture.eventId))?.description).toContain('完全开启')
    }
  })

  it('候选冻结的依赖 proof 过期后不再恢复或采纳', async () => {
    const fixture = await seed('proof-stale')
    const { replan, item, dependencyReview } = await prepare(fixture)
    const generated = await generateImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id, runAI: async () => VALID_OUTPUT,
    })
    await staleAgentRunVerificationV1({
      scope: fixture.scope,
      runId: dependencyReview!.snapshot.run.id,
      reason: '测试依赖证明过期',
    })
    expect(await readPendingImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope,
      sourceChapterId: fixture.sourceChapterId,
    })).toBeNull()
    await expect(adoptImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope,
      runId: generated.snapshot.run.id,
    })).rejects.toThrow('已变化')
    expect((await db.storyTimelineEvents.get(fixture.eventId))?.description).toContain('完全开启')
  })

  it('严格拒绝协议外字段、非法 importance 和未登记证据，正式事件保持冻结', async () => {
    const outputs = [
      JSON.stringify({ ...JSON.parse(VALID_OUTPUT), title: '越权改名' }),
      JSON.stringify({ ...JSON.parse(VALID_OUTPUT), importance: 4 }),
      JSON.stringify({ ...JSON.parse(VALID_OUTPUT), evidenceRefs: ['不存在的来源'] }),
    ]
    for (let index = 0; index < outputs.length; index++) {
      const fixture = await seed(`protocol-${index}`)
      const { replan, item } = await prepare(fixture)
      await expect(generateImpactStoryTimelineRegenerationCandidateV1({
        scope: fixture.scope,
        expectedReplan: replan,
        itemId: item.id,
        runAI: async () => outputs[index],
      })).rejects.toThrow()
      expect((await db.storyTimelineEvents.get(fixture.eventId))?.description).toContain('完全开启')
      expect((await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
        .find(row => row.parentRelation?.startsWith('impact-generative-target:'))?.status).toBe('failed')
    }
  })

  it('模型未知窗口不自动重试；候选检查点崩溃窗可补事件且不重复调用', async () => {
    const unknown = await seed('unknown')
    const unknownPrepared = await prepare(unknown)
    let calls = 0
    await expect(generateImpactStoryTimelineRegenerationCandidateV1({
      scope: unknown.scope,
      expectedReplan: unknownPrepared.replan,
      itemId: unknownPrepared.item.id,
      runAI: async () => { calls++; throw new Error('network outcome unknown') },
    })).rejects.toThrow('network outcome unknown')
    expect((await db.agentRuns.where('projectId').equals(unknown.projectId).toArray())
      .find(row => row.parentRelation?.startsWith('impact-generative-target:'))?.status).toBe('paused')

    const crash = await seed('checkpoint-crash')
    const crashPrepared = await prepare(crash)
    await expect(generateImpactStoryTimelineRegenerationCandidateV1({
      scope: crash.scope,
      expectedReplan: crashPrepared.replan,
      itemId: crashPrepared.item.id,
      runAI: async () => { calls++; return VALID_OUTPUT },
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:candidate') },
    })).rejects.toThrow('interrupt:candidate')
    const recovered = await readPendingImpactStoryTimelineRegenerationCandidateV1({
      scope: crash.scope,
      sourceChapterId: crash.sourceChapterId,
    })
    expect(calls).toBe(2)
    expect(recovered?.candidate.result.description).toContain('只开启一半')
    expect(recovered?.snapshot.projection.state).toBe('awaiting_confirmation')
  })

  it('目标事件、目标章节正文或 H57 parent 任一变化都阻断采纳', async () => {
    const targetChanged = await seed('target-stale')
    const targetPrepared = await prepare(targetChanged)
    const targetCandidate = await generateImpactStoryTimelineRegenerationCandidateV1({
      scope: targetChanged.scope,
      expectedReplan: targetPrepared.replan,
      itemId: targetPrepared.item.id,
      runAI: async () => VALID_OUTPUT,
    })
    await db.storyTimelineEvents.update(targetChanged.eventId, { description: '作者另行修改正式事件' })
    await expect(adoptImpactStoryTimelineRegenerationCandidateV1({
      scope: targetChanged.scope, runId: targetCandidate.snapshot.run.id,
    })).rejects.toThrow(/目标|Context/)

    const chapterChanged = await seed('chapter-stale')
    const chapterPrepared = await prepare(chapterChanged)
    const chapterCandidate = await generateImpactStoryTimelineRegenerationCandidateV1({
      scope: chapterChanged.scope,
      expectedReplan: chapterPrepared.replan,
      itemId: chapterPrepared.item.id,
      runAI: async () => VALID_OUTPUT,
    })
    await db.chapters.update(chapterChanged.sourceChapterId, { content: '<p>作者再次改写潮门结果。</p>' })
    await expect(adoptImpactStoryTimelineRegenerationCandidateV1({
      scope: chapterChanged.scope, runId: chapterCandidate.snapshot.run.id,
    })).rejects.toThrow(/来源|H57|Context/)

    const parentStale = await seed('parent-stale')
    const parentPrepared = await prepare(parentStale)
    const parentCandidate = await generateImpactStoryTimelineRegenerationCandidateV1({
      scope: parentStale.scope,
      expectedReplan: parentPrepared.replan,
      itemId: parentPrepared.item.id,
      runAI: async () => VALID_OUTPUT,
    })
    await staleAgentRunVerificationV1({
      scope: parentStale.scope,
      runId: parentPrepared.replan.snapshot.run.id,
      reason: '测试 H57 parent 过期',
    })
    await expect(adoptImpactStoryTimelineRegenerationCandidateV1({
      scope: parentStale.scope, runId: parentCandidate.snapshot.run.id,
    })).rejects.toThrow(/H57|plan|来源/)
  })

  it('八个采纳边界沿同一 child Run 收敛，正式写回不改变冻结身份字段', async () => {
    const fixture = await seed('boundaries')
    const { replan, item } = await prepare(fixture)
    const generated = await generateImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id, runAI: async () => VALID_OUTPUT,
    })
    const boundaries: ImpactStoryTimelineRegenerationAdoptionBoundaryV1[] = [
      'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
      'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
    ]
    for (const boundary of boundaries) {
      await expect(adoptImpactStoryTimelineRegenerationCandidateV1({
        scope: fixture.scope,
        runId: generated.snapshot.run.id,
        onDurableBoundary: reached => { if (reached === boundary) throw new Error(`interrupt:${boundary}`) },
      })).rejects.toThrow(`interrupt:${boundary}`)
    }
    const completed = await adoptImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope,
      runId: generated.snapshot.run.id,
    })
    expect(completed.snapshot.run.id).toBe(generated.snapshot.run.id)
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(await db.storyTimelineEvents.get(fixture.eventId)).toMatchObject({
      id: fixture.eventId,
      title: '潮门开启',
      chapterId: fixture.targetChapterId,
      chapterTitle: '第二章',
      order: 0,
    })
  })

  it('拒绝后可显式新建候选；完成证明可恢复且正式值再变会撤销 receipt', async () => {
    const fixture = await seed('retry-terminal')
    const { replan, item } = await prepare(fixture)
    const first = await generateImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id, runAI: async () => VALID_OUTPUT,
    })
    await rejectImpactStoryTimelineRegenerationCandidateV1({ scope: fixture.scope, runId: first.snapshot.run.id })
    expect((await db.storyTimelineEvents.get(fixture.eventId))?.description).toContain('完全开启')
    const second = await generateImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id, runAI: async () => VALID_OUTPUT,
    })
    expect(second.snapshot.run.id).not.toBe(first.snapshot.run.id)
    await adoptImpactStoryTimelineRegenerationCandidateV1({ scope: fixture.scope, runId: second.snapshot.run.id })
    expect(await readCompletedImpactStoryTimelineRegenerationsV1({
      scope: fixture.scope,
      sourceChapterId: fixture.sourceChapterId,
    })).toHaveLength(1)
    await db.storyTimelineEvents.update(fixture.eventId, { importance: 1 })
    expect(await readCompletedImpactStoryTimelineRegenerationsV1({
      scope: fixture.scope,
      sourceChapterId: fixture.sourceChapterId,
    })).toHaveLength(0)
    expect((await db.agentRuns.get(second.snapshot.run.id))?.terminalReceiptHash).toBeNull()
  })

  it('非年表项与跨 Work 目标不能进入 H79，导入后物理 child 不可便携', async () => {
    const fixture = await seed('scope-import')
    const { replan, item } = await prepare(fixture)
    const factItem = replan.output.plan.items.find(candidate => candidate.table === 'temporalFacts')!
    await expect(generateImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: factItem.id, runAI: async () => VALID_OUTPUT,
    })).rejects.toThrow(/不存在可重建/)
    const generated = await generateImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id, runAI: async () => VALID_OUTPUT,
    })
    const other = await seed('other-work')
    await expect(readPendingImpactStoryTimelineRegenerationCandidateV1({
      scope: other.scope,
      sourceChapterId: fixture.sourceChapterId,
    })).rejects.toThrow(/不存在|越界/)
    await adoptImpactStoryTimelineRegenerationCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(row => row.parentRelation?.startsWith('impact-generative-target:'))!
    expect(imported.status).toBe('running')
    expect(imported.terminalReceiptHash).toBeNull()
  })
})

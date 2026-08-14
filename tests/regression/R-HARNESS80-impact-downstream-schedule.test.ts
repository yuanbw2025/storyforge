import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactHandoffV2 } from '../../src/lib/consistency/impact-handoff'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { db } from '../../src/lib/db/schema'
import {
  beginImpactManualCorrectionV1,
  completeImpactManualCorrectionV1,
} from '../../src/lib/agent/run/impact-manual-correction-durable'
import { readImpactDownstreamScheduleV1 } from '../../src/lib/agent/run/impact-downstream-schedule'
import {
  adoptImpactOutlineRegenerationCandidateV1,
  generateImpactOutlineRegenerationCandidateV1,
  rejectImpactOutlineRegenerationCandidateV1,
} from '../../src/lib/agent/run/impact-outline-regeneration-durable'
import {
  executeImpactPostCorrectionRemediationV1,
} from '../../src/lib/agent/run/impact-post-correction-remediation-durable'
import { executeImpactPostCorrectionReplanV1 } from '../../src/lib/agent/run/impact-post-correction-replan-durable'
import { executeImpactAuthorReviewV1 } from '../../src/lib/agent/run/impact-review-durable'
import {
  adoptImpactStoryTimelineRegenerationCandidateV1,
  generateImpactStoryTimelineRegenerationCandidateV1,
} from '../../src/lib/agent/run/impact-story-timeline-regeneration-durable'
import { staleAgentRunVerificationV1 } from '../../src/lib/agent/run/event-store'
import type { WorkspaceScope } from '../../src/lib/types'

const OUTLINE_OUTPUT = JSON.stringify({
  summary: '钟楼根据半开启的潮门调整撤离次序，并留下追查潮声来源的因果钩子。',
  reason: '上游事实已经修正，后续章纲必须保留港口受阻的结果。',
  evidenceRefs: ['章节正文', '当前章节大纲'],
})

const TIMELINE_OUTPUT = JSON.stringify({
  storyTime: '潮汐纪元第七日黄昏',
  importance: 3,
  description: '潮门只开启一半，钟声穿过旧港，但船队仍无法完整通行。',
  reason: '上游事实已经修正，年表必须保留港口受阻状态。',
  evidenceRefs: ['章节正文', '目标故事年表事件'],
})

async function seed(label = 'h80') {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: `影响调度-${label}`, genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 100_000, worldCode: `${label}-${now}`, worldVersion: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `${label}-${now}`, name: '主世界', description: '', currentVersion: 1,
    createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: label, description: '', genres: ['fantasy'], status: 'drafting',
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
    projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '第二章', summary: '旧港恢复通行',
    order: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const targetChapterId = await db.chapters.add({
    projectId, workId, outlineNodeId: targetOutlineNodeId, title: '第二章',
    content: '<p>侦察队抵达旧港，仍按潮门完全开启的旧计划接引船队。</p>',
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
  await db.storyCores.add({
    projectId, workId, logline: '潮汐改变港城命运', concept: '', theme: '', centralConflict: '',
    plotPattern: '', storyLines: '', mainPlot: '', subPlots: '', createdAt: now, updatedAt: now,
  } as any)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId,
    worldGroupId,
    sourceOutlineNodeId,
    sourceChapterId,
    targetOutlineNodeId,
    targetChapterId,
    factId,
    eventId,
  }
}

async function prepare(fixture: Awaited<ReturnType<typeof seed>>) {
  const graph = await buildEditImpactGraphV1(fixture.scope, fixture.sourceChapterId)
  const plan = await buildImpactRemediationPlanV1(graph)
  const factItem = plan.items.find(item => item.table === 'temporalFacts' && item.recordId === fixture.factId)!
  const review = await executeImpactAuthorReviewV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    plan,
    itemId: factItem.id,
    decision: 'needs-manual-action',
    note: '将潮门状态修正为半开启后重新规划。',
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
  const outlineItem = replan.output.plan.items.find(item => (
    item.table === 'outlineNodes' && item.recordId === fixture.targetOutlineNodeId
  ))!
  const timelineItem = replan.output.plan.items.find(item => (
    item.table === 'storyTimelineEvents' && item.recordId === fixture.eventId
  ))!
  expect(outlineItem).toBeTruthy()
  expect(timelineItem).toBeTruthy()
  const dependencyIds = new Set([...outlineItem.dependencyNodeIds, ...timelineItem.dependencyNodeIds])
  const dependencies = replan.output.plan.items.filter(item => dependencyIds.has(item.nodeId))
  for (const dependency of dependencies) {
    await executeImpactAuthorReviewV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan: replan.output.plan,
      itemId: dependency.id,
      decision: 'acknowledged',
      note: '已复核下游正文，可继续处理依赖它的受治理目标。',
    })
  }
  return { replan, outlineItem, timelineItem, dependencies }
}

describe.sequential('R-HARNESS80 · H57 跨类型下游调度与完成投影', { timeout: 30_000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('从 current H57 与可信 ledger 生成稳定拓扑/hash，且读取本身不创建 Run', async () => {
    const fixture = await seed()
    const { replan, outlineItem, timelineItem, dependencies } = await prepare(fixture)
    const before = await db.agentRuns.where('projectId').equals(fixture.projectId).count()
    const first = await readImpactDownstreamScheduleV1({ scope: fixture.scope, expectedReplan: replan })
    const second = await readImpactDownstreamScheduleV1({ scope: fixture.scope, expectedReplan: replan })
    expect(second).toEqual(first)
    expect(first.scheduleHash).toHaveLength(64)
    expect(first.portable).toBe(false)
    expect(first.items.find(item => item.itemId === outlineItem.id)).toMatchObject({
      executor: 'outline-regeneration', status: 'ready',
    })
    expect(first.items.find(item => item.itemId === timelineItem.id)).toMatchObject({
      executor: 'story-timeline-regeneration', status: 'ready',
    })
    for (const dependency of dependencies) {
      expect(first.items.findIndex(item => item.itemId === dependency.id))
        .toBeLessThan(first.items.findIndex(item => item.itemId === outlineItem.id))
    }
    expect(await db.agentRuns.where('projectId').equals(fixture.projectId).count()).toBe(before)
  })

  it('目标自身 acknowledged 直接完成，needs-manual-action 优先阻断生成且模型/Run 为零', async () => {
    for (const decision of ['acknowledged', 'needs-manual-action'] as const) {
      const fixture = await seed(`target-${decision}`)
      const { replan, timelineItem } = await prepare(fixture)
      const review = await executeImpactAuthorReviewV1({
        scope: fixture.scope,
        worldGroupId: fixture.worldGroupId,
        plan: replan.output.plan,
        itemId: timelineItem.id,
        decision,
        note: decision === 'acknowledged' ? '现有年表无需修改。' : '年表必须先由作者修正。',
      })
      const schedule = await readImpactDownstreamScheduleV1({ scope: fixture.scope, expectedReplan: replan })
      expect(schedule.items.find(item => item.itemId === timelineItem.id)).toMatchObject({
        status: decision === 'acknowledged' ? 'completed' : 'needs-manual-action',
        evidenceRefs: [`review:${review.snapshot.run.id}:${review.receiptHash}`],
      })
      let calls = 0
      const before = await db.agentRuns.where('projectId').equals(fixture.projectId).count()
      await expect(generateImpactStoryTimelineRegenerationCandidateV1({
        scope: fixture.scope,
        expectedReplan: replan,
        itemId: timelineItem.id,
        runAI: async () => { calls += 1; return TIMELINE_OUTPUT },
      })).rejects.toThrow(/已由作者确认|需人工处理/)
      expect(calls).toBe(0)
      expect(await db.agentRuns.where('projectId').equals(fixture.projectId).count()).toBe(before)
    }
  })

  it('跨类型只允许一个待确认候选；拒绝后才释放下一共享 slot', async () => {
    const fixture = await seed('sequential-slot')
    const { replan, outlineItem, timelineItem } = await prepare(fixture)
    const outline = await generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: outlineItem.id, runAI: async () => OUTLINE_OUTPUT,
    })
    const pending = await readImpactDownstreamScheduleV1({ scope: fixture.scope, expectedReplan: replan })
    expect(pending.items.find(item => item.itemId === outlineItem.id)?.status).toBe('awaiting-confirmation')
    expect(pending.items.find(item => item.itemId === timelineItem.id)).toMatchObject({
      status: 'blocked',
      evidenceRefs: [`active-generative:${outline.snapshot.run.id}:awaiting_confirmation`],
    })
    let timelineCalls = 0
    await expect(generateImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope,
      expectedReplan: replan,
      itemId: timelineItem.id,
      runAI: async () => { timelineCalls += 1; return TIMELINE_OUTPUT },
    })).rejects.toThrow('已有待处理的生成式 child')
    expect(timelineCalls).toBe(0)
    await rejectImpactOutlineRegenerationCandidateV1({ scope: fixture.scope, runId: outline.snapshot.run.id })
    const released = await readImpactDownstreamScheduleV1({ scope: fixture.scope, expectedReplan: replan })
    expect(released.items.find(item => item.itemId === timelineItem.id)?.status).toBe('ready')
    const timeline = await generateImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: timelineItem.id,
      runAI: async () => { timelineCalls += 1; return TIMELINE_OUTPUT },
    })
    expect(timelineCalls).toBe(1)
    expect(timeline.snapshot.run.parentRelation).toBe(`impact-generative-target:${replan.output.outputHash}:2`)
  })

  it('候选检查点与事件之间的崩溃窗由 schedule 单链恢复，不重复调用模型', async () => {
    const fixture = await seed('schedule-recovery')
    const { replan, outlineItem } = await prepare(fixture)
    let calls = 0
    await expect(generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope,
      expectedReplan: replan,
      itemId: outlineItem.id,
      runAI: async () => { calls += 1; return OUTLINE_OUTPUT },
      onDurableBoundary: boundary => {
        if (boundary === 'candidate.checkpoint') throw new Error('interrupt:schedule-recovery')
      },
    })).rejects.toThrow('interrupt:schedule-recovery')
    const schedule = await readImpactDownstreamScheduleV1({ scope: fixture.scope, expectedReplan: replan })
    expect(schedule.items.find(item => item.itemId === outlineItem.id)?.status).toBe('awaiting-confirmation')
    expect(calls).toBe(1)
  })

  it('并发创建由 parent mutation lock 与同 relation 收敛为一次模型调用和一个 child', async () => {
    const fixture = await seed('concurrent-slot')
    const { replan, outlineItem, timelineItem } = await prepare(fixture)
    let calls = 0
    const results = await Promise.allSettled([
      generateImpactOutlineRegenerationCandidateV1({
        scope: fixture.scope, expectedReplan: replan, itemId: outlineItem.id,
        runAI: async () => { calls += 1; return OUTLINE_OUTPUT },
      }),
      generateImpactStoryTimelineRegenerationCandidateV1({
        scope: fixture.scope, expectedReplan: replan, itemId: timelineItem.id,
        runAI: async () => { calls += 1; return TIMELINE_OUTPUT },
      }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(calls).toBe(1)
    const children = (await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
      .filter(run => run.parentRelation?.startsWith('impact-generative-target:'))
    expect(children).toHaveLength(1)
    expect(children[0].parentRelation).toBe(`impact-generative-target:${replan.output.outputHash}:1`)
  })

  it('H58/H77/H79 只完成各自精确目标，终态仍由所有 active item 共同决定', async () => {
    const fixture = await seed('completion')
    const { replan, outlineItem, timelineItem } = await prepare(fixture)
    if (replan.output.plan.counts.deterministic > 0) {
      await executeImpactPostCorrectionRemediationV1({
        scope: fixture.scope,
        worldGroupId: fixture.worldGroupId,
        sourceChapterId: fixture.sourceChapterId,
        expectedReplan: replan,
      })
    }
    const outline = await generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: outlineItem.id, runAI: async () => OUTLINE_OUTPUT,
    })
    await adoptImpactOutlineRegenerationCandidateV1({ scope: fixture.scope, runId: outline.snapshot.run.id })
    const timeline = await generateImpactStoryTimelineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: timelineItem.id, runAI: async () => TIMELINE_OUTPUT,
    })
    await adoptImpactStoryTimelineRegenerationCandidateV1({ scope: fixture.scope, runId: timeline.snapshot.run.id })
    const schedule = await readImpactDownstreamScheduleV1({ scope: fixture.scope, expectedReplan: replan })
    expect(schedule.items.find(item => item.itemId === outlineItem.id)).toMatchObject({ status: 'completed' })
    expect(schedule.items.find(item => item.itemId === timelineItem.id)).toMatchObject({ status: 'completed' })
    for (const item of schedule.items.filter(item => item.executor === 'deterministic-remediation')) {
      expect(item.status).toBe('completed')
    }
    expect(schedule.settled).toBe(schedule.items.every(item => item.status === 'completed'))
    expect(schedule.settled).toBe(false)
  })

  it('过期 H57 terminal receipt 与跨 Work scope 均不能投影 current schedule', async () => {
    const fixture = await seed('stale')
    const { replan } = await prepare(fixture)
    await staleAgentRunVerificationV1({
      scope: fixture.scope, runId: replan.snapshot.run.id, reason: '测试 H80 parent stale',
    })
    await expect(readImpactDownstreamScheduleV1({
      scope: fixture.scope, expectedReplan: replan,
    })).rejects.toThrow(/H57|过期/)

    const other = await seed('other-work')
    await expect(readImpactDownstreamScheduleV1({
      scope: other.scope, expectedReplan: replan,
    })).rejects.toThrow()
  })
})

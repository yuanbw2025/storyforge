import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { appendAgentRunEventV1 } from '../../src/lib/agent/run/event-store'
import {
  createChapterPostAdoptionDurableRunV1,
  scheduleChapterPostAdoptionStepsV1,
  CHAPTER_POST_ADOPTION_STEP_IDS_V1,
} from '../../src/lib/agent/run/chapter-post-adoption-durable'
import {
  buildChapterPostAdoptionResumePlanV1,
  isChapterPostAdoptionStepRunnableV1,
} from '../../src/lib/agent/run/chapter-post-adoption-resume'

async function seed(): Promise<{ scope: WorkspaceScope; chapterId: number; worldGroupId: number }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '后处理恢复计划', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 100_000, worldCode: 'resume-world', worldVersion: 1,
    createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({ projectId, code: 'resume-world', name: '主世界', description: '', currentVersion: 1, createdAt: now, updatedAt: now }) as number
  const workId = await db.works.add({ projectId, worldId, title: '恢复计划', description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({ projectId, name: '主世界', order: 0, createdAt: now, updatedAt: now }) as number
  const volumeId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
  const outlineNodeId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '恢复', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapterId = await db.chapters.add({ projectId, workId, outlineNodeId, title: '恢复', content: '<p>潮声。</p>', wordCount: 3, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now } as any) as number
  return { scope: { projectId, worldId, workId }, chapterId, worldGroupId }
}

describe.sequential('R-HARNESS42 · post-adoption 失败步骤恢复计划', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('只重试可恢复失败，成功步骤不重跑，并阻断依赖未完成的下游', async () => {
    const fixture = await seed()
    let snapshot = await createChapterPostAdoptionDurableRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      chapterId: fixture.chapterId,
    })
    snapshot = await scheduleChapterPostAdoptionStepsV1({ scope: fixture.scope, snapshot })

    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope, runId: snapshot.run.id, type: 'step.started',
      payload: { stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization, attempt: 1 },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope, runId: snapshot.run.id, type: 'step.succeeded',
      payload: { stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization, attempt: 1, outputHash: await hashCanonicalValue('organization') },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope, runId: snapshot.run.id, type: 'step.started',
      payload: { stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory, attempt: 1 },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope, runId: snapshot.run.id, type: 'step.failed',
      payload: { stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory, attempt: 1, code: 'provider_transient', retryable: true },
      expectedLastSequence: snapshot.projection.lastSequence,
    })

    const plan = buildChapterPostAdoptionResumePlanV1(snapshot)
    expect(plan.steps.map(step => [step.stepId, step.action])).toEqual([
      [CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization, 'skip-succeeded'],
      [CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory, 'retry-failed'],
      [CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval, 'blocked-dependency'],
      [CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency, 'blocked-dependency'],
    ])
    expect(plan.nextStepId).toBe(CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory)
    expect(isChapterPostAdoptionStepRunnableV1(plan, CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization)).toBe(false)
    expect(isChapterPostAdoptionStepRunnableV1(plan, CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory)).toBe(true)
  })

  it('过期、运行中未知窗口和不可重试失败不会被自动重跑', async () => {
    const fixture = await seed()
    let snapshot = await createChapterPostAdoptionDurableRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      chapterId: fixture.chapterId,
    })
    snapshot = await scheduleChapterPostAdoptionStepsV1({ scope: fixture.scope, snapshot })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope, runId: snapshot.run.id, type: 'step.started',
      payload: { stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization, attempt: 1 },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope, runId: snapshot.run.id, type: 'step.failed',
      payload: { stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization, attempt: 1, code: 'stale_input', retryable: false },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope, runId: snapshot.run.id, type: 'step.started',
      payload: { stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory, attempt: 1 },
      expectedLastSequence: snapshot.projection.lastSequence,
    })

    const plan = buildChapterPostAdoptionResumePlanV1(snapshot)
    expect(plan.canResume).toBe(false)
    expect(plan.blockedReason).toContain(`${CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization}:blocked-non-retryable`)
    expect(plan.steps.find(step => step.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory)?.action).toBe('inspect-running')
  })
})

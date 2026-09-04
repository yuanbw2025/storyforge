import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { createContextManifestFromAssemblyV1 } from '../../src/lib/agent/run/context-manifest'
import {
  hashConsistencyAgentCandidateV1,
  persistConsistencyAgentCandidate,
  runBackgroundConsistencyAgent,
} from '../../src/lib/agent/consistency-agent'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { appendAgentRunEventV1 } from '../../src/lib/agent/run/event-store'
import {
  CHAPTER_POST_ADOPTION_STEP_IDS_V1,
  CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1,
  createChapterPostAdoptionDurableRunV1,
  recoverChapterPostAdoptionConsistencyV1,
  scheduleChapterPostAdoptionStepsV1,
  beginChapterPostAdoptionStepV1,
} from '../../src/lib/agent/run/chapter-post-adoption-durable'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentProject } from '../helpers/current-workspace'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const CONTENT = '<p>守灯人抵达潮门，点亮了旧灯。</p>'

async function seed(): Promise<{ scope: WorkspaceScope; chapterId: number; outlineNodeId: number; worldGroupId: number }> {
  const now = Date.now()
  const projectId = await seedCurrentProject({
    name: '一致性后处理', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 100_000,
    createdAt: now, updatedAt: now,
  } as any) as number
  const { worldId, workId } = await resolveWorkspaceScope(projectId)
  const worldGroupId = await db.worldGroups.add({ projectId, name: '主世界', order: 0, createdAt: now, updatedAt: now }) as number
  const volumeId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
  const outlineNodeId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '潮门', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapterId = await db.chapters.add({ projectId, workId, outlineNodeId, title: '潮门', content: CONTENT, wordCount: 15, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now } as any) as number
  await finalizeCurrentFixtureV1(projectId)
  return { scope: { projectId, worldId, workId }, chapterId, outlineNodeId, worldGroupId }
}

describe.sequential('R-HARNESS41 · 一致性守卫进入正文章后 Run', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('候选事件与 durable ledger 绑定，恢复不重复调用模型且不写业务 Canon', async () => {
    const fixture = await seed()
    let snapshot = await createChapterPostAdoptionDurableRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      chapterId: fixture.chapterId,
    })
    snapshot = await scheduleChapterPostAdoptionStepsV1({ scope: fixture.scope, snapshot })

    // Previous post-adoption steps are represented as completed in this focused
    // test; their own contracts are covered by HARNESS-20.
    for (const stepId of [
      CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
      CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
      CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
    ]) {
      snapshot = await appendAgentRunEventV1({
        scope: fixture.scope,
        runId: snapshot.run.id,
        type: 'step.started',
        payload: { stepId, attempt: 1 },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
      snapshot = await appendAgentRunEventV1({
        scope: fixture.scope,
        runId: snapshot.run.id,
        type: 'step.succeeded',
        payload: { stepId, attempt: 1, outputHash: await hashCanonicalValue(stepId) },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
    }

    const assembly = await assembleContext({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      sourceKeys: [...CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.consistency],
      inputBudgetMaxTokens: 24_000,
    })
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
      attempt: 1,
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      declaredSourceKeys: CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.consistency,
      assembled: assembly,
      boundary: { chapterId: fixture.chapterId, outlineNodeId: fixture.outlineNodeId },
      readerVersion: 'chapter-post-adoption-context-v1',
    })
    snapshot = await beginChapterPostAdoptionStepV1({
      scope: fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
      contextManifest: manifest,
      model: false,
    })
    const before = {
      chapters: await db.chapters.count(),
      facts: await db.temporalFacts.count(),
      items: await db.itemLedger.count(),
    }
    const guard = await runBackgroundConsistencyAgent({
      projectId: fixture.scope.projectId,
      chapterId: fixture.chapterId,
      chapterTitle: '潮门',
      worldGroupId: fixture.worldGroupId,
      chapterContent: CONTENT,
      budget: new AgentTeamBudgetTracker('economy'),
      contextEvidence: {
        included: assembly.included,
        omitted: assembly.omitted,
        trimmed: assembly.trimmed,
        inputTokens: assembly.totalInputTokens,
        inputBudget: assembly.inputBudget,
      },
    })
    const candidateHash = await hashConsistencyAgentCandidateV1(guard)
    const candidate = {
      ...guard,
      durable: {
        runId: snapshot.run.id,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        attempt: 1,
        contextManifestHash: manifest.manifestHash,
        candidateHash,
      },
    }
    const stored = await persistConsistencyAgentCandidate(candidate)

    // Simulate the crash after the Agent event but before ledger append.
    const recovered = await recoverChapterPostAdoptionConsistencyV1({
      scope: fixture.scope,
      candidate,
    })
    expect(recovered?.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency]?.status).toBe('succeeded')
    expect(recovered?.events.filter(event => event.type === 'model.requested' && event.payload.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency)).toHaveLength(0)
    expect(stored.event.durableRunId).toBe(snapshot.run.id)
    expect({
      chapters: await db.chapters.count(),
      facts: await db.temporalFacts.count(),
      items: await db.itemLedger.count(),
    }).toEqual(before)
  })

  it('候选 hash 或正文变化后拒绝恢复', async () => {
    const fixture = await seed()
    const candidate = {
      version: 1,
      type: 'consistency-agent',
      projectId: fixture.scope.projectId,
      chapterId: fixture.chapterId,
      chapterTitle: '潮门',
      worldGroupId: fixture.worldGroupId,
      mode: 'background' as const,
      sourceTextHash: '0'.repeat(64),
      createdAt: Date.now(),
      findings: [],
      context: { included: [], omitted: [], trimmed: [], inputTokens: 0, inputBudget: 0 },
      budget: new AgentTeamBudgetTracker('economy').snapshot(),
      durable: {
        runId: 1,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        attempt: 1,
        contextManifestHash: '0'.repeat(64),
        candidateHash: '0'.repeat(64),
      },
    }
    expect(await recoverChapterPostAdoptionConsistencyV1({ scope: fixture.scope, candidate })).toBeNull()
  })
})

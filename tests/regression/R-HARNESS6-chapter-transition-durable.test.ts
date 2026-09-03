import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { createContextManifestFromAssemblyV1 } from '../../src/lib/agent/run/context-manifest'
import {
  beginChapterTransitionStepV1,
  commitChapterTransitionStateAdoptionV1,
  createChapterTransitionDurableRunV1,
  hashChapterTransitionCandidateV1,
  persistChapterTransitionCandidateV1,
  recordChapterTransitionOutputV1,
  recoverChapterTransitionCandidateV1,
  scheduleChapterTransitionStepsV1,
  succeedChapterTransitionStepV1,
  verifyChapterTransitionRunV1,
  CHAPTER_TRANSITION_CANDIDATE_TYPE_V1,
  CHAPTER_TRANSITION_SOURCE_KEYS_V1,
  CHAPTER_TRANSITION_STEP_IDS_V1,
  type ChapterTransitionCandidateV1,
} from '../../src/lib/agent/run/chapter-transition-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import {
  CHAPTER_TEXT_NORMALIZATION_VERSION,
  hashChapterText,
} from '../../src/lib/ai/chapter-memory/text-normalization'
import {
  rebuildChapterChunks,
  rebuildProjectNarrativeSummaries,
} from '../../src/lib/retrieval/retrieval'
import type { WorkspaceScope } from '../../src/lib/types'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  outlineNodeId: number
  chapterId: number
  content: string
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: label,
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,


    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: `world-${label}`,
    name: `${label}世界`,
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: label,
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  const worldGroupId = await db.worldGroups.add({
    projectId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId,
    workId,
    worldGroupId,
    parentId: null,
    type: 'chapter',
    title: '潮门',
    summary: '守灯人抵达潮门。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const content = '<p>守灯人抵达潮门，点亮了旧灯。</p>'
  const chapterId = await db.chapters.add({
    projectId,
    workId,
    outlineNodeId,
    title: '潮门',
    content,
    wordCount: 15,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return { scope: { projectId, worldId, workId }, worldGroupId, outlineNodeId, chapterId, content }
}

async function preparePending(label: string, recordCandidate = true) {
  const fixture = await createWorkspace(label)
  let snapshot = await createChapterTransitionDurableRunV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    chapterId: fixture.chapterId,
  })
  snapshot = await scheduleChapterTransitionStepsV1({ scope: fixture.scope, snapshot })
  const assembled = await assembleContext({
    projectId: fixture.scope.projectId,
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    chapterId: fixture.chapterId,
    outlineNodeId: fixture.outlineNodeId,
    sourceKeys: [...CHAPTER_TRANSITION_SOURCE_KEYS_V1],
    inputBudgetMaxTokens: 24_000,
  })
  const manifest = async (stepId: string) => createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId,
    attempt: 1,
    projectId: fixture.scope.projectId,
    worldGroupId: fixture.worldGroupId,
    declaredSourceKeys: CHAPTER_TRANSITION_SOURCE_KEYS_V1,
    assembled,
    boundary: { chapterId: fixture.chapterId, outlineNodeId: fixture.outlineNodeId },
    readerVersion: 'chapter-transition-context-v1',
  })

  snapshot = await beginChapterTransitionStepV1({
    scope: fixture.scope,
    snapshot,
    stepId: CHAPTER_TRANSITION_STEP_IDS_V1.retrieval,
    contextManifest: await manifest(CHAPTER_TRANSITION_STEP_IDS_V1.retrieval),
    model: false,
  })
  const chapter = await db.chapters.get(fixture.chapterId)
  const chunks = await rebuildChapterChunks({
    projectId: fixture.scope.projectId,
    scope: fixture.scope,
    chapter: chapter!,
    worldGroupId: fixture.worldGroupId,
    knownEntities: [],
  })
  const summaries = await rebuildProjectNarrativeSummaries({
    projectId: fixture.scope.projectId,
    scope: fixture.scope,
  })
  snapshot = await succeedChapterTransitionStepV1({
    scope: fixture.scope,
    snapshot,
    stepId: CHAPTER_TRANSITION_STEP_IDS_V1.retrieval,
    output: { chunks, summaries },
  })

  const stateManifest = await manifest(CHAPTER_TRANSITION_STEP_IDS_V1.state)
  snapshot = await beginChapterTransitionStepV1({
    scope: fixture.scope,
    snapshot,
    stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
    contextManifest: stateManifest,
  })
  const sourceTextHash = await hashChapterText(fixture.content)
  const baseCandidate = {
    version: 1 as const,
    type: CHAPTER_TRANSITION_CANDIDATE_TYPE_V1,
    projectId: fixture.scope.projectId,
    chapterId: fixture.chapterId,
    chapterTitle: '潮门',
    worldGroupId: fixture.worldGroupId,
    sourceTextHash,
    stateDiffs: [{
      entityName: '守灯人',
      category: 'character' as const,
      field: '位置',
      oldValue: null,
      newValue: '潮门',
    }],
    createdAt: Date.now(),
  }
  const candidateHash = await hashChapterTransitionCandidateV1(baseCandidate)
  const candidate: ChapterTransitionCandidateV1 = {
    ...baseCandidate,
    durable: {
      runId: snapshot.run.id,
      stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
      attempt: 1,
      contextManifestHash: stateManifest.manifestHash,
      candidateHash,
    },
  }
  await persistChapterTransitionCandidateV1({ scope: fixture.scope, candidate })
  if (recordCandidate) {
    snapshot = await recordChapterTransitionOutputV1({
      scope: fixture.scope,
      snapshot,
      stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
      output: candidate.stateDiffs,
      candidateHash,
      requiresConfirmation: true,
    })
  }

  snapshot = await beginChapterTransitionStepV1({
    scope: fixture.scope,
    snapshot,
    stepId: CHAPTER_TRANSITION_STEP_IDS_V1.memory,
    contextManifest: await manifest(CHAPTER_TRANSITION_STEP_IDS_V1.memory),
  })
  await db.chapters.update(fixture.chapterId, {
    summary: '守灯人抵达潮门并点亮旧灯。',
    summarySourceTextHash: sourceTextHash,
    summaryTextNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
    continuityHandoff: {
      chapterId: fixture.chapterId,
      sourceTextHash,
      schemaVersion: 1,
      extractorVersion: 'test',
      textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      finalScene: { location: '潮门', activeCharacters: ['守灯人'], lastAction: '点亮旧灯' },
      stateChanges: [],
      knowledgeChanges: [],
      commitments: [],
      openLoops: [],
      evidenceQuotes: [],
      generatedAt: Date.now(),
    },
  })
  snapshot = await recordChapterTransitionOutputV1({
    scope: fixture.scope,
    snapshot,
    stepId: CHAPTER_TRANSITION_STEP_IDS_V1.memory,
    output: { status: 'written', sourceTextHash },
  })
  snapshot = await succeedChapterTransitionStepV1({
    scope: fixture.scope,
    snapshot,
    stepId: CHAPTER_TRANSITION_STEP_IDS_V1.memory,
    output: { status: 'written', sourceTextHash },
  })
  return { fixture, snapshot, candidate }
}

describe.sequential('R-HARNESS6 · 章节状态变化完成屏障', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('正文已保存不等于后处理完成；状态候选确认后才签发 receipt', async () => {
    const pending = await preparePending('transition complete')
    expect(pending.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(pending.snapshot.projection.terminalReceiptHash).toBeUndefined()

    const adopted = await commitChapterTransitionStateAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      written: 0,
    })
    expect(adopted.projection.state).toBe('running')
    const completed = await verifyChapterTransitionRunV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
    })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(completed.receiptHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('候选事件已保存但 durable ledger 未推进时可恢复，不重复模型步骤', async () => {
    const interrupted = await preparePending('transition recover', false)
    const recovered = await recoverChapterTransitionCandidateV1({
      scope: interrupted.fixture.scope,
      candidate: interrupted.candidate,
    })
    expect(recovered?.durable.candidateHash).toBe(interrupted.candidate.durable.candidateHash)
    const snapshot = await readAgentRunV1(interrupted.fixture.scope, interrupted.candidate.durable.runId)
    expect(snapshot.projection.steps[CHAPTER_TRANSITION_STEP_IDS_V1.state].status).toBe('awaiting_confirmation')
    expect(snapshot.events.filter(event => event.type === 'model.requested' && event.payload.stepId === CHAPTER_TRANSITION_STEP_IDS_V1.state)).toHaveLength(1)
    expect(snapshot.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
  })

  it('正文变化后拒绝旧状态候选并保持无终态 receipt', async () => {
    const pending = await preparePending('transition stale')
    await db.chapters.update(pending.fixture.chapterId, {
      content: '<p>作者已经改写正文。</p>',
      updatedAt: Date.now(),
    })
    await expect(commitChapterTransitionStateAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      written: 0,
    })).rejects.toThrow('已过期')
    const snapshot = await readAgentRunV1(pending.fixture.scope, pending.candidate.durable.runId)
    expect(snapshot.projection.state).toBe('paused')
    expect(snapshot.projection.terminalReceiptHash).toBeUndefined()
  })

  it('业务派生状态缺失时拒绝终态 receipt，即使所有 step 事件都已成功', async () => {
    const pending = await preparePending('transition verifier')
    await db.chapters.update(pending.fixture.chapterId, { summary: '' })
    const adopted = await commitChapterTransitionStateAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      written: 0,
    })
    expect(adopted.projection.state).toBe('running')
    await expect(verifyChapterTransitionRunV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
    })).rejects.toThrow('summary/handoff')
  })
})

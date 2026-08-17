import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { createContextManifestFromAssemblyV1 } from '../../src/lib/agent/run/context-manifest'
import {
  parseChapterOrganizationOutput,
  persistChapterOrganizationCandidate,
  selectAllChapterOrganizationCandidates,
  adoptChapterOrganizationSelection,
  type ChapterOrganizationCandidate,
} from '../../src/lib/agent/chapter-organization'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import {
  hashConsistencyAgentCandidateV1,
  persistConsistencyAgentCandidate,
  runBackgroundConsistencyAgent,
} from '../../src/lib/agent/consistency-agent'
import { hashChapterText, CHAPTER_TEXT_NORMALIZATION_VERSION } from '../../src/lib/ai/chapter-memory/text-normalization'
import { rebuildChapterChunks, rebuildProjectNarrativeSummaries } from '../../src/lib/retrieval/retrieval'
import type { WorkspaceScope } from '../../src/lib/types'
import {
  beginChapterPostAdoptionStepV1,
  beginChapterPostAdoptionOrganizationAdoptionV1,
  commitChapterPostAdoptionOrganizationV1,
  createChapterPostAdoptionDurableRunV1,
  failChapterPostAdoptionStepV1,
  recordChapterPostAdoptionOutputV1,
  recoverChapterPostAdoptionOrganizationV1,
  rejectChapterPostAdoptionOrganizationAdoptionV1,
  scheduleChapterPostAdoptionStepsV1,
  succeedChapterPostAdoptionStepV1,
  verifyChapterPostAdoptionRunV1,
  CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1,
  CHAPTER_POST_ADOPTION_STEP_IDS_V1,
  type ChapterPostAdoptionDurableEvidenceV1,
} from '../../src/lib/agent/run/chapter-post-adoption-durable'

const CONTENT = '<p>守灯人抵达潮门，点亮了旧灯。</p>'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  outlineNodeId: number
  chapterId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: label,
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    worldCode: `world-${label}`,
    worldVersion: 1,
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
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({ projectId, name: '主世界', order: 0, createdAt: now, updatedAt: now }) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'chapter', title: '潮门',
    summary: '守灯人抵达潮门。', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, workId, outlineNodeId, title: '潮门', content: CONTENT, wordCount: 15,
    status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  return { scope: { projectId, worldId, workId }, worldGroupId, outlineNodeId, chapterId }
}

function emptyCandidate(input: {
  projectId: number
  chapterId: number
  worldGroupId: number
  sourceTextHash: string
}): ChapterOrganizationCandidate {
  return parseChapterOrganizationOutput({
    raw: JSON.stringify({ stateDiffs: [], facts: [], inventoryEvents: [], storyEvents: [], relations: [], foreshadowUpdates: [] }),
    projectId: input.projectId,
    chapterId: input.chapterId,
    chapterTitle: '潮门',
    worldGroupId: input.worldGroupId,
    chapterText: '守灯人抵达潮门，点亮了旧灯。',
    sourceTextHash: input.sourceTextHash,
    characters: [],
    existingRelations: [],
    foreshadows: [],
    budget: new AgentTeamBudgetTracker('economy').snapshot(),
  })!
}

async function preparePending(label: string, recordCandidate = true) {
  const fixture = await createWorkspace(label)
  let snapshot = await createChapterPostAdoptionDurableRunV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    chapterId: fixture.chapterId,
  })
  snapshot = await scheduleChapterPostAdoptionStepsV1({ scope: fixture.scope, snapshot })
  const manifest = async (stepId: string, attempt = 1) => {
    const sourceKeys = CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1[
      stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization
        ? 'organization'
        : stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory
          ? 'memory'
          : stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency ? 'consistency' : 'retrieval'
    ]
    const assembled = await assembleContext({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      sourceKeys: [...sourceKeys],
      inputBudgetMaxTokens: 24_000,
    })
    return createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId,
      attempt,
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      declaredSourceKeys: sourceKeys,
      assembled,
      boundary: { chapterId: fixture.chapterId, outlineNodeId: fixture.outlineNodeId },
      readerVersion: 'chapter-post-adoption-context-v1',
    })
  }
  snapshot = await beginChapterPostAdoptionStepV1({
    scope: fixture.scope,
    snapshot,
    stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
    contextManifest: await manifest(CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization),
  })
  const sourceTextHash = await hashChapterText(CONTENT)
  const base = emptyCandidate({
    projectId: fixture.scope.projectId,
    chapterId: fixture.chapterId,
    worldGroupId: fixture.worldGroupId,
    sourceTextHash,
  })
  const candidateHash = await (await import('../../src/lib/agent/run/chapter-organization-durable')).hashChapterOrganizationCandidateV1(base)
  const candidate = {
    ...base,
    durable: {
      runId: snapshot.run.id,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
      attempt: 1,
      contextManifestHash: (await manifest(CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization)).manifestHash,
      candidateHash,
    } satisfies ChapterPostAdoptionDurableEvidenceV1,
  }
  const run = await persistChapterOrganizationCandidate(candidate)
  if (recordCandidate) {
    snapshot = await recordChapterPostAdoptionOutputV1({
      scope: fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
      output: candidate,
      candidateHash,
      requiresConfirmation: true,
    })
  }
  return { fixture, snapshot, run: { ...run, candidate }, candidate, manifest }
}

describe.sequential('R-HARNESS20 · 正文采纳后的统一章后处理屏障', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('把六域候选、检索和章节记忆绑定在同一 durable run，作者确认后才签发终态回执', async () => {
    const pending = await preparePending('post-adoption')
    let snapshot = pending.snapshot
    const consistencyManifest = await pending.manifest(CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency)
    snapshot = await beginChapterPostAdoptionStepV1({
      scope: pending.fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
      contextManifest: await pending.manifest(CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory),
    })
    const sourceTextHash = await hashChapterText(CONTENT)
    await db.chapters.update(pending.fixture.chapterId, {
      summary: '守灯人抵达潮门并点亮旧灯。',
      summarySourceTextHash: sourceTextHash,
      summaryTextNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      continuityHandoff: {
        chapterId: pending.fixture.chapterId,
        sourceTextHash,
        schemaVersion: 1,
        extractorVersion: 'test',
        textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
        finalScene: { location: '潮门', activeCharacters: ['守灯人'], lastAction: '点亮旧灯' },
        stateChanges: [], knowledgeChanges: [], commitments: [], openLoops: [], evidenceQuotes: [], generatedAt: Date.now(),
      },
    } as any)
    await rebuildProjectNarrativeSummaries({
      projectId: pending.fixture.scope.projectId,
      scope: pending.fixture.scope,
    })
    snapshot = await recordChapterPostAdoptionOutputV1({
      scope: pending.fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
      output: { status: 'written', sourceTextHash },
    })
    snapshot = await succeedChapterPostAdoptionStepV1({
      scope: pending.fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
      output: { status: 'written', sourceTextHash },
    })
    snapshot = await beginChapterPostAdoptionStepV1({
      scope: pending.fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
      contextManifest: await pending.manifest(CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval),
      model: false,
    })
    const chapter = await db.chapters.get(pending.fixture.chapterId)
    await rebuildChapterChunks({
      projectId: pending.fixture.scope.projectId,
      scope: pending.fixture.scope,
      chapter: chapter!,
      worldGroupId: pending.fixture.worldGroupId,
      knownEntities: [],
    })
    await rebuildProjectNarrativeSummaries({
      projectId: pending.fixture.scope.projectId,
      scope: pending.fixture.scope,
    })
    snapshot = await succeedChapterPostAdoptionStepV1({
      scope: pending.fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
      output: { rebuilt: true },
    })
    const consistencyAssembly = await assembleContext({
      projectId: pending.fixture.scope.projectId,
      scope: pending.fixture.scope,
      worldGroupId: pending.fixture.worldGroupId,
      chapterId: pending.fixture.chapterId,
      outlineNodeId: pending.fixture.outlineNodeId,
      sourceKeys: [...CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.consistency],
      inputBudgetMaxTokens: 24_000,
    })
    snapshot = await beginChapterPostAdoptionStepV1({
      scope: pending.fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
      contextManifest: consistencyManifest,
      model: false,
    })
    const guard = await runBackgroundConsistencyAgent({
      projectId: pending.fixture.scope.projectId,
      chapterId: pending.fixture.chapterId,
      chapterTitle: '潮门',
      worldGroupId: pending.fixture.worldGroupId,
      chapterContent: CONTENT,
      budget: new AgentTeamBudgetTracker('economy'),
      contextEvidence: {
        included: consistencyAssembly.included,
        omitted: consistencyAssembly.omitted,
        trimmed: consistencyAssembly.trimmed,
        inputTokens: consistencyAssembly.totalInputTokens,
        inputBudget: consistencyAssembly.inputBudget,
      },
    })
    const consistencyCandidateHash = await hashConsistencyAgentCandidateV1(guard)
    const durableGuard = {
      ...guard,
      durable: {
        runId: snapshot.run.id,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        attempt: 1,
        contextManifestHash: consistencyManifest.manifestHash,
        candidateHash: consistencyCandidateHash,
      },
    }
    await persistConsistencyAgentCandidate(durableGuard)
    snapshot = await recordChapterPostAdoptionOutputV1({
      scope: pending.fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
      output: durableGuard,
      candidateHash: consistencyCandidateHash,
      requiresConfirmation: false,
      modelResponded: false,
    })
    snapshot = await succeedChapterPostAdoptionStepV1({
      scope: pending.fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
      output: durableGuard,
    })
    expect(snapshot.projection.terminalReceiptHash).toBeUndefined()

    const adopted = await adoptChapterOrganizationSelection({
      run: pending.run,
      selection: selectAllChapterOrganizationCandidates(pending.candidate),
    })
    snapshot = await commitChapterPostAdoptionOrganizationV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: adopted.run.candidate as ChapterOrganizationCandidate & { durable: ChapterPostAdoptionDurableEvidenceV1 },
      written: adopted.written,
    })
    const completed = await verifyChapterPostAdoptionRunV1({ scope: pending.fixture.scope, runId: snapshot.run.id })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(completed.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(completed.snapshot.events.map(event => event.type).slice(-3)).toEqual([
      'verification.started', 'verification.accepted', 'memory.settlement.recorded',
    ])
  })

  it('正文变化后六域候选失效，run 停在 paused 且没有终态回执', async () => {
    const pending = await preparePending('post-adoption-stale')
    await db.chapters.update(pending.fixture.chapterId, { content: '<p>作者改写了正文。</p>' })
    await expect(commitChapterPostAdoptionOrganizationV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate as ChapterOrganizationCandidate & { durable: ChapterPostAdoptionDurableEvidenceV1 },
      written: {},
    })).rejects.toThrow('已过期')
    const snapshot = await (await import('../../src/lib/agent/run/event-store')).readAgentRunV1(
      pending.fixture.scope,
      pending.candidate.durable.runId,
    )
    expect(snapshot.projection.state).toBe('paused')
    expect(snapshot.projection.terminalReceiptHash).toBeUndefined()
  })

  it('候选事件已保存但 durable ledger 未推进时可恢复，不重复调用模型', async () => {
    const pending = await preparePending('post-adoption-recover', false)
    const recovered = await recoverChapterPostAdoptionOrganizationV1({
      scope: pending.fixture.scope,
      candidate: pending.candidate as ChapterOrganizationCandidate & { durable: ChapterPostAdoptionDurableEvidenceV1 },
    })
    expect(recovered?.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization].status).toBe('awaiting_confirmation')
    expect(recovered?.events.filter(event => event.type === 'model.responded')).toHaveLength(1)
    const repeated = await recoverChapterPostAdoptionOrganizationV1({
      scope: pending.fixture.scope,
      candidate: pending.candidate as ChapterOrganizationCandidate & { durable: ChapterPostAdoptionDurableEvidenceV1 },
    })
    expect(repeated?.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
  })

  it('每个步骤只接受自己的 Context Manifest，失败后用递增 attempt 恢复', async () => {
    const pending = await preparePending('post-adoption-step-context')
    const wrongAssembly = await assembleContext({
      projectId: pending.fixture.scope.projectId,
      scope: pending.fixture.scope,
      worldGroupId: pending.fixture.worldGroupId,
      chapterId: pending.fixture.chapterId,
      outlineNodeId: pending.fixture.outlineNodeId,
      sourceKeys: [...CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.organization],
      inputBudgetMaxTokens: 24_000,
    })
    const wrongManifest = await createContextManifestFromAssemblyV1({
      runId: pending.snapshot.run.id,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
      attempt: 1,
      projectId: pending.fixture.scope.projectId,
      worldGroupId: pending.fixture.worldGroupId,
      declaredSourceKeys: CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.organization,
      assembled: wrongAssembly,
      boundary: { chapterId: pending.fixture.chapterId, outlineNodeId: pending.fixture.outlineNodeId },
      readerVersion: 'chapter-post-adoption-context-v1',
    })
    await expect(beginChapterPostAdoptionStepV1({
      scope: pending.fixture.scope,
      snapshot: pending.snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
      contextManifest: wrongManifest,
    })).rejects.toThrow('来源不匹配')

    let snapshot = await beginChapterPostAdoptionStepV1({
      scope: pending.fixture.scope,
      snapshot: pending.snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
      contextManifest: await pending.manifest(CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory),
    })
    snapshot = await failChapterPostAdoptionStepV1({
      scope: pending.fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
      code: 'transient_memory_failure',
    })
    snapshot = await beginChapterPostAdoptionStepV1({
      scope: pending.fixture.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
      contextManifest: await pending.manifest(CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory, 2),
    })
    expect(snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory].attempt).toBe(2)
    expect(snapshot.events.filter(event => (
      event.type === 'context.assembled'
        && event.payload.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory
    ))).toHaveLength(2)
  })

  it('部分采纳失败进入 durable 失败态，重试只开启新的采纳 attempt', async () => {
    const pending = await preparePending('post-adoption-partial')
    let snapshot = await beginChapterPostAdoptionOrganizationAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.snapshot.run.id,
      candidateHash: pending.candidate.durable.candidateHash,
    })
    snapshot = await rejectChapterPostAdoptionOrganizationAdoptionV1({
      scope: pending.fixture.scope,
      snapshot,
      candidateHash: pending.candidate.durable.candidateHash,
    })
    expect(snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]).toMatchObject({
      status: 'failed',
      attempt: 1,
      failureCode: 'chapter_organization_partial_adoption',
    })

    snapshot = await beginChapterPostAdoptionOrganizationAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.snapshot.run.id,
      candidateHash: pending.candidate.durable.candidateHash,
    })
    expect(snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]).toMatchObject({
      status: 'running',
      attempt: 2,
    })
    expect(snapshot.events.filter(event => event.type === 'adoption.started')).toHaveLength(2)
  })
})

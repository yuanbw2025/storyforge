import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { createContextManifestFromAssemblyV1 } from '../../src/lib/agent/run/context-manifest'
import {
  adoptChapterOrganizationSelection,
  persistChapterOrganizationCandidate,
  readLatestChapterOrganizationRun,
  runChapterOrganization,
  selectAllChapterOrganizationCandidates,
} from '../../src/lib/agent/chapter-organization'
import {
  beginChapterOrganizationDurableStepV1,
  commitChapterOrganizationDurableAdoptionV1,
  createChapterOrganizationDurableRunV1,
  hashChapterOrganizationCandidateV1,
  hashChapterOrganizationPostStateV1,
  recoverChapterOrganizationCandidateV1,
  recordChapterOrganizationCandidateV1,
  CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
  CHAPTER_ORGANIZATION_SOURCE_KEYS_V1,
} from '../../src/lib/agent/run/chapter-organization-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { WorkspaceScope } from '../../src/lib/types'

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
  const chapterId = await db.chapters.add({
    projectId,
    workId,
    outlineNodeId,
    title: '潮门',
    content: '<p>守灯人抵达潮门。</p>',
    wordCount: 9,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return { scope: { projectId, worldId, workId }, worldGroupId, outlineNodeId, chapterId }
}

async function createPendingCandidate(label: string, recordDurableCandidate = true) {
  const fixture = await createWorkspace(label)
  let snapshot = await createChapterOrganizationDurableRunV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    chapterId: fixture.chapterId,
  })
  const assembled = await assembleContext({
    projectId: fixture.scope.projectId,
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    chapterId: fixture.chapterId,
    outlineNodeId: fixture.outlineNodeId,
    sourceKeys: [...CHAPTER_ORGANIZATION_SOURCE_KEYS_V1],
    inputBudgetMaxTokens: 24_000,
  })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
    attempt: 1,
    projectId: fixture.scope.projectId,
    worldGroupId: fixture.worldGroupId,
    declaredSourceKeys: CHAPTER_ORGANIZATION_SOURCE_KEYS_V1,
    assembled,
    boundary: { chapterId: fixture.chapterId, outlineNodeId: fixture.outlineNodeId },
    readerVersion: 'chapter-organization-context-v1',
  })
  snapshot = await beginChapterOrganizationDurableStepV1({
    scope: fixture.scope,
    snapshot,
    contextManifest: manifest,
    binding: { chapterId: fixture.chapterId },
  })
  const candidate = await runChapterOrganization({
    projectId: fixture.scope.projectId,
    chapterId: fixture.chapterId,
    chapterTitle: '潮门',
    worldGroupId: fixture.worldGroupId,
    chapterContent: '<p>守灯人抵达潮门。</p>',
    stateContext: '',
    contextSnapshot: assembled.text,
    characters: [],
    knownItemNames: [],
    existingRelations: [],
    foreshadows: [],
    budget: new AgentTeamBudgetTracker('economy'),
    call: async () => JSON.stringify({
      stateDiffs: [],
      facts: [],
      inventoryEvents: [],
      storyEvents: [],
      relations: [],
      foreshadowUpdates: [],
    }),
  })
  const candidateHash = await hashChapterOrganizationCandidateV1(candidate)
  const run = await persistChapterOrganizationCandidate(candidate, {
    durable: {
      runId: snapshot.run.id,
      stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
      attempt: 1,
      contextManifestHash: manifest.manifestHash,
      candidateHash,
    },
  })
  if (recordDurableCandidate) {
    const recorded = await recordChapterOrganizationCandidateV1({
      scope: fixture.scope,
      snapshot,
      candidate: run.candidate,
    })
    snapshot = recorded.snapshot
  }
  return { fixture, run, snapshot }
}

describe.sequential('R-HARNESS5 · 整理本章 durable run', { timeout: 15_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('候选绑定受控上下文和正文 hash，作者确认后才签发终态 receipt', async () => {
    const pending = await createPendingCandidate('整理 durable')
    expect(pending.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(pending.snapshot.events.map(event => event.type)).toContain('context.assembled')
    expect(await db.stateCards.count()).toBe(0)
    expect(await db.temporalFacts.count()).toBe(0)

    const adopted = await adoptChapterOrganizationSelection({
      run: pending.run,
      selection: selectAllChapterOrganizationCandidates(pending.run.candidate),
    })
    const completed = await commitChapterOrganizationDurableAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.run.candidate.durable!.runId,
      candidate: adopted.run.candidate,
      written: adopted.written,
    })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(completed.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(completed.snapshot.events.map(event => event.type).slice(-6)).toEqual([
      'adoption.started',
      'adoption.committed',
      'step.succeeded',
      'verification.started',
      'verification.accepted',
      'memory.settlement.recorded',
    ])
    const restored = await readLatestChapterOrganizationRun({
      projectId: pending.fixture.scope.projectId,
      chapterId: pending.fixture.chapterId,
    })
    expect(restored?.candidate.durable?.candidateHash).toBe(pending.run.candidate.durable?.candidateHash)
  })

  it('正文变更后旧候选进入 paused/stale，不能伪造完成', async () => {
    const pending = await createPendingCandidate('整理 stale')
    await db.chapters.update(pending.fixture.chapterId, {
      content: '<p>守灯人抵达潮门。</p><p>作者补写。</p>',
      updatedAt: Date.now(),
    })
    await expect(commitChapterOrganizationDurableAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.run.candidate.durable!.runId,
      candidate: pending.run.candidate,
      written: { state: 0, facts: 0, inventory: 0, timeline: 0, relations: 0, foreshadows: 0 },
    })).rejects.toThrow('已过期')
    const snapshot = await readAgentRunV1(pending.fixture.scope, pending.run.candidate.durable!.runId)
    expect(snapshot.projection.state).toBe('paused')
    expect(snapshot.projection.steps[CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1].status).toBe('stale')
    expect(snapshot.projection.terminalReceiptHash).toBeUndefined()
  })

  it('候选事件已落库但 ledger 未推进时可恢复，不重复调用模型', async () => {
    const interrupted = await createPendingCandidate('整理恢复', false)
    expect(interrupted.snapshot.projection.state).toBe('running')
    expect(interrupted.snapshot.projection.steps[CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1].candidateHash)
      .toBeUndefined()
    const recovered = await recoverChapterOrganizationCandidateV1({
      scope: interrupted.fixture.scope,
      candidate: interrupted.run.candidate,
    })
    expect(recovered?.projection.state).toBe('awaiting_confirmation')
    expect(recovered?.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(recovered?.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
    const repeated = await recoverChapterOrganizationCandidateV1({
      scope: interrupted.fixture.scope,
      candidate: interrupted.run.candidate,
    })
    expect(repeated?.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
  })

  it('终态 post-state hash 随受治理业务表实际状态变化，而不是只记录写入数量', async () => {
    const pending = await createPendingCandidate('整理 post-state')
    const before = await hashChapterOrganizationPostStateV1({
      scope: pending.fixture.scope,
      chapterId: pending.fixture.chapterId,
    })
    await db.stateCards.add({
      projectId: pending.fixture.scope.projectId,
      workId: pending.fixture.scope.workId,
      category: 'character',
      entityName: '守灯人',
      fields: JSON.stringify([{ key: '位置', value: '潮门' }]),
      lastChapterId: pending.fixture.chapterId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    const after = await hashChapterOrganizationPostStateV1({
      scope: pending.fixture.scope,
      chapterId: pending.fixture.chapterId,
    })
    expect(after).toMatch(/^[a-f0-9]{64}$/)
    expect(after).not.toBe(before)
  })
})

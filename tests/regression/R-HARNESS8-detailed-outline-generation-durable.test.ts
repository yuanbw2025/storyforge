import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { adoptChapterOutlineWorkshopResult } from '../../src/lib/outline/adopt-workshop'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  beginDetailedOutlineGenerationStepV1,
  commitDetailedOutlineGenerationAdoptionV1,
  createDetailedOutlineGenerationDurableRunV1,
  detailedOutlineManifestV1,
  hashDetailedOutlineGenerationCandidateV1,
  hashDetailedOutlineSourceSummaryV1,
  persistDetailedOutlineGenerationCandidateV1,
  recordDetailedOutlineGenerationCandidateV1,
  recordDetailedOutlineGenerationModelOutputV1,
  readLatestDetailedOutlineGenerationCandidateV1,
  DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1,
  DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
  type DetailedOutlineGenerationCandidateV1,
} from '../../src/lib/agent/run/detailed-outline-generation-durable'
import type { WorkspaceScope } from '../../src/lib/types'
import { assertFormalAIEntrySnapshotIntegrityV1 } from '../../src/lib/agent/formal-ai-entry'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  outlineNodeId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: label,
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
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
  return { scope: { projectId, worldId, workId }, worldGroupId, outlineNodeId }
}

async function pendingCandidate(label: string, recordLedger = true) {
  const fixture = await createWorkspace(label)
  let snapshot = await createDetailedOutlineGenerationDurableRunV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    outlineNodeId: fixture.outlineNodeId,
    operation: 'enhanced',
  })
  const assembled = await assembleContext({
    projectId: fixture.scope.projectId,
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    outlineNodeId: fixture.outlineNodeId,
    sourceKeys: [...DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1],
    inputBudgetMaxTokens: 16_000,
  })
  const manifest = await detailedOutlineManifestV1({
    runId: snapshot.run.id,
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    outlineNodeId: fixture.outlineNodeId,
    assembled,
  })
  const output = JSON.stringify({
    openingHook: '潮声从上一章的门缝里涌来。',
    endingCliffhanger: '灯芯忽然映出第二道影子。',
    sceneLocation: '潮门内港',
    emotionArc: 'rising',
    appearingCharacterIds: [],
    foreshadowIds: [],
    scenes: [{
      title: '潮门回响',
      summary: '守灯人发现潮门的刻痕正在移动。',
      location: '潮门内港',
      conflict: '时间紧迫与未知警告冲突。',
      pace: 'fast',
      characterIds: [],
      estimatedWords: 1200,
    }],
  })
  snapshot = await beginDetailedOutlineGenerationStepV1({
    scope: fixture.scope,
    snapshot,
    contextManifest: manifest,
    binding: {
      operation: 'enhanced',
      sourceSummaryHash: await hashDetailedOutlineSourceSummaryV1('守灯人抵达潮门。'),
      promptHash: await hashCanonicalValue([{ role: 'user', content: '完善潮门细纲' }]),
    },
  })
  snapshot = await recordDetailedOutlineGenerationModelOutputV1({
    scope: fixture.scope,
    snapshot,
    output,
  })
  const base = {
    version: 1 as const,
    type: 'detailed-outline-generation-candidate' as const,
    projectId: fixture.scope.projectId,
    outlineNodeId: fixture.outlineNodeId,
    worldGroupId: fixture.worldGroupId,
    operation: 'enhanced' as const,
    sourceSummaryHash: await hashDetailedOutlineSourceSummaryV1('守灯人抵达潮门。'),
    output,
    outputHash: await hashCanonicalValue(output),
    contextManifestHash: manifest.manifestHash,
    workspaceScope: fixture.scope,
    createdAt: Date.now(),
  }
  const candidateHash = await hashDetailedOutlineGenerationCandidateV1({
    ...base,
    durable: { runId: snapshot.run.id, stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1, attempt: 1, candidateHash: '' },
  })
  const candidate: DetailedOutlineGenerationCandidateV1 = {
    ...base,
    durable: { runId: snapshot.run.id, stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1, attempt: 1, candidateHash },
  }
  const persisted = await persistDetailedOutlineGenerationCandidateV1({ scope: fixture.scope, candidate })
  if (recordLedger) {
    snapshot = await recordDetailedOutlineGenerationCandidateV1({ scope: fixture.scope, snapshot, candidate })
  }
  return { fixture, snapshot, candidate, eventId: persisted.event.id! }
}

async function currentManifestHash(
  pending: Awaited<ReturnType<typeof pendingCandidate>>,
): Promise<string> {
  const assembled = await assembleContext({
    projectId: pending.fixture.scope.projectId,
    scope: pending.fixture.scope,
    worldGroupId: pending.fixture.worldGroupId,
    outlineNodeId: pending.fixture.outlineNodeId,
    sourceKeys: [...DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1],
    inputBudgetMaxTokens: 16_000,
  })
  return (await detailedOutlineManifestV1({
    runId: pending.candidate.durable.runId,
    scope: pending.fixture.scope,
    worldGroupId: pending.fixture.worldGroupId,
    outlineNodeId: pending.fixture.outlineNodeId,
    assembled,
  })).manifestHash
}

describe.sequential('R-HARNESS8 · 细纲生成 durable run', { timeout: 15_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('候选先停在 durable ledger，作者确认后经 adopt 写回并签发 receipt', async () => {
    const pending = await pendingCandidate('细纲 durable')
    const formalEntrySnapshot = pending.snapshot.contract.executionBindings?.[0]?.formalEntry
    expect(formalEntrySnapshot?.entryId).toBe('outline.detail.enhance')
    const formalEntry = await assertFormalAIEntrySnapshotIntegrityV1(formalEntrySnapshot!)
    expect(formalEntry.skillId).toBe('outline.details')
    expect(formalEntry.adoptionTargets).toEqual(['detailedOutlines'])
    expect(pending.candidate.durable.runId).toBe(pending.snapshot.run.id)
    expect(pending.candidate.contextManifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(pending.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(await db.detailedOutlines.count()).toBe(0)
    const adopted = await commitDetailedOutlineGenerationAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      output: pending.candidate.output,
      currentSourceSummaryHash: () => hashDetailedOutlineSourceSummaryV1('守灯人抵达潮门。'),
      currentContextManifestHash: () => currentManifestHash(pending),
      adopt: async () => {
        const result = await adoptChapterOutlineWorkshopResult({
          raw: pending.candidate.output,
          projectId: pending.fixture.scope.projectId,
          scope: pending.fixture.scope,
          outlineNodeId: pending.fixture.outlineNodeId,
          chapterSummary: '守灯人抵达潮门。',
          validCharacterIds: new Set(),
          validForeshadowIds: new Set(),
        })
        if (!result.ok) throw new Error(result.reason)
      },
      postState: async () => await db.detailedOutlines.where('outlineNodeId').equals(pending.fixture.outlineNodeId).first(),
      postStateMatches: state => (
        !!state
        && typeof state === 'object'
        && !Array.isArray(state)
        && (state as any).outlineNodeId === pending.fixture.outlineNodeId
        && (state as any).scenes?.length === 1
      ),
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await db.detailedOutlines.where('outlineNodeId').equals(pending.fixture.outlineNodeId).first())?.scenes)
      .toHaveLength(1)
  })

  it('刷新可恢复未采纳候选，章纲变更会标记旧 run stale', async () => {
    const pending = await pendingCandidate('细纲恢复')
    const restored = await readLatestDetailedOutlineGenerationCandidateV1({
      scope: pending.fixture.scope,
      outlineNodeId: pending.fixture.outlineNodeId,
    })
    expect(restored?.candidate.output).toBe(pending.candidate.output)
    await db.outlineNodes.update(pending.fixture.outlineNodeId, {
      summary: '作者改写了潮门目标。',
      updatedAt: Date.now(),
    })
    await expect(commitDetailedOutlineGenerationAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      output: pending.candidate.output,
      currentSourceSummaryHash: () => hashDetailedOutlineSourceSummaryV1('作者改写了潮门目标。'),
      currentContextManifestHash: () => currentManifestHash(pending),
      adopt: async () => { throw new Error('不应写入') },
      postState: async () => null,
      postStateMatches: () => false,
    })).rejects.toThrow('已过期')
    const snapshot = await readAgentRunV1(pending.fixture.scope, pending.candidate.durable.runId)
    expect(snapshot.projection.state).toBe('paused')
    expect(snapshot.projection.steps[DETAILED_OUTLINE_GENERATION_STEP_ID_V1].status).toBe('stale')
  })

  it('候选事件已落库但 ledger 未推进时，刷新恢复会补齐候选边界且不重复生成', async () => {
    const interrupted = await pendingCandidate('细纲中断恢复', false)
    expect(interrupted.snapshot.projection.steps[DETAILED_OUTLINE_GENERATION_STEP_ID_V1].candidateHash)
      .toBeUndefined()
    const restored = await readLatestDetailedOutlineGenerationCandidateV1({
      scope: interrupted.fixture.scope,
      outlineNodeId: interrupted.fixture.outlineNodeId,
    })
    expect(restored?.candidate.output).toBe(interrupted.candidate.output)
    expect(restored?.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(restored?.snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(restored?.snapshot.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
  })
})

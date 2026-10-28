import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { adoptChapterOutlineWorkshopResult } from '../../src/lib/outline/adopt-workshop'
import { appendAgentRunEventV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
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
  readPendingDetailedOutlineNodeIdsV1,
  rejectDetailedOutlineGenerationCandidateV1,
  DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1,
  DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
  type DetailedOutlineGenerationCandidateV1,
} from '../../src/lib/agent/run/detailed-outline-generation-durable'
import type { WorkspaceScope } from '../../src/lib/types'
import { assertFormalAIEntrySnapshotIntegrityV1 } from '../../src/lib/agent/formal-ai-entry'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  outlineNodeId: number
}> {
  const now = Date.now()
  const createdWorkspaceV1 = await seedCurrentWorkspace(label)
  const { projectId, worldId, workId } = createdWorkspaceV1.scope
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

  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('已拒绝的步骤与已取消的运行都不再进入只读候选索引或刷新恢复', async () => {
    const rejected = await pendingCandidate('拒绝索引')
    await rejectDetailedOutlineGenerationCandidateV1({ scope: rejected.fixture.scope, runId: rejected.candidate.durable.runId, candidate: rejected.candidate })
    expect(await readPendingDetailedOutlineNodeIdsV1(rejected.fixture.scope)).toEqual(new Set())
    expect(await readLatestDetailedOutlineGenerationCandidateV1({ scope: rejected.fixture.scope, outlineNodeId: rejected.fixture.outlineNodeId })).toBeNull()
    const terminal = await readAgentRunV1(rejected.fixture.scope, rejected.candidate.durable.runId)
    expect(terminal.projection.state).toBe('failed')
    expect(terminal.events.filter(event => event.type === 'run.failed').map(event => event.payload)).toEqual([{ code: 'author_rejected', retryable: false }])
    const repeated = await rejectDetailedOutlineGenerationCandidateV1({ scope: rejected.fixture.scope, runId: rejected.candidate.durable.runId, candidate: rejected.candidate })
    expect(repeated.events).toEqual(terminal.events)
    const cancelled = await pendingCandidate('取消索引')
    const snapshot = await readAgentRunV1(cancelled.fixture.scope, cancelled.candidate.durable.runId)
    await appendAgentRunEventV1({ scope: cancelled.fixture.scope, runId: cancelled.candidate.durable.runId, expectedLastSequence: snapshot.projection.lastSequence, type: 'run.cancelled', payload: { reason: '作者停止此运行' } })
    expect(await readPendingDetailedOutlineNodeIdsV1(cancelled.fixture.scope)).toEqual(new Set())
    expect(await readLatestDetailedOutlineGenerationCandidateV1({ scope: cancelled.fixture.scope, outlineNodeId: cancelled.fixture.outlineNodeId })).toBeNull()
  })

  it.each(['run.failed', 'memory.settlement.recorded'])('拒绝的 %s 写失败时整次决定回滚，原候选仍能恢复后明确重试', async eventType => {
    const pending = await pendingCandidate('拒绝终态故障')
    const before = await readAgentRunV1(pending.fixture.scope, pending.candidate.durable.runId)
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === eventType) throw new DOMException('拒绝终态写入故障', 'QuotaExceededError')
      return add(...args)
    })
    await expect(rejectDetailedOutlineGenerationCandidateV1({ scope: pending.fixture.scope, runId: pending.candidate.durable.runId, candidate: pending.candidate })).rejects.toThrow('拒绝终态写入故障')
    expect(await readAgentRunV1(pending.fixture.scope, pending.candidate.durable.runId)).toEqual(before)
    expect(await readLatestDetailedOutlineGenerationCandidateV1({ scope: pending.fixture.scope, outlineNodeId: pending.fixture.outlineNodeId })).not.toBeNull()
    spy.mockRestore()
    const after = await rejectDetailedOutlineGenerationCandidateV1({ scope: pending.fixture.scope, runId: pending.candidate.durable.runId, candidate: pending.candidate })
    expect(after.projection.state).toBe('failed')
    expect(after.events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
  })

  it('重复并发拒绝只追加一条决定、一条终态及一条结算', async () => {
    const pending = await pendingCandidate('并发拒绝')
    const input = { scope: pending.fixture.scope, runId: pending.candidate.durable.runId, candidate: pending.candidate }
    await Promise.all([rejectDetailedOutlineGenerationCandidateV1(input), rejectDetailedOutlineGenerationCandidateV1(input)])
    const after = await readAgentRunV1(input.scope, input.runId)
    expect(after.projection.state).toBe('failed')
    for (const type of ['confirmation.recorded', 'run.failed', 'memory.settlement.recorded']) expect(after.events.filter(event => event.type === type)).toHaveLength(1)
  })

  it('明确再次拒绝可补齐旧的已拒绝步骤终态，不重复决定或改写既有终态', async () => {
    const pending = await pendingCandidate('旧拒绝回执')
    const before = await readAgentRunV1(pending.fixture.scope, pending.candidate.durable.runId)
    await appendAgentRunEventV1({ scope: pending.fixture.scope, runId: before.run.id!, type: 'confirmation.recorded', expectedLastSequence: before.projection.lastSequence, payload: { stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1, candidateHash: pending.candidate.durable.candidateHash, decision: 'reject' } })
    const after = await rejectDetailedOutlineGenerationCandidateV1({ scope: pending.fixture.scope, runId: before.run.id!, candidate: pending.candidate })
    expect(after.projection.state).toBe('failed')
    expect(after.events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
    expect(after.events.slice(0, before.events.length)).toEqual(before.events)
  })

  it('候选先停在 durable ledger，作者确认后经 adopt 写回并签发 receipt', async () => {
    const pending = await pendingCandidate('细纲 durable')
    const beforeIndex = await readAgentRunV1(pending.fixture.scope, pending.candidate.durable.runId)
    expect(await readPendingDetailedOutlineNodeIdsV1(pending.fixture.scope)).toEqual(new Set([pending.fixture.outlineNodeId]))
    expect(await readAgentRunV1(pending.fixture.scope, pending.candidate.durable.runId)).toEqual(beforeIndex)
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
    expect(await readPendingDetailedOutlineNodeIdsV1(pending.fixture.scope)).toEqual(new Set())
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

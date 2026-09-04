import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { appendAgentRunEventV1, createAgentRunV1, deleteAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import {
  assertMemoryPlaneContractV1,
  memoryPlaneForTableV1,
} from '../../src/lib/memory/plane-contract'
import {
  assertExactRunArtifactBodySafeV1,
  ExactRunArtifactPolicyError,
} from '../../src/lib/memory/evidence-policy'
import {
  createWorkingContextCompactionCheckpointV1,
  parseWorkingContextCompactionCheckpointV1,
  readWorkingContextReplayV1,
} from '../../src/lib/memory/working-context'
import { buildMemoryArtifactIndexV1 } from '../../src/lib/memory/settlement'
import { recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import { planExactArtifactRetentionV1 } from '../../src/lib/memory/artifact-retention'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { seedCurrentProject } from '../helpers/current-workspace'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

async function seed() {
  const now = 1_787_360_000_000
  const projectId = await seedCurrentProject({
    workspaceUid: generateWorkspaceUid(),
    name: 'MEMINT 接缝',
    genres: [],
    status: 'drafting',
    description: '',
    targetWordCount: 1_000_000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const ownership = await resolveWorkspaceOwnership(projectId)
  return { projectId, scope: ownership.scope }
}

async function runFixture() {
  const seeded = await seed()
  let snapshot = await createAgentRunV1({
    scope: seeded.scope,
    now: 1_787_360_000_100,
    contract: {
      version: 1,
      objective: '验证 exact evidence 与工作上下文压缩接缝',
      workflowKind: 'read-only-audit',
      scope: { projectId: seeded.projectId, worldGroupId: null },
      permissions: { contextSourceKeys: ['chapterContent'], writeTargets: [] },
      runtimeBindingHash: 'a'.repeat(64),
      budget: {
        maxModelCalls: 1,
        maxToolCalls: 0,
        maxInputTokens: 1000,
        maxOutputTokens: 100,
        maxAttemptsPerStep: 1,
      },
      acceptance: [{ id: 'result', kind: 'output-present', required: true }],
      verificationPlan: [{
        id: 'terminal', kind: 'terminal', verifier: 'memint-v1', criterionIds: ['result'],
      }],
      failurePolicy: {
        onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author',
      },
    },
  })
  const append = async (type: any, payload: any) => {
    snapshot = await appendAgentRunEventV1({
      scope: seeded.scope,
      runId: snapshot.run.id,
      type,
      payload,
      expectedLastSequence: snapshot.projection.lastSequence,
      now: 1_787_360_000_100 + snapshot.projection.lastSequence,
    } as any)
  }
  const record = async (content: string, artifactKind: 'context-packet' | 'raw-response') => {
    const result = await recordAgentRunArtifactV1({
      scope: seeded.scope,
      runId: snapshot.run.id,
      artifactKind,
      content,
      stepId: 'compose',
      attempt: 1,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = result.snapshot
    return result
  }
  await append('step.scheduled', { stepId: 'compose' })
  await append('step.started', { stepId: 'compose', attempt: 1 })
  return { ...seeded, get snapshot() { return snapshot }, append, record }
}

describe('MEMINT-0 · five memory planes and compaction replay contract', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('classifies persistent memory consumers without creating another table registry', () => {
    expect(() => assertMemoryPlaneContractV1()).not.toThrow()
    expect(memoryPlaneForTableV1('worldviews')).toBe('canon-authority')
    expect(memoryPlaneForTableV1('retrievalChunks')).toBe('derived-narrative-memory')
    expect(memoryPlaneForTableV1('agentRunEvents')).toBe('execution-evidence')
    expect(memoryPlaneForTableV1('workspaceDocuments')).toBe('projection-recovery')
    expect(memoryPlaneForTableV1('importSessions')).toBe('projection-recovery')
    expect(memoryPlaneForTableV1('promptTemplates')).toBeNull()
    expect(() => memoryPlaneForTableV1('parallelMemoryCenter')).toThrow('PROJECT_TABLES')
  })

  it('rejects secrets, credentials and provider hidden reasoning at the exact-evidence boundary', () => {
    expect(() => assertExactRunArtifactBodySafeV1({
      artifactKind: 'rendered-request',
      body: { messages: [{ role: 'user', content: '生成一个边境民族' }] },
    })).not.toThrow()
    for (const body of [
      { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' },
      { api_key: 'abcdefghijklmnopqrstuv' },
      'request sk-proj-abcdefghijklmnopqrstuv',
      { reasoning_content: 'provider private chain' },
      '<thinking>private reasoning</thinking>',
    ]) {
      expect(() => assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body }))
        .toThrow(ExactRunArtifactPolicyError)
    }
  })

  it('records exact artifact refs in the existing settlement and keeps portable hashes across import', async () => {
    const fixture = await runFixture()
    const recorded = await fixture.record('{"packet":"exact"}', 'context-packet')
    await fixture.record('{"packet":"exact"}', 'context-packet')
    await fixture.append('run.failed', { code: 'fixture-terminal', retryable: false })

    const sourceIndex = await buildMemoryArtifactIndexV1(fixture.projectId)
    const sourceRefs = sourceIndex.runs[0].artifactRefs.filter(ref => ref.sourceKind === 'agent-run-artifact')
    expect(sourceRefs).toHaveLength(1)
    expect(sourceRefs[0]).toMatchObject({
      artifactKind: 'context-packet', contentHash: recorded.artifact.contentHash, authority: 'evidence',
    })

    const importedProjectId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const importedIndex = await buildMemoryArtifactIndexV1(importedProjectId)
    const importedRefs = importedIndex.runs[0].artifactRefs.filter(ref => ref.sourceKind === 'agent-run-artifact')
    expect(importedRefs).toEqual(sourceRefs)
    expect(importedIndex.runs[0].settlementReceiptHash).toBe(sourceIndex.runs[0].settlementReceiptHash)
  })

  it('replays a bounded compaction from checkpoint plus tail without dropping raw evidence refs', async () => {
    const fixture = await runFixture()
    const recorded = await fixture.record('{"packet":"original"}', 'context-packet')
    const replacement = await fixture.record('{"packet":"replacement"}', 'context-packet')
    const rawSource = await fixture.record('{"source":"raw"}', 'raw-response')
    const saved = await createWorkingContextCompactionCheckpointV1({
      scope: fixture.scope,
      runId: fixture.snapshot.run.id,
      expectedLastSequence: fixture.snapshot.projection.lastSequence,
      originalPacketHash: recorded.artifact.contentHash,
      replacementPacketHash: replacement.artifact.contentHash,
      sources: [
        {
          sourceKey: 'worldview.races', sourceRevision: 'rv-7', contentHash: HASH_C,
          span: { start: 0, end: 1200 }, disposition: 'compressed', reasonCode: 'budget-soft-limit',
        },
        {
          sourceKey: 'projectInfo', sourceRevision: 'rv-2', contentHash: HASH_B,
          span: { start: 0, end: 80 }, disposition: 'kept', reasonCode: 'mandatory-core',
        },
      ],
      strategy: 'deterministic-source-budget-v1',
      provider: null,
      promptVersion: null,
      gatewayVersion: 'memint-contract-v1',
      beforeTokens: 1800,
      afterTokens: 900,
      rawArtifactRefs: [rawSource.artifact.contentHash, recorded.artifact.contentHash],
      now: 1_787_360_000_500,
    })
    await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: saved.snapshot.run.id,
      type: 'model.responded',
      payload: { stepId: 'compose', attempt: 1, outputHash: HASH_C },
      expectedLastSequence: saved.snapshot.projection.lastSequence,
      now: 1_787_360_000_600,
    })

    const first = await readWorkingContextReplayV1(fixture.scope, saved.snapshot.run.id)
    const second = await readWorkingContextReplayV1(fixture.scope, saved.snapshot.run.id)
    expect(first?.replayHash).toBe(second?.replayHash)
    expect(first?.compaction.rawArtifactRefs).toContain(recorded.artifact.contentHash)
    expect(first?.compaction.sources.map(source => source.sourceKey)).toEqual([
      'projectInfo', 'worldview.races',
    ])
    expect(first?.tailEvents.map(event => event.type)).toEqual(['model.responded'])
    const durableEvents = await db.agentRunEvents.where('runId').equals(saved.snapshot.run.id).toArray()
    expect(durableEvents.filter(event => event.type === 'evidence.artifact.recorded')).toHaveLength(3)
  })

  it('uses live-reference mark-and-sweep and leaves a portable tombstone for explicit pruning', async () => {
    const liveRef = {
      artifactId: 'ART-live',
      sourceKind: 'agent-run-artifact' as const,
      sourceExportId: 'RUN-1:artifact:context-packet:a',
      contentHash: HASH_A,
      artifactKind: 'context-packet' as const,
      authority: 'evidence' as const,
    }
    const artifacts = [
      { artifactKind: 'context-packet' as const, contentHash: HASH_A },
      { artifactKind: 'raw-response' as const, contentHash: HASH_B },
    ]
    const swept = await planExactArtifactRetentionV1({
      artifacts, liveRefs: [liveRef], mode: 'mark-and-sweep', now: 100,
    })
    expect(swept.keep).toEqual([artifacts[0]])
    expect(swept.prune).toMatchObject([{
      ...artifacts[1], state: 'evidence-pruned', reasonCode: 'unreferenced-run-cleanup', prunedAt: 100,
    }])
    expect(swept.prune[0].receiptHash).toMatch(/^[a-f0-9]{64}$/)

    const explicit = await planExactArtifactRetentionV1({
      artifacts, liveRefs: [liveRef], mode: 'explicit-retention-prune',
      explicitTargets: [artifacts[0]], now: 200,
    })
    expect(explicit.prune[0]).toMatchObject({
      contentHash: HASH_A, state: 'evidence-pruned', reasonCode: 'explicit-retention-prune',
    })
  })

  it('removes exact references with their Run ledger so later mark-and-sweep can collect bodies', async () => {
    const fixture = await runFixture()
    const recorded = await fixture.record('exact raw response', 'raw-response')
    expect(await deleteAgentRunV1(fixture.scope, fixture.snapshot.run.id)).toBe(true)
    expect(await db.agentRunEvents.where('runId').equals(fixture.snapshot.run.id).count()).toBe(0)
    const plan = await planExactArtifactRetentionV1({
      artifacts: [{ artifactKind: 'raw-response', contentHash: recorded.artifact.contentHash }],
      liveRefs: [],
      mode: 'mark-and-sweep',
      now: 300,
    })
    expect(plan.prune).toHaveLength(1)
  })

  it('fails closed when compaction omits the original packet or expands the budget', () => {
    expect(() => parseWorkingContextCompactionCheckpointV1({
      version: 1,
      kind: 'working-context-compaction',
      generation: 1,
      baseCheckpointHash: null,
      tailFromSequence: 1,
      originalPacketHash: HASH_A,
      replacementPacketHash: HASH_B,
      sources: [],
      strategy: 'bad',
      provider: null,
      promptVersion: null,
      gatewayVersion: 'v1',
      beforeTokens: 10,
      afterTokens: 11,
      rawArtifactRefs: [HASH_B],
    })).toThrow('token')
    expect(() => parseWorkingContextCompactionCheckpointV1({
      version: 1,
      kind: 'working-context-compaction',
      generation: 1,
      baseCheckpointHash: null,
      tailFromSequence: 1,
      originalPacketHash: HASH_A,
      replacementPacketHash: HASH_B,
      sources: [],
      strategy: 'bad',
      provider: null,
      promptVersion: null,
      gatewayVersion: 'v1',
      beforeTokens: 10,
      afterTokens: 9,
      rawArtifactRefs: [HASH_B],
    })).toThrow('原始 Context Packet')
  })
})

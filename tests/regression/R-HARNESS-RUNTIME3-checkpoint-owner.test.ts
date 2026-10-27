import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { appendAgentRunEventV1, createAgentRunV1, readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { createAgentRunCheckpointV1, verifyAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1,
  beginAgentRunRecoveryV1, completeAgentRunRecoveryV1 } from '../../src/lib/agent/run/checkpoint'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import type { ProductRuntimeSession } from '../../src/lib/types'

// Isolated generic owner-row fixture; this is not a released game, source or
// real-model claim. No product-private contract parsing belongs in Harness.
async function fixture(instance = true) {
  const { scope } = await seedCurrentWorkspace('generic checkpoint owner')
  const row: ProductRuntimeSession = { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, worldGroupId: null,
    productReleaseId: null, productBuildId: 1, runtimeSourceHash: 'a'.repeat(64), kind: 'text-adventure', title: 'isolated checkpoint owner',
    status: 'active', rulesetVersion: 1, seed: 'fixture', canonSnapshotJson: '{}', initialStateJson: '{}', runtimeHeadSequence: 0,
    runtimeHeadStateJson: '{}', runtimeHeadStateHash: 'b'.repeat(64), parentSessionId: null, parentThroughSequence: null, createdAt: 1, updatedAt: 1 }
  const sessionId = await db.productRuntimeSessions.add(row) as number
  const contract = { version: 1, objective: 'isolated checkpoint ownership bookkeeping', workflowKind: 'direct-generation',
    scope: { projectId: scope.projectId, worldGroupId: null, ...(instance ? { runtime: { productRuntimeSessionId: sessionId,
      baseSequence: 0, stateHash: 'b'.repeat(64), visibilityHash: 'c'.repeat(64), releaseHash: row.runtimeSourceHash } } : {}) },
    runtimeBindingHash: 'd'.repeat(64), permissions: { contextSourceKeys: ['storyCore'], writeTargets: [] },
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1, maxOutputTokens: 1, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'output', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'fixture-only', criterionIds: ['output'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } }
  let snapshot = await createAgentRunV1({ scope, ...(instance ? { productRuntimeSessionId: sessionId } : {}), contract })
  const owner = instance ? { productRuntimeSessionId: sessionId } : {}
  snapshot = await appendAgentRunEventV1({ scope, ...owner, runId: snapshot.run.id, type: 'step.scheduled', payload: { stepId: 'fixture' }, expectedLastSequence: snapshot.projection.lastSequence })
  snapshot = await appendAgentRunEventV1({ scope, ...owner, runId: snapshot.run.id, type: 'step.started', payload: { stepId: 'fixture', attempt: 1 }, expectedLastSequence: snapshot.projection.lastSequence })
  const saved = await createAgentRunCheckpointV1({ scope, ...owner, runId: snapshot.run.id, resumePayload: { note: 'original bookkeeping only' }, expectedLastSequence: snapshot.projection.lastSequence })
  const paused = await appendAgentRunEventV1({ scope, ...owner, runId: snapshot.run.id, type: 'run.paused',
    payload: { reason: 'isolated checkpoint recovery fixture', recoverable: true }, expectedLastSequence: saved.snapshot.projection.lastSequence })
  return { scope, sessionId, row, owner, saved, paused, runId: snapshot.run.id }
}
describe('R-HARNESS-RUNTIME3 explicit Instance checkpoint verification and recovery', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('verifies the actual Instance checkpoint and resumes the same original Run with the existing hash and events', async () => {
    const s = await fixture()
    expect(await verifyAgentRunCheckpointV1(s.scope, s.saved.checkpoint.id, s.owner)).toBe(true)
    expect((await readLatestVerifiedAgentRunCheckpointV1(s.scope, s.runId, { owner: 'instance' }))!.checkpoint.checkpointHash).toBe(s.saved.checkpoint.checkpointHash)
    const recovery = await beginAgentRunRecoveryV1({ scope: s.scope, runId: s.runId, ...s.owner, expectedLastSequence: s.paused.projection.lastSequence })
    expect(recovery.snapshot.projection.state).toBe('recovering')
    const completed = await completeAgentRunRecoveryV1({ scope: s.scope, runId: s.runId, ...s.owner,
      checkpointHash: recovery.checkpointHash, expectedLastSequence: recovery.snapshot.projection.lastSequence })
    expect(completed.projection.state).toBe('running'); expect(completed.run.contractHash).toBe(s.paused.run.contractHash)
    expect(completed.run.contractJson).toBe(s.paused.run.contractJson)
    expect(completed.events.filter(e => e.type === 'model.requested')).toHaveLength(0)
    expect(await db.agentRuns.count()).toBe(1)
  })
  it('rejects an incorrect explicit Instance owner without writing recovery events or changing the checkpoint', async () => {
    const s = await fixture(), wrongId = await db.productRuntimeSessions.add({ ...s.row, id: undefined, title: 'another instance' }) as number
    const before = await db.agentRunEvents.count()
    expect(await verifyAgentRunCheckpointV1(s.scope, s.saved.checkpoint.id, { productRuntimeSessionId: wrongId })).toBe(false)
    await expect(beginAgentRunRecoveryV1({ scope: s.scope, runId: s.runId, productRuntimeSessionId: wrongId })).rejects.toMatchObject({ code: 'checkpoint_scope' })
    expect(await db.agentRunEvents.count()).toBe(before)
    const started = await beginAgentRunRecoveryV1({ scope: s.scope, runId: s.runId, ...s.owner })
    await expect(completeAgentRunRecoveryV1({ scope: s.scope, runId: s.runId, productRuntimeSessionId: wrongId,
      checkpointHash: started.checkpointHash })).rejects.toMatchObject({ code: 'checkpoint_scope' })
    expect((await readInstanceAgentRunV1(s.scope, s.runId)).projection.lastSequence).toBe(started.snapshot.projection.lastSequence)
  })
  it('keeps exact payload verification and rejects corrupt Instance evidence before any recovery start', async () => {
    const s = await fixture(), before = await db.agentRunEvents.count()
    await db.agentRunCheckpoints.update(s.saved.checkpoint.id, { resumePayloadJson: '{"note":"changed"}' })
    expect(await verifyAgentRunCheckpointV1(s.scope, s.saved.checkpoint.id, s.owner)).toBe(false)
    await expect(beginAgentRunRecoveryV1({ scope: s.scope, runId: s.runId, ...s.owner })).rejects.toMatchObject({ code: 'checkpoint_resume_hash' })
    expect(await db.agentRunEvents.count()).toBe(before)
  })
  it('does not recreate a deleted Instance owner or write a half recovery', async () => {
    const s = await fixture(), before = await db.agentRunEvents.count()
    await db.productRuntimeSessions.delete(s.sessionId)
    await expect(beginAgentRunRecoveryV1({ scope: s.scope, runId: s.runId, ...s.owner })).rejects.toThrow()
    expect(await db.agentRunEvents.count()).toBe(before); expect(await db.productRuntimeSessions.count()).toBe(0)
  })
  it('preserves default Work-owned behavior inside the original transaction table set without requiring a runtime table', async () => {
    const s = await fixture(false), tables = scopeTransactionTables(db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints)
    await db.transaction('rw', tables, async () => {
      expect(await verifyAgentRunCheckpointV1(s.scope, s.saved.checkpoint.id)).toBe(true)
      const started = await beginAgentRunRecoveryV1({ scope: s.scope, runId: s.runId })
      const done = await completeAgentRunRecoveryV1({ scope: s.scope, runId: s.runId, checkpointHash: started.checkpointHash })
      expect(done.projection.state).toBe('running'); expect(done.run.contractHash).toBe(s.paused.run.contractHash)
    })
  })
})

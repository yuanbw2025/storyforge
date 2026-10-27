import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as contracts from '../../src/lib/agent/run/contract'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import type { ProductRuntimeSession } from '../../src/lib/types'

// An isolated owner-row fixture exercises the generic ledger precondition.
// It does not claim a valid product release/gameplay path or invoke any model.
async function fixture() {
  const { scope } = await seedCurrentWorkspace('generic instance creation snapshot')
  const row: ProductRuntimeSession = { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    worldGroupId: null, productReleaseId: null, productBuildId: 1, runtimeSourceHash: 'a'.repeat(64),
    kind: 'text-adventure', title: 'isolated ledger owner', status: 'active', rulesetVersion: 1, seed: 'fixture',
    canonSnapshotJson: '{}', initialStateJson: '{}', runtimeHeadSequence: 0, runtimeHeadStateJson: '{}', runtimeHeadStateHash: 'b'.repeat(64),
    parentSessionId: null, parentThroughSequence: null, createdAt: 1, updatedAt: 1 }
  const sessionId = await db.productRuntimeSessions.add(row) as number
  const session = (await db.productRuntimeSessions.get(sessionId))!
  const contract = { version: 1, objective: 'isolated generic creation bookkeeping', workflowKind: 'direct-generation',
    scope: { projectId: scope.projectId, worldGroupId: null, runtime: { productRuntimeSessionId: sessionId,
      baseSequence: 0, stateHash: 'b'.repeat(64), visibilityHash: 'c'.repeat(64), releaseHash: row.runtimeSourceHash } },
    permissions: { contextSourceKeys: ['storyCore'], writeTargets: [] }, runtimeBindingHash: 'd'.repeat(64),
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1, maxOutputTokens: 1, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'output', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'fixture-only', criterionIds: ['output'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } }
  return { scope, sessionId, session, contract, expected: await hashCanonicalValue(session) }
}
describe('R-HARNESS-RUNTIME2 generic atomic owner-row creation precondition', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('accepts the exact row while leaving legacy contract bytes/hashes and omitted-call behavior unchanged', async () => {
    const s = await fixture(), input = { scope: s.scope, productRuntimeSessionId: s.sessionId, contract: s.contract }
    const legacy = await createAgentRunV1(input), guarded = await createAgentRunV1({ ...input, expectedRuntimeSessionHash: s.expected })
    expect(guarded.run.contractHash).toBe(legacy.run.contractHash); expect(guarded.run.contractJson).toBe(legacy.run.contractJson)
    expect(guarded.run.contractJson).not.toContain('expectedRuntimeSessionHash')
    expect(guarded.events.map(e => e.type)).toEqual(['run.created', 'contract.accepted'])
  })
  it('rejects a changed owner row without leaving a Run or any events', async () => {
    const s = await fixture()
    await db.productRuntimeSessions.update(s.sessionId, { updatedAt: 2, runtimeHeadSequence: 1 })
    await expect(createAgentRunV1({ scope: s.scope, productRuntimeSessionId: s.sessionId, contract: s.contract,
      expectedRuntimeSessionHash: s.expected })).rejects.toMatchObject({ code: 'runtime_snapshot_stale' })
    expect(await db.agentRuns.count()).toBe(0); expect(await db.agentRunEvents.count()).toBe(0)
  })
  it('captures the clicked expected hash before asynchronous contract acceptance instead of accepting a later caller edit', async () => {
    const s = await fixture(), accept = contracts.acceptAgentRunContract
    const input = { scope: s.scope, productRuntimeSessionId: s.sessionId, contract: s.contract, expectedRuntimeSessionHash: s.expected }
    vi.spyOn(contracts, 'acceptAgentRunContract').mockImplementation(async value => {
      await db.productRuntimeSessions.update(s.sessionId, { updatedAt: 2 })
      input.expectedRuntimeSessionHash = await hashCanonicalValue(await db.productRuntimeSessions.get(s.sessionId))
      return accept(value)
    })
    await expect(createAgentRunV1(input)).rejects.toMatchObject({ code: 'runtime_snapshot_stale' })
    expect(await db.agentRuns.count()).toBe(0); expect(await db.agentRunEvents.count()).toBe(0)
  })
  it('rejects malformed or Work-owned preconditions before writing any ledger', async () => {
    const s = await fixture()
    await expect(createAgentRunV1({ scope: s.scope, productRuntimeSessionId: s.sessionId, contract: s.contract,
      expectedRuntimeSessionHash: 'invalid' })).rejects.toMatchObject({ code: 'runtime_snapshot_precondition' })
    await expect(createAgentRunV1({ scope: s.scope, contract: s.contract,
      expectedRuntimeSessionHash: s.expected })).rejects.toMatchObject({ code: 'runtime_snapshot_precondition' })
    expect(await db.agentRuns.count()).toBe(0); expect(await db.agentRunEvents.count()).toBe(0)
  })
  it('a deleted instance cannot be silently recreated through a valid old snapshot hash', async () => {
    const s = await fixture(); await db.productRuntimeSessions.delete(s.sessionId)
    await expect(createAgentRunV1({ scope: s.scope, productRuntimeSessionId: s.sessionId, contract: s.contract,
      expectedRuntimeSessionHash: s.expected })).rejects.toMatchObject({ code: 'instance_scope' })
    expect(await db.agentRuns.count()).toBe(0); expect(await db.agentRunEvents.count()).toBe(0)
  })
})

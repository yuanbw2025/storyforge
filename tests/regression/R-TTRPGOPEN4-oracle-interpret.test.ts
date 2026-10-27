import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, consultTtrpgOracleV1, changeTtrpgSafetyStatus, commitTtrpgOpenOracleCandidateFactV1, completeTtrpgOpenSessionZeroV1, retireTtrpgOpenSessionFactV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, readProductRuntimeStateVersion, branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { generateTtrpgOpenOracleCandidateV1, executeTtrpgOpenOracleRequestV1, executeTtrpgOpenIntentRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readTtrpgOpenOracleCandidateV1, verifyTtrpgOpenOracleCandidateProofV1 } from '../../src/lib/ttrpg/open-oracle-candidate'
import { prepareTtrpgOpenOracleInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import * as oracleAdoption from '../../src/lib/ttrpg/open-oracle-adoption'
import * as runStore from '../../src/lib/agent/run/event-store'
import * as artifactStore from '../../src/lib/memory/artifact-store'

const fact = { kind: 'relation', subjectRef: 'keeper', predicateKey: 'knows', objectRef: 'harbor', canonicalValue: true,
  detail: '守灯人知道港口当前状况。', sourceFactRefs: ['fact.harbor'], audience: 'party',
  knownByActorKeys: ['hero', 'companion.1', 'companion.2'], supersedes: null, supersedeReason: null }
const output = JSON.stringify({ interpretation: '守灯人可以讲述码头当前状况，原始 Oracle 结果保持不变。', facts: [fact] })
async function setup() {
  const fixture = await readyOpenTtrpgSessionV1('Oracle interpretation candidate', pkg => {
    pkg.ttrpg!.campaign.runtimePolicy.enabled = true
  })
  const rawInput = '解释本次守灯人咨询'
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'continue-host', rawInput })
  await consultTtrpgOracleV1({ ...await openEnvelopeV1(fixture.sessionId, 'oracle'), viewerKey: OPEN_HUMAN_VIEWER,
    askedBy: 'player:hero', oracleKey: 'oracle.yes', question: '守灯人知道港口当前状况吗？', likelihoodTierKey: 'even' })
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(fixture.sessionId)).ttrpg)!
  const input = { ...await openEnvelopeV1(fixture.sessionId, 'interpret'), scope: fixture.scope, viewerKey: OPEN_HUMAN_VIEWER,
    rawInput, oracleSourceRef: runtime.openRun!.oracleReceipts![0].sourceRef, maximumOutputTokens: 1000, maximumCostUsd: 0.2 }
  const resume = (prepared: { runId: number; requestKey: string }) => ({ scope: fixture.scope, sessionId: fixture.sessionId,
    viewerKey: OPEN_HUMAN_VIEWER, ...prepared })
  return { fixture, input, resume }
}
describe('R-TTRPGOPEN4 governed Oracle interpretation and retained candidate evidence', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('persists exact raw text and a read-only candidate, restores it without checkpoint or another send', async () => {
    const { fixture, input, resume } = await setup(), before = await readProductRuntimeState(fixture.sessionId)
    const runAI = vi.fn(async () => output)
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...input, runAI })
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(generated.candidate.artifact.status).toBe('usable-with-warnings')
    expect(generated.candidate.facts).toEqual([fact])
    expect(await readAgentRunArtifactExactV1({ projectId: fixture.scope.projectId, artifactKind: 'raw-response',
      contentHash: generated.candidate.rawResponseHash })).toBe(output)
    const after = await readProductRuntimeState(fixture.sessionId)
    expect(after.entities).toEqual(before.entities)
    expect(after.ttrpg!.openRun!.oracleReceipts).toEqual(before.ttrpg!.openRun!.oracleReceipts)
    expect(after.ttrpg!.openRun!.factLedger).toBeUndefined()
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    await db.agentRunCheckpoints.where('runId').equals(generated.prepared.runId).delete()
    db.close(); await db.open()
    expect(await readTtrpgOpenOracleCandidateV1(resume(generated.prepared))).toEqual(generated.candidate)
    expect((await verifyTtrpgOpenOracleCandidateProofV1({ ...resume(generated.prepared), candidateHash: generated.candidate.candidateHash })).candidate).toEqual(generated.candidate)
    expect(await executeTtrpgOpenOracleRequestV1({ ...resume(generated.prepared), runAI })).toEqual({ status: 'not-sent' })
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it.each(['not-json', JSON.stringify({ interpretation: '替玩家承诺', facts: [{ ...fact, subjectRef: 'hero', predicateKey: 'promised' }] }),
    JSON.stringify({ interpretation: '泄露秘密', facts: [{ ...fact, sourceFactRefs: ['secret.unread'] }] }),
    JSON.stringify({ interpretation: '修改规则', facts: [fact], rawResult: 'yes' })])('keeps invalid output for manual repair and never silently retries (%s)', async raw => {
    const { fixture, input } = await setup(), runAI = vi.fn(async () => raw)
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...input, runAI })
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(generated.candidate.artifact.status).toBe('manual-repair')
    expect(generated.candidate.facts).toBeNull()
    expect(generated.candidate.artifact.originalText).toBe(raw)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.factLedger).toBeUndefined()
  })
  it('blocks a charged candidate if human safety authorization changes during the response', async () => {
    const { fixture, input } = await setup()
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...input, runAI: async (_messages, _signal, receipt) => {
      await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'pause'), status: 'paused',
        reason: '暂停咨询', changedBy: 'hero', viewerKey: OPEN_HUMAN_VIEWER })
      receipt.usage = { inputTokens: 2200, outputTokens: 100, totalTokens: 2300 }
      return output
    } })
    expect(generated.candidate.artifact.status).toBe('blocked')
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0]).toMatchObject({ status: 'succeeded',
      usage: { source: 'provider', inputTokens: 2200, outputTokens: 100, actualCostUsd: null } })
  })
  it('prevents a wrong purpose or competing executor from dispatching another request', async () => {
    const { input, resume } = await setup()
    const prepared = await prepareTtrpgOpenOracleInputV1({ ...input, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const runAI = vi.fn(async () => output)
    await expect(executeTtrpgOpenIntentRequestV1({ ...resume(prepared), runAI })).rejects.toThrow(/目的不一致/)
    expect(runAI).not.toHaveBeenCalled()
    const results = await Promise.all([executeTtrpgOpenOracleRequestV1({ ...resume(prepared), runAI }), executeTtrpgOpenOracleRequestV1({ ...resume(prepared), runAI })])
    expect(results.map(result => result.status).sort()).toEqual(['candidate', 'not-sent'])
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('holds unknown transport results and terminates the Run without a hidden resend', async () => {
    const { fixture, input, resume } = await setup(), runAI = vi.fn(async () => { throw new Error('simulated Oracle interruption') })
    await expect(generateTtrpgOpenOracleCandidateV1({ ...input, runAI })).rejects.toThrow(/interruption/)
    const call = (await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0], run = await db.agentRuns.toCollection().first()
    expect(call.status).toBe('unknown')
    expect((await readInstanceAgentRunV1(fixture.scope, run!.id!)).projection.state).toBe('failed')
    expect(await executeTtrpgOpenOracleRequestV1({ ...resume({ runId: run!.id!, requestKey: call.requestKey }), runAI })).toEqual({ status: 'not-sent' })
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('confirms only the selected real candidate through the human owner and preserves one immutable fact receipt', async () => {
    const { fixture, input } = await setup(), runAI = vi.fn(async () => output)
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...input, runAI })
    const confirm = { ...await openEnvelopeV1(fixture.sessionId, 'confirm'), viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey,
      candidateHash: generated.candidate.candidateHash, proposalIndex: 0, decision: 'assert' as const }
    await expect(commitTtrpgOpenOracleCandidateFactV1({ ...confirm, candidateHash: 'b'.repeat(64) })).rejects.toThrow(/真实候选/)
    const event = await commitTtrpgOpenOracleCandidateFactV1(confirm)
    expect(event.actorKey).toBe('hero')
    expect(await commitTtrpgOpenOracleCandidateFactV1({ ...confirm, ...await openEnvelopeV1(fixture.sessionId, 'another.button') })).toEqual(event)
    const ledger = (await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.factLedger!
    expect(ledger.entries).toHaveLength(1)
    expect(ledger.entries[0].modelCandidate).toMatchObject({ candidateHash: generated.candidate.candidateHash,
      rawResponseHash: generated.candidate.rawResponseHash, proposalIndex: 0 })
    expect(ledger.entries[0].fact).toMatchObject({ subjectRef: 'keeper', predicateKey: 'knows', layer: 'session', origin: 'oracle' })
    const run = await readInstanceAgentRunV1(fixture.scope, generated.prepared.runId)
    expect(run.projection.state).toBe('completed')
    expect(run.events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
    expect(run.events.filter(event => event.type === 'runtime.candidate.adopted')).toHaveLength(1)
    expect(run.events.some(event => event.type === 'verification.accepted')).toBe(true)
    db.close(); await db.open()
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.factLedger).toEqual(ledger)
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('does not regain its Oracle interpretation slot after a new authorization epoch or reload', async () => {
    const { fixture, input } = await setup(), runAI = vi.fn(async () => output)
    await generateTtrpgOpenOracleCandidateV1({ ...input, runAI })
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'close'), viewerKey: OPEN_HUMAN_VIEWER, reason: 'finished-review',
      epochKey: (await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey! })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'next'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'continue-host', rawInput: input.rawInput })
    db.close(); await db.open()
    await expect(generateTtrpgOpenOracleCandidateV1({ ...input, ...await openEnvelopeV1(fixture.sessionId, 'again'), runAI })).rejects.toThrow(/最多一次/)
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(await db.agentRuns.count()).toBe(1)
  })
  it('keeps an adopted fact and consumed interpretation slot in frozen branch and backup evidence', async () => {
    const { fixture, input } = await setup(), runAI = vi.fn(async () => output)
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...input, runAI })
    await commitTtrpgOpenOracleCandidateFactV1({ ...await openEnvelopeV1(fixture.sessionId, 'fact'), viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash,
      proposalIndex: 0, decision: 'assert' })
    const parent = await readProductRuntimeState(fixture.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: fixture.sessionId,
      throughSequence: (await readProductRuntimeStateVersion(fixture.sessionId)).sequence, title: 'Oracle candidate branch', seed: 'child.oracle.candidate' })
    const childState = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'zero'), viewerKey: OPEN_HUMAN_VIEWER,
      acceptedItemKeys: childState.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.id!, 'epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'continue-host', rawInput: input.rawInput })
    await expect(generateTtrpgOpenOracleCandidateV1({ ...input, ...await openEnvelopeV1(child.id!, 'child.interpret'), runAI })).rejects.toThrow(/最多一次/)
    expect((await readProductRuntimeState(child.id!)).ttrpg!.openRun!.factLedger).toEqual(parent.ttrpg!.openRun!.factLedger)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(parent)
    const importedProjectId = await importProjectJSON(await exportProjectJSON(fixture.scope.projectId))
    const imported = await db.productRuntimeSessions.where('projectId').equals(importedProjectId).toArray()
    const restored = await Promise.all(imported.map(session => readProductRuntimeState(session.id!)))
    expect(restored.every(state => JSON.stringify(state.ttrpg!.openRun!.factLedger) === JSON.stringify(parent.ttrpg!.openRun!.factLedger))).toBe(true)
  })
  it('rejects adoption without the actual retained response artifact', async () => {
    const { fixture, input } = await setup()
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...input, runAI: async () => output })
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
      .equals([fixture.scope.projectId, 'raw-response', generated.candidate.rawResponseHash]).first()
    await db.agentRunArtifacts.delete(row!.id!)
    await expect(commitTtrpgOpenOracleCandidateFactV1({ ...await openEnvelopeV1(fixture.sessionId, 'missing.raw'), viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash,
      proposalIndex: 0, decision: 'assert' })).rejects.toThrow(/artifact|工件|原始/)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.factLedger).toBeUndefined()
  })
  it('recovers after E5 committed but before the terminal journal, without another fact or model call', async () => {
    const { fixture, input, resume } = await setup(), runAI = vi.fn(async () => output)
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...input, runAI })
    const confirm = { ...await openEnvelopeV1(fixture.sessionId, 'confirm'), viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash,
      proposalIndex: 0, decision: 'assert' as const }
    const interrupted = vi.spyOn(oracleAdoption, 'reconcileTtrpgOpenOracleFactRunV1').mockRejectedValueOnce(new Error('simulated receipt interruption'))
    await expect(commitTtrpgOpenOracleCandidateFactV1(confirm)).rejects.toThrow(/interruption/)
    interrupted.mockRestore()
    const committed = await readProductRuntimeState(fixture.sessionId)
    expect(committed.ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
    expect((await readInstanceAgentRunV1(fixture.scope, generated.prepared.runId)).projection.state).toBe('awaiting_confirmation')
    db.close(); await db.open()
    const receipt = await oracleAdoption.reconcileTtrpgOpenOracleFactRunV1({ ...resume(generated.prepared), candidateHash: generated.candidate.candidateHash })
    expect(await oracleAdoption.reconcileTtrpgOpenOracleFactRunV1({ ...resume(generated.prepared), candidateHash: generated.candidate.candidateHash })).toBe(receipt)
    expect((await readInstanceAgentRunV1(fixture.scope, generated.prepared.runId)).projection.terminalReceiptHash).toBe(receipt)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(committed)
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('rejects a paused confirmation and a different human viewer without adopting any fact', async () => {
    const { fixture, input } = await setup()
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...input, runAI: async () => output })
    const confirm = { ...await openEnvelopeV1(fixture.sessionId, 'confirm'), viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash,
      proposalIndex: 0, decision: 'assert' as const }
    await expect(commitTtrpgOpenOracleCandidateFactV1({ ...confirm, viewerKey: 'viewer.unauthorized' })).rejects.toThrow(/无权|授权/)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'pause'), status: 'paused', reason: '停止解释', changedBy: 'hero', viewerKey: OPEN_HUMAN_VIEWER })
    await expect(commitTtrpgOpenOracleCandidateFactV1({ ...confirm, ...await openEnvelopeV1(fixture.sessionId, 'paused.confirm') })).rejects.toThrow(/stale|GM|暂停/)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.factLedger).toBeUndefined()
  })
  it('does not sign a terminal receipt before any real human fact confirmation', async () => {
    const { input, resume } = await setup()
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...input, runAI: async () => output })
    await expect(oracleAdoption.reconcileTtrpgOpenOracleFactRunV1({ ...resume(generated.prepared), candidateHash: generated.candidate.candidateHash })).rejects.toThrow(/真实已确认事实/)
  })
  it.each(['confirmation.recorded', 'runtime-adopted', 'step.succeeded', 'verification.started', 'receipt-artifact', 'verification.accepted'])('resumes terminal evidence after interruption at %s without repeating E5', async checkpoint => {
    const { fixture, input, resume } = await setup()
    let sends = 0
    const runAI = async () => { sends += 1; return output }
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...input, runAI })
    let interrupted = false
    if (checkpoint === 'runtime-adopted') {
      vi.spyOn(runStore, 'appendRuntimeCandidateAdoptedV1').mockRejectedValueOnce(new Error('simulated terminal checkpoint'))
    } else if (checkpoint === 'receipt-artifact') {
      vi.spyOn(artifactStore, 'recordAgentRunArtifactV1').mockRejectedValueOnce(new Error('simulated terminal checkpoint'))
    } else {
      const original = runStore.appendAgentRunEventV1
      vi.spyOn(runStore, 'appendAgentRunEventV1').mockImplementation(async args => {
        if (!interrupted && args.type === checkpoint) { interrupted = true; throw new Error('simulated terminal checkpoint') }
        return original(args)
      })
    }
    await expect(commitTtrpgOpenOracleCandidateFactV1({ ...await openEnvelopeV1(fixture.sessionId, 'confirm'), viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash,
      proposalIndex: 0, decision: 'assert' })).rejects.toThrow(/checkpoint/)
    vi.restoreAllMocks()
    const before = await readProductRuntimeState(fixture.sessionId)
    const receipts = await Promise.all([oracleAdoption.reconcileTtrpgOpenOracleFactRunV1({ ...resume(generated.prepared), candidateHash: generated.candidate.candidateHash }),
      oracleAdoption.reconcileTtrpgOpenOracleFactRunV1({ ...resume(generated.prepared), candidateHash: generated.candidate.candidateHash })])
    expect(receipts[0]).toBe(receipts[1])
    const snapshot = await readInstanceAgentRunV1(fixture.scope, generated.prepared.runId)
    expect(snapshot.projection.state).toBe('completed')
    expect(snapshot.events.filter(event => event.type === 'runtime.candidate.adopted')).toHaveLength(1)
    expect(snapshot.events.filter(event => event.type === 'verification.accepted')).toHaveLength(1)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
    expect(sends).toBe(1)
  })
  it('lets the human AI-GM owner retire its confirmed model fact without resurrecting it on receipt recovery', async () => {
    const { fixture, input, resume } = await setup()
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...input, runAI: async () => output })
    await commitTtrpgOpenOracleCandidateFactV1({ ...await openEnvelopeV1(fixture.sessionId, 'fact'), viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash,
      proposalIndex: 0, decision: 'assert' })
    const factKey = (await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.factLedger!.entries[0].fact.factKey
    const retire = { ...await openEnvelopeV1(fixture.sessionId, 'withdraw'), viewerKey: OPEN_HUMAN_VIEWER, factKey, reason: '撤回这条解释' }
    const event = await retireTtrpgOpenSessionFactV1(retire)
    expect(await retireTtrpgOpenSessionFactV1(retire)).toEqual(event)
    const retired = await readProductRuntimeState(fixture.sessionId)
    await oracleAdoption.reconcileTtrpgOpenOracleFactRunV1({ ...resume(generated.prepared), candidateHash: generated.candidate.candidateHash })
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(retired)
    expect(retired.ttrpg!.openRun!.factLedger!.retirements).toHaveLength(1)
  })
})

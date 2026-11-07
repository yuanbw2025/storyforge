import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { completedAgentRunEvidencePrefixV1, replayAgentRunEventsV1, toAgentRunProjectionBodyV1 } from '../../src/lib/agent/run/projection'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { executeTextOpenWorldActionV1, resumeTextOpenWorldSystemWorkV1 } from '../../src/lib/open-world/action-executor'
import { fingerprintTextOpenWorldCommandV1 } from '../../src/lib/open-world/command-contract'
import { getTextOpenWorldCommandStatusV1 } from '../../src/lib/open-world/commands'
import { applyProductRuntimeEvent, hashProductRuntimeStateV1, readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import type { TextOpenWorldCommandEnvelopeV1 } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import {
  commitInterruptedMappedCommandV1,
  createMappedCommandRecoveryFixtureV1,
  readMappedCommandEventsV1,
} from '../helpers/sfqa072-mapped-command-recovery'

describe('SFQA072 · mapped command retains its original portable authorization during recovery', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it.each(['resume', 'load'] as const)('%s settles the real interrupted command once without another model request', async route => {
    const created = await commitInterruptedMappedCommandV1(route)
    const sessionId = created.session.id!
    const commandId = created.request.commandId
    const before = await readMappedCommandEventsV1(sessionId, commandId)
    expect(before.map(event => event.type)).toEqual(['text-open-world.command.committed'])
    expect(created.envelope.payload.runtimeIntent).toEqual(created.evidence)
    const runEventsBefore = await db.agentRunEvents.toArray()

    if (route === 'resume') {
      await expect(resumeTextOpenWorldSystemWorkV1(sessionId)).resolves.toMatchObject({
        commandId, phase: 'terminal', status: 'succeeded', outcomeCommitted: true,
      })
    } else {
      await useTextOpenWorldPlayerStore.getState().load(created.scope, null, sessionId)
      expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
        selectedSessionId: sessionId, loading: false, error: '',
      })
    }
    const after = await readMappedCommandEventsV1(sessionId, commandId)
    expect(after.filter(event => event.type === 'text-open-world.command.committed')).toEqual(before)
    expect(after.filter(event => event.type === 'text-open-world.effects.applied')).toHaveLength(1)
    expect(created.calls.mapping).toBe(1)
    expect(await db.agentRunEvents.toArray()).toEqual(runEventsBefore)
    const allEvents = await db.productRuntimeEvents.toArray()
    await expect(resumeTextOpenWorldSystemWorkV1(sessionId)).resolves.toBeNull()
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, sessionId)
    expect(useTextOpenWorldPlayerStore.getState().error).toBe('')
    expect(await db.productRuntimeEvents.toArray()).toEqual(allEvents)
    expect(created.calls.mapping).toBe(1)
  }, 45_000)

  it('recovers a real mapped-action proof with its original Action selection', async () => {
    const created = await commitInterruptedMappedCommandV1('action-selection', 'action')
    expect(created.evidence).toMatchObject({ selectedKind: 'action', selectedKey: 'action.accept-main' })
    await expect(resumeTextOpenWorldSystemWorkV1(created.session.id!)).resolves.toMatchObject({
      commandId: created.request.commandId, phase: 'terminal', status: 'succeeded',
    })
    expect((await readMappedCommandEventsV1(created.session.id!, created.request.commandId))
      .filter(event => event.type === 'text-open-world.effects.applied')).toHaveLength(1)
    expect(created.calls.mapping).toBe(1)
  }, 45_000)

  it('official backup import remaps Session and Run IDs while keeping the original evidence and one settlement', async () => {
    const created = await commitInterruptedMappedCommandV1('backup')
    const originalCheckpoints = await db.agentRunCheckpoints.where('runId').equals(created.resolution.runId).sortBy('throughSequence')
    const originalCandidateJson = originalCheckpoints[originalCheckpoints.length - 1]!.resumePayloadJson
    const backup = await exportProjectJSON(created.scope.projectId)
    const backupBytes = JSON.stringify(backup)
    const projectId = await importProjectJSON(backup)
    expect(JSON.stringify(backup)).toBe(backupBytes)
    expect(projectId).not.toBe(created.scope.projectId)
    const session = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    if (!session?.id || session.worldId == null || session.workId == null) throw new Error('导入Session缺少真实owner')
    expect(session.id).not.toBe(created.session.id)
    const run = await db.agentRuns.where('productRuntimeSessionId').equals(session.id).first()
    expect(run?.id).toBeDefined()
    expect(run?.id).not.toBe(created.resolution.runId)
    const scope = { projectId, worldId: session.worldId, workId: session.workId }
    const importedSnapshot = await readInstanceAgentRunV1(scope, run!.id!)
    expect(importedSnapshot.contract.scope.runtime?.productRuntimeSessionId).toBe(session.id)
    expect(importedSnapshot.events[importedSnapshot.events.length - 1]).toMatchObject({
      type: 'verification.staled', payload: { reason: 'project-import-scope-rebound' },
    })
    expect(completedAgentRunEvidencePrefixV1(importedSnapshot.events)?.terminalReceiptHash)
      .toBe(created.evidence.terminalReceiptHash)
    const checkpoints = await db.agentRunCheckpoints.where('runId').equals(run!.id!).sortBy('throughSequence')
    expect(checkpoints[checkpoints.length - 1]!.resumePayloadJson).toBe(originalCandidateJson)
    const frozenCandidate = JSON.parse(originalCandidateJson!) as { runId: number; productRuntimeSessionId: number }
    expect(frozenCandidate).toMatchObject({ runId: created.resolution.runId, productRuntimeSessionId: created.session.id })
    const imported = await getTextOpenWorldCommandStatusV1({ sessionId: session.id, commandId: created.request.commandId })
    if (imported.status !== 'committed') throw new Error('导入后原命令不存在')
    expect(imported.envelope).toEqual({ ...created.envelope, sessionId: session.id })
    expect(imported.receipt.requestFingerprint).toBe(created.commandReceipt.requestFingerprint)
    const commandsBefore = await readMappedCommandEventsV1(session.id, created.request.commandId)
    const runEventsBefore = await db.agentRunEvents.toArray()
    await useTextOpenWorldPlayerStore.getState().load(scope, null, session.id)
    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({ selectedSessionId: session.id, error: '' })
    const after = await readMappedCommandEventsV1(session.id, created.request.commandId)
    expect(after.filter(event => event.type === 'text-open-world.command.committed')).toEqual(commandsBefore)
    expect(after.filter(event => event.type === 'text-open-world.effects.applied')).toHaveLength(1)
    expect((await readProductRuntimeState(session.id)).textOpenWorld?.protocol.pendingCommandId).toBeNull()
    expect(await db.agentRunEvents.toArray()).toEqual(runEventsBefore)
    const eventsAfter = await db.productRuntimeEvents.toArray()
    await expect(resumeTextOpenWorldSystemWorkV1(session.id)).resolves.toBeNull()
    await useTextOpenWorldPlayerStore.getState().load(scope, null, session.id)
    expect(await db.productRuntimeEvents.toArray()).toEqual(eventsAfter)
    // The original remains interrupted; no restore or recovery rewrote its owner.
    expect(await readMappedCommandEventsV1(created.session.id!, created.request.commandId)).toHaveLength(1)
    expect(created.calls.mapping).toBe(1)
  }, 45_000)

  it.each(['mapped-intent', 'fixed-choice'] as const)('uninterrupted %s keeps the existing public path', async source => {
    const created = await createMappedCommandRecoveryFixtureV1(source)
    await expect(executeTextOpenWorldActionV1({
      ...created.request, source,
      runtimeIntentAuthorization: source === 'mapped-intent' ? created.request.runtimeIntentAuthorization : undefined,
    })).resolves.toMatchObject({ phase: 'terminal', status: 'succeeded', outcomeCommitted: true })
    expect(created.calls.mapping).toBe(1)
    const events = await db.productRuntimeEvents.toArray()
    await expect(resumeTextOpenWorldSystemWorkV1(created.session.id!)).resolves.toBeNull()
    expect(await db.productRuntimeEvents.toArray()).toEqual(events)
  }, 45_000)

  const tampering: Array<[string, (envelope: TextOpenWorldCommandEnvelopeV1) => void]> = [
    ['missing evidence', envelope => { delete envelope.payload.runtimeIntent }],
    ['null evidence', envelope => { envelope.payload.runtimeIntent = null }],
    ['forged schema', envelope => { evidence(envelope).schema = 'forged' }],
    ['unsupported version', envelope => { evidence(envelope).version = 2 }],
    ['invalid hash', envelope => { evidence(envelope).candidateHash = 'forged' }],
    ['well-formed altered candidate hash', envelope => { evidence(envelope).candidateHash = 'a'.repeat(64) }],
    ['well-formed altered context hash', envelope => { evidence(envelope).contextManifestHash = 'b'.repeat(64) }],
    ['well-formed altered terminal hash', envelope => { evidence(envelope).terminalReceiptHash = 'c'.repeat(64) }],
    ['local Run ID inserted', envelope => { evidence(envelope).runId = 1 }],
    ['wrong selected kind', envelope => { evidence(envelope).selectedKind = 'arbitrary' }],
    ['action selection does not name Action', envelope => { evidence(envelope).selectedKind = 'action' }],
    ['unknown Choice', envelope => { evidence(envelope).selectedKey = 'choice.not-in-release' }],
    ['wrong Action', envelope => { evidence(envelope).actionKey = 'action.steal-tonic' }],
    ['wrong target', envelope => { evidence(envelope).targetKey = 'actor.caretaker' }],
    ['wrong source', envelope => { envelope.source = 'fixed-choice' }],
    ['wrong Actor', envelope => { envelope.actorKey = 'system' }],
    ['unexpected payload', envelope => { envelope.payload.unregistered = true }],
  ]
  it.each(tampering)('rejects %s without rewriting history or settling an effect', async (_label, mutate) => {
    const created = await commitInterruptedMappedCommandV1('tamper')
    const events = await readMappedCommandEventsV1(created.session.id!, created.request.commandId)
    const event = events[0]!
    const payload = JSON.parse(event.payloadJson) as { envelope: TextOpenWorldCommandEnvelopeV1 }
    mutate(payload.envelope)
    await db.productRuntimeEvents.update(event.id!, { payloadJson: JSON.stringify(payload) })
    const before = await db.productRuntimeEvents.toArray()
    await expect(resumeTextOpenWorldSystemWorkV1(created.session.id!)).rejects.toThrow(/待结算命令|正式命令事件/)
    expect(await db.productRuntimeEvents.toArray()).toEqual(before)
    expect(created.calls.mapping).toBe(1)
  }, 45_000)

  it('rejects forged portable hashes even when the attacker recomputes the command fingerprint', async () => {
    const created = await commitInterruptedMappedCommandV1('recomputed-forgery')
    const [event] = await readMappedCommandEventsV1(created.session.id!, created.request.commandId)
    const payload = JSON.parse(event!.payloadJson) as {
      envelope: TextOpenWorldCommandEnvelopeV1; requestFingerprint: string
    }
    evidence(payload.envelope).candidateHash = 'd'.repeat(64)
    evidence(payload.envelope).contextManifestHash = 'e'.repeat(64)
    evidence(payload.envelope).terminalReceiptHash = 'f'.repeat(64)
    payload.requestFingerprint = await fingerprintTextOpenWorldCommandV1(payload.envelope)
    await db.productRuntimeEvents.update(event!.id!, { payloadJson: JSON.stringify(payload) })
    const before = await db.productRuntimeEvents.toArray()
    await expect(resumeTextOpenWorldSystemWorkV1(created.session.id!)).rejects.toThrow(/AI意图原始授权账本缺失/)
    expect(await db.productRuntimeEvents.toArray()).toEqual(before)
    expect(created.calls.mapping).toBe(1)
  }, 45_000)

  it.each(['candidateHash', 'contextManifestHash', 'terminalReceiptHash'] as const)('rejects recomputed %s against the actual original ledger', async field => {
    const created = await commitInterruptedMappedCommandV1(field)
    const [event] = await readMappedCommandEventsV1(created.session.id!, created.request.commandId)
    const payload = JSON.parse(event!.payloadJson) as { envelope: TextOpenWorldCommandEnvelopeV1; requestFingerprint: string }
    evidence(payload.envelope)[field] = 'd'.repeat(64)
    payload.requestFingerprint = await fingerprintTextOpenWorldCommandV1(payload.envelope)
    await db.productRuntimeEvents.update(event!.id!, { payloadJson: JSON.stringify(payload) })
    const before = await db.productRuntimeEvents.toArray()
    await expect(resumeTextOpenWorldSystemWorkV1(created.session.id!)).rejects.toThrow(/AI意图原始授权账本(缺失|不匹配)/)
    expect(await db.productRuntimeEvents.toArray()).toEqual(before)
    expect(created.calls.mapping).toBe(1)
  }, 45_000)

  it.each(['missing Run', 'missing checkpoint', 'different real Session owner'] as const)('rejects %s without manufacturing replacement authorization', async fault => {
    const created = await commitInterruptedMappedCommandV1(fault)
    if (fault === 'missing Run') await db.agentRuns.delete(created.resolution.runId)
    else if (fault === 'missing checkpoint') await db.agentRunCheckpoints.where('runId').equals(created.resolution.runId).delete()
    else {
      const other = await createTextOpenWorldInstance({
        scope: created.scope, productReleaseId: created.release.id!, title: '另一真实Session', seed: 'sfqa072-other-owner',
      })
      expect(other.id).not.toBe(created.session.id)
      await db.agentRuns.update(created.resolution.runId, { productRuntimeSessionId: other.id! })
    }
    const before = await db.productRuntimeEvents.toArray()
    await expect(resumeTextOpenWorldSystemWorkV1(created.session.id!)).rejects.toThrow(/AI意图原始授权账本缺失/)
    expect(await db.productRuntimeEvents.toArray()).toEqual(before)
    expect(created.calls.mapping).toBe(1)
  }, 45_000)

  it('rejects a genuinely replayable but unfinished Harness prefix', async () => {
    const created = await commitInterruptedMappedCommandV1('unfinished')
    const snapshot = await readInstanceAgentRunV1(created.scope, created.resolution.runId)
    const accepted = snapshot.events.find(event => event.type === 'verification.accepted')!
    const prefix = snapshot.events.filter(event => event.sequence < accepted.sequence)
    const projection = replayAgentRunEventsV1(prefix)
    expect(projection.errors).toEqual([])
    expect(projection.state).toBe('verifying')
    const body = toAgentRunProjectionBodyV1(projection)
    // Fault injection keeps a real, internally consistent incomplete prefix;
    // a failed JSON/hash parse cannot be mistaken for the authorization check.
    await db.agentRunEvents.where('runId').equals(created.resolution.runId)
      .filter(event => event.sequence >= accepted.sequence).delete()
    await db.agentRuns.update(created.resolution.runId, {
      status: projection.state, generation: projection.generation, lastSequence: projection.lastSequence,
      terminalReceiptHash: null, projectionJson: canonicalStringify(body), projectionHash: await hashCanonicalValue(body),
    })
    const reread = await readInstanceAgentRunV1(created.scope, created.resolution.runId)
    expect(reread.projection.state).toBe('verifying')
    const before = await db.productRuntimeEvents.toArray()
    await expect(resumeTextOpenWorldSystemWorkV1(created.session.id!)).rejects.toThrow(/AI意图原始授权账本不匹配/)
    expect(await db.productRuntimeEvents.toArray()).toEqual(before)
    expect(created.calls.mapping).toBe(1)
  }, 45_000)

  it.each(['base state', 'candidate selection', 'target'] as const)('binds %s to the original candidate even with a recomputed fingerprint', async fault => {
    const created = await commitInterruptedMappedCommandV1(fault)
    const [event] = await readMappedCommandEventsV1(created.session.id!, created.request.commandId)
    const payload = JSON.parse(event!.payloadJson) as {
      envelope: TextOpenWorldCommandEnvelopeV1; requestFingerprint: string; resultingStateHash: string
    }
    if (fault === 'base state') payload.envelope.baseStateHash = 'd'.repeat(64)
    else if (fault === 'candidate selection') {
      evidence(payload.envelope).selectedKind = 'action'
      evidence(payload.envelope).selectedKey = payload.envelope.actionKey
    } else {
      payload.envelope.payload.targetKey = 'actor.caretaker'
      evidence(payload.envelope).targetKey = 'actor.caretaker'
    }
    payload.requestFingerprint = await fingerprintTextOpenWorldCommandV1(payload.envelope)
    if (fault === 'target') {
      // Also keep the forged cache/result hash consistent, so this case must
      // reach the original candidate's target check rather than fail parsing.
      const base = await readProductRuntimeState(created.session.id!, payload.envelope.baseSequence)
      const next = applyProductRuntimeEvent(base, { ...event!, payloadJson: JSON.stringify(payload) })
      payload.resultingStateHash = await hashProductRuntimeStateV1(next)
      await db.productRuntimeSessions.update(created.session.id!, {
        runtimeHeadStateJson: JSON.stringify(next), runtimeHeadStateHash: payload.resultingStateHash,
      })
    }
    await db.productRuntimeEvents.update(event!.id!, {
      payloadJson: JSON.stringify(payload), baseStateHash: payload.envelope.baseStateHash,
    })
    const before = await db.productRuntimeEvents.toArray()
    await expect(resumeTextOpenWorldSystemWorkV1(created.session.id!)).rejects.toThrow(/AI意图原始授权账本不匹配|AI意图目标不属于原候选/)
    expect(await db.productRuntimeEvents.toArray()).toEqual(before)
    expect(created.calls.mapping).toBe(1)
  }, 45_000)
})

function evidence(envelope: TextOpenWorldCommandEnvelopeV1): Record<string, unknown> {
  return envelope.payload.runtimeIntent as Record<string, unknown>
}

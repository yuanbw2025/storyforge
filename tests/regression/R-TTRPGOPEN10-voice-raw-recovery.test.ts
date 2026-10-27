import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupLocalVoiceExecutionV1 } from '../helpers/open-local-voice'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenLocalVoiceExecutionV1, recoverTtrpgOpenLocalVoiceRawV1, stopTtrpgOpenLocalVoiceJobV1 } from '../../src/lib/ttrpg/open-audio-service'
import { TTRPG_OPEN_VOICE_CONTROL_SCHEMA_V1, dispatchTtrpgOpenLocalVoiceForKernelV1, readTtrpgOpenVoiceExecutionControlsForKernelV1 } from '../../src/lib/ttrpg/open-voice-execution'
import * as ledger from '../../src/lib/agent/run/event-store'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as builder from '../../src/lib/ttrpg/open-voice-execution-input'
import * as assembly from '../../src/lib/registry/assemble-context'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import profile from '../../scripts/ttrpg-local-tts/product-profile.json'

// Deliberately not valid audio/JSON: raw retention must precede candidate parsing.
const raw = '\uFEFF  original unknown return\n编号零零一。\n'
async function fixture() {
  const s = await setupLocalVoiceExecutionV1(), prepared = await prepareTtrpgOpenLocalVoiceExecutionV1(s.input)
  const execute = vi.fn(async () => { throw new Error('unknown-original-return') })
  await expect(dispatchTtrpgOpenLocalVoiceForKernelV1({ ...s.input, decision: 'dispatch-this-original-local-voice-execution',
    transport: { kind: 'local-offline-speech-v1', profileHash: prepared.profileHash, execute } })).rejects.toThrow('unknown-original-return')
  return { ...s, prepared, execute, request: { ...s.input, decision: 'recover-this-original-local-voice-raw-without-resending' as const },
    execution: { scope: s.owner.scope, sessionId: s.owner.sessionId, runId: prepared.runId, inputArtifactHash: prepared.inputArtifactHash } }
}
function mockRaw(content = raw) {
  const calls = vi.fn(async (url: string, init: RequestInit) => {
    expect(url.endsWith('/recover-raw')).toBe(true); expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'recover-original-complete-raw-without-resending', inputArtifactHash: url.split('/').at(-2)!.split('.').at(-1) })
    return new Response(content, { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', calls); return calls
}
async function assertOriginalOnly(s: Awaited<ReturnType<typeof fixture>>) {
  const current = await ledger.readInstanceAgentRunV1(s.owner.scope, s.prepared.runId)
  expect(current.events.filter(e => e.type === 'model.requested')).toHaveLength(1)
  expect(current.events.filter(e => e.type === 'model.responded')).toHaveLength(1)
  expect(current.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')).toHaveLength(1)
  expect(await db.agentRuns.count()).toBe(2); expect(s.execute).toHaveBeenCalledTimes(1)
  expect(await db.productMediaAssets.count()).toBe(0)
  expect(current.events.filter(e => e.type === 'candidate.persisted')).toHaveLength(0)
  return current
}
describe('R-TTRPGOPEN10 explicit same-original raw recovery', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
  it('recovers paused bookkeeping with exact raw bytes, one durable barrier, unchanged quota/game state, and no parsing, model or adoption', async () => {
    const s = await fixture(), before = await readProductRuntimeState(s.owner.sessionId), calls = mockRaw()
    const result = await recoverTtrpgOpenLocalVoiceRawV1(s.request)
    expect(result).toMatchObject({ status: 'raw-response-recorded', runId: s.prepared.runId, responseArtifactHash: await sha256Text(raw),
      runState: 'running', retrievedFromLocalJob: true, candidateAccepted: false, adoptionAllowed: false, automaticRetryAllowed: false })
    expect(await artifacts.readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId, artifactKind: 'raw-response', contentHash: result.responseArtifactHash })).toBe(raw)
    const current = await assertOriginalOnly(s)
    expect(current.events.filter(e => e.type === 'recovery.started')).toHaveLength(1)
    expect(current.events.filter(e => e.type === 'recovery.completed')).toHaveLength(1)
    expect(await db.agentRunCheckpoints.count()).toBe(1)
    expect(await readProductRuntimeState(s.owner.sessionId)).toEqual(before)
    db.close(); await db.open()
    expect(await recoverTtrpgOpenLocalVoiceRawV1(s.request)).toMatchObject({ responseArtifactHash: result.responseArtifactHash, retrievedFromLocalJob: false })
    expect(calls).toHaveBeenCalledTimes(1); await assertOriginalOnly(s)
    expect(await db.agentRunEvents.where('runId').equals(s.prepared.runId).count()).toBe(current.events.length)
  })
  it.each(['checkpoint','begin','complete','raw','responded'] as const)('resumes the original ledger after a real committed %s return is lost', async boundary => {
    const s = await fixture(), calls = mockRaw()
    if (boundary === 'checkpoint') {
      const original = checkpoints.createAgentRunCheckpointV1
      vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockImplementationOnce(async input => { await original(input); throw new Error('lost-raw-return') })
    } else if (boundary === 'begin') {
      const original = checkpoints.beginAgentRunRecoveryV1
      vi.spyOn(checkpoints, 'beginAgentRunRecoveryV1').mockImplementationOnce(async input => { await original(input); throw new Error('lost-raw-return') })
    } else if (boundary === 'complete') {
      const original = checkpoints.completeAgentRunRecoveryV1
      vi.spyOn(checkpoints, 'completeAgentRunRecoveryV1').mockImplementationOnce(async input => { await original(input); throw new Error('lost-raw-return') })
    } else if (boundary === 'raw') {
      const original = artifacts.recordAgentRunArtifactV1
      vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementationOnce(async input => { await original(input); throw new Error('lost-raw-return') })
    } else {
      const original = ledger.appendAgentRunEventV1
      vi.spyOn(ledger, 'appendAgentRunEventV1').mockImplementationOnce(async input => { await original(input); throw new Error('lost-raw-return') })
    }
    await expect(recoverTtrpgOpenLocalVoiceRawV1(s.request)).rejects.toThrow('lost-raw-return')
    await recoverTtrpgOpenLocalVoiceRawV1(s.request)
    const current = await assertOriginalOnly(s)
    expect(await db.agentRunCheckpoints.count()).toBe(1)
    for (const type of ['recovery.started','recovery.completed']) expect(current.events.filter(e => e.type === type)).toHaveLength(1)
    expect(calls).toHaveBeenCalledTimes(boundary === 'raw' || boundary === 'responded' ? 1 : 2)
  })
  it('concurrent explicit recoveries retain one raw artifact, checkpoint and response event', async () => {
    const s = await fixture(), calls = mockRaw()
    const results = await Promise.all([recoverTtrpgOpenLocalVoiceRawV1(s.request),recoverTtrpgOpenLocalVoiceRawV1(s.request)])
    expect(results.every(r => r.responseArtifactHash === results[0].responseArtifactHash)).toBe(true)
    await assertOriginalOnly(s); expect(await db.agentRunCheckpoints.count()).toBe(1); expect(calls).toHaveBeenCalledTimes(2)
  })
  it('keeps an unknown HTTP response unknown, without retrying or creating a checkpoint; an explicit retry fetches only the same job', async () => {
    const s = await fixture(), calls = mockRaw(); calls.mockRejectedValueOnce(new Error('lost-local-raw-http'))
    await expect(recoverTtrpgOpenLocalVoiceRawV1(s.request)).rejects.toThrow('lost-local-raw-http')
    expect(calls).toHaveBeenCalledTimes(1); expect(await db.agentRunCheckpoints.count()).toBe(0)
    await recoverTtrpgOpenLocalVoiceRawV1(s.request); await assertOriginalOnly(s)
    expect(calls).toHaveBeenCalledTimes(2); expect(calls.mock.calls[0][0]).toBe(calls.mock.calls[1][0])
  })
  it('retains a conflicting expected raw hash without overwriting the checkpoint or inventing a response', async () => {
    const s = await fixture(), snapshot = await ledger.readInstanceAgentRunV1(s.owner.scope, s.prepared.runId), calls = mockRaw()
    const saved = await checkpoints.createAgentRunCheckpointV1({ scope: s.owner.scope, productRuntimeSessionId: s.owner.sessionId, runId: s.prepared.runId,
      resumePayload: { schema: TTRPG_OPEN_VOICE_CONTROL_SCHEMA_V1, version: 1, action: 'recover-original-raw-only',
        jobKey: `ttrpg.voice.${s.prepared.runId}.${s.prepared.inputArtifactHash}`, inputArtifactHash: s.prepared.inputArtifactHash, expectedRawResponseHash: 'c'.repeat(64) },
      expectedLastSequence: snapshot.projection.lastSequence })
    await expect(recoverTtrpgOpenLocalVoiceRawV1(s.request)).rejects.toThrow(/另一份/)
    expect(await db.agentRunCheckpoints.get(saved.checkpoint.id!)).toEqual(saved.checkpoint)
    expect((await ledger.readInstanceAgentRunV1(s.owner.scope, s.prepared.runId)).events).toEqual(saved.snapshot.events)
    expect(calls).toHaveBeenCalledTimes(1)
  })
  it.each(['source-snapshot','context-manifest'] as const)('rejects missing original %s before HTTP without recreating context or input', async kind => {
    const s = await fixture(), calls = mockRaw(), snapshot = await ledger.readInstanceAgentRunV1(s.owner.scope, s.prepared.runId)
    const event = snapshot.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === kind)
    if (event?.type !== 'evidence.artifact.recorded') throw new Error('missing fixture artifact')
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.owner.scope.projectId,kind,event.payload.contentHash]).first()
    await db.agentRunArtifacts.delete(row!.id!)
    await expect(recoverTtrpgOpenLocalVoiceRawV1(s.request)).rejects.toThrow()
    expect(calls).not.toHaveBeenCalled(); expect(await db.agentRunCheckpoints.count()).toBe(0)
  })
  it.each(['run.failed','run.cancelled'] as const)('cannot revive a known %s terminal', async type => {
    const s = await fixture(), calls = mockRaw()
    await ledger.appendAgentRunEventV1({ scope: s.owner.scope, productRuntimeSessionId: s.owner.sessionId, runId: s.prepared.runId,
      ...(type === 'run.failed' ? { type, payload: { code: 'fixture-known-failure', retryable: false } } : { type, payload: { reason: 'fixture-known-cancellation' } }) })
    await expect(recoverTtrpgOpenLocalVoiceRawV1(s.request)).rejects.toThrow()
    expect(calls).not.toHaveBeenCalled(); expect(await db.agentRunCheckpoints.count()).toBe(0)
  })
  it('a stop during actual ledger recovery retains the raw-only checkpoint and never dispatches again', async () => {
    const s = await fixture(), calls = mockRaw(), begin = checkpoints.beginAgentRunRecoveryV1
    calls.mockImplementation(async (url, init) => {
      if (url.endsWith('/cancel')) return new Response(JSON.stringify({ jobKey: decodeURIComponent(url.split('/').at(-2)!), status: 'stop-requested-without-job', canStart: false, cancellationConfirmed: false, futureStartBlocked: true }), { headers: { 'Content-Type': 'application/json' } })
      expect(init.method).toBe('POST'); return new Response(raw, { headers: { 'Content-Type': 'application/json' } })
    })
    vi.spyOn(checkpoints, 'beginAgentRunRecoveryV1').mockImplementationOnce(async input => {
      const plan = await begin(input)
      expect(await stopTtrpgOpenLocalVoiceJobV1({ ...s.input, decision: 'stop-this-original-local-voice-execution' })).toMatchObject({ runState: 'recovering', futureInferenceBlocked: true })
      return plan
    })
    await recoverTtrpgOpenLocalVoiceRawV1(s.request); await assertOriginalOnly(s)
    expect(await db.agentRunCheckpoints.count()).toBe(1)
    expect((await readTtrpgOpenVoiceExecutionControlsForKernelV1(s.execution)).controls[0].payload.action).toBe('recover-original-raw-only')
    expect(calls).toHaveBeenCalledTimes(2)
  })
  // Isolated corruption/tombstone fixtures, not a claim that live evidence can
  // be pruned through the retention API (that API correctly rejects live Runs).
  it.each(['missing','corrupt','evidence-pruned'] as const)('preserves a %s existing raw artifact failure without fetching or reviving its body', async mode => {
    const s = await fixture(), calls = mockRaw(), result = await recoverTtrpgOpenLocalVoiceRawV1(s.request)
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.owner.scope.projectId,'raw-response',result.responseArtifactHash]).first()
    const before = await ledger.readInstanceAgentRunV1(s.owner.scope,s.prepared.runId)
    if (mode === 'missing') await db.agentRunArtifacts.delete(row!.id!)
    else if (mode === 'corrupt') await db.agentRunArtifacts.update(row!.id!,{ content: 'changed original raw bytes' })
    else await db.agentRunArtifacts.update(row!.id!,{ content: null, retentionState: 'evidence-pruned' })
    await expect(recoverTtrpgOpenLocalVoiceRawV1(s.request)).rejects.toThrow()
    expect(calls).toHaveBeenCalledTimes(1)
    expect((await ledger.readInstanceAgentRunV1(s.owner.scope,s.prepared.runId)).events).toEqual(before.events)
  })
  it('uses the exact historical profile and source evidence without today’s input builder or context assembly', async () => {
    const s = await fixture(), calls = mockRaw(), old = profile.implementation.sources[0].sha256
    const context = vi.spyOn(assembly,'assembleContext').mockRejectedValue(new Error('must-not-assemble'))
    const input = vi.spyOn(builder,'createTtrpgOpenVoiceExecutionInputForKernelV1').mockRejectedValue(new Error('must-not-upgrade'))
    try {
      profile.implementation.sources[0].sha256 = '0'.repeat(64)
      await recoverTtrpgOpenLocalVoiceRawV1(s.request); await assertOriginalOnly(s)
      expect(context).not.toHaveBeenCalled(); expect(input).not.toHaveBeenCalled(); expect(calls).toHaveBeenCalledTimes(1)
    } finally { profile.implementation.sources[0].sha256 = old }
  })
  it('rechecks the original recipient after HTTP and does not store private raw after consent is revoked', async () => {
    const s = await fixture(), calls = mockRaw()
    calls.mockImplementationOnce(async () => {
      const seat = (await readTtrpgSessionParticipantsV2(s.owner.sessionId)).find(r => r.viewerKey === s.owner.viewerKey)!
      await configureTtrpgSessionParticipantV2({ sessionId: s.owner.sessionId, seatKey: seat.seatKey, expectedRevision: seat.revision,
        commandId: 'voice.raw.revoke', requestedByViewerKey: s.owner.viewerKey, consent: { publicSharingAllowed: false } })
      return new Response(raw, { headers: { 'Content-Type': 'application/json' } })
    })
    await expect(recoverTtrpgOpenLocalVoiceRawV1(s.request)).rejects.toThrow()
    expect(calls).toHaveBeenCalledTimes(1); expect(await db.agentRunCheckpoints.count()).toBe(0)
    expect((await db.agentRunEvents.toArray()).filter(e => e.type === 'model.responded')).toHaveLength(0)
  })
  it('permits a harmless game pause during retrieval while still forbidding another inference', async () => {
    const s = await fixture(), calls = mockRaw()
    calls.mockImplementationOnce(async () => {
      await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'voice.raw.pause'), viewerKey: s.owner.viewerKey,
        status: 'paused', changedBy: s.owner.viewerKey, reason: 'no new inference while paused' })
      return new Response(raw, { headers: { 'Content-Type': 'application/json' } })
    })
    await recoverTtrpgOpenLocalVoiceRawV1(s.request); await assertOriginalOnly(s)
    const repeat = await dispatchTtrpgOpenLocalVoiceForKernelV1({ ...s.input, decision: 'dispatch-this-original-local-voice-execution',
      transport: { kind: 'local-offline-speech-v1', profileHash: s.prepared.profileHash, execute: s.execute } }).catch(() => null)
    expect(repeat === null || repeat.status === 'dispatch-already-recorded').toBe(true); expect(s.execute).toHaveBeenCalledTimes(1)
  })
  it('preserves raw bytes and external job identity in backups, denies imported/ancestor recovery, and deletes only the original owner evidence', async () => {
    const s = await fixture(), calls = mockRaw(), result = await recoverTtrpgOpenLocalVoiceRawV1(s.request)
    const marker = (await db.agentRunCheckpoints.toArray())[0].resumePayloadJson!
    const projectId = await importProjectJSON(await exportProjectJSON(s.owner.scope.projectId))
    const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const archived = (await db.agentRunCheckpoints.where('projectId').equals(projectId).toArray())[0]
    expect(archived.resumePayloadJson).toBe(marker)
    await expect(recoverTtrpgOpenLocalVoiceRawV1({ ...s.request, scope: { projectId, worldId: imported.worldId, workId: imported.workId }, sessionId: imported.id! })).rejects.toThrow()
    const branch = await branchProductRuntimeSession({ parentSessionId: s.owner.sessionId,
      throughSequence: (await readProductRuntimeState(s.owner.sessionId)).lastSequence, title: 'voice-raw-history' })
    await expect(recoverTtrpgOpenLocalVoiceRawV1({ ...s.request, sessionId: branch.id! })).rejects.toThrow()
    expect(calls).toHaveBeenCalledTimes(1)
    await deleteProductRuntimeSession(s.owner.sessionId)
    expect(await db.agentRunCheckpoints.where('runId').equals(s.prepared.runId).count()).toBe(0)
    expect(await artifacts.readAgentRunArtifactExactV1({ projectId, artifactKind: 'raw-response', contentHash: result.responseArtifactHash })).toBe(raw)
    expect(await db.agentRunCheckpoints.where('projectId').equals(projectId).count()).toBe(1)
  })
})

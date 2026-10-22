import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupLocalVoiceExecutionV1 } from '../helpers/open-local-voice'
import { prepareTtrpgOpenLocalVoiceExecutionV1, stopTtrpgOpenLocalVoiceJobV1 } from '../../src/lib/ttrpg/open-audio-service'
import { TTRPG_OPEN_VOICE_CONTROL_SCHEMA_V1, dispatchTtrpgOpenLocalVoiceForKernelV1, readTtrpgOpenVoiceExecutionControlsForKernelV1 } from '../../src/lib/ttrpg/open-voice-execution'
import { appendAgentRunEventV1, readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import * as formal from '../../src/lib/agent/formal-ai-entry'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as builder from '../../src/lib/ttrpg/open-voice-execution-input'
import * as assembly from '../../src/lib/registry/assemble-context'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import profile from '../../scripts/ttrpg-local-tts/product-profile.json'

function mockStop() {
  const calls = vi.fn(async (url: string, init: RequestInit) => {
    expect(url.endsWith('/cancel')).toBe(true); expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'request-stop-original-local-voice-job' })
    return new Response(JSON.stringify({ jobKey: decodeURIComponent(url.split('/').at(-2)!), status: 'stop-requested-without-job',
      canStart: false, cancellationConfirmed: false, futureStartBlocked: true }), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', calls); return calls
}
async function fixture() {
  const s = await setupLocalVoiceExecutionV1(), prepared = await prepareTtrpgOpenLocalVoiceExecutionV1(s.input)
  return { ...s, prepared, request: { ...s.input, decision: 'stop-this-original-local-voice-execution' as const },
    execution: { scope: s.owner.scope, sessionId: s.owner.sessionId, runId: prepared.runId, inputArtifactHash: prepared.inputArtifactHash } }
}
async function resumeOriginal(s: Awaited<ReturnType<typeof fixture>>) {
  const current = await readInstanceAgentRunV1(s.owner.scope, s.prepared.runId)
  const saved = await checkpoints.createAgentRunCheckpointV1({ scope: s.owner.scope, productRuntimeSessionId: s.owner.sessionId,
    runId: s.prepared.runId, resumePayload: { note: 'later generic bookkeeping checkpoint does not erase historical stop' }, expectedLastSequence: current.projection.lastSequence })
  await checkpoints.beginAgentRunRecoveryV1({ scope: s.owner.scope, runId: s.prepared.runId, productRuntimeSessionId: s.owner.sessionId })
  return checkpoints.completeAgentRunRecoveryV1({ scope: s.owner.scope, runId: s.prepared.runId, productRuntimeSessionId: s.owner.sessionId, checkpointHash: saved.checkpoint.checkpointHash })
}
describe('R-TTRPGOPEN10 original local voice stop barrier', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
  it('persists a verified original barrier and pauses bookkeeping before HTTP, retaining quotas and separating a missing job from confirmed closure', async () => {
    const s = await fixture(), before = await readProductRuntimeState(s.owner.sessionId), calls = mockStop()
    calls.mockImplementationOnce(async url => {
      const controlled = await readTtrpgOpenVoiceExecutionControlsForKernelV1(s.execution)
      expect(controlled.controls).toHaveLength(1); expect(controlled.controls[0].payload.action).toBe('stop-original-job')
      expect(controlled.snapshot.projection.state).toBe('paused')
      return new Response(JSON.stringify({ jobKey: decodeURIComponent(url.split('/').at(-2)!), status: 'stop-requested-without-job',
        canStart: false, cancellationConfirmed: false, futureStartBlocked: true }), { headers: { 'Content-Type': 'application/json' } })
    })
    expect(await stopTtrpgOpenLocalVoiceJobV1(s.request)).toMatchObject({ runState: 'paused', runBarrierRecorded: true,
      futureInferenceBlocked: true, cancellationConfirmed: false, generationAllowed: false, adoptionAllowed: false })
    await stopTtrpgOpenLocalVoiceJobV1(s.request)
    expect(await db.agentRunCheckpoints.count()).toBe(1); expect(await db.agentRuns.count()).toBe(2)
    expect((await db.agentRunEvents.toArray()).filter(e => e.type === 'model.requested')).toHaveLength(0)
    expect(await readProductRuntimeState(s.owner.sessionId)).toEqual(before)
    expect(await db.productMediaAssets.count()).toBe(0); expect(calls).toHaveBeenCalledTimes(2)
  })
  it('stops partial preparation with no source artifact and never recreates input or obtains raw-reading rights', async () => {
    const s = await setupLocalVoiceExecutionV1(), record = artifacts.recordAgentRunArtifactV1
    vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
      if (input.artifactKind === 'source-snapshot') throw new Error('interrupted-before-original-input')
      return record(input)
    })
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1(s.input)).rejects.toThrow('interrupted-before-original-input')
    const count = await db.agentRunArtifacts.count(), calls = mockStop()
    expect(await stopTtrpgOpenLocalVoiceJobV1({ ...s.input, decision: 'stop-this-original-local-voice-execution' })).toMatchObject({ futureInferenceBlocked: true, cancellationConfirmed: false })
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1(s.input)).rejects.toThrow(/屏障/)
    expect(await db.agentRunArtifacts.count()).toBe(count); expect(calls).toHaveBeenCalledTimes(1)
  })
  it('concurrent explicit stops share one durable barrier without creating a new Run or model request', async () => {
    const s = await fixture(); mockStop()
    const results = await Promise.all([stopTtrpgOpenLocalVoiceJobV1(s.request), stopTtrpgOpenLocalVoiceJobV1(s.request)])
    expect(results.every(r => r.futureInferenceBlocked && !r.cancellationConfirmed)).toBe(true)
    expect(await db.agentRunCheckpoints.count()).toBe(1); expect(await db.agentRuns.count()).toBe(2)
  })
  it('a later generic checkpoint and completed ledger recovery cannot erase the historical stop or grant another inference', async () => {
    const s = await fixture(); mockStop(); await stopTtrpgOpenLocalVoiceJobV1(s.request)
    expect((await resumeOriginal(s)).projection.state).toBe('running')
    let models = 0
    await expect(dispatchTtrpgOpenLocalVoiceForKernelV1({ ...s.input, decision: 'dispatch-this-original-local-voice-execution', transport: {
      kind: 'local-offline-speech-v1', profileHash: s.prepared.profileHash, execute: async () => { models++; return 'must-not-infer' },
    } })).rejects.toThrow(/屏障/)
    expect(models).toBe(0)
    expect((await readTtrpgOpenVoiceExecutionControlsForKernelV1(s.execution)).controls).toHaveLength(1)
  })
  it('reuses a verified raw-only barrier during recovering without clobbering its latest checkpoint or enabling inference after completion', async () => {
    const s = await fixture(), current = await readInstanceAgentRunV1(s.owner.scope, s.prepared.runId), calls = mockStop()
    const saved = await checkpoints.createAgentRunCheckpointV1({ scope: s.owner.scope, productRuntimeSessionId: s.owner.sessionId,
      runId: s.prepared.runId, expectedLastSequence: current.projection.lastSequence, resumePayload: {
        schema: TTRPG_OPEN_VOICE_CONTROL_SCHEMA_V1, version: 1, action: 'recover-original-raw-only',
        jobKey: `ttrpg.voice.${s.prepared.runId}.${s.prepared.inputArtifactHash}`, inputArtifactHash: s.prepared.inputArtifactHash, expectedRawResponseHash: 'c'.repeat(64),
      } })
    await appendAgentRunEventV1({ scope: s.owner.scope, productRuntimeSessionId: s.owner.sessionId, runId: s.prepared.runId,
      type: 'run.paused', payload: { reason: 'isolated raw-only bookkeeping fixture', recoverable: true }, expectedLastSequence: saved.snapshot.projection.lastSequence })
    await checkpoints.beginAgentRunRecoveryV1({ scope: s.owner.scope, runId: s.prepared.runId, productRuntimeSessionId: s.owner.sessionId })
    expect(await stopTtrpgOpenLocalVoiceJobV1(s.request)).toMatchObject({ runState: 'recovering', runBarrierRecorded: true, futureInferenceBlocked: true })
    expect(await db.agentRunCheckpoints.count()).toBe(1); expect(calls).toHaveBeenCalledTimes(1)
    const recovered = await checkpoints.completeAgentRunRecoveryV1({ scope: s.owner.scope, runId: s.prepared.runId, productRuntimeSessionId: s.owner.sessionId, checkpointHash: saved.checkpoint.checkpointHash })
    expect(recovered.projection.state).toBe('running')
    let models = 0
    await expect(dispatchTtrpgOpenLocalVoiceForKernelV1({ ...s.input, decision: 'dispatch-this-original-local-voice-execution', transport: {
      kind: 'local-offline-speech-v1', profileHash: s.prepared.profileHash, execute: async () => { models++; return 'must-not-infer' },
    } })).rejects.toThrow(/屏障/)
    expect(models).toBe(0)
  })
  it('a stop committed during asynchronous frozen-entry validation blocks transport even after the durable dispatch claim', async () => {
    const s = await fixture(), execute = formal.executeFrozenFormalAudioEntryV1
    mockStop(); let models = 0
    vi.spyOn(formal, 'executeFrozenFormalAudioEntryV1').mockImplementationOnce(async (...args) => {
      await stopTtrpgOpenLocalVoiceJobV1(s.request); return execute(...args)
    })
    await expect(dispatchTtrpgOpenLocalVoiceForKernelV1({ ...s.input, decision: 'dispatch-this-original-local-voice-execution', transport: {
      kind: 'local-offline-speech-v1', profileHash: s.prepared.profileHash, execute: async () => { models++; return 'must-not-infer' },
    } })).rejects.toThrow(/屏障/)
    expect(models).toBe(0)
    expect((await db.agentRunEvents.toArray()).filter(e => e.type === 'model.requested')).toHaveLength(1)
  })
  it('checks the barrier in the actual start/lease callback, not only before entering the transport', async () => {
    const s = await fixture(); mockStop(); let models = 0
    await expect(dispatchTtrpgOpenLocalVoiceForKernelV1({ ...s.input, decision: 'dispatch-this-original-local-voice-execution', transport: {
      kind: 'local-offline-speech-v1', profileHash: s.prepared.profileHash, execute: async ({ assertCurrentBeforeStart }) => {
        await stopTtrpgOpenLocalVoiceJobV1(s.request); await assertCurrentBeforeStart(); models++; return 'must-not-infer'
      },
    } })).rejects.toThrow(/屏障/)
    expect(models).toBe(0)
  })
  it('keeps a lost checkpoint return as an effective barrier before HTTP and reuses it on explicit retry', async () => {
    const s = await fixture(), create = checkpoints.createAgentRunCheckpointV1, calls = mockStop()
    vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockImplementationOnce(async input => { await create(input); throw new Error('lost-stop-checkpoint-return') })
    await expect(stopTtrpgOpenLocalVoiceJobV1(s.request)).rejects.toThrow('lost-stop-checkpoint-return')
    expect(calls).not.toHaveBeenCalled(); expect((await readTtrpgOpenVoiceExecutionControlsForKernelV1(s.execution)).controls).toHaveLength(1)
    await stopTtrpgOpenLocalVoiceJobV1(s.request)
    expect(await db.agentRunCheckpoints.count()).toBe(1); expect(calls).toHaveBeenCalledTimes(1)
  })
  it('a lost HTTP stop response cannot remove the barrier, confirm closure or trigger an automatic retry', async () => {
    const s = await fixture(), calls = mockStop(); calls.mockRejectedValueOnce(new Error('stop-response-unknown'))
    await expect(stopTtrpgOpenLocalVoiceJobV1(s.request)).rejects.toThrow('stop-response-unknown')
    expect(calls).toHaveBeenCalledTimes(1)
    expect((await readTtrpgOpenVoiceExecutionControlsForKernelV1(s.execution)).controls).toHaveLength(1)
    await stopTtrpgOpenLocalVoiceJobV1(s.request)
    expect(await db.agentRunCheckpoints.count()).toBe(1); expect(calls).toHaveBeenCalledTimes(2)
  })
  it.each(['missing','corrupt-schema'] as const)('cannot turn a %s witnessed historical checkpoint into a new generation permit', async mode => {
    const s = await fixture(); mockStop(); await stopTtrpgOpenLocalVoiceJobV1(s.request); await resumeOriginal(s)
    const first = (await db.agentRunCheckpoints.where('runId').equals(s.prepared.runId).toArray())[0]
    if (mode === 'missing') await db.agentRunCheckpoints.delete(first.id!)
    else await db.agentRunCheckpoints.update(first.id!, { resumePayloadJson: '{"schema":"erased-stop"}' })
    await expect(readTtrpgOpenVoiceExecutionControlsForKernelV1(s.execution)).rejects.toThrow(/检查点/)
    let models = 0
    await expect(dispatchTtrpgOpenLocalVoiceForKernelV1({ ...s.input, decision: 'dispatch-this-original-local-voice-execution', transport: {
      kind: 'local-offline-speech-v1', profileHash: s.prepared.profileHash, execute: async () => { models++; return 'must-not-infer' },
    } })).rejects.toThrow(/检查点/)
    expect(models).toBe(0)
  })
  it('can stop its old original profile without current generation builders or source negotiation', async () => {
    const s = await fixture(), old = profile.implementation.sources[0].sha256, calls = mockStop()
    const context = vi.spyOn(assembly, 'assembleContext').mockRejectedValue(new Error('must-not-assemble'))
    const input = vi.spyOn(builder, 'createTtrpgOpenVoiceExecutionInputForKernelV1').mockRejectedValue(new Error('must-not-upgrade'))
    try {
      profile.implementation.sources[0].sha256 = '0'.repeat(64)
      expect(await stopTtrpgOpenLocalVoiceJobV1(s.request)).toMatchObject({ runBarrierRecorded: true, futureInferenceBlocked: true })
      expect(context).not.toHaveBeenCalled(); expect(input).not.toHaveBeenCalled(); expect(calls).toHaveBeenCalledTimes(1)
    } finally { profile.implementation.sources[0].sha256 = old }
  })
  it('preserves the external original job key through backup without granting imported/ancestor control and deletes checkpoints with their original owner', async () => {
    const s = await fixture(), calls = mockStop(); await stopTtrpgOpenLocalVoiceJobV1(s.request)
    const marker = (await db.agentRunCheckpoints.toArray())[0].resumePayloadJson!
    const exported = await exportProjectJSON(s.owner.scope.projectId), projectId = await importProjectJSON(exported)
    const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const locator = { ...s.request, scope: { projectId, worldId: imported.worldId, workId: imported.workId }, sessionId: imported.id! }
    const archived = (await db.agentRunCheckpoints.where('projectId').equals(projectId).toArray())[0]
    expect(archived.resumePayloadJson).toBe(marker)
    await expect(stopTtrpgOpenLocalVoiceJobV1(locator)).rejects.toThrow()
    const branch = await branchProductRuntimeSession({ parentSessionId: s.owner.sessionId,
      throughSequence: (await readProductRuntimeState(s.owner.sessionId)).lastSequence, title: 'stopped-speech-history' })
    await expect(stopTtrpgOpenLocalVoiceJobV1({ ...s.request, sessionId: branch.id! })).rejects.toThrow()
    expect(calls).toHaveBeenCalledTimes(1)
    await deleteProductRuntimeSession(s.owner.sessionId)
    expect(await db.agentRunCheckpoints.where('runId').equals(s.prepared.runId).count()).toBe(0)
    expect(await db.agentRunCheckpoints.where('projectId').equals(projectId).count()).toBe(1)
  })
})

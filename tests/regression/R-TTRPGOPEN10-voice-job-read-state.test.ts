import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupLocalVoiceExecutionV1 } from '../helpers/open-local-voice'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenLocalVoiceExecutionV1, readTtrpgOpenLocalVoiceJobV1 } from '../../src/lib/ttrpg/open-audio-service'
import { readTtrpgOpenLocalVoiceJobForKernelV1 } from '../../src/lib/ttrpg/open-voice-job-service'
import { loadTtrpgOpenVoiceJobReadStateForKernelV1 } from '../../src/lib/ttrpg/open-voice-job-read-state'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { appendAgentRunEventV1, readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { branchProductRuntimeSession, deleteProductRuntimeSession, readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import * as executionInput from '../../src/lib/ttrpg/open-voice-execution-input'
import * as assembly from '../../src/lib/registry/assemble-context'
import * as artifacts from '../../src/lib/memory/artifact-store'
import profile from '../../scripts/ttrpg-local-tts/product-profile.json'

async function fixture() {
  const s = await setupLocalVoiceExecutionV1(), prepared = await prepareTtrpgOpenLocalVoiceExecutionV1(s.input)
  const status = { jobKey: `ttrpg.voice.${prepared.runId}.${prepared.inputArtifactHash}`, inputArtifactHash: prepared.inputArtifactHash,
    profileHash: prepared.profileHash, status: 'waiting-for-slot' as const, canStart: true, cancellationConfirmed: false,
    cancellationRequested: false, hasResultFile: false, automaticRetryAllowed: false as const }
  const fetcher = vi.fn(async () => new Response(JSON.stringify(status), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetcher)
  return { ...s, prepared, status, fetcher }
}
async function rows() { return canonicalStringify(await Promise.all(db.tables.map(async t => [t.name, await t.toArray()]))) }
describe('R-TTRPGOPEN10 original job ownership and history reads', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
  it('queries the same original child while leaving every isolated database table unchanged and granting no execution', async () => {
    const s = await fixture(), before = await rows()
    const control = await loadTtrpgOpenVoiceJobReadStateForKernelV1(s.input, false)
    expect(control.identity).toBeNull(); expect(control.sourceContent).toBeNull(); expect(s.fetcher).not.toHaveBeenCalled()
    const result = await readTtrpgOpenLocalVoiceJobV1(s.input)
    expect(result).toMatchObject({ runId: s.prepared.runId, runState: 'running', backend: s.status,
      generationAllowed: false, adoptionAllowed: false, automaticRetryAllowed: false })
    expect(await rows()).toBe(before); expect(s.fetcher).toHaveBeenCalledTimes(1)
    db.close(); await db.open()
    expect((await readTtrpgOpenLocalVoiceJobV1(s.input)).jobKey).toBe(result.jobKey)
    expect(await rows()).toBe(before)
  })
  it('reads the persisted old profile after an implementation upgrade without invoking current input or context builders', async () => {
    const s = await fixture(), old = profile.implementation.sources[0].sha256
    const context = vi.spyOn(assembly, 'assembleContext').mockRejectedValue(new Error('query-must-not-assemble'))
    const builder = vi.spyOn(executionInput, 'createTtrpgOpenVoiceExecutionInputForKernelV1').mockRejectedValue(new Error('query-must-not-upgrade'))
    try {
      profile.implementation.sources[0].sha256 = '0'.repeat(64)
      expect(await hashCanonicalValue(profile)).not.toBe(s.prepared.profileHash)
      expect(await readTtrpgOpenLocalVoiceJobV1(s.input)).toMatchObject({ profileHash: s.prepared.profileHash, backend: s.status })
      expect(context).not.toHaveBeenCalled(); expect(builder).not.toHaveBeenCalled()
    } finally { profile.implementation.sources[0].sha256 = old }
  })
  it('allows a human metadata read while gameplay is paused without acquiring model source permission', async () => {
    const s = await fixture()
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'voice.read.pause'), viewerKey: s.owner.viewerKey,
      changedBy: s.owner.viewerKey, status: 'paused', reason: 'explicit safety pause' })
    const before = await rows()
    expect(await readTtrpgOpenLocalVoiceJobV1(s.input)).toMatchObject({ profileHash: s.prepared.profileHash, generationAllowed: false })
    expect(await rows()).toBe(before)
  })
  it('rejects a changed owner during a metadata response instead of publishing stale status', async () => {
    const s = await fixture()
    await expect(readTtrpgOpenLocalVoiceJobForKernelV1(s.input, { kind: 'original-local-voice-job-reader-v1', read: async () => {
      await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'voice.read.concurrent-pause'), viewerKey: s.owner.viewerKey,
        changedBy: s.owner.viewerKey, status: 'paused', reason: 'changed during metadata request' })
      return s.status
    } })).rejects.toThrow(/进度|来源|身份|变化/)
    expect(s.fetcher).not.toHaveBeenCalled()
  })
  it('returns the new original Run state when only its ledger advanced during HTTP', async () => {
    const s = await fixture()
    const result = await readTtrpgOpenLocalVoiceJobForKernelV1(s.input, { kind: 'original-local-voice-job-reader-v1', read: async () => {
      const snapshot = await readInstanceAgentRunV1(s.owner.scope, s.prepared.runId)
      await appendAgentRunEventV1({ scope: s.owner.scope, productRuntimeSessionId: s.owner.sessionId, runId: s.prepared.runId,
        type: 'run.paused', payload: { reason: 'observed ledger pause during query', recoverable: true }, expectedLastSequence: snapshot.projection.lastSequence })
      return s.status
    } })
    expect(result).toMatchObject({ runId: s.prepared.runId, runState: 'paused', generationAllowed: false })
  })
  it('rejects exact input corruption committed while metadata was in flight even when gameplay did not advance', async () => {
    const s = await fixture()
    await expect(readTtrpgOpenLocalVoiceJobForKernelV1(s.input, { kind: 'original-local-voice-job-reader-v1', read: async () => {
      const row = (await db.agentRunArtifacts.toArray()).find(r => r.contentHash === s.prepared.inputArtifactHash)!
      await db.agentRunArtifacts.update(row.id!, { content: row.content + ' ' })
      return s.status
    } })).rejects.toThrow()
  })
  it('does not disclose a private original job to another viewer or fetch a job whose exact source artifact was corrupted', async () => {
    const s = await fixture()
    await expect(readTtrpgOpenLocalVoiceJobV1({ ...s.input, viewerKey: 'viewer.stranger' })).rejects.toThrow()
    const row = (await db.agentRunArtifacts.toArray()).find(r => r.contentHash === s.prepared.inputArtifactHash)!
    await db.agentRunArtifacts.update(row.id!, { content: row.content + ' ' })
    await expect(readTtrpgOpenLocalVoiceJobV1(s.input)).rejects.toThrow()
    expect(s.fetcher).not.toHaveBeenCalled()
  })
  it('does not repair missing preparation or fetch its raw identity; an internal partial stop locator grants no audio rights', async () => {
    const s = await setupLocalVoiceExecutionV1(), record = artifacts.recordAgentRunArtifactV1
    vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
      if (input.artifactKind === 'source-snapshot') throw new Error('interrupted-before-input-recording')
      return record(input)
    })
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1(s.input)).rejects.toThrow('interrupted-before-input-recording')
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const before = await rows()
    await expect(readTtrpgOpenLocalVoiceJobV1(s.input)).rejects.toThrow(/输入/)
    const partial = await loadTtrpgOpenVoiceJobReadStateForKernelV1(s.input, false)
    expect(partial.identity).toBeNull(); expect(partial.sourceContent).toBeNull()
    expect(await rows()).toBe(before); expect(fetcher).not.toHaveBeenCalled()
  })
  it('preserves imported original input and lineage as history without querying the old local job from an imported or branched owner', async () => {
    const s = await fixture(), sourceContent = await artifacts.readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId,
      artifactKind: 'source-snapshot', contentHash: s.prepared.inputArtifactHash })
    const exported = await exportProjectJSON(s.owner.scope.projectId), projectId = await importProjectJSON(exported)
    const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const locator = { scope: { projectId, worldId: imported.worldId, workId: imported.workId }, sessionId: imported.id!, viewerKey: s.owner.viewerKey, requestKey: s.input.requestKey }
    await expect(readTtrpgOpenLocalVoiceJobV1(locator)).rejects.toThrow()
    const branch = await branchProductRuntimeSession({ parentSessionId: s.owner.sessionId, throughSequence: (await readProductRuntimeState(s.owner.sessionId)).lastSequence, title: 'original-job-history' })
    await expect(readTtrpgOpenLocalVoiceJobV1({ ...s.input, sessionId: branch.id! })).rejects.toThrow()
    await deleteProductRuntimeSession(s.owner.sessionId)
    await expect(readTtrpgOpenLocalVoiceJobV1(s.input)).rejects.toThrow()
    expect(await db.agentRuns.where('productRuntimeSessionId').equals(s.owner.sessionId).count()).toBe(0)
    const retained = (await db.agentRuns.where('productRuntimeSessionId').equals(imported.id!).toArray()).find(r => r.parentRelation === executionInput.TTRPG_OPEN_VOICE_EXECUTION_RELATION_V1)!
    const retainedSnapshot = await readInstanceAgentRunV1(locator.scope, retained.id!)
    if (retainedSnapshot.contract.version !== 3) throw new Error('expected original frozen product runtime contract')
    expect(retainedSnapshot.run.productRuntimeSessionId).toBe(imported.id!)
    expect(retainedSnapshot.run.parentRunId).not.toBeNull()
    const parent = await readInstanceAgentRunV1(locator.scope, retainedSnapshot.run.parentRunId!)
    expect(parent.run.productRuntimeSessionId).toBe(imported.id!)
    expect(retainedSnapshot.contract.lineage!.parent!.runId).toBe(parent.run.id)
    expect(await artifacts.readAgentRunArtifactExactV1({ projectId, artifactKind: 'source-snapshot', contentHash: s.prepared.inputArtifactHash })).toBe(sourceContent)
    expect(s.fetcher).not.toHaveBeenCalled()
  })
})

import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { preparePortableOpenRequestV1 } from '../helpers/open-ttrpg-portability'
import { exportProjectJSON, importProjectJSON, type ProjectExportData } from '../../src/lib/export/json-export'
import { parseTtrpgOpenRunOriginV1, readTtrpgOpenRunOriginV1, readTtrpgOpenImportedCallOwnerV1, freezeTtrpgOpenRunOriginForExportV1 } from '../../src/lib/ttrpg/open-run-portability'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { resolveScope } from '../../src/lib/workspace/scope'
import { OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { cancelTtrpgOpenTablePreparedRequestV1, finishTtrpgOpenTableWindowV1, readTtrpgOpenTableV1 } from '../../src/lib/ttrpg/open-table-service'
import { executeTtrpgOpenIntentRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { startTtrpgOpenEpochV1, dispatchTtrpgOpenModelCallV1, finishTtrpgOpenModelCallV1 } from '../../src/lib/ttrpg/runtime-commands'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import * as runEvents from '../../src/lib/agent/run/event-store'
import { pruneAgentRunArtifactsExplicitlyV1 } from '../../src/lib/memory/artifact-store'
import { deriveStrictExportProjectSnapshotInCurrentTransaction } from '../../src/lib/export/registry-export'

async function imported(backup: ProjectExportData) {
  const projectId = await importProjectJSON(backup), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
  const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
  return { scope, sessionId: session.id!, viewerKey: OPEN_HUMAN_VIEWER }
}
describe('R-TTRPGIMPORT1 exact historical origin and explicit unsent cancellation', { timeout: 30000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('preserves original bytes across colliding IDs/UID and two imports without mutating the source or authorizing a send', async () => {
    const f = await preparePortableOpenRequestV1(), source = await db.agentRuns.get(f.prepared.runId)
    const backup = await exportProjectJSON(f.scope.projectId), originJson = backup.agentRuns[0].portableRuntimeOriginJson!
    const origin = await parseTtrpgOpenRunOriginV1(originJson)
    expect(origin.sourceRunId).toBe(f.prepared.runId); expect(origin.contractHash).toBe(source!.contractHash)
    expect(await db.agentRuns.get(f.prepared.runId)).toEqual(source)
    const copy = await imported(backup), proof = await readTtrpgOpenImportedCallOwnerV1({ ...copy, requestKey: f.prepared.requestKey })
    expect(proof).not.toBeNull(); expect(proof!.runId).not.toBe(f.prepared.runId)
    expect(proof!.evidence.run.contractHash).not.toBe(origin.contractHash)
    expect(proof!.origin).toEqual(origin)
    expect((await db.projects.get(copy.scope.projectId))!.workspaceUid).not.toBe(origin.workspaceUid)
    const beforeRejectedSend = await readProductRuntimeState(copy.sessionId), beforeRejectedRun = await db.agentRuns.get(proof!.runId)
    const send = vi.fn(async () => '')
    await expect(executeTtrpgOpenIntentRequestV1({ ...copy, runId: proof!.runId, requestKey: f.prepared.requestKey, runAI: send })).rejects.toThrow(/导入的原请求只保留历史证据，不授予新的发送权限/)
    expect(send).not.toHaveBeenCalled()
    expect(await readProductRuntimeState(copy.sessionId)).toEqual(beforeRejectedSend); expect(await db.agentRuns.get(proof!.runId)).toEqual(beforeRejectedRun)
    const next = await imported(await exportProjectJSON(copy.scope.projectId)), again = await readTtrpgOpenImportedCallOwnerV1({ ...next, requestKey: f.prepared.requestKey })
    expect(again!.origin).toEqual(origin); expect(await readTtrpgOpenRunOriginV1(again!.runId)).toEqual(origin)
  })
  it('explicitly cancels only the imported unsent request, retains its counted slot, and permits a genuinely new authorized request', async () => {
    const f = await preparePortableOpenRequestV1(), original = await readProductRuntimeState(f.sessionId)
    const copy = await imported(await exportProjectJSON(f.scope.projectId)), request = { ...copy, requestKey: f.prepared.requestKey }
    const first = await cancelTtrpgOpenTablePreparedRequestV1(request), repeated = await cancelTtrpgOpenTablePreparedRequestV1(request)
    expect(repeated.id).toBe(first.id)
    const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(copy.sessionId)).ttrpg)!, call = runtime.openRun!.coordination.calls[0]
    expect(call.status).toBe('failed'); expect(call.terminalReason).toBe('cancelled-before-dispatch'); expect(call.dispatchRef).toBeNull()
    expect(runtime.openRun!.coordination.calls).toHaveLength(1); expect(runtime.openRun!.coordination.epochs[0].reservedCalls).toBe(0)
    expect(call.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, actualCostUsd: 0 })
    const proof = (await readTtrpgOpenImportedCallOwnerV1(request))!
    expect((await readInstanceAgentRunV1(copy.scope, proof.runId)).projection.state).toBe('cancelled')
    await finishTtrpgOpenTableWindowV1(copy)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(copy.sessionId, 'new.epoch'), viewerKey: copy.viewerKey, triggerKind: 'submit-action', rawInput: f.input.rawInput })
    const fresh = await prepareTtrpgOpenIntentInputV1({ ...f.input, ...copy, ...await openEnvelopeV1(copy.sessionId, 'new.request') })
    let sent = 0
    const result = await executeTtrpgOpenIntentRequestV1({ ...copy, runId: fresh.runId, requestKey: fresh.requestKey, runAI: async () => {
      sent++; return JSON.stringify({ goal: '调查河港', method: null, targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
    } })
    expect(result.status).toBe('candidate'); expect(sent).toBe(1)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(original)
    expect((await readTtrpgOpenImportedCallOwnerV1(request))!.origin.originHash).toBe(proof.origin.originHash)
  })
  it('recovers a committed cancellation after its imported Run receipt write was interrupted', async () => {
    const f = await preparePortableOpenRequestV1(), copy = await imported(await exportProjectJSON(f.scope.projectId)), request = { ...copy, requestKey: f.prepared.requestKey }
    vi.spyOn(runEvents, 'appendAgentRunEventV1').mockRejectedValueOnce(new Error('simulated close after runtime cancellation'))
    await expect(cancelTtrpgOpenTablePreparedRequestV1(request)).rejects.toThrow(/simulated close/)
    vi.restoreAllMocks()
    expect((await readTtrpgOpenTableV1(copy)).player!.pendingCancellations).toEqual([request.requestKey])
    await cancelTtrpgOpenTablePreparedRequestV1(request)
    expect((await readTtrpgOpenTableV1(copy)).player!.pendingCancellations).toEqual([])
    expect(parseTtrpgRuntimeStateV2((await readProductRuntimeState(copy.sessionId)).ttrpg)!.openRun!.coordination.calls).toHaveLength(1)
  })
  it('allows archived tombstones to travel again while refusing operational recovery from pruned evidence', async () => {
    const f = await preparePortableOpenRequestV1(), copy = await imported(await exportProjectJSON(f.scope.projectId)), request = { ...copy, requestKey: f.prepared.requestKey }
    await cancelTtrpgOpenTablePreparedRequestV1(request)
    const proof = (await readTtrpgOpenImportedCallOwnerV1(request))!
    const receipts = await pruneAgentRunArtifactsExplicitlyV1({ projectId: copy.scope.projectId, targets: [{ artifactKind: 'rendered-request', contentHash: f.prepared.reservation.requestHash }] })
    expect(receipts).toHaveLength(1)
    expect(await readTtrpgOpenRunOriginV1(proof.runId, 'archive')).not.toBeNull()
    await expect(readTtrpgOpenImportedCallOwnerV1(request)).rejects.toThrow(/裁剪|不可读/)
    const next = await imported(await exportProjectJSON(copy.scope.projectId))
    const rows = await db.agentRuns.where('productRuntimeSessionId').equals(next.sessionId).toArray()
    expect((await readTtrpgOpenRunOriginV1(rows[0].id!, 'archive'))!.originHash).toBe(proof.origin.originHash)
    await expect(readTtrpgOpenImportedCallOwnerV1({ ...next, requestKey: request.requestKey })).rejects.toThrow(/裁剪|不可读/)
  })
  it('requires the original proof and current human owner; an older backup stays importable without invented provenance', async () => {
    const f = await preparePortableOpenRequestV1('two humans', pkg => { pkg.ttrpg!.campaign.characterTemplates[1].controller = 'hybrid' })
    const backup = await exportProjectJSON(f.scope.projectId), copy = await imported(structuredClone(backup))
    const other = await db.ttrpgSessionParticipants.where('sessionId').equals(copy.sessionId).filter(seat => seat.actorKey === 'companion.1').first()
    await expect(cancelTtrpgOpenTablePreparedRequestV1({ ...copy, viewerKey: other!.viewerKey, requestKey: f.prepared.requestKey })).rejects.toThrow(/本人|授权/)
    delete backup.agentRuns[0].portableRuntimeOriginJson
    const legacy = await imported(backup)
    expect(await readTtrpgOpenImportedCallOwnerV1({ ...legacy, requestKey: f.prepared.requestKey })).toBeNull()
    await expect(cancelTtrpgOpenTablePreparedRequestV1({ ...legacy, requestKey: f.prepared.requestKey })).rejects.toThrow(/原请求/)
    expect(parseTtrpgRuntimeStateV2((await readProductRuntimeState(copy.sessionId)).ttrpg)!.openRun!.coordination.calls[0].status).toBe('prepared')
  })
  it('refuses freezing a Run that advanced beyond the export snapshot', async () => {
    const f = await preparePortableOpenRequestV1(), row = (await db.agentRuns.get(f.prepared.runId))!
    await expect(freezeTtrpgOpenRunOriginForExportV1(f.prepared.runId, { contractHash: row.contractHash, lastSequence: row.lastSequence - 1 })).rejects.toThrow(/导出期间/)
  })
  it('handles a workspace UID collision even when every numeric contract locator happens to match', async () => {
    await seedCurrentWorkspace('unrelated workspace')
    const f = await preparePortableOpenRequestV1(), project = (await db.projects.get(f.scope.projectId))!
    const backup = await exportProjectJSON(f.scope.projectId), sourceContractHash = f.prepared.reservation.runContractHash
    await db.delete(); await db.open()
    const { id: _id, ...holder } = project
    await db.projects.add({ ...holder, activeWorldId: null, activeWorkId: null })
    const copy = await imported(backup)
    expect(copy.scope.projectId).toBe(f.scope.projectId); expect(copy.sessionId).toBe(f.sessionId)
    const proof = (await readTtrpgOpenImportedCallOwnerV1({ ...copy, requestKey: f.prepared.requestKey }))!
    expect(proof.evidence.run.contractHash).toBe(sourceContractHash)
    expect((await db.projects.get(copy.scope.projectId))!.workspaceUid).not.toBe(proof.origin.workspaceUid)
    const beforeRejectedSend = await readProductRuntimeState(copy.sessionId), beforeRejectedRun = await db.agentRuns.get(proof.runId)
    const send = vi.fn(async () => '')
    await expect(executeTtrpgOpenIntentRequestV1({ ...copy, runId: proof.runId, requestKey: f.prepared.requestKey, runAI: send })).rejects.toThrow(/导入的原请求只保留历史证据，不授予新的发送权限/)
    expect(send).not.toHaveBeenCalled()
    expect(await readProductRuntimeState(copy.sessionId)).toEqual(beforeRejectedSend); expect(await db.agentRuns.get(proof.runId)).toEqual(beforeRejectedRun)
    await cancelTtrpgOpenTablePreparedRequestV1({ ...copy, requestKey: f.prepared.requestKey })
    expect(parseTtrpgRuntimeStateV2((await readProductRuntimeState(copy.sessionId)).ttrpg)!.openRun!.coordination.calls[0].status).toBe('failed')
  })
  it.each([false, true])('world-owned snapshot preserves existing proof without minting runtime authority (imported: %s)', async restored => {
    const f = await preparePortableOpenRequestV1(), backup = restored ? await imported(await exportProjectJSON(f.scope.projectId)) : null
    const scope = backup?.scope ?? f.scope
    const snapshot = await db.transaction('rw', db.tables, () => deriveStrictExportProjectSnapshotInCurrentTransaction(scope.projectId, {
      worldId: scope.worldId, workId: scope.workId,
    }))
    expect(Boolean(snapshot.data.agentRuns[0].portableRuntimeOriginJson)).toBe(restored)
  }, 10000)
  it.each(['changed-contract','changed-event','changed-world','changed-source-id','changed-workspace-uid'])('rejects rehashed provenance tampering atomically: %s', async mode => {
    const f = await preparePortableOpenRequestV1(), backup = await exportProjectJSON(f.scope.projectId)
    const origin = JSON.parse(backup.agentRuns[0].portableRuntimeOriginJson!)
    if (mode === 'changed-contract') {
      const contract = JSON.parse(origin.contractJson); contract.objective = 'Different objective'
      origin.contractJson = canonicalStringify(contract); origin.contractHash = await hashCanonicalValue(contract)
      for (const event of origin.events) { event.contractHash = origin.contractHash; if (event.type === 'contract.accepted') event.payload.contractJson = origin.contractJson }
    } else if (mode === 'changed-event') origin.events.find((event: { type: string }) => event.type === 'model.requested').payload.bindingHash = 'a'.repeat(64)
    else if (mode === 'changed-source-id') { origin.sourceRunId++; for (const event of origin.events) event.runId = origin.sourceRunId }
    else if (mode === 'changed-workspace-uid') origin.workspaceUid = origin.workspaceUid.slice(0, -1) + (origin.workspaceUid.endsWith('a') ? 'b' : 'a')
    else origin.worldCode = 'world.changed'
    const { originHash: _originHash, ...body } = origin
    origin.originHash = await hashCanonicalValue(body)
    backup.agentRuns[0].portableRuntimeOriginJson = canonicalStringify(origin)
    const before = await db.projects.count()
    await expect(importProjectJSON(backup)).rejects.toThrow(/原始|重绑定/)
    expect(await db.projects.count()).toBe(before)
    expect(await db.agentRuns.count()).toBe(1)
  })
  it.each(['dispatched', 'unknown'] as const)('never clears %s requests or authorizes invented zero usage through the import proof', async status => {
    const f = await preparePortableOpenRequestV1()
    await dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(f.sessionId, 'send'), viewerKey: OPEN_HUMAN_VIEWER, runId: f.prepared.runId, requestKey: f.prepared.requestKey })
    if (status === 'unknown') await finishTtrpgOpenModelCallV1({ ...await openEnvelopeV1(f.sessionId, 'unknown'), viewerKey: OPEN_HUMAN_VIEWER, runId: f.prepared.runId, requestKey: f.prepared.requestKey, status: 'unknown', responseArtifactHash: null, terminalReason: 'transport-result-unknown', usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null } })
    const copy = await imported(await exportProjectJSON(f.scope.projectId)), proof = (await readTtrpgOpenImportedCallOwnerV1({ ...copy, requestKey: f.prepared.requestKey }))!
    await expect(cancelTtrpgOpenTablePreparedRequestV1({ ...copy, requestKey: f.prepared.requestKey })).rejects.toThrow(/已发送|尚未|取消/)
    await expect(finishTtrpgOpenModelCallV1({ ...await openEnvelopeV1(copy.sessionId, 'forged.cancel'), viewerKey: copy.viewerKey, runId: proof.runId, requestKey: f.prepared.requestKey,
      status: 'failed', responseArtifactHash: null, terminalReason: 'cancelled-before-dispatch', usage: { source: 'unknown', inputTokens: 0, outputTokens: 0, actualCostUsd: 0 } })).rejects.toThrow(status === 'unknown' ? /commandId.*不同命令/ : /契约|请求/)
    expect(parseTtrpgRuntimeStateV2((await readProductRuntimeState(copy.sessionId)).ttrpg)!.openRun!.coordination.calls[0].status).toBe(status)
  })
})

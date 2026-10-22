import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupCommonOracleSourceV1 } from '../helpers/open-common-oracle-source'
import { closeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { loadTtrpgOpenCommonOracleContextV1 } from '../../src/lib/ttrpg/open-common-oracle-context'
import { startTtrpgOpenCommonOracleWindowV1, finishTtrpgOpenEmptyCommonOracleWindowV1 } from '../../src/lib/ttrpg/open-common-oracle-window'
import { verifyTtrpgOpenCommonOracleAuthorizationV1 } from '../../src/lib/ttrpg/open-common-oracle-authorization-proof'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { TTRPG_OPEN_COMMON_ORACLE_STEP_V1 } from '../../src/lib/ttrpg/open-common-oracle-request'
import { prepareTtrpgOpenOracleInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import * as commands from '../../src/lib/ttrpg/runtime-commands'
import * as runEvents from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import * as gmContext from '../../src/lib/ttrpg/open-gm-oracle-context'

async function setup() {
  const s = await setupCommonOracleSourceV1()
  await closeTtrpgOpenEntityDeskV1({ ...s.owner, submissionKey: 'common.window.close.original' })
  const source = await loadTtrpgOpenCommonOracleContextV1(s.contextInput), selected = source.directory[0]
  const budget = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.epochBudget
  const input = { ...s.owner, ...await openEnvelopeV1(s.f.sessionId, 'common.window.authorize'), oracleSourceRef: selected.oracleSourceRef, oracleInputHash: selected.contentHash, snapshotHash: selected.snapshotHash,
    decision: 'request-this-one-common-oracle-candidate' as const, modelIdentity: { provider: 'custom', model: 'common-window-fixture' }, maximumInputTokens: Math.min(16000, budget.maximumTokens - 1000), maximumOutputTokens: 1000, maximumCostUsd: 0.2 }
  return { ...s, source, input }
}
describe('R-TTRPGOPEN14 actual original local Run authority for a common Oracle window', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('creates exactly one original governed Run and passive window, keeps all sources and performs no model dispatch or fact write', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), opened = await startTtrpgOpenCommonOracleWindowV1(s.input)
    const after = await readProductRuntimeState(s.f.sessionId), epoch = after.ttrpg!.openRun!.coordination.epochs.at(-1)!
    expect(epoch.commonOracle?.run.runId).toBe(opened.runId); expect(epoch.budget.maximumCalls).toBe(1); expect(epoch.budget.maximumAiActions).toBe(0)
    expect(after.ttrpg!.openRun!.oracleReceipts).toEqual(before.ttrpg!.openRun!.oracleReceipts); expect(after.ttrpg!.openRun!.factLedger).toEqual(before.ttrpg!.openRun!.factLedger)
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime); expect(after.entities).toEqual(before.entities)
    const snapshot = await readInstanceAgentRunV1(s.f.scope, opened.runId)
    expect(snapshot.projection.steps[TTRPG_OPEN_COMMON_ORACLE_STEP_V1].status).toBe('running'); expect(snapshot.events.some(row => row.type === 'model.requested')).toBe(false)
    expect(snapshot.contract.permissions).toEqual({ contextSourceKeys: ['ttrpgOpenCommonOracleInput'], writeTargets: [] })
    expect((await verifyTtrpgOpenCommonOracleAuthorizationV1({ ...s.owner, authorization: epoch.commonOracle, phase: 'prepare' })).grant).toEqual(epoch.commonOracle)
    expect((await loadTtrpgOpenCommonOracleContextV1(s.contextInput)).resources).toEqual(s.source.resources)
    expect(await startTtrpgOpenCommonOracleWindowV1(s.input)).toEqual(opened); expect(await db.agentRuns.count()).toBe(1)
    await expect(startTtrpgOpenCommonOracleWindowV1({ ...s.input, maximumCostUsd: 0.1 })).rejects.toThrow(/其他输入|不能挪用/)
  })
  it('rejects old GM preparation before reading a GM source, with no replacement Run or source artifacts', async () => {
    const s = await setup(); await startTtrpgOpenCommonOracleWindowV1(s.input)
    const before = await readProductRuntimeState(s.f.sessionId), count = await db.agentRunArtifacts.count(), gm = vi.spyOn(gmContext, 'loadTtrpgOpenGmOracleContextV1')
    await expect(prepareTtrpgOpenOracleInputV1({ ...s.owner, ...await openEnvelopeV1(s.f.sessionId, 'common.window.old.prepare'), oracleSourceRef: s.input.oracleSourceRef,
      actorKey: 'gm', rawInput: '不能借用私域模型入口', modelIdentity: s.input.modelIdentity, maximumOutputTokens: 1000, maximumCostUsd: 0.2 } as Parameters<typeof prepareTtrpgOpenOracleInputV1>[0])).rejects.toThrow(/共同事实/)
    expect(gm).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(1); expect(await db.agentRunArtifacts.count()).toBe(count); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
  })
  it('keeps invalid consent, source/cut, owner and insufficient budget outside both Run and domain creation', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId)
    for (const change of [{ decision: 'adopt-this-one-candidate' }, { oracleInputHash: '0'.repeat(64) }, { snapshotHash: '0'.repeat(64) },
      { viewerKey: 'viewer.gm' }, { baseSequence: s.input.baseSequence - 1 }, { maximumInputTokens: 1 }, { maximumCostUsd: -1 }, { maximumOutputTokens: 5000 }]) {
      await expect(startTtrpgOpenCommonOracleWindowV1({ ...s.input, ...change } as typeof s.input)).rejects.toThrow()
      expect(await db.agentRuns.count()).toBe(0); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    }
  })
  it('rolls back a failed domain save, retains the failed original Run and requires an explicit new operation', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId)
    const cut = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('COMMON-WINDOW-STORAGE-CUT'))
    await expect(startTtrpgOpenCommonOracleWindowV1(s.input)).rejects.toThrow('COMMON-WINDOW-STORAGE-CUT'); cut.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    const run = (await db.agentRuns.where('productRuntimeSessionId').equals(s.f.sessionId).toArray())[0]
    expect((await readInstanceAgentRunV1(s.f.scope, run.id!)).projection.state).toBe('failed')
    await expect(startTtrpgOpenCommonOracleWindowV1(s.input)).rejects.toThrow(/原准备已经终止/); expect(await db.agentRuns.count()).toBe(1)
    const next = await startTtrpgOpenCommonOracleWindowV1({ ...s.input, commandId: 'common.window.new.explicit.operation' })
    expect(next.runId).not.toBe(run.id)
    await finishTtrpgOpenEmptyCommonOracleWindowV1({ ...s.owner, epochKey: next.epochKey, decision: 'close-this-empty-common-oracle-window' })
  })
  it('retains the committed original Run after a lost authorization return and repeats only that exact receipt', async () => {
    const s = await setup(), original = commands.startTtrpgOpenEpochV1
    const cut = vi.spyOn(commands, 'startTtrpgOpenEpochV1').mockImplementationOnce(async input => { await original(input); throw new Error('COMMON-WINDOW-COMMITTED-RETURN-CUT') })
    await expect(startTtrpgOpenCommonOracleWindowV1(s.input)).rejects.toThrow('COMMON-WINDOW-COMMITTED-RETURN-CUT'); cut.mockRestore()
    const state = await readProductRuntimeState(s.f.sessionId), epoch = state.ttrpg!.openRun!.coordination.epochs.at(-1)!, runId = epoch.commonOracle!.run.runId
    expect((await readInstanceAgentRunV1(s.f.scope, runId)).projection.state).toBe('running')
    const repeated = await startTtrpgOpenCommonOracleWindowV1(s.input)
    expect(repeated.runId).toBe(runId); expect(repeated.epochKey).toBe(epoch.epochKey); expect(await db.agentRuns.count()).toBe(1)
    await finishTtrpgOpenEmptyCommonOracleWindowV1({ ...s.owner, epochKey: epoch.epochKey, decision: 'close-this-empty-common-oracle-window' })
  })
  it('saves a zero-call close during pause before terminating the original Run, and repairs the exact cancelled receipt', async () => {
    const s = await setup(), opened = await startTtrpgOpenCommonOracleWindowV1(s.input)
    await commands.changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'common.window.pause'), viewerKey: s.owner.viewerKey, changedBy: 'hero', status: 'paused', reason: '暂停后仍可撤销尚未发送的授权' })
    const before = await readProductRuntimeState(s.f.sessionId), append = runEvents.appendAgentRunEventV1
    const cut = vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementationOnce(async input => { if (input.type === 'run.cancelled') throw new Error('COMMON-WINDOW-CANCELLED-RECEIPT-CUT'); return append(input) })
    const input = { ...s.owner, epochKey: opened.epochKey, decision: 'close-this-empty-common-oracle-window' as const }
    await expect(finishTtrpgOpenEmptyCommonOracleWindowV1(input)).rejects.toThrow('COMMON-WINDOW-CANCELLED-RECEIPT-CUT'); cut.mockRestore()
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    expect((await readInstanceAgentRunV1(s.f.scope, opened.runId)).projection.state).toBe('running')
    const repaired = await finishTtrpgOpenEmptyCommonOracleWindowV1(input)
    expect(await finishTtrpgOpenEmptyCommonOracleWindowV1(input)).toEqual(repaired)
    const snapshot = await readInstanceAgentRunV1(s.f.scope, opened.runId)
    expect(snapshot.projection.state).toBe('cancelled'); expect(snapshot.events.filter(row => row.type === 'run.cancelled')).toHaveLength(1)
    const state = await readProductRuntimeState(s.f.sessionId)
    expect(state.ttrpg!.openRun!.coordination.calls).toEqual([]); expect(state.ttrpg!.openRun!.oracleReceipts).toEqual(before.ttrpg!.openRun!.oracleReceipts)
    expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
  })
  it('requires the exact original authorization artifact and never rebuilds a deleted Run, while closing only its zero-call authority', async () => {
    const s = await setup(), opened = await startTtrpgOpenCommonOracleWindowV1(s.input), state = await readProductRuntimeState(s.f.sessionId), grant = state.ttrpg!.openRun!.coordination.epochs.at(-1)!.commonOracle!
    const artifact = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.f.scope.projectId, 'source-snapshot', grant.inputArtifactHash]).first()
    const bytes = artifact!.content
    await db.agentRunArtifacts.update(artifact!.id!, { content: 'changed original authorization' })
    await expect(verifyTtrpgOpenCommonOracleAuthorizationV1({ ...s.owner, authorization: grant, phase: 'prepare' })).rejects.toThrow()
    await db.agentRunArtifacts.update(artifact!.id!, { content: bytes })
    await expect(verifyTtrpgOpenCommonOracleAuthorizationV1({ ...s.owner, authorization: grant, phase: 'prepare' })).resolves.toBeDefined()
    const checkpoint = (await db.agentRunCheckpoints.where('runId').equals(opened.runId).toArray())[0], resume = checkpoint.resumePayloadJson
    await db.agentRunCheckpoints.update(checkpoint.id!, { resumePayloadJson: '{}' })
    await expect(verifyTtrpgOpenCommonOracleAuthorizationV1({ ...s.owner, authorization: grant, phase: 'prepare' })).rejects.toThrow(/检查点/)
    await db.agentRunCheckpoints.update(checkpoint.id!, { resumePayloadJson: resume })
    await db.agentRuns.delete(opened.runId)
    await expect(startTtrpgOpenCommonOracleWindowV1(s.input)).rejects.toThrow(/Run 已缺失/)
    const stopped = await finishTtrpgOpenEmptyCommonOracleWindowV1({ ...s.owner, epochKey: opened.epochKey, decision: 'close-this-empty-common-oracle-window' })
    expect(stopped.originalRun).toBe('missing-or-imported'); expect(await db.agentRuns.count()).toBe(0)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
  })
  it('keeps imported original ids as history, closes imported zero-call authority without changing the source Run, and requires a fresh local decision', async () => {
    const s = await setup(), opened = await startTtrpgOpenCommonOracleWindowV1(s.input), before = await readInstanceAgentRunV1(s.f.scope, opened.runId)
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId))
    const copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0], scope = await resolveScope({ scope: { projectId, worldId: copy.worldId!, workId: copy.workId! } })
    const owner = { scope, sessionId: copy.id!, viewerKey: s.owner.viewerKey }, copied = await readProductRuntimeState(copy.id!), grant = copied.ttrpg!.openRun!.coordination.epochs.at(-1)!.commonOracle!
    expect(grant.run).toEqual((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.epochs.at(-1)!.commonOracle!.run)
    await expect(verifyTtrpgOpenCommonOracleAuthorizationV1({ ...owner, authorization: grant, phase: 'prepare' })).rejects.toThrow()
    await expect(startTtrpgOpenCommonOracleWindowV1({ ...s.input, ...owner })).rejects.toThrow(/导入历史|Run 已缺失/)
    const stopped = await finishTtrpgOpenEmptyCommonOracleWindowV1({ ...owner, epochKey: opened.epochKey, decision: 'close-this-empty-common-oracle-window' })
    expect(stopped.originalRun).toBe('missing-or-imported')
    expect(await readInstanceAgentRunV1(s.f.scope, opened.runId)).toEqual(before)
    const source = await loadTtrpgOpenCommonOracleContextV1({ ...owner, actorKey: 'gm' }), selected = source.directory[0]
    const fresh = await startTtrpgOpenCommonOracleWindowV1({ ...s.input, ...owner, ...await openEnvelopeV1(copy.id!, 'common.window.copy.fresh'), oracleSourceRef: selected.oracleSourceRef, oracleInputHash: selected.contentHash, snapshotHash: selected.snapshotHash })
    const local = await readInstanceAgentRunV1(scope, fresh.runId)
    expect(local.run.portableRuntimeOriginJson).toBeUndefined(); expect(local.run.productRuntimeSessionId).toBe(copy.id)
    await finishTtrpgOpenEmptyCommonOracleWindowV1({ ...owner, epochKey: fresh.epochKey, decision: 'close-this-empty-common-oracle-window' })
    await finishTtrpgOpenEmptyCommonOracleWindowV1({ ...s.owner, epochKey: opened.epochKey, decision: 'close-this-empty-common-oracle-window' })
  })
  it('denies imported unprepared authority when a fresh database reuses the same project, session and Run ids', async () => {
    const s = await setup(), opened = await startTtrpgOpenCommonOracleWindowV1(s.input)
    const backup = await exportProjectJSON(s.f.scope.projectId)
    await db.delete(); await db.open()
    const projectId = await importProjectJSON(backup), copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: copy.worldId!, workId: copy.workId! } })
    expect(projectId).toBe(s.f.scope.projectId); expect(copy.id).toBe(s.f.sessionId)
    const run = (await db.agentRuns.where('productRuntimeSessionId').equals(copy.id!).toArray())[0]
    expect(run.id).toBe(opened.runId)
    await expect(verifyTtrpgOpenCommonOracleAuthorizationV1({ scope, sessionId: copy.id!, viewerKey: s.owner.viewerKey,
      authorization: (await readProductRuntimeState(copy.id!)).ttrpg!.openRun!.coordination.epochs.at(-1)!.commonOracle, phase: 'prepare' })).rejects.toThrow()
    expect((await readInstanceAgentRunV1(scope, run.id!)).events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'run.cancelled', payload: { reason: 'project-import-nonportable-checkpoint' } })]))
    const copiedOwner = { scope, sessionId: copy.id!, viewerKey: s.owner.viewerKey }
    await expect(startTtrpgOpenCommonOracleWindowV1({ ...s.input, ...copiedOwner })).rejects.toThrow(/导入历史/)
    const closed = await finishTtrpgOpenEmptyCommonOracleWindowV1({ ...copiedOwner, epochKey: opened.epochKey, decision: 'close-this-empty-common-oracle-window' })
    expect(closed.originalRun).toBe('missing-or-imported')
  })
  it('preserves before/after cuts and derives a new child authorization after deleting the parent, without inheriting execution', async () => {
    const s = await setup(), opened = await startTtrpgOpenCommonOracleWindowV1(s.input), after = await readProductRuntimeState(s.f.sessionId)
    const beforeChild = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: s.input.baseSequence, title: 'Common request before authorization' })
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: after.lastSequence, title: 'Common request after authorization' })
    expect(JSON.stringify((await readProductRuntimeState(beforeChild.id!)).ttrpg!.branchLineage)).not.toContain(opened.basisHash)
    expect(JSON.stringify((await readProductRuntimeState(child.id!)).ttrpg!.branchLineage)).toContain(opened.basisHash)
    const state = await readProductRuntimeState(child.id!)
    await commands.completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'common.window.child.zero'), viewerKey: s.owner.viewerKey, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys })
    const owner = { ...s.owner, sessionId: child.id! }
    await expect(finishTtrpgOpenEmptyCommonOracleWindowV1({ ...owner, epochKey: opened.epochKey, decision: 'close-this-empty-common-oracle-window' })).rejects.toThrow()
    await deleteProductRuntimeSession(s.f.sessionId)
    const source = await loadTtrpgOpenCommonOracleContextV1({ ...owner, actorKey: 'gm' }), selected = source.directory[0]
    const fresh = await startTtrpgOpenCommonOracleWindowV1({ ...s.input, ...owner, ...await openEnvelopeV1(child.id!, 'common.window.child.fresh'), oracleSourceRef: selected.oracleSourceRef, oracleInputHash: selected.contentHash, snapshotHash: selected.snapshotHash })
    const grant = (await readProductRuntimeState(child.id!)).ttrpg!.openRun!.coordination.epochs.at(-1)!.commonOracle!
    await expect(verifyTtrpgOpenCommonOracleAuthorizationV1({ ...owner, authorization: grant, phase: 'prepare' })).resolves.toBeDefined()
    expect((await readInstanceAgentRunV1(s.f.scope, fresh.runId)).run.productRuntimeSessionId).toBe(child.id)
    await finishTtrpgOpenEmptyCommonOracleWindowV1({ ...owner, epochKey: fresh.epochKey, decision: 'close-this-empty-common-oracle-window' })
  })

})

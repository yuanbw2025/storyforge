import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupCommonOracleModelV1 as setup } from '../helpers/open-common-oracle-model'
import { prepareTtrpgOpenCommonOracleInputForKernelV1 as prepareTtrpgOpenCommonOracleInputV1, prepareTtrpgOpenCommonOracleInputV1 as preparePublic } from '../../src/lib/ttrpg/open-intent-input'
import { finishTtrpgOpenEmptyCommonOracleWindowV1 } from '../../src/lib/ttrpg/open-common-oracle-window'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { verifyTtrpgOpenModelCallEvidenceV1 } from '../../src/lib/ttrpg/open-model-call-evidence'
import { ttrpgOpenCommonOracleMessagesV1 } from '../../src/lib/ttrpg/open-common-oracle-delivery'
import * as commands from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'

describe('R-TTRPGOPEN14 exact common Oracle preparation on the authorized original local Run', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  for (const audience of ['party', 'public'] as const) it(`delivers only the original complete ${audience} common input, reserves once on the same Run and never sends or writes facts`, async () => {
    const s = await setup(audience), before = await readProductRuntimeState(s.f.sessionId)
    const prepared = await prepareTtrpgOpenCommonOracleInputV1(s.read)
    expect(prepared.runId).toBe(s.authorized.runId); expect(prepared.requestKey).toBe(s.authorized.requestKey); expect(await db.agentRuns.count()).toBe(1)
    const after = await readProductRuntimeState(s.f.sessionId), call = after.ttrpg!.openRun!.coordination.calls.at(-1)!
    expect(call.status).toBe('prepared'); expect(call.commonOracle?.basisHash).toBe(s.grant.basisHash)
    expect(call.oracleInterpretation).toBeUndefined(); expect(call.supportSlot).toBeUndefined()
    expect(call.reservedInputTokens).toBeLessThanOrEqual(s.grant.basis.budget.maximumInputTokens)
    expect(prepared.messages).toEqual(ttrpgOpenCommonOracleMessagesV1(prepared.evidence.preflight.contextPacket.content))
    expect(prepared.evidence.manifest.sources.map(row => row.key)).toEqual(['ttrpgOpenCommonOracleInput'])
    expect(prepared.evidence.preflight.artifacts.filter(row => row.role === 'source-snapshot')).toHaveLength(2)
    expect(prepared.evidence.contextSelection?.baseSequence).toBe(s.grant.basis.readEvidence.sequence)
    expect(prepared.evidence.contextSelection?.deliveredTriggerKeys).toEqual([])
    const text = JSON.stringify(prepared.messages)
    for (const secret of ['COMMON-ORACLE-GM-', 'COMMON-ORACLE-PRIVATE-', 'COMMON-ORACLE-FULL-', s.privatePlace, 'characterSheet', 'frozenContentJson', 'operationKey', '.equipment.0']) expect(text).not.toContain(secret)
    if (audience === 'party') expect(text).toContain(s.npc); else expect(text).not.toContain(s.npc)
    const snapshot = await readInstanceAgentRunV1(s.f.scope, prepared.runId)
    expect(snapshot.contract).toEqual(JSON.parse(s.grant.run.contractJson)); expect(snapshot.events.filter(row => row.type === 'model.requested')).toHaveLength(1)
    expect(snapshot.events.some(row => row.type === 'model.responded')).toBe(false)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.factLedger).toEqual(before.ttrpg!.openRun!.factLedger)
    expect(after.ttrpg!.openRun!.oracleReceipts).toEqual(before.ttrpg!.openRun!.oracleReceipts); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    await expect(verifyTtrpgOpenModelCallEvidenceV1({ ...s.read, call, mode: 'dispatch' })).resolves.toBeDefined()
    const repeated = await prepareTtrpgOpenCommonOracleInputV1(s.read)
    expect(repeated.evidence).toEqual(prepared.evidence); expect(repeated.messages).toEqual(prepared.messages); expect(repeated.event).toEqual(prepared.event)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(after)
    expect(await preparePublic(s.read)).toEqual({ runId: s.read.runId, requestKey: s.read.requestKey })
    await expect(finishTtrpgOpenEmptyCommonOracleWindowV1({ ...s.owner, epochKey: s.grant.epochKey, decision: 'close-this-empty-common-oracle-window' })).rejects.toThrow(/原请求回执|空共同事实/)
  })
  it('repairs a real reservation rollback from the retained original request bytes, with no replacement Run or second model binding', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId)
    const cut = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('COMMON-MODEL-RESERVATION-ROLLBACK'))
    await expect(prepareTtrpgOpenCommonOracleInputV1(s.read)).rejects.toThrow('COMMON-MODEL-RESERVATION-ROLLBACK'); cut.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    const snapshot = await readInstanceAgentRunV1(s.f.scope, s.read.runId), requested = snapshot.events.find(row => row.type === 'model.requested')!
    if (requested.type !== 'model.requested') throw new Error('missing original request')
    const bytes = await readAgentRunArtifactExactV1({ projectId: s.f.scope.projectId, artifactKind: 'rendered-request', contentHash: requested.payload.bindingHash })
    const recovered = await prepareTtrpgOpenCommonOracleInputV1(s.read)
    expect(recovered.reservation.requestHash).toBe(requested.payload.bindingHash); expect(JSON.stringify(recovered.messages)).toBe(JSON.stringify(JSON.parse(bytes).messages))
    expect((await readInstanceAgentRunV1(s.f.scope, s.read.runId)).events.filter(row => row.type === 'model.requested')).toHaveLength(1)
    expect(await db.agentRuns.count()).toBe(1); expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.calls).toHaveLength(1)
  })
  it('returns the exact original committed reservation after a lost response without another event or Run', async () => {
    const s = await setup(), reserve = commands.reserveTtrpgOpenModelCallV1
    const cut = vi.spyOn(commands, 'reserveTtrpgOpenModelCallV1').mockImplementationOnce(async input => { await reserve(input); throw new Error('COMMON-MODEL-RESERVATION-RETURN-CUT') })
    await expect(prepareTtrpgOpenCommonOracleInputV1(s.read)).rejects.toThrow('COMMON-MODEL-RESERVATION-RETURN-CUT'); cut.mockRestore()
    const before = await readProductRuntimeState(s.f.sessionId), recovered = await prepareTtrpgOpenCommonOracleInputV1(s.read)
    expect(recovered.requestKey).toBe(s.read.requestKey); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.agentRuns.count()).toBe(1)
  })
  it('denies changed actual full-source bytes before dispatch and permits only the restored exact original bytes', async () => {
    const s = await setup(), prepared = await prepareTtrpgOpenCommonOracleInputV1(s.read), state = await readProductRuntimeState(s.f.sessionId)
    const call = state.ttrpg!.openRun!.coordination.calls.at(-1)!, ref = prepared.evidence.preflight.artifacts.find(row => row.role === 'source-snapshot')!
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.f.scope.projectId, ref.artifactKind, ref.contentHash]).first()
    const bytes = row!.content
    await db.agentRunArtifacts.update(row!.id!, { content: 'changed common full source' })
    await expect(verifyTtrpgOpenModelCallEvidenceV1({ ...s.read, call, mode: 'dispatch' })).rejects.toThrow()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(state)
    await db.agentRunArtifacts.update(row!.id!, { content: bytes })
    await expect(verifyTtrpgOpenModelCallEvidenceV1({ ...s.read, call, mode: 'dispatch' })).resolves.toBeDefined()
  })
  it('does not renew preparation after a pause, deletion or complete import of the original Run', async () => {
    const s = await setup(); await prepareTtrpgOpenCommonOracleInputV1(s.read)
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId)), copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: copy.worldId!, workId: copy.workId! } }), count = await db.agentRuns.count()
    await expect(prepareTtrpgOpenCommonOracleInputV1({ ...s.read, scope, sessionId: copy.id! })).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(count)
    await commands.changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'common.model.pause'), viewerKey: s.owner.viewerKey, changedBy: 'hero', status: 'paused', reason: '先核对共同请求' })
    await expect(prepareTtrpgOpenCommonOracleInputV1(s.read)).rejects.toThrow()
    await db.agentRuns.delete(s.read.runId)
    await expect(prepareTtrpgOpenCommonOracleInputV1(s.read)).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(count - 1)
  })
})

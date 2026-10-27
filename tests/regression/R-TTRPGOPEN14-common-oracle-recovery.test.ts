import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupCommonOracleModelV1 as setup } from '../helpers/open-common-oracle-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenCommonOracleInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { generateTtrpgOpenCommonOracleCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { repairTtrpgOpenCommonOracleResponseReceiptV1, abandonTtrpgOpenCommonOracleWaitV1 } from '../../src/lib/ttrpg/open-situation-request-recovery'
import { finishTtrpgOpenCommonOracleDraftV1 } from '../../src/lib/ttrpg/open-runtime-draft-stop'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as events from '../../src/lib/agent/run/event-store'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'

const output = JSON.stringify({ interpretation: '原共同结果仅解释，不提出新事实。', facts: [] })
describe('R-TTRPGOPEN14 original common Oracle stop and bookkeeping recovery without another send', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('cancels an unsent reservation after a pause, saves the close first and repairs an interrupted local cancelled receipt', async () => {
    const s = await setup(); await prepareTtrpgOpenCommonOracleInputV1(s.read)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'common.recovery.pause'), viewerKey: s.owner.viewerKey, changedBy: 'hero', status: 'paused', reason: '暂停仍可结束原请求' })
    const append = events.appendAgentRunEventV1
    const cut = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => { if (input.type === 'run.cancelled') throw new Error('COMMON-CANCELLED-RETURN-CUT'); return append(input) })
    const stop = { ...s.read, decision: 'discard-this-common-oracle-request-and-close-window' as const }
    await expect(finishTtrpgOpenCommonOracleDraftV1(stop)).rejects.toThrow('COMMON-CANCELLED-RETURN-CUT'); cut.mockRestore()
    const saved = await readProductRuntimeState(s.f.sessionId)
    expect(saved.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull(); expect(saved.ttrpg!.openRun!.coordination.calls.at(-1)!.status).toBe('failed')
    expect((await readInstanceAgentRunV1(s.f.scope, s.read.runId)).projection.state).toBe('running')
    await finishTtrpgOpenCommonOracleDraftV1(stop); await finishTtrpgOpenCommonOracleDraftV1(stop)
    const snapshot = await readInstanceAgentRunV1(s.f.scope, s.read.runId)
    expect(snapshot.projection.state).toBe('cancelled'); expect(snapshot.events.filter(row => row.type === 'run.cancelled')).toHaveLength(1)
    expect(snapshot.events.some(row => row.type === 'model.responded')).toBe(false); expect(await db.agentRuns.count()).toBe(1)
  })
  it('repairs an already observed original answer after model.responded was interrupted, with no new model request or Run', async () => {
    const s = await setup(), append = events.appendAgentRunEventV1
    let sends = 0
    let once = true
    const cut = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => { if (input.type === 'model.responded' && once) { once = false; throw new Error('COMMON-OBSERVED-RESPONSE-CUT') } return append(input) })
    await expect(generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async () => { sends++; return output } })).rejects.toThrow('COMMON-OBSERVED-RESPONSE-CUT'); cut.mockRestore()
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.calls.at(-1)!.status).toBe('dispatched')
    const candidate = await repairTtrpgOpenCommonOracleResponseReceiptV1(s.read)
    expect(candidate!.schema).toBe('storyforge.ttrpg-open-common-oracle-candidate'); expect(sends).toBe(1)
    expect((await repairTtrpgOpenCommonOracleResponseReceiptV1(s.read))!.candidateHash).toBe(candidate!.candidateHash)
    await finishTtrpgOpenCommonOracleDraftV1({ ...s.read, decision: 'discard-this-common-oracle-request-and-close-window' })
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    const snapshot = await readInstanceAgentRunV1(s.f.scope, s.read.runId)
    expect(snapshot.events.filter(row => row.type === 'model.requested')).toHaveLength(1); expect(snapshot.events.filter(row => row.type === 'model.responded')).toHaveLength(1); expect(await db.agentRuns.count()).toBe(1)
  })
  it('durably records unknown outcome and cost before closing; a late answer cannot replace that decision', async () => {
    const s = await setup(); let release!: () => void, started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), sending = new Promise<void>(resolve => { started = resolve })
    let sends = 0
    const generation = generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async () => { sends++; started(); await gate; return output } })
    const observed = generation.then(() => null, error => error)
    await sending
    await abandonTtrpgOpenCommonOracleWaitV1({ ...s.read, decision: 'abandon-wait-as-unknown' })
    const saved = await readProductRuntimeState(s.f.sessionId), call = saved.ttrpg!.openRun!.coordination.calls.at(-1)!
    expect(call.status).toBe('unknown'); expect(call.usage?.actualCostUsd).toBeNull(); expect(saved.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    release(); expect(await observed).toBeInstanceOf(Error)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(saved); expect(sends).toBe(1); expect(await db.agentRuns.count()).toBe(1)
    expect((await readInstanceAgentRunV1(s.f.scope, s.read.runId)).projection.state).toBe('cancelled')
  })
  it('keeps imported original-request history without permitting stop or cleanup of the source Run', async () => {
    const s = await setup(); await prepareTtrpgOpenCommonOracleInputV1(s.read)
    const original = await readInstanceAgentRunV1(s.f.scope, s.read.runId)
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId)), copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: copy.worldId!, workId: copy.workId! } })
    await expect(finishTtrpgOpenCommonOracleDraftV1({ ...s.read, scope, sessionId: copy.id!, decision: 'discard-this-common-oracle-request-and-close-window' })).rejects.toThrow()
    expect(await readInstanceAgentRunV1(s.f.scope, s.read.runId)).toEqual(original)
    await finishTtrpgOpenCommonOracleDraftV1({ ...s.read, decision: 'discard-this-common-oracle-request-and-close-window' })
  })
})

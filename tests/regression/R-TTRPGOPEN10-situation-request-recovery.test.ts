import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupSituationGenerationV1 } from '../helpers/open-situation-generation'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenSituationInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { generateTtrpgOpenSituationCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { dispatchTtrpgOpenModelCallV1, finishTtrpgOpenModelCallV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import { repairTtrpgOpenSituationResponseReceiptV1, abandonTtrpgOpenSituationWaitV1 } from '../../src/lib/ttrpg/open-situation-request-recovery'
import { readTtrpgOpenSituationDeskV1, repairTtrpgOpenSituationDeskResponseV1 } from '../../src/lib/ttrpg/open-situation-desk-service'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'

async function dispatched() {
  const f = await setupSituationGenerationV1(true)
  const prepared = await prepareTtrpgOpenSituationInputV1({ ...f.request, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
  const id = { ...f.input, runId: prepared.runId, requestKey: prepared.requestKey }
  expect((await dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(id.sessionId, 'fixture.actual.dispatch'), ...id })).sendAuthorized).toBe(true)
  return { f, id }
}
describe('R-TTRPGOPEN10 zero-send original dispatch receipt recovery', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('explicitly ends an unobserved original dispatch with unknown usage and preserves the paid slot without a new request', async () => {
    const { id } = await dispatched(), before = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!
    expect((await readTtrpgOpenSituationDeskV1(id))!.request!.responseRecovery).toBe('unobserved')
    await abandonTtrpgOpenSituationWaitV1({ ...id, decision: 'abandon-wait-as-unknown' })
    await abandonTtrpgOpenSituationWaitV1({ ...id, decision: 'abandon-wait-as-unknown' })
    const run = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!
    expect(run.coordination.activeEpochKey).toBeNull(); expect(run.coordination.calls).toHaveLength(1)
    expect(run.coordination.calls[0]).toMatchObject({ requestKey: id.requestKey, status: 'unknown', reservedCostUsd: before.coordination.calls[0].reservedCostUsd,
      usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null } })
    expect((await readInstanceAgentRunV1(id.scope, id.runId)).projection.state).toBe('cancelled')
    expect(run.worldTime.worldTurn).toBe(0); expect(run).not.toHaveProperty('situationReceipts')
  })
  it.each(['raw-before-model-event', 'model-event-before-domain-receipt'] as const)('repairs %s from the original bytes with estimated usage and zero resend', async cut => {
    const f = await setupSituationGenerationV1(cut === 'raw-before-model-event'), send = vi.fn(async () => JSON.stringify(f.value))
    if (cut === 'raw-before-model-event') {
      const add = db.agentRunEvents.add.bind(db.agentRunEvents)
      const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async row => {
        if (row.type === 'model.responded') { spy.mockRestore(); throw new Error('fixture raw response cut') }
        return add(row)
      })
    } else {
      const add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
      const spy = vi.spyOn(db.productRuntimeEvents, 'add').mockImplementation(async row => {
        if (row.type === 'ttrpg.open.call.finished') { spy.mockRestore(); throw new Error('fixture response receipt cut') }
        return add(row)
      })
    }
    await expect(generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: send })).rejects.toThrow()
    const before = (await readProductRuntimeState(f.input.sessionId)).ttrpg!.openRun!, call = before.coordination.calls[0]
    const owner = (await db.agentRuns.where('productRuntimeSessionId').equals(f.input.sessionId).toArray()).find(r => r.contractHash === call.runContractHash)!
    const id = { ...f.input, runId: owner.id!, requestKey: call.requestKey }
    expect(call.status).toBe('dispatched'); expect((await readTtrpgOpenSituationDeskV1(f.input))!.request!.responseRecovery).toBe('saved-response')
    const restored = await repairTtrpgOpenSituationDeskResponseV1(f.input)
    expect(restored?.status).toBe('usable-with-warnings'); expect(JSON.stringify(restored)).not.toContain('PRIVATE-')
    const after = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!
    expect(after.coordination.calls).toHaveLength(1)
    expect(after.coordination.calls[0]).toMatchObject({ status: 'succeeded', usage: { source: 'estimated', actualCostUsd: null } })
    expect(after.coordination.calls[0].responseArtifactHash).not.toBeNull()
    const eventCount = await db.productRuntimeEvents.count()
    await repairTtrpgOpenSituationResponseReceiptV1(id)
    expect(await db.productRuntimeEvents.count()).toBe(eventCount); expect(send).toHaveBeenCalledTimes(1)
    if (cut === 'model-event-before-domain-receipt') expect((await readTtrpgOpenSituationDeskV1(f.input))!.candidate).toBeNull()
  })
  it('refuses multiple original answers and prevents a known response from becoming unknown inside the formal finish command', async () => {
    const { id } = await dispatched(), call = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!.coordination.calls[0]
    let snapshot = await readInstanceAgentRunV1(id.scope, id.runId)
    for (const content of ['{"first":true}', '{"second":true}']) {
      const stored = await recordAgentRunArtifactV1({ ...id, productRuntimeSessionId: id.sessionId, artifactKind: 'raw-response', content,
        stepId: call.stepId, attempt: call.attempt, expectedLastSequence: snapshot.projection.lastSequence })
      snapshot = stored.snapshot
    }
    const count = await db.productRuntimeEvents.count()
    await expect(repairTtrpgOpenSituationResponseReceiptV1(id)).rejects.toThrow(/尚未恢复/)
    await expect(finishTtrpgOpenModelCallV1({ ...await openEnvelopeV1(id.sessionId, 'wrong.unknown'), ...id, status: 'unknown', responseArtifactHash: null,
      usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null }, terminalReason: 'human-abandoned-unobserved-request' })).rejects.toThrow(/不能降格/)
    expect(await db.productRuntimeEvents.count()).toBe(count)
    expect((await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('dispatched')
  })
  it('rejects foreign scope or a missing explicit unknown decision before changing any original receipt', async () => {
    const { id } = await dispatched(), count = await db.productRuntimeEvents.count()
    await expect(repairTtrpgOpenSituationResponseReceiptV1({ ...id, scope: { ...id.scope, projectId: id.scope.projectId + 1000 } })).rejects.toThrow(/尚未恢复/)
    await expect(repairTtrpgOpenSituationResponseReceiptV1({ ...id, viewerKey: 'viewer.seat.hero' })).rejects.toThrow(/尚未恢复/)
    await expect(abandonTtrpgOpenSituationWaitV1({ ...id, decision: 'cancel-with-zero-charge' as 'abandon-wait-as-unknown' })).rejects.toThrow(/明确/)
    expect(await db.productRuntimeEvents.count()).toBe(count)
  })
  it('rejects corrupted exact raw bytes instead of manufacturing a successful response receipt', async () => {
    const { id } = await dispatched(), call = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!.coordination.calls[0]
    const snapshot = await readInstanceAgentRunV1(id.scope, id.runId)
    const raw = await recordAgentRunArtifactV1({ ...id, productRuntimeSessionId: id.sessionId, artifactKind: 'raw-response', content: '{"original":true}',
      stepId: call.stepId, attempt: call.attempt, expectedLastSequence: snapshot.projection.lastSequence })
    await db.agentRunArtifacts.update(raw.artifact.id!, { content: '{"changed":true}' })
    const count = await db.productRuntimeEvents.count()
    await expect(repairTtrpgOpenSituationResponseReceiptV1(id)).rejects.toThrow(/尚未恢复/)
    expect(await db.productRuntimeEvents.count()).toBe(count)
    expect((await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('dispatched')
  })
  it('does not turn a complete imported original Run into a live response-repair or unknown-close authority', async () => {
    const { id } = await dispatched()
    const projectId = await importProjectJSON(await exportProjectJSON(id.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
    const owner = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).toArray()).find(r => r.portableRuntimeOriginJson)!
    const read = { scope, sessionId: session.id!, viewerKey: id.viewerKey, runId: owner.id!, requestKey: id.requestKey }
    const count = await db.productRuntimeEvents.count()
    await expect(repairTtrpgOpenSituationResponseReceiptV1(read)).rejects.toThrow(/尚未恢复/)
    await expect(abandonTtrpgOpenSituationWaitV1({ ...read, decision: 'abandon-wait-as-unknown' })).rejects.toThrow(/尚未结束/)
    expect(await db.productRuntimeEvents.count()).toBe(count)
  })
  it('keeps the explicit unknown terminal when the original executor returns late without creating another request', async () => {
    const f = await setupSituationGenerationV1(true)
    let release!: (value: string) => void
    const held = new Promise<string>(resolve => { release = resolve }), send = vi.fn(async () => held)
    const executing = generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: send }).then(() => 'returned', () => 'stopped')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1), { timeout: 30000 })
    const page = (await readTtrpgOpenSituationDeskV1(f.input))!, id = page.request!.read!
    await abandonTtrpgOpenSituationWaitV1({ ...id, decision: 'abandon-wait-as-unknown' })
    release(JSON.stringify(f.value)); expect(await executing).toBe('stopped')
    const run = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!
    expect(run.coordination.calls).toHaveLength(1); expect(run.coordination.calls[0]).toMatchObject({ status: 'unknown', terminalReason: 'human-abandoned-unobserved-request' })
    expect(run.coordination.activeEpochKey).toBeNull(); expect(run).not.toHaveProperty('situationReceipts'); expect(send).toHaveBeenCalledTimes(1)
  })
})

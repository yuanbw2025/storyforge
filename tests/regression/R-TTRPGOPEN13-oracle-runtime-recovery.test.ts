import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOracleRuntimeModelV1 as setup } from '../helpers/open-oracle-runtime-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenOracleInputV2 } from '../../src/lib/ttrpg/open-intent-input'
import { generateTtrpgOpenOracleCandidateV2, executeTtrpgOpenOracleRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { finishTtrpgOpenOracleInstanceDraftV1 } from '../../src/lib/ttrpg/open-runtime-draft-stop'
import { abandonTtrpgOpenOracleInstanceWaitV1, repairTtrpgOpenOracleInstanceResponseReceiptV1 } from '../../src/lib/ttrpg/open-situation-request-recovery'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import * as commands from '../../src/lib/ttrpg/runtime-commands'
import { ttrpgOpenCallBudgetV1 } from '../../src/lib/ttrpg/open-model-calls'

const decision = 'discard-this-oracle-instance-request-and-close-window' as const
describe('R-TTRPGOPEN13 original instance Oracle cancellation, observed/unknown recovery and late execution', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('explicitly cancels a real unsent original request and closes its window without any transport, facts or altered counted slot', async () => {
    const s = await setup(), prepared = await prepareTtrpgOpenOracleInputV2({ ...s.input, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    await finishTtrpgOpenOracleInstanceDraftV1({ ...s.resume(prepared), decision })
    const after = await readProductRuntimeState(s.f.sessionId), run = after.ttrpg!.openRun!
    expect(run.coordination.activeEpochKey).toBeNull(); expect(run.coordination.calls[0]).toMatchObject({ status: 'failed', terminalReason: 'cancelled-before-dispatch', usage: { actualCostUsd: 0, inputTokens: 0, outputTokens: 0 } })
    expect(run.coordination.epochs.at(-1)!.reservedCalls).toBe(0)
    expect(ttrpgOpenCallBudgetV1(run.coordination.epochs.at(-1)!, run.coordination.calls).countedRequests).toBe(1)
    expect(run.factLedger).toBeUndefined(); expect(after.entities).toEqual(s.state.entities)
    expect((await readInstanceAgentRunV1(s.f.scope, prepared.runId)).projection.state).toBe('cancelled')
    const runAI = vi.fn(async () => 'must not send')
    expect(await executeTtrpgOpenOracleRequestV1({ ...s.resume(prepared), runAI })).toEqual({ status: 'not-sent' }); expect(runAI).not.toHaveBeenCalled()
  })
  it('retains a real unadopted answer and cancels only that original Run after a saved close', async () => {
    const s = await setup(), raw = JSON.stringify({ interpretation: '这是一份尚未确认的事实候选。', facts: [s.fact] })
    const generated = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI: async () => raw })
    await finishTtrpgOpenOracleInstanceDraftV1({ ...s.resume(generated.prepared), decision })
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger).toBeUndefined()
    expect((await readInstanceAgentRunV1(s.f.scope, generated.prepared.runId)).projection.state).toBe('cancelled')
    expect(await readAgentRunArtifactExactV1({ projectId: s.f.scope.projectId, artifactKind: 'raw-response', contentHash: generated.candidate.rawResponseHash })).toBe(raw)
  })
  it('does not relabel a real confirmed fact Run as discarded or cancel its terminal receipt', async () => {
    const s = await setup(), generated = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI: async () => JSON.stringify({ interpretation: '原咨询候选。', facts: [s.fact] }) })
    await commands.reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.recovery.confirm'), ...s.resume(generated.prepared), candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })
    const before = await readProductRuntimeState(s.f.sessionId)
    await expect(finishTtrpgOpenOracleInstanceDraftV1({ ...s.resume(generated.prepared), decision })).rejects.toThrow(/已明确审阅或确认/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    expect((await readInstanceAgentRunV1(s.f.scope, generated.prepared.runId)).projection.state).toBe('completed')
  })
  it('records unknown result and possible cost before closing, then refuses a late original executor or another send', async () => {
    const s = await setup(); let entered!: () => void, release!: (value: string) => void
    const started = new Promise<void>(resolve => { entered = resolve }), response = new Promise<string>(resolve => { release = resolve })
    const runAI = vi.fn(async () => { entered(); return response })
    const pending = generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI }).then(value => ({ value }), error => ({ error }))
    await started
    const call = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.calls[0], original = (await db.agentRuns.toArray())[0]
    expect(call.status).toBe('dispatched')
    const read = { ...s.owner, runId: original.id!, requestKey: call.requestKey }
    await abandonTtrpgOpenOracleInstanceWaitV1({ ...read, decision: 'abandon-wait-as-unknown' })
    const stopped = await readProductRuntimeState(s.f.sessionId)
    expect(stopped.ttrpg!.openRun!.coordination.calls[0]).toMatchObject({ status: 'unknown', usage: { source: 'unknown', actualCostUsd: null }, responseArtifactHash: null })
    expect(stopped.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    release(JSON.stringify({ interpretation: '结束等待以后才到达的回答。', facts: [s.fact] })); await pending
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(stopped)
    expect(await executeTtrpgOpenOracleRequestV1({ ...read, runAI })).toEqual({ status: 'not-sent' }); expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('repairs an actually observed raw answer after a real response-receipt cut, without replacing it or making another call', async () => {
    const s = await setup(), raw = JSON.stringify({ interpretation: '已收到的同一原始回答。', facts: [s.fact] }), runAI = vi.fn(async () => raw)
    const cut = vi.spyOn(commands, 'finishTtrpgOpenModelCallV1').mockRejectedValueOnce(new Error('ORACLE-INSTANCE-RESPONSE-RECEIPT-CUT'))
    await expect(generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI })).rejects.toThrow(); cut.mockRestore()
    const before = await readProductRuntimeState(s.f.sessionId), call = before.ttrpg!.openRun!.coordination.calls[0], original = (await db.agentRuns.toArray())[0]
    expect(call.status).toBe('dispatched')
    const read = { ...s.owner, runId: original.id!, requestKey: call.requestKey }
    const candidate = await repairTtrpgOpenOracleInstanceResponseReceiptV1(read)
    expect(candidate?.schema).toBe('storyforge.ttrpg-open-oracle-candidate')
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.ttrpg!.openRun!.coordination.calls[0]).toMatchObject({ status: 'succeeded', usage: { source: 'estimated', actualCostUsd: null } })
    expect(after.ttrpg!.openRun!.factLedger).toBeUndefined(); expect(after.entities).toEqual(before.entities); expect(runAI).toHaveBeenCalledTimes(1)
  })
})

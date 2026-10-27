import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupNormalizationRuntimeModelV1 as setup } from '../helpers/open-normalization-runtime-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenFactNormalizationInputV2 } from '../../src/lib/ttrpg/open-intent-input'
import { generateTtrpgOpenFactNormalizationCandidateV2, executeTtrpgOpenFactNormalizationRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { finishTtrpgOpenNormalizationInstanceDraftV1, reconcileTtrpgOpenStoppedNormalizationInstanceV1 } from '../../src/lib/ttrpg/open-runtime-draft-stop'
import { repairTtrpgOpenNormalizationInstanceResponseReceiptV1, abandonTtrpgOpenNormalizationInstanceWaitV1 } from '../../src/lib/ttrpg/open-situation-request-recovery'
import { reviewTtrpgOpenOracleCandidateV1 } from '../../src/lib/ttrpg/runtime-commands'
import { reconcileTtrpgOpenOracleFactRunV1 } from '../../src/lib/ttrpg/open-oracle-adoption'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { ttrpgOpenCallBudgetV1 } from '../../src/lib/ttrpg/open-model-calls'

const decision = 'discard-this-normalization-instance-request-and-close-window' as const
describe('R-TTRPGOPEN13 original instance normalization recovery without resending', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('closes an actual unsent request, preserving its counted support slot and original accepted source', async () => {
    const s = await setup(), prepared = await prepareTtrpgOpenFactNormalizationInputV2({ ...s.normalizationInput, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    await finishTtrpgOpenNormalizationInstanceDraftV1({ ...s.resume(prepared), decision })
    const state = await readProductRuntimeState(s.f.sessionId), run = state.ttrpg!.openRun!
    expect(run.coordination.calls.at(-1)).toMatchObject({ status: 'failed', terminalReason: 'cancelled-before-dispatch', usage: { actualCostUsd: 0 } })
    expect(run.coordination.activeEpochKey).toBeNull(); expect(run.oracleReviews).toEqual(s.state.ttrpg!.openRun!.oracleReviews)
    expect(ttrpgOpenCallBudgetV1(run.coordination.epochs.at(-1)!, run.coordination.calls).countedRequests).toBe(1)
    const sends = vi.fn(async () => s.output)
    expect(await executeTtrpgOpenFactNormalizationRequestV1({ ...s.resume(prepared), runAI: sends })).toEqual({ status: 'not-sent' }); expect(sends).not.toHaveBeenCalled()
    expect((await readInstanceAgentRunV1(s.f.scope, prepared.runId)).projection.state).toBe('cancelled')
  })
  it.each(['model.responded', 'candidate.persisted', 'confirmation.recorded', 'run.cancelled'] as const)('repairs the actual %s receipt cut on the same normalized candidate and immutable source', async cut => {
    const s = await setup(), add = db.agentRunEvents.add.bind(db.agentRunEvents), sends = vi.fn(async () => s.output)
    let prepared!: Awaited<ReturnType<typeof prepareTtrpgOpenFactNormalizationInputV2>>, candidateHash = ''
    const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === cut) throw new Error('NORMALIZATION-ORIGINAL-RECEIPT-CUT:' + cut)
      return add(...args)
    })
    const work = generateTtrpgOpenFactNormalizationCandidateV2({ ...s.normalizationInput, runAI: sends, onPrepared: value => { prepared = value } })
    if (cut === 'model.responded' || cut === 'candidate.persisted') await expect(work).rejects.toThrow()
    else {
      const result = await work; candidateHash = result.candidate.candidateHash
      if (cut === 'confirmation.recorded') await expect(reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.receipt.confirm'), ...s.resume(prepared),
        candidateHash, interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })).rejects.toThrow(/确认已提交/)
      else await expect(finishTtrpgOpenNormalizationInstanceDraftV1({ ...s.resume(prepared), decision })).rejects.toThrow('NORMALIZATION-ORIGINAL-RECEIPT-CUT:run.cancelled')
    }
    spy.mockRestore()
    const before = await readProductRuntimeState(s.f.sessionId), read = s.resume(prepared)
    if (cut === 'confirmation.recorded') {
      await expect(finishTtrpgOpenNormalizationInstanceDraftV1({ ...read, decision })).rejects.toThrow(/已明确审阅或确认/)
      await reconcileTtrpgOpenOracleFactRunV1({ ...read, candidateHash })
    } else if (cut === 'run.cancelled') await reconcileTtrpgOpenStoppedNormalizationInstanceV1(read)
    else {
      const repaired = await repairTtrpgOpenNormalizationInstanceResponseReceiptV1(read)
      expect(repaired?.schema).toBe('storyforge.ttrpg-open-oracle-candidate')
      if (repaired?.schema === 'storyforge.ttrpg-open-oracle-candidate') expect(repaired.normalizationOf?.reviewHash).toBe(s.review.reviewHash)
    }
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.factLedger).toEqual(before.ttrpg!.openRun!.factLedger)
    expect(after.ttrpg!.openRun!.oracleReviews![0]).toEqual(s.review); expect(after.ttrpg!.openRun!.coordination.calls).toHaveLength(2)
    expect(sends).toHaveBeenCalledOnce(); expect(await db.agentRuns.count()).toBe(2)
  })
  it('records possible unknown cost and closes durably before a late executor returns, without rewriting the source or creating a fact', async () => {
    const s = await setup(); let release!: () => void, entered!: () => void, prepared!: Awaited<ReturnType<typeof prepareTtrpgOpenFactNormalizationInputV2>>
    const held = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { entered = r })
    const sends = vi.fn(async () => { entered(); await held; return s.output })
    const work = generateTtrpgOpenFactNormalizationCandidateV2({ ...s.normalizationInput, runAI: sends, onPrepared: value => { prepared = value } }).catch(error => error)
    await started
    await abandonTtrpgOpenNormalizationInstanceWaitV1({ ...s.resume(prepared), decision: 'abandon-wait-as-unknown' })
    const stopped = await readProductRuntimeState(s.f.sessionId)
    expect(stopped.ttrpg!.openRun!.coordination.calls.at(-1)).toMatchObject({ status: 'unknown', usage: { actualCostUsd: null }, responseArtifactHash: null })
    expect(stopped.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull(); expect(stopped.ttrpg!.openRun!.oracleReviews).toEqual(s.state.ttrpg!.openRun!.oracleReviews)
    release(); await work
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(stopped); expect(sends).toHaveBeenCalledOnce()
  })
})

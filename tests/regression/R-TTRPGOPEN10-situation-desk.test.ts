import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupSituationGenerationV1, situationGenerationOutputV1, SITUATION_GENERATION_INPUT_V1 } from '../helpers/open-situation-generation'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { prepareTtrpgOpenSituationInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { generateTtrpgOpenSituationCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { loadTtrpgOpenSituationKernelInputV1 } from '../../src/lib/ttrpg/open-generated-situation-context'
import { finishTtrpgOpenSituationDraftV1 } from '../../src/lib/ttrpg/open-generated-situation-stop'
import { TtrpgOpenSituationReceiptPendingError } from '../../src/lib/ttrpg/open-session-situation-adoption'
import { readTtrpgOpenSituationDeskV1, requestTtrpgOpenSituationDeskV1, confirmTtrpgOpenSituationDeskV1, declineTtrpgOpenSituationDeskV1,
  finishTtrpgOpenSituationDeskV1, enableTtrpgOpenSituationDeskV1, repairTtrpgOpenSituationDeskV1, recoverTtrpgOpenSituationDeskV1,
  resumeTtrpgOpenSituationDeskV1, cancelTtrpgOpenSituationDeskPreparedV1 } from '../../src/lib/ttrpg/open-situation-desk-service'

async function fresh(human = true) {
  const f = await setupSituationGenerationV1(human)
  await finishTtrpgOpenSituationDraftV1(f.input)
  return f
}
async function drafted(human = true) {
  const f = human ? await fresh(true) : await setupSituationGenerationV1(false), send = vi.fn(async () => JSON.stringify(situationGenerationOutputV1((await loadTtrpgOpenSituationKernelInputV1({ ...f.input, actorKey: 'gm' })).basis)))
  if (human) await requestTtrpgOpenSituationDeskV1({ ...f.input, submissionKey: 'explicit.request', rawInput: SITUATION_GENERATION_INPUT_V1, maximumCostUsd: 0.1, runAI: send })
  else await generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: send }) // Existing private history remains recoverable; fresh fallback UI is closed.
  const page = (await readTtrpgOpenSituationDeskV1(f.input))!
  return { f, page, send }
}
function confirmation(s: Awaited<ReturnType<typeof drafted>>) {
  return { ...s.f.input, candidateHash: s.page.candidate!.candidateHash, templateHash: s.page.templateHash!, disclosure: 'player-and-discovery-text-reviewed' as const }
}
// Each case uses the real frozen-source/Run/receipt path, including DB and coverage overhead.
describe('R-TTRPGOPEN10 explicit human situation desk', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('reads progress without sending or writing, requires exact disclosure, then separately enables the saved definition', async () => {
    const s = await drafted(), count = await db.productRuntimeEvents.count(), runs = await db.agentRunEvents.count()
    expect(s.page).toMatchObject({ privateGm: true, currentWindow: true, canConfirm: true, adopted: false, canEnable: false })
    expect(await readTtrpgOpenSituationDeskV1({ ...s.f.input, viewerKey: 'viewer.seat.hero' })).toBeNull()
    await readTtrpgOpenSituationDeskV1(s.f.input); await readTtrpgOpenSituationDeskV1(s.f.input)
    expect(await db.productRuntimeEvents.count()).toBe(count); expect(await db.agentRunEvents.count()).toBe(runs); expect(s.send).toHaveBeenCalledTimes(1)
    await expect(confirmTtrpgOpenSituationDeskV1({ ...confirmation(s), templateHash: 'f'.repeat(64) })).rejects.toThrow(/版本/)
    await expect(confirmTtrpgOpenSituationDeskV1({ ...confirmation(s), disclosure: 'unchecked' as 'player-and-discovery-text-reviewed' })).rejects.toThrow(/披露/)
    await confirmTtrpgOpenSituationDeskV1(confirmation(s))
    expect(await readTtrpgOpenSituationDeskV1(s.f.input)).toMatchObject({ adopted: true, canConfirm: false, canEnable: false, receiptPending: false })
    const enable = { ...s.f.input, templateKey: s.page.candidate!.review!.proposal.template.templateKey, submissionKey: 'explicit.enable' }
    await expect(enableTtrpgOpenSituationDeskV1(enable)).rejects.toThrow(/结束/)
    await finishTtrpgOpenSituationDeskV1(s.f.input)
    const event = await enableTtrpgOpenSituationDeskV1(enable)
    expect(JSON.parse(event.payloadJson).result.transition).toBe('activated')
    expect((await readProductRuntimeState(s.f.input.sessionId)).ttrpg!.openRun!.worldTime.worldTurn).toBe(0)
    expect((await readTtrpgOpenSituationDeskV1(s.f.input))!.accepted[0].status).toBe('active'); expect(s.send).toHaveBeenCalledTimes(1)
  })
  it('keeps the fallback host opaque and gives an ordinary player no desk or adoption/decline rights', async () => {
    const s = await drafted(false)
    expect(s.page).toMatchObject({ privateGm: false, candidate: null, templateHash: null, accepted: [], canConfirm: false })
    const text = JSON.stringify(s.page)
    for (const secret of ['PRIVATE-GM-SITUATION-SOURCE', 'PRIVATE-GENERATED-SITUATION-GOAL', 'driverGoal', 'originalText', 'personalizationSourceKeys']) expect(text).not.toContain(secret)
    expect(s.page.summary).not.toBeNull()
    await expect(readTtrpgOpenSituationDeskV1({ ...s.f.input, viewerKey: 'viewer.seat.companion.1' })).rejects.toThrow(/真人主持授权/)
    await expect(declineTtrpgOpenSituationDeskV1({ ...s.f.input, candidateHash: s.page.summary!.candidateHash })).rejects.toThrow(/真人 GM/)
    await expect(confirmTtrpgOpenSituationDeskV1({ ...s.f.input, candidateHash: s.page.summary!.candidateHash, templateHash: 'f'.repeat(64), disclosure: 'player-and-discovery-text-reviewed' })).rejects.toThrow(/版本/)
    await recoverTtrpgOpenSituationDeskV1(s.f.input); expect(s.send).toHaveBeenCalledTimes(1)
    await finishTtrpgOpenSituationDeskV1(s.f.input)
  })
  it('closes a precise declined candidate before cancellation and never adopts it or discards a saved definition', async () => {
    const s = await drafted(), candidateHash = s.page.candidate!.candidateHash
    await declineTtrpgOpenSituationDeskV1({ ...s.f.input, candidateHash }); await declineTtrpgOpenSituationDeskV1({ ...s.f.input, candidateHash })
    expect(await readTtrpgOpenSituationDeskV1(s.f.input)).toMatchObject({ declined: true, stopped: true, adopted: false, canConfirm: false, canRequest: true })
    expect((await readInstanceAgentRunV1(s.f.input.scope, s.page.request!.read!.runId)).projection.state).toBe('cancelled')
    await expect(confirmTtrpgOpenSituationDeskV1(confirmation(s))).rejects.toThrow(/版本/)
    expect((await readProductRuntimeState(s.f.input.sessionId)).ttrpg!.openRun).not.toHaveProperty('situationReceipts')
    const saved = await drafted(); await confirmTtrpgOpenSituationDeskV1(confirmation(saved))
    await expect(declineTtrpgOpenSituationDeskV1({ ...saved.f.input, candidateHash: saved.page.candidate!.candidateHash })).rejects.toThrow(/已采用/)
    expect((await readInstanceAgentRunV1(saved.f.input.scope, saved.page.request!.read!.runId)).projection.state).toBe('completed')
  })
  it('exposes and repairs only an actual committed adoption after the original Run confirmation is interrupted', async () => {
    const s = await drafted(), spy = vi.spyOn(db.agentRunEvents, 'add').mockRejectedValueOnce(new Error('fixture human desk receipt interruption'))
    await expect(confirmTtrpgOpenSituationDeskV1(confirmation(s))).rejects.toBeInstanceOf(TtrpgOpenSituationReceiptPendingError); spy.mockRestore()
    expect(await readTtrpgOpenSituationDeskV1(s.f.input)).toMatchObject({ adopted: true, receiptPending: true, canConfirm: false })
    await finishTtrpgOpenSituationDeskV1(s.f.input)
    const count = await db.productRuntimeEvents.count()
    await repairTtrpgOpenSituationDeskV1({ ...s.f.input, candidateHash: s.page.candidate!.candidateHash })
    expect(await readTtrpgOpenSituationDeskV1(s.f.input)).toMatchObject({ adopted: true, receiptPending: false })
    expect(await db.productRuntimeEvents.count()).toBe(count); expect(s.send).toHaveBeenCalledTimes(1)
  })
  it('cancels the actual unsent prepared request without dispatching and never resumes a cancelled one', async () => {
    const f = await setupSituationGenerationV1(true)
    await prepareTtrpgOpenSituationInputV1({ ...f.request, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const page = (await readTtrpgOpenSituationDeskV1(f.input))!
    expect(page.request).toMatchObject({ status: 'prepared', local: true })
    const count = await db.productRuntimeEvents.count()
    await readTtrpgOpenSituationDeskV1(f.input); expect(await db.productRuntimeEvents.count()).toBe(count)
    await cancelTtrpgOpenSituationDeskPreparedV1(f.input)
    const send = vi.fn(async () => '{}')
    await expect(resumeTtrpgOpenSituationDeskV1({ ...f.input, runAI: send })).rejects.toThrow(/尚未发送/)
    await finishTtrpgOpenSituationDeskV1(f.input); expect(send).not.toHaveBeenCalled()
    expect((await readInstanceAgentRunV1(f.input.scope, page.request!.read!.runId)).projection.state).toBe('cancelled')
  })
  it('retains an invalid original reply for human decline and validates the budget before starting a window', async () => {
    const f = await fresh()
    const events = await db.productRuntimeEvents.count()
    await expect(requestTtrpgOpenSituationDeskV1({ ...f.input, submissionKey: 'invalid.budget', rawInput: '起草', maximumCostUsd: NaN, runAI: async () => '{}' })).rejects.toThrow(/预留/)
    expect(await db.productRuntimeEvents.count()).toBe(events)
    const send = vi.fn(async () => '{"schema":"invalid-private-reply"}')
    await requestTtrpgOpenSituationDeskV1({ ...f.input, submissionKey: 'invalid.reply', rawInput: SITUATION_GENERATION_INPUT_V1, maximumCostUsd: 0.1, runAI: send })
    const page = (await readTtrpgOpenSituationDeskV1(f.input))!
    expect(page).toMatchObject({ canConfirm: false, candidate: { review: null } })
    expect(page.candidate!.artifact.originalText).toContain('invalid-private-reply')
    await declineTtrpgOpenSituationDeskV1({ ...f.input, candidateHash: page.candidate!.candidateHash }); expect(send).toHaveBeenCalledTimes(1)
  })
})

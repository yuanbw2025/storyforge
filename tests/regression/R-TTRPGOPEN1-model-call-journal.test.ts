import * as playerContext from '../../src/lib/ttrpg/open-player-context'
import { TtrpgOpenReadConflictV1 } from '../../src/lib/ttrpg/open-read-conflict'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { preparedOpenTtrpgCallV1 } from '../helpers/open-ttrpg-call'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { dispatchTtrpgOpenModelCallV1, finishTtrpgOpenModelCallV1, closeTtrpgOpenEpochV1, reserveTtrpgOpenModelCallV1,
  changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, replayProductRuntimeEvents, parseProductRuntimeState } from '../../src/lib/product/runtime-core'
import { ttrpgOpenCallBudgetV1 } from '../../src/lib/ttrpg/open-model-calls'
import { parseTtrpgOpenCoordinationV1 } from '../../src/lib/ttrpg/open-coordination'
describe('R-TTRPGOPEN1 durable request journal and exact response evidence', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  async function setup() {
    const call = await preparedOpenTtrpgCallV1()
    const event = await call.reserve()
    const requestKey = JSON.parse(event.payloadJson).call.requestKey as string
    const envelope = async (id: string) => ({ ...await openEnvelopeV1(call.fixture.sessionId, id), requestKey,
      viewerKey: OPEN_HUMAN_VIEWER, runId: call.snapshot().run.id })
    return { ...call, event, requestKey, envelope }
  }
  it.each(['disabled', 'request', 'manifest', 'partial-manifest'] as const)('rejects %s before reserving or sending', async missing => {
    const call = await preparedOpenTtrpgCallV1({ enabled: missing !== 'disabled', missingRequest: missing === 'request',
      missingManifest: missing === 'manifest', wrongManifest: missing === 'partial-manifest' })
    const before = await readProductRuntimeState(call.fixture.sessionId)
    await expect(call.reserve()).rejects.toThrow(/策略|工件|Manifest|来源不完整/)
    expect(await readProductRuntimeState(call.fixture.sessionId)).toEqual(before)
  })
  it('reserves then dispatches once, requires the original response before success, and replays the same journal', async () => {
    const call = await setup()
    expect((await call.reserve()).id).toBe(call.event.id)
    const dispatch = await dispatchTtrpgOpenModelCallV1(await call.envelope('dispatch'))
    expect(dispatch.sendAuthorized).toBe(true)
    const replayedDispatch = await dispatchTtrpgOpenModelCallV1(await call.envelope('dispatch.retry'))
    expect(replayedDispatch.event.id).toBe(dispatch.event.id)
    expect(replayedDispatch.sendAuthorized).toBe(false)
    const finish = { ...await call.envelope('finish'), status: 'succeeded' as const, responseArtifactHash: 'a'.repeat(64),
      usage: { source: 'provider' as const, inputTokens: 100, outputTokens: 20, actualCostUsd: 0.02 }, terminalReason: 'response-received' }
    await expect(finishTtrpgOpenModelCallV1(finish)).rejects.toThrow(/工件/)
    finish.responseArtifactHash = await call.record('raw-response', '{"route":"generic-check","ruleKey":"inspect"}')
    const terminal = await finishTtrpgOpenModelCallV1(finish)
    expect((await finishTtrpgOpenModelCallV1({ ...finish, ...await openEnvelopeV1(call.fixture.sessionId, 'terminal.retry') })).id).toBe(terminal.id)
    await expect(finishTtrpgOpenModelCallV1({ ...finish, terminalReason: 'changed' })).rejects.toThrow(/不同命令/)
    const state = await readProductRuntimeState(call.fixture.sessionId), epoch = state.ttrpg!.openRun!.coordination.epochs[0]
    expect(epoch).toMatchObject({ reservedCalls: 0, consumedTokens: 120, actualCostUsd: 0.02 })
    expect(state.ttrpg!.openRun!.coordination.calls[0].status).toBe('succeeded')
    const session = await db.productRuntimeSessions.get(call.fixture.sessionId)
    const events = await db.productRuntimeEvents.where('sessionId').equals(call.fixture.sessionId).sortBy('sequence')
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session!.initialStateJson), events)).toEqual(state)
  })
  it('keeps an unknown result reserved, blocks another call and records an explicit human stop', async () => {
    const call = await setup()
    await dispatchTtrpgOpenModelCallV1(await call.envelope('dispatch'))
    const state = await readProductRuntimeState(call.fixture.sessionId), epoch = state.ttrpg!.openRun!.coordination.epochs[0]
    await expect(closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(call.fixture.sessionId, 'early.close'), epochKey: epoch.epochKey,
      viewerKey: OPEN_HUMAN_VIEWER, reason: '提前关闭' })).rejects.toThrow(/等待/)
    await finishTtrpgOpenModelCallV1({ ...await call.envelope('unknown'), status: 'unknown', responseArtifactHash: null,
      usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null }, terminalReason: 'interrupted-after-dispatch' })
    const unknownState = await readProductRuntimeState(call.fixture.sessionId)
    expect(ttrpgOpenCallBudgetV1(unknownState.ttrpg!.openRun!.coordination.epochs[0], unknownState.ttrpg!.openRun!.coordination.calls))
      .toMatchObject({ countedRequests: 1, committedOrReservedTokens: 10000, blockedByUnknown: true })
    await expect(reserveTtrpgOpenModelCallV1({ ...call.reservation, ...await openEnvelopeV1(call.fixture.sessionId, 'reserve.another') })).rejects.toThrow(/预算/)
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(call.fixture.sessionId, 'close'), epochKey: epoch.epochKey,
      viewerKey: OPEN_HUMAN_VIEWER, reason: '结果未知，停止本次授权' })
    expect((await readProductRuntimeState(call.fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0].usage!.actualCostUsd).toBeNull()
  })
  it('cancels a prepared call only with zero usage and releases its pending reservation', async () => {
    const call = await setup()
    await expect(finishTtrpgOpenModelCallV1({ ...await call.envelope('invalid.finish'), status: 'unknown', responseArtifactHash: null,
      usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null }, terminalReason: 'interrupted-after-dispatch' })).rejects.toThrow(/证据/)
    await finishTtrpgOpenModelCallV1({ ...await call.envelope('cancel'), status: 'failed', responseArtifactHash: null,
      usage: { source: 'unknown', inputTokens: 0, outputTokens: 0, actualCostUsd: 0 }, terminalReason: 'cancelled-before-dispatch' })
    const state = await readProductRuntimeState(call.fixture.sessionId)
    expect(state.ttrpg!.openRun!.coordination.epochs[0]).toMatchObject({ reservedCalls: 0, consumedTokens: 0, actualCostUsd: 0 })
    expect(ttrpgOpenCallBudgetV1(state.ttrpg!.openRun!.coordination.epochs[0], state.ttrpg!.openRun!.coordination.calls).countedRequests).toBe(1)
  })
  it('rejects an imported call summary that hides a pending reservation', async () => {
    const call = await setup()
    const coordination = structuredClone((await readProductRuntimeState(call.fixture.sessionId)).ttrpg!.openRun!.coordination)
    coordination.epochs[0].reservedCalls = 0
    expect(() => parseTtrpgOpenCoordinationV1(coordination)).toThrow(/真实请求回执/)
  })
  it('records a charged response after a safety pause while refusing new dispatches', async () => {
    const call = await setup()
    await dispatchTtrpgOpenModelCallV1(await call.envelope('dispatch'))
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(call.fixture.sessionId, 'pause'), status: 'paused', reason: '暂停',
      changedBy: 'hero', viewerKey: OPEN_HUMAN_VIEWER })
    const responseArtifactHash = await call.record('raw-response', 'paused-response')
    await finishTtrpgOpenModelCallV1({ ...await call.envelope('finish'), status: 'succeeded', responseArtifactHash,
      usage: { source: 'provider', inputTokens: 12000, outputTokens: 2000, actualCostUsd: 3 }, terminalReason: 'budget-overrun' })
    const state = await readProductRuntimeState(call.fixture.sessionId)
    expect(state.ttrpg!.product.safety.status).toBe('paused')
    expect(state.ttrpg!.openRun!.coordination.epochs[0]).toMatchObject({ reservedCalls: 0, consumedTokens: 14000, actualCostUsd: 3 })
  })
  it('grants only one external send to concurrent executors of the same request', async () => {
    const call = await setup()
    const envelope = await call.envelope('concurrent.dispatch')
    const results = await Promise.all([dispatchTtrpgOpenModelCallV1(envelope), dispatchTtrpgOpenModelCallV1(envelope)])
    expect(results.filter(result => result.sendAuthorized)).toHaveLength(1)
    expect(results[0].event.id).toBe(results[1].event.id)
    expect(await db.productRuntimeEvents.where('sessionId').equals(call.fixture.sessionId).filter(event => event.type === 'ttrpg.open.call.dispatched').count()).toBe(1)
  })
  it('recovers only the real winning receipt when the competing reader observes a changed head', async () => {
    const call = await setup(), envelope = await call.envelope('controlled.concurrent')
    const realLoad = playerContext.loadTtrpgOpenPlayerContextV1
    let releaseSecond!: () => void, releaseWinner!: () => void
    const secondEntered = new Promise<void>(resolve => { releaseSecond = resolve })
    const winnerCommitted = new Promise<void>(resolve => { releaseWinner = resolve })
    let reads = 0
    vi.spyOn(playerContext, 'loadTtrpgOpenPlayerContextV1').mockImplementation(async input => {
      reads++
      if (reads === 1) { await secondEntered; return realLoad(input) }
      releaseSecond(); await winnerCommitted
      throw new TtrpgOpenReadConflictV1('controlled changed read head')
    })
    const winner = dispatchTtrpgOpenModelCallV1(envelope).then(result => { releaseWinner(); return result })
    const competitor = dispatchTtrpgOpenModelCallV1(envelope)
    const results = await Promise.all([winner, competitor])
    expect(results.map(r => r.sendAuthorized)).toEqual([true, false])
    expect(results[0].event.id).toBe(results[1].event.id)
    expect(await db.productRuntimeEvents.where('sessionId').equals(call.fixture.sessionId).filter(e => e.type === 'ttrpg.open.call.dispatched').count()).toBe(1)
  })
  it('does not turn an unrelated read conflict into a send permit or a fabricated receipt', async () => {
    const call = await setup()
    vi.spyOn(playerContext, 'loadTtrpgOpenPlayerContextV1').mockRejectedValueOnce(new TtrpgOpenReadConflictV1('controlled unrelated read drift'))
    await expect(dispatchTtrpgOpenModelCallV1(await call.envelope('unrelated.drift'))).rejects.toThrow(/unrelated read drift/)
    expect(await db.productRuntimeEvents.where('sessionId').equals(call.fixture.sessionId).filter(e => e.type === 'ttrpg.open.call.dispatched').count()).toBe(0)
  })
  it('refuses forged Run identity and excessive budgets without adding a reservation', async () => {
    const call = await preparedOpenTtrpgCallV1()
    const before = await readProductRuntimeState(call.fixture.sessionId)
    await expect(reserveTtrpgOpenModelCallV1({ ...call.reservation, runContractHash: 'f'.repeat(64) })).rejects.toThrow(/真实运行契约/)
    await expect(reserveTtrpgOpenModelCallV1({ ...call.reservation, reservedCostUsd: 2 })).rejects.toThrow(/预算/)
    await expect(reserveTtrpgOpenModelCallV1({ ...call.reservation, viewerKey: 'viewer.gm' })).rejects.toThrow(/本人活动授权/)
    expect(await readProductRuntimeState(call.fixture.sessionId)).toEqual(before)
  })
  it('rejects a stale dispatch without spending another request and permits a zero-usage cancellation', async () => {
    const call = await setup()
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(call.fixture.sessionId, 'pause'), status: 'paused', reason: '暂停',
      changedBy: 'hero', viewerKey: OPEN_HUMAN_VIEWER })
    await expect(dispatchTtrpgOpenModelCallV1(await call.envelope('dispatch'))).rejects.toThrow(/暂停/)
    await finishTtrpgOpenModelCallV1({ ...await call.envelope('cancel'), status: 'failed', responseArtifactHash: null,
      usage: { source: 'unknown', inputTokens: 0, outputTokens: 0, actualCostUsd: 0 }, terminalReason: 'cancelled-before-dispatch' })
    expect((await readProductRuntimeState(call.fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0].dispatchRef).toBeNull()
  })
})

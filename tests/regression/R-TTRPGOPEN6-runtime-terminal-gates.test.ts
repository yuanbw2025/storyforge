import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { applyProductRuntimeEvent, parseProductRuntimeState, readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { evaluateTtrpgOpenOperationTerminalV1, evaluateTtrpgOpenOperationGatesV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { createTtrpgOpenRulePlanV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { evaluateTtrpgOpenPlayerGatesV1 } from '../../src/lib/ttrpg/open-terminal-gates'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { setupChecksFixtureV1 as setup, checksTerminalV1 as terminal } from '../helpers/open-ttrpg-checks'
import { rt, operationInput, forkAndStart, approve } from '../helpers/open-ttrpg-branch-recovery'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN6 real terminal decisions and per-human runtime gates', { timeout: 90000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('classifies actual state and joins all four real player gates without time, chaos or knowledge writes', async () => {
    const f = await setup(), before = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(await resumeTtrpgOpenChecksV1(f.command)).toEqual({ status: 'executing', nextStepKey: 'narration' })
    const state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!
    expect(run.terminalReceipts![0].decision.status).toBe('actionable')
    expect(run.gateReceipts).toHaveLength(1); expect(run.gateReceipts![0]).toMatchObject({ actorKey: 'hero', viewerKey: f.command.viewerKey, result: { allApplicablePassed: true } })
    expect(run.worldTime).toEqual(before.worldTime); expect(run.chaos).toEqual(before.chaos); expect(run.knowledge).toEqual(before.knowledge)
    await resumeTtrpgOpenChecksV1(f.command); expect(await readProductRuntimeState(f.command.sessionId)).toEqual(state)
    await replay(f.command.sessionId)
  })
  it('evaluates every actual human independently and does not use the companion private point for the original player', async () => {
    const f = await setup({ multiHuman: true, privatePoint: true })
    expect((await resumeTtrpgOpenChecksV1(f.command)).status).toBe('awaiting-gate-recovery')
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(run.gateReceipts!.map(r => r.actorKey).sort()).toEqual(['companion.1', 'hero'])
    expect(run.gateReceipts!.find(r => r.actorKey === 'hero')!.result.results['exit-exists'].passed).toBe(false)
    expect(run.gateReceipts!.find(r => r.actorKey === 'companion.1')!.result.results['exit-exists'].passed).toBe(true)
    expect(run.operations[0].businessRefs.some(r => r.stepKey === 'gates')).toBe(false);await replay(f.command.sessionId)
  })
  it('returns the original terminal event on retry and rejects a changed viewer or forged eligibility', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.command.sessionId), command = await operationInput(f.command.sessionId, f.command.operationKey, 'terminal')
    await expect(evaluateTtrpgOpenOperationTerminalV1({ ...command, viewerKey: 'viewer.gm' })).rejects.toThrow()
    const event = await evaluateTtrpgOpenOperationTerminalV1(command)
    expect(await evaluateTtrpgOpenOperationTerminalV1(command)).toEqual(event)
    const payload = JSON.parse(event.payloadJson); payload.receipt.decision.status = 'closure-available'
    expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })).toThrow(/真实状态/)
  })
  it.each(['trigger', 'maximum'])('offers a real %s closure before treating empty active situations as a deadlock', async mode => {
    const f = await setup({ empty: true, closure: mode === 'trigger', maximum: mode === 'maximum' })
    expect(await resumeTtrpgOpenChecksV1(f.command)).toMatchObject({ status: 'awaiting-stage-closure', nextStepKey: 'gates', terminalStatus: mode === 'trigger' ? 'closure-available' : 'maximum-reached' })
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(run.situations.active).toEqual([]); expect(run.gateReceipts).toBeUndefined(); expect(run.stage.status).toBe('open')
    expect(run.operations[0].businessRefs.some(r => r.stepKey === 'gates')).toBe(false)
    await replay(f.command.sessionId)
  })
  it('does not use another actor private exit, nor repeatedly increment failure on unchanged state', async () => {
    const f = await setup({ privatePoint: true })
    expect(await resumeTtrpgOpenChecksV1(f.command)).toMatchObject({ status: 'awaiting-gate-recovery' })
    const state = await readProductRuntimeState(f.command.sessionId), result = rt(state).openRun!.gateReceipts![0].result
    expect(result.results['exit-exists'].passed).toBe(false); expect(result.consecutiveFailures['exit-exists']).toBe(1)
    await resumeTtrpgOpenChecksV1(f.command); expect(await readProductRuntimeState(f.command.sessionId)).toEqual(state)
    await expect(evaluateTtrpgOpenOperationGatesV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'gates.settled'), actorKey: null })).rejects.toThrow(/失败或过期/)
    await replay(f.command.sessionId)
  })
  it('requires the real warning lead and retains G3 failure instead of silently authorizing the next front stage', async () => {
    const f = await setup({ noWarning: true })
    expect((await resumeTtrpgOpenChecksV1(f.command)).status).toBe('awaiting-gate-recovery')
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(run.gateReceipts![0].result.results['telegraph-complete'].passed).toBe(false); expect(run.fronts[0].stageKey).toBeNull()
    await replay(f.command.sessionId)
  })
  it('refuses a new known-overlong action before committing effects or a new operation', async () => {
    const f = await setup({ maximum: true }), state = await readProductRuntimeState(f.command.sessionId)
    await expect(createTtrpgOpenRulePlanV1({ state, content: f.f.runtimePackage.ttrpg!, runtimeSourceHash: rt(state).openRun!.operations[0].plan.runtimeSourceHash, request: f.f.request })).rejects.toThrow(/最大世界轮次/)
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(state)
    await replay(f.command.sessionId)
  })
  it('rejects a known multi-turn action that would cross the maximum before any new effect or tick commits', async () => {
    const f = await setup({ nearlyMaximum: true }), state = await readProductRuntimeState(f.command.sessionId), request = { ...f.f.request }
    Reflect.deleteProperty(request, 'discovery')
    expect(rt(state).openRun!.worldTime.worldTurn).toBe(9)
    await expect(createTtrpgOpenRulePlanV1({ state, content: f.f.runtimePackage.ttrpg!, runtimeSourceHash: rt(state).openRun!.operations[0].plan.runtimeSourceHash, request })).rejects.toThrow(/超过最大世界轮次/)
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(state);await replay(f.command.sessionId)
  })
  it('does not advertise a visible intervention as an exit when its suggested actions are currently unavailable', async () => {
    const f = await setup();await terminal(f.command)
    const state = await readProductRuntimeState(f.command.sessionId), runtime = rt(state), receipt = runtime.openRun!.terminalReceipts![0]
    // Pure rule-availability counterexample; no live browser data is edited.
    for (const ability of Object.values(runtime.product.abilityStates)) if (ability.actorInstanceId === 'hero') ability.disabledReasons = ['disabled.this-turn']
    state.ttrpg = runtime
    const result = evaluateTtrpgOpenPlayerGatesV1({ state, terminal: receipt, actorKey: 'hero', viewerKey: f.command.viewerKey, basisHash: await hashProductProductionValueV2('unavailable method') })
    expect(result.results['exit-exists'].passed).toBe(false)
  })
  it('uses only observed actual private grants for predecessor proof; hearsay and an old globally discovered ref do not flip G2', async () => {
    const f = await setup({ privateDiscovery: true }); await terminal(f.command)
    const state = await readProductRuntimeState(f.command.sessionId), runtime = rt(state), receipt = runtime.openRun!.terminalReceipts![0]
    const actual = evaluateTtrpgOpenPlayerGatesV1({ state, terminal: receipt, actorKey: 'hero', viewerKey: f.command.viewerKey, basisHash: await hashProductProductionValueV2('actual observed') })
    expect(actual.results['hypothesis-formable'].passed).toBe(true)
    // Pure role/reliability counterexample, preserving the real source session untouched.
    for (const entry of runtime.openRun!.knowledge) entry.reliability = 'hearsay'
    state.ttrpg = runtime
    const hearsay = evaluateTtrpgOpenPlayerGatesV1({ state, terminal: receipt, actorKey: 'hero', viewerKey: f.command.viewerKey, basisHash: await hashProductProductionValueV2('hearsay probe') })
    expect(hearsay.results['hypothesis-formable'].passed).toBe(false)
  })
  it.each([false, true])('retains committed gate=%s at a branch/backup cutpoint without recounting the parent or accepting old consent', async committed => {
    const f = await setup()
    await terminal(f.command)
    if (committed) await resumeTtrpgOpenChecksV1(f.command)
    const child = await forkAndStart(f.command.sessionId); await approve(child.sessionId, child.op.operationKey)
    const command = { ...f.command, sessionId: child.sessionId, operationKey: child.op.operationKey, frozenPlanHash: child.op.planHash }
    const outcome = await resumeTtrpgOpenChecksV1(command)
    expect(outcome).toEqual({ status: 'executing', nextStepKey: 'narration' })
    const state = await readProductRuntimeState(child.sessionId), run = rt(state).openRun!
    expect(run.terminalReceipts).toHaveLength(1); expect(run.gateReceipts).toHaveLength(1)
    expect(run.gateReceipts![0].sourceRef.sessionKey).toBe(committed ? rt(await readProductRuntimeState(f.command.sessionId)).sessionKey : rt(state).sessionKey)
    const project = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId)), restored = await Promise.all((await db.productRuntimeSessions.where('projectId').equals(project).toArray()).map(s => readProductRuntimeState(s.id!)))
    expect(rt(restored.find(s => rt(s).sessionKey === rt(state).sessionKey)!).openRun).toEqual(run)
    await replay(child.sessionId)
  })
})

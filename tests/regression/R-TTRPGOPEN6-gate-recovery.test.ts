import { setupGateHintFixtureV1 as setupHint } from '../helpers/open-ttrpg-gate-recovery'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { operationInput, forkAndStart, approve, rt } from '../helpers/open-ttrpg-branch-recovery'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { recoverTtrpgOpenOperationGatesV1, stopTtrpgOpenOperationGateRecoveryV1, startTtrpgOpenEpochV1, changeTtrpgSafetyStatus, changeTtrpgSituationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { chooseTtrpgOpenGateRecoveryV1 } from '../../src/lib/ttrpg/open-gate-recovery'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { loadTtrpgOpenHumanViewV1 } from '../../src/lib/ttrpg/open-player-context'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
async function repairInput(command: Awaited<ReturnType<typeof setupHint>>['command']) {
  const state = await readProductRuntimeState(command.sessionId), selected = chooseTtrpgOpenGateRecoveryV1(state,command.operationKey)!
  return { ...await operationInput(command.sessionId,command.operationKey,'gates.recovery'), evaluationRef: selected.evaluation.sourceRef, evaluationBasisHash: selected.evaluation.result.evaluationBasisHash!, gateKey: selected.gateKey, actorKey: selected.evaluation.actorKey }
}
async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN6 bounded real recovery and stopped authority', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  it('grants one actual optional fail-forward observation to the requesting player without mechanical cost, then re-evaluates the real gate', async () => {
    const f = await setupHint();expect((await resumeTtrpgOpenChecksV1(f.command)).status).toBe('awaiting-gate-recovery')
    const before = await readProductRuntimeState(f.command.sessionId), input = await repairInput(f.command)
    expect(input.gateKey).toBe('hypothesis-formable')
    const event = await recoverTtrpgOpenOperationGatesV1(input)
    expect(await recoverTtrpgOpenOperationGatesV1(input)).toEqual(event)
    const state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!
    expect(state.entities).toEqual(before.entities);expect(run.worldTime).toEqual(rt(before).openRun!.worldTime)
    expect(run.coordination).toEqual(rt(before).openRun!.coordination)
    expect(run.knowledge).toMatchObject([{ evidenceRef: 'evidence.lamp', audience: 'private', recipientActorKeys: ['hero'], reliability: 'observed' }])
    expect(run.gateRecoveries).toMatchObject([{ action: 'evidence', result: 'observed', stoppedRef: null }])
    const human = await loadTtrpgOpenHumanViewV1({ scope: f.f.scope,sessionId: f.command.sessionId,actorKey: 'hero',viewerKey: f.command.viewerKey })
    expect(human.view.knowledge).toHaveLength(1)
    expect(await resumeTtrpgOpenChecksV1(f.command)).toEqual({ status: 'executing',nextStepKey: 'narration' })
    await replay(f.command.sessionId)
  })
  it.each([{ unavailable: true }, { privateRecipient: true }])('preserves a real unavailable/private hint failure %j and stops without reroll, charges or a new authorization window', async options => {
    const f = await setupHint(options);await resumeTtrpgOpenChecksV1(f.command)
    const input = await repairInput(f.command), before = await readProductRuntimeState(f.command.sessionId)
    await recoverTtrpgOpenOperationGatesV1(input)
    expect((await resumeTtrpgOpenChecksV1(f.command)).status).toBe('gate-recovery-stopped')
    const state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!
    expect(run.knowledge).toEqual([]);expect(run.gateRecoveries).toMatchObject([{ action: 'none',result: 'unavailable',stoppedRef: expect.any(Object) }])
    expect(run.coordination.activeEpochKey).toBeNull();expect(run.coordination.epochs[0].status).toBe('closed')
    expect(run.operations[0].status).toBe('executing');expect(run.operations[0].businessRefs.some(r => r.stepKey === 'gates')).toBe(false)
    expect(state.entities).toEqual(before.entities);expect(run.worldTime).toEqual(rt(before).openRun!.worldTime)
    await resumeTtrpgOpenChecksV1(f.command);expect(await readProductRuntimeState(f.command.sessionId)).toEqual(state)
    await expect(startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.command.sessionId,'bypass'),viewerKey: f.command.viewerKey,triggerKind: 'submit-action',rawInput: '绕开尚未完成的质量门' })).rejects.toThrow(/停止/)
    db.close();await db.open();expect(await readProductRuntimeState(f.command.sessionId)).toEqual(state);await replay(f.command.sessionId)
  })
  it('rejects stale/changed evaluation, unauthorized viewer, premature stop and a forged knowledge result', async () => {
    const f = await setupHint();await resumeTtrpgOpenChecksV1(f.command)
    const input = await repairInput(f.command), before = await readProductRuntimeState(f.command.sessionId)
    await expect(recoverTtrpgOpenOperationGatesV1({ ...input,evaluationBasisHash: 'f'.repeat(64) })).rejects.toThrow()
    await expect(recoverTtrpgOpenOperationGatesV1({ ...input,viewerKey: 'viewer.seat.companion.1' })).rejects.toThrow()
    await expect(stopTtrpgOpenOperationGateRecoveryV1(await operationInput(f.command.sessionId,f.command.operationKey,'gates.recovery.stop'))).rejects.toThrow()
    const event = await recoverTtrpgOpenOperationGatesV1(input), payload = JSON.parse(event.payloadJson);payload.receipt.targetRef = 'evidence.door'
    expect(() => applyProductRuntimeEvent(before,{ ...event,payloadJson: JSON.stringify(payload) })).toThrow()
    await expect(recoverTtrpgOpenOperationGatesV1({ ...input,gateKey: 'exit-exists' })).rejects.toThrow()
  })
  it('records a genuine G1 attempt with no queued exit and preserves the blocked path instead of inventing one', async () => {
    const f = await setupChecksFixtureV1({ privatePoint: true });await resumeTtrpgOpenChecksV1(f.command)
    const input = await repairInput(f.command);expect(input.gateKey).toBe('exit-exists')
    await recoverTtrpgOpenOperationGatesV1(input);await resumeTtrpgOpenChecksV1(f.command)
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(run.gateRecoveries![0]).toMatchObject({ action: 'none',result: 'unavailable' });expect(run.situations.active).toHaveLength(1)
    expect(run.coordination.activeEpochKey).toBeNull();await replay(f.command.sessionId)
  })
  it('retains a missing warning gate and stops instead of fabricating the warning or advancing the threat', async () => {
    const f = await setupChecksFixtureV1({ noWarning: true });await resumeTtrpgOpenChecksV1(f.command)
    const input = await repairInput(f.command);expect(input.gateKey).toBe('telegraph-complete')
    const before = await readProductRuntimeState(f.command.sessionId)
    await recoverTtrpgOpenOperationGatesV1(input);await resumeTtrpgOpenChecksV1(f.command)
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(run.fronts).toEqual(rt(before).openRun!.fronts);expect(run.pressureSignals).toEqual(rt(before).openRun!.pressureSignals)
    expect(run.gateRecoveries![0]).toMatchObject({ action: 'none',result: 'unavailable',stoppedRef: expect.any(Object) });await replay(f.command.sessionId)
  })
  it('preserves committed hint provenance through a real child recovery and project backup without a second disclosure', async () => {
    const f = await setupHint();await resumeTtrpgOpenChecksV1(f.command);await recoverTtrpgOpenOperationGatesV1(await repairInput(f.command))
    const child = await forkAndStart(f.command.sessionId);await approve(child.sessionId,child.op.operationKey)
    const command = { ...f.command,sessionId: child.sessionId,operationKey: child.op.operationKey,frozenPlanHash: child.op.planHash }
    expect(await resumeTtrpgOpenChecksV1(command)).toEqual({ status: 'executing',nextStepKey: 'narration' })
    const state = await readProductRuntimeState(child.sessionId), run = rt(state).openRun!
    expect(run.gateRecoveries).toHaveLength(1);expect(run.knowledge).toHaveLength(1)
    const projectId = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId))
    const restored = await Promise.all((await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).map(s => readProductRuntimeState(s.id!)))
    expect(rt(restored.find(s => rt(s).sessionKey === rt(state).sessionKey)!).openRun).toEqual(run);await replay(child.sessionId)
  })
  it('keeps paused recovery read-only', async () => {
    const f = await setupHint();await resumeTtrpgOpenChecksV1(f.command);const input = await repairInput(f.command)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.command.sessionId,'pause'),status: 'paused',reason: '真实安全暂停',changedBy: 'hero',viewerKey: f.command.viewerKey })
    const before = await readProductRuntimeState(f.command.sessionId)
    await expect(recoverTtrpgOpenOperationGatesV1({ ...input,...await operationInput(f.command.sessionId,f.command.operationKey,'gates.recovery') })).rejects.toThrow()
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(before)
  })
  it('repairs the actual epoch starter first and never treats their private observation as the other human gate passing', async () => {
    const f = await setupHint({ multiHuman: true });await resumeTtrpgOpenChecksV1(f.command)
    const input = await repairInput(f.command);expect(input.actorKey).toBe('hero')
    await recoverTtrpgOpenOperationGatesV1(input)
    expect((await resumeTtrpgOpenChecksV1(f.command)).status).toBe('gate-recovery-stopped')
    const own = await loadTtrpgOpenHumanViewV1({ scope: f.f.scope,sessionId: f.command.sessionId,actorKey: 'hero',viewerKey: 'viewer.seat.hero' })
    const other = await loadTtrpgOpenHumanViewV1({ scope: f.f.scope,sessionId: f.command.sessionId,actorKey: 'companion.1',viewerKey: 'viewer.seat.companion.1' })
    expect(own.view.knowledge).toHaveLength(1);expect(other.view.knowledge).toEqual([])
    await replay(f.command.sessionId)
  })
  it('attempts only the real FIFO head and retains its capacity reservation without inventing room or dropping other situations', async () => {
    const f = await setupChecksFixtureV1({ privatePoint: true }, pkg => {
      const c = pkg.ttrpg!.campaign, original = c.situationTemplates[0]
      for (let i = 1; i <= 5; i++) {
        const next = structuredClone(original);next.templateKey = `situation.gate.queue.${i}`
        next.evidence.forEach(e => { e.clueRef += `.queue.${i}` })
        if (i === 5) next.interventionPoints.forEach(p => { p.visibleTo = 'party';p.knownByActorKeys = [] })
        c.situationTemplates.push(next)
        if (i < 5) c.openingSituationKeys.push(next.templateKey)
        else { c.fronts[0].escalationStages[0].newSituationTemplateKey = next.templateKey;c.fronts[0].escalationStages[0].atClockValue = 1 }
      }
    }, async f => {
      for (const templateKey of f.campaign.openingSituationKeys.slice(1)) await changeTtrpgSituationV1({ ...await openEnvelopeV1(f.sessionId,`opening.${templateKey}`),templateKey,activationReason: 'opening',mode: 'auto',viewerKey: 'viewer.seat.hero' })
    })
    await resumeTtrpgOpenChecksV1(f.command)
    const before = await readProductRuntimeState(f.command.sessionId), queued = rt(before).openRun!.situations.queued[0]
    expect(rt(before).openRun!.situations.active).toHaveLength(5)
    await recoverTtrpgOpenOperationGatesV1(await repairInput(f.command));await resumeTtrpgOpenChecksV1(f.command)
    const after = await readProductRuntimeState(f.command.sessionId), run = rt(after).openRun!
    expect(run.gateRecoveries![0]).toMatchObject({ action: 'queue',targetRef: queued.situationKey,result: 'retained' })
    expect(run.situations.queued).toEqual(rt(before).openRun!.situations.queued);expect(run.situations.active).toEqual(rt(before).openRun!.situations.active)
    expect(after.entities).toEqual(before.entities);expect(run.worldTime).toEqual(rt(before).openRun!.worldTime)
    expect(run.coordination.activeEpochKey).toBeNull();await replay(f.command.sessionId)
  })
  it('requests author review only after three real failed evaluations with renewed child authority, never from repeated reads/continues', async () => {
    const f = await setupHint({ unavailable: true });let command = f.command
    for (let expected = 1; expected <= 3; expected++) {
      await resumeTtrpgOpenChecksV1(command)
      const input = await repairInput(command)
      const selected = chooseTtrpgOpenGateRecoveryV1(await readProductRuntimeState(command.sessionId),command.operationKey)!
      expect(selected.evaluation.result.consecutiveFailures['hypothesis-formable']).toBe(expected)
      expect(selected.evaluation.result.requestAuthorReview.includes('hypothesis-formable')).toBe(expected === 3)
      await recoverTtrpgOpenOperationGatesV1(input);await resumeTtrpgOpenChecksV1(command)
      const stopped = await readProductRuntimeState(command.sessionId)
      await resumeTtrpgOpenChecksV1(command);expect(await readProductRuntimeState(command.sessionId)).toEqual(stopped)
      if (expected < 3) {
        const child = await forkAndStart(command.sessionId);await approve(child.sessionId,child.op.operationKey)
        command = { ...command,sessionId: child.sessionId,operationKey: child.op.operationKey,frozenPlanHash: child.op.planHash }
      }
    }
    await replay(command.sessionId)
  })
})

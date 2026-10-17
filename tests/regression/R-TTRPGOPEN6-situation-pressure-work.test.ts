import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { completeTtrpgOpenPressureSituationV1, ttrpgOpenOperationCommandIdV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenPressureV1 } from '../../src/lib/ttrpg/open-pressure-coordinator'
import { setupSituationPressureWorkV1 as setup } from '../helpers/open-ttrpg-situation'
import { rt, forkAndStart, approve } from '../helpers/open-ttrpg-branch-recovery'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

async function input(f: Awaited<ReturnType<typeof setup>>) {
  const state = await readProductRuntimeState(f.command.sessionId)
  return { ...await openEnvelopeV1(f.command.sessionId, await ttrpgOpenOperationCommandIdV1(rt(state).sessionKey, f.command.operationKey, `pressure.work.${f.workKey}.situation`)), ...f.command,
    cycleKey: f.cycleKey, workKey: f.workKey }
}
async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN6 actual pressure to situation lifecycle', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('activates the exact frozen consequence with a scoped identity, actual receipt, replay and no extra time', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.command.sessionId), command = await input(f)
    const event = await completeTtrpgOpenPressureSituationV1(command)
    expect(await completeTtrpgOpenPressureSituationV1(command)).toEqual(event)
    const state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!, instance = run.situations.active.find(i => i.templateKey === 'situation.after-storm')!
    expect(instance).toMatchObject({ status: 'active', activatedAtSequence: event.sequence, activatedAtWorldTurn: 3, activationReason: 'front-escalation' })
    expect(instance.situationKey).not.toBe(`${instance.templateKey}.${event.sequence}`)
    expect(run.worldTime).toEqual(rt(before).openRun!.worldTime)
    expect(run.knowledge).toEqual(rt(before).openRun!.knowledge)
    expect(run.pressureCycles!.find(c => c.cycleKey === f.cycleKey)!.work[0].completedRef).toEqual({ sessionKey: rt(state).sessionKey, sequence: event.sequence })
    expect(await resumeTtrpgOpenPressureV1(f.command)).toEqual({ status: 'executing', nextStepKey: f.ownerStepKey.replace('pressure','situations') })
    await replay(f.command.sessionId)
  })
  it('admits I2 from a real published telegraph while keeping a GM-only clock out of the actor reason', async () => {
    const f = await setup({ whyTelegraph: true })
    const event = await completeTtrpgOpenPressureSituationV1(await input(f))
    expect(JSON.parse(event.payloadJson).result.transition).toBe('activated')
    expect(rt(await readProductRuntimeState(f.command.sessionId)).openRun!.pressureSignals![0].recipientActorKeys).toContain('hero')
    await replay(f.command.sessionId)
  })
  it('deduplicates against the real existing instance and does not erase its discovered evidence or knowledge', async () => {
    const f = await setup({ duplicate: true }), before = await readProductRuntimeState(f.command.sessionId), instance = rt(before).openRun!.situations.active[0]
    const event = await completeTtrpgOpenPressureSituationV1(await input(f)), state = await readProductRuntimeState(f.command.sessionId)
    expect(JSON.parse(event.payloadJson).result.transition).toBe('existing')
    expect(rt(state).openRun!.situations.active).toEqual([instance])
    expect(rt(state).openRun!.knowledge).toEqual(rt(before).openRun!.knowledge)
    await replay(f.command.sessionId)
  })
  it('queues the frozen escalation behind the actual five active instances without falsely activating a sixth', async () => {
    const f = await setup({ full: true }), before = await readProductRuntimeState(f.command.sessionId)
    expect(rt(before).openRun!.situations.active).toHaveLength(5)
    const event = await completeTtrpgOpenPressureSituationV1(await input(f)), run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(run.situations.active).toHaveLength(5)
    expect(run.situations.queued).toMatchObject([{ templateKey: 'situation.after-storm', status: 'queued', queuePosition: 0 }])
    expect(JSON.parse(event.payloadJson).result.transition).toBe('queued')
    expect(run.pressureCycles!.find(c => c.cycleKey === f.cycleKey)!.work[0].completedRef).not.toBeNull()
    await replay(f.command.sessionId)
  })
  it('records a real I1 rejection without inventing an instance or blocking the subsequent runtime stage forever', async () => {
    const f = await setup({ inaccessible: true }), before = await readProductRuntimeState(f.command.sessionId)
    const event = await completeTtrpgOpenPressureSituationV1(await input(f)), state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!
    expect(JSON.parse(event.payloadJson).result).toMatchObject({ transition: 'rejected', instance: null, rejection: { templateKey: 'situation.after-storm' } })
    expect(run.situations).toEqual(rt(before).openRun!.situations)
    expect(run.knowledge).toEqual(rt(before).openRun!.knowledge)
    expect(run.failures.slice(-1)[0]).toMatchObject({ category: 'situation-rejected', atSequence: event.sequence })
    expect(run.pressureCycles!.find(c => c.cycleKey === f.cycleKey)!.work[0]).toMatchObject({ situationDisposition: 'rejected', completedRef: { sessionKey: rt(state).sessionKey, sequence: event.sequence } })
    expect(await resumeTtrpgOpenPressureV1(f.command)).toEqual({ status: 'executing', nextStepKey: f.ownerStepKey.replace('pressure','situations') })
    await replay(f.command.sessionId)
  })
  it('resolves only the actual defeated front instance, keeps a terminal snapshot/knowledge and changes chaos only in E12', async () => {
    const f = await setup({ defeat: true }), before = await readProductRuntimeState(f.command.sessionId), original = rt(before).openRun!.situations.active[0]
    expect(rt(before).openRun!.fronts[0].defeated).toBe(true)
    const event = await completeTtrpgOpenPressureSituationV1(await input(f)), state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!
    expect(run.situations.active).toEqual([])
    expect(run.situations.history![0]).toMatchObject({ sourceRef: { sessionKey: rt(state).sessionKey, sequence: event.sequence },
      instance: { situationKey: original.situationKey, status: 'resolved', resolutionKind: 'front-defeated', discoveredEvidenceRefs: original.discoveredEvidenceRefs } })
    expect(run.situations.cooldowns[original.templateKey]).toBe(13)
    expect(run.knowledge).toEqual(rt(before).openRun!.knowledge)
    expect(run.chaos).toEqual(rt(before).openRun!.chaos)
    expect(await resumeTtrpgOpenPressureV1(f.command)).toEqual({ status: 'executing', nextStepKey: f.ownerStepKey.replace('pressure','situations') })
    await replay(f.command.sessionId)
  })
  it('rejects forged transitions and keeps the pending original on a wrong viewer', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.command.sessionId), envelope = await input(f)
    await expect(completeTtrpgOpenPressureSituationV1({ ...envelope, viewerKey: 'viewer.gm' })).rejects.toThrow()
    const event = await completeTtrpgOpenPressureSituationV1(envelope), payload = JSON.parse(event.payloadJson)
    payload.result.instance.activationReason = 'opening'
    expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })).toThrow(/确定性结果/)
  })
  it.each([false, true])('retains committed=%s across a child and backup without another activation or cleanup', async committed => {
    const f = await setup({ defeat: committed })
    if (committed) await completeTtrpgOpenPressureSituationV1(await input(f))
    const child = await forkAndStart(f.command.sessionId)
    await approve(child.sessionId, child.op.operationKey)
    const command = { ...f.command, sessionId: child.sessionId, operationKey: child.op.operationKey, frozenPlanHash: child.op.planHash }
    expect(await resumeTtrpgOpenPressureV1(command)).toEqual({ status: 'executing', nextStepKey: f.ownerStepKey.replace('pressure','situations') })
    const final = await readProductRuntimeState(child.sessionId), events = await db.productRuntimeEvents.where('sessionId').equals(child.sessionId).toArray()
    expect(events.filter(e => e.type === 'ttrpg.open.pressure.situation.completed')).toHaveLength(committed ? 0 : 1)
    const project = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId)), sessions = await db.productRuntimeSessions.where('projectId').equals(project).toArray()
    const states = await Promise.all(sessions.map(s => readProductRuntimeState(s.id!)))
    expect(rt(states.find(s => rt(s).sessionKey === rt(final).sessionKey)!).openRun!.situations).toEqual(rt(final).openRun!.situations)
    await replay(child.sessionId)
  })
})

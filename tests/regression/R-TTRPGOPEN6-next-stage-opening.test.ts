import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { openTtrpgNextStageV1 } from '../../src/lib/ttrpg/runtime-commands'
import { parseProductRuntimeState, replayProductRuntimeEvents, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { verifyTtrpgOpenStageOpeningReceiptsV1 } from '../../src/lib/ttrpg/open-stage-opening-contract'
import { prepareTtrpgOpenNextStagePlanV1 } from '../../src/lib/ttrpg/open-stage-opening-plan'

import { setupClosedStageOpeningV1 as closed } from '../helpers/open-ttrpg-stage-opening'

describe('R-TTRPGOPEN6 explicit next-stage preparation', { timeout: 30000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('checks a lawful opening after actual closure and preserves time, costs, knowledge and original history', async () => {
    const { input } = await closed(), original = structuredClone(input.state)
    const { plan, proposedState } = await prepareTtrpgOpenNextStagePlanV1(input)
    expect(input.state).toEqual(original)
    expect(rt(proposedState).openRun!.stage).toEqual({ status: 'open', openedAtWorldTurn: 1, closedAtWorldTurn: null })
    const before = rt(original).openRun!, after = rt(proposedState).openRun!
    for (const field of ['worldTime', 'chaos', 'clocks', 'fronts', 'knowledge', 'factLedger', 'operations', 'coordination', 'stageClosures'] as const) expect(after[field]).toEqual(before[field])
    expect(proposedState.entities).toEqual(original.entities)
    expect(plan.selected[0].transition).toBe('continued')
    expect(plan.humanChecks.length).toBeGreaterThan(0)
    expect(plan.humanChecks.every(h => h.checks.filter(c => ['exit-exists', 'hypothesis-formable'].includes(c.gateKey)).every(c => c.applicable && c.passed))).toBe(true)
    expect(plan.stageRevision).toMatch(/^stage\.opening\.[0-9a-f]{64}$/)
    expect(plan).toEqual((await prepareTtrpgOpenNextStagePlanV1(input)).plan)
    expect((await prepareTtrpgOpenNextStagePlanV1({ ...input, commandId: 'next-stage.other' })).plan.stageRevision).not.toBe(plan.stageRevision)
  })

  it('commits an exact reviewed opening once and retains it through replay and real backup import', async () => {
    const { f, input } = await closed(), { plan } = await prepareTtrpgOpenNextStagePlanV1(input)
    const command = { ...await openEnvelopeV1(f.command.sessionId, input.commandId), viewerKey: input.viewerKey,
      templateKeys: input.templateKeys, expectedPlanHash: plan.planHash }
    const before = await readProductRuntimeState(command.sessionId)
    const [event, duplicate] = await Promise.all([openTtrpgNextStageV1(command), openTtrpgNextStageV1(command)])
    expect(duplicate).toEqual(event)
    expect(await openTtrpgNextStageV1(command)).toEqual(event)
    const state = await readProductRuntimeState(command.sessionId), row = (await db.productRuntimeSessions.get(command.sessionId))!
    expect(rt(state).openRun!.stage.status).toBe('open')
    expect(rt(state).openRun!.stageOpenings).toHaveLength(1)
    expect(rt(state).openRun!.operations).toEqual(rt(before).openRun!.operations)
    await verifyTtrpgOpenStageOpeningReceiptsV1(rt(state).openRun!.stageOpenings!)
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(row.id!).sortBy('sequence'))).toEqual(state)
    const child = await branchProductRuntimeSession({ parentSessionId: row.id!, throughSequence: state.lastSequence, title: '阶段开启后的独立分支' })
    const childState = rt(await readProductRuntimeState(child.id!))
    expect(childState.authorization).toBeNull()
    expect(childState.product.sessionZero.completed).toBe(false)
    expect(childState.openRun!.stageOpenings).toEqual(rt(state).openRun!.stageOpenings)
    const projectId = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId))
    const restoredSession = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => JSON.parse(s.initialStateJson).ttrpg?.sessionKey === rt(state).sessionKey)!
    expect(rt(await readProductRuntimeState(restoredSession.id!)).openRun).toEqual(rt(state).openRun)
    await deleteProductRuntimeSession(row.id!)
    expect(rt(await readProductRuntimeState(child.id!)).openRun!.stageOpenings).toEqual(rt(state).openRun!.stageOpenings)
  })

  it('rejects a stale preview without an opening event or state changes', async () => {
    const { f, input } = await closed(), { plan } = await prepareTtrpgOpenNextStagePlanV1(input)
    const envelope = await openEnvelopeV1(f.command.sessionId, input.commandId)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.command.sessionId, 'stage.safety.pause'), viewerKey: input.viewerKey,
      changedBy: 'hero', status: 'paused', reason: '真人在预览之后暂停' })
    const before = await readProductRuntimeState(f.command.sessionId)
    await expect(openTtrpgNextStageV1({ ...envelope, viewerKey: input.viewerKey, templateKeys: input.templateKeys, expectedPlanHash: plan.planHash })).rejects.toThrow(/变化|暂停/)
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(before)
    expect(await db.productRuntimeEvents.where('sessionId').equals(f.command.sessionId).filter(e => e.type === 'ttrpg.open.stage.opened').count()).toBe(0)
  })

  it('rejects an altered evaluation hash even when the outer plan hash is recomputed', async () => {
    const { f, input } = await closed(), { plan } = await prepareTtrpgOpenNextStagePlanV1(input)
    await openTtrpgNextStageV1({ ...await openEnvelopeV1(f.command.sessionId, input.commandId), viewerKey: input.viewerKey,
      templateKeys: input.templateKeys, expectedPlanHash: plan.planHash })
    const backup = await exportProjectJSON(f.f.scope.projectId)
    const event = backup.productRuntimeEvents.find((e: { type: string }) => e.type === 'ttrpg.open.stage.opened')
    const payload = JSON.parse(event._portablePayloadJson ?? event.payloadJson)
    payload.receipt.plan.humanChecks[0].evaluationHash = 'c'.repeat(64)
    const { planHash: _, ...body } = payload.receipt.plan
    payload.receipt.plan.planHash = await hashProductProductionValueV2(body)
    payload.intent.expectedPlanHash = payload.receipt.plan.planHash
    if (typeof event._portablePayloadJson === 'string') event._portablePayloadJson = JSON.stringify(payload)
    else event.payloadJson = JSON.stringify(payload)
    const before = await db.projects.count()
    await expect(importProjectJSON(backup)).rejects.toThrow(/开局预览与原真实前态不一致/)
    expect(await db.projects.count()).toBe(before)
  })

  it('rejects an unclaimed identity, nonclosed stage and duplicate selections', async () => {
    const { input } = await closed()
    await expect(prepareTtrpgOpenNextStagePlanV1({ ...input, viewerKey: 'visitor' })).rejects.toThrow()
    await expect(prepareTtrpgOpenNextStagePlanV1({ ...input, templateKeys: [...input.templateKeys, ...input.templateKeys] })).rejects.toThrow(/重复/)
    const runtime = rt(input.state); runtime.openRun!.stage = { status: 'open', openedAtWorldTurn: 0, closedAtWorldTurn: null }; input.state.ttrpg = runtime
    await expect(prepareTtrpgOpenNextStagePlanV1(input)).rejects.toThrow(/收束/)
  })

  it('does not bypass cooldown merely because an active instance was previously admitted', async () => {
    const { input } = await closed(), runtime = rt(input.state)
    runtime.openRun!.situations.cooldowns[input.templateKeys[0]] = runtime.openRun!.worldTime.worldTurn + 2
    input.state.ttrpg = runtime
    await expect(prepareTtrpgOpenNextStagePlanV1(input)).rejects.toThrow(/I7|冷却/)
  })

  it('does not treat a queued opening as already playable', async () => {
    const { input } = await closed(), runtime = rt(input.state), run = runtime.openRun!
    const instance = run.situations.active.shift()!
    run.situations.queued.push({ ...instance, status: 'queued', queuePosition: 0 })
    run.situations.cooldowns[instance.templateKey] = run.worldTime.worldTurn + 2; input.state.ttrpg = runtime
    await expect(prepareTtrpgOpenNextStagePlanV1(input)).rejects.toThrow(/排队|可用/)
  })

  it('promotes an actually eligible FIFO opening through the original queue owner', async () => {
    const { input } = await closed(), runtime = rt(input.state), run = runtime.openRun!
    const instance = run.situations.active.shift()!
    run.situations.queued.push({ ...instance, status: 'queued', queuePosition: 0 }); input.state.ttrpg = runtime
    const { plan, proposedState } = await prepareTtrpgOpenNextStagePlanV1(input)
    expect(plan.selected[0]).toMatchObject({ instanceKey: instance.situationKey, transition: 'promoted' })
    expect(rt(proposedState).openRun!.situations.queued).toEqual([])
    expect(rt(proposedState).openRun!.situations.active[0].activatedAtWorldTurn).toBe(run.worldTime.worldTurn)
    expect(rt(proposedState).openRun!.worldTime).toEqual(run.worldTime)
    expect(run.situations.queued).toHaveLength(1)
  })

  it('does not renew the absolute session cap at a new stage', async () => {
    const { input } = await closed(), runtime = rt(input.state), run = runtime.openRun!
    run.worldTime.worldTurn = input.content.campaign.stageClosurePolicy.maximumWorldTurns
    run.stage.closedAtWorldTurn = run.worldTime.worldTurn
    run.stageClosures![run.stageClosures!.length - 1].atWorldTurn = run.worldTime.worldTurn
    input.state.ttrpg = runtime
    await expect(prepareTtrpgOpenNextStagePlanV1(input)).rejects.toThrow(/单局上限/)
  })
})

import { prepareTtrpgOpenPrivateChoiceDisclosureV1,discloseTtrpgOpenPrivateChoiceV1 } from '../../src/lib/ttrpg/runtime-commands'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState,
  replayProductRuntimeEvents, parseProductRuntimeState } from '../../src/lib/product/runtime-core'
import { startTtrpgOpenEpochV1, startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1,
  applyTtrpgOpenOperationEffectV1, advanceTtrpgWorldTurnV1, completeTtrpgOpenOperationStepV1,
  startTtrpgOpenInheritedOperationV1,
  selectTtrpgOpenOperationEffectV1, closeTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { settleOpenPaidTurnsV1 } from '../helpers/open-ttrpg-paid-turns'
import { DEGREES } from '../../src/lib/ttrpg/open-contract-parse'
import { rt, operationInput, approve, parentAtCut, forkAndStart } from '../helpers/open-ttrpg-branch-recovery'

async function discloseChoice(sessionId: number,operationKey: string) {
  const state = rt(await readProductRuntimeState(sessionId)),op = state.openRun!.operations.find(o => o.operationKey === operationKey)!,gm = state.authorization!.seats.find(s => s.role === 'gm')!
  const viewerKey = gm.controller === 'ai' ? state.authorization!.viewerKey : gm.viewerKey
  const locator = { sessionId,operationKey,frozenPlanHash: op.planHash,viewerKey,kind: 'effect' as const,templateKey: op.pendingChoice!.templateKey }
  const prepared = await prepareTtrpgOpenPrivateChoiceDisclosureV1(locator)
  await discloseTtrpgOpenPrivateChoiceV1({ ...await operationInput(sessionId,operationKey,`private-disclosure.${prepared.reviewHash}`),...locator,reviewHash: prepared.reviewHash })
  return prepared.reviewHash
}

describe('R-TTRPGOPEN1 child recovery from already submitted parent business', { timeout: 60000 },() => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it.each(['rule', 'rule.receipt', 'mechanics', 'mechanics.receipt', 'time.1', 'time.1.receipt', 'pressure'])(
    'recovers after %s without another roll, charge, or consumed time', async cut => {
      const parent = await parentAtCut(cut), parentCut = await readProductRuntimeState(parent.sessionId)
      const branch = await forkAndStart(parent.sessionId)
      expect(branch.op.status).toBe('awaiting-approval')
      const noApproval = await settleOpenPaidTurnsV1({ sessionId: branch.sessionId, operationKey: branch.op.operationKey,
        frozenPlanHash: branch.op.planHash, viewerKey: OPEN_HUMAN_VIEWER })
      expect(noApproval.status).toBe('awaiting-approval')
      await approve(branch.sessionId, branch.op.operationKey)
      const resumed = await settleOpenPaidTurnsV1({ sessionId: branch.sessionId, operationKey: branch.op.operationKey,
        frozenPlanHash: branch.op.planHash, viewerKey: OPEN_HUMAN_VIEWER })
      expect(resumed).toEqual({ status: 'executing',nextStepKey: 'terminal' })
      await settleOpenPaidTurnsV1({ sessionId: parent.sessionId, operationKey: parent.operationKey,
        frozenPlanHash: parent.frozenPlanHash, viewerKey: OPEN_HUMAN_VIEWER })
      const expected = await readProductRuntimeState(parent.sessionId), actual = await readProductRuntimeState(branch.sessionId)
      expect(actual.entities).toEqual(expected.entities)
      expect(rt(actual).product.abilityStates).toEqual(rt(expected).product.abilityStates)
      expect(rt(actual).product.inventory).toEqual(rt(expected).product.inventory)
      expect(rt(actual).openRun!.worldTime.worldTurn).toBe(3)
      const events = await db.productRuntimeEvents.where('sessionId').equals(branch.sessionId).sortBy('sequence')
      expect(events.filter(event => event.type === 'ttrpg.rule.action.resolved')).toEqual([])
      expect(events.filter(event => event.type === 'ttrpg.world-turn.advanced')).toHaveLength(3 - rt(parentCut).openRun!.worldTime.worldTurn)
      expect(events.filter(event => event.type === 'ttrpg.world-turn.advanced').every(event =>
        JSON.parse(event.payloadJson).causeRef.sequence === branch.marker.sequence)).toBe(true)
      const receipt = rt(actual).openRun!.ruleReceipts[0], original = rt(expected).openRun!.ruleReceipts[0]
      expect(receipt.result).toEqual(original.result)
      expect(receipt.inheritedFrom!.originalSourceRef).toEqual(original.sourceRef)
      expect(receipt.sourceRef).toEqual({ sessionKey: rt(actual).sessionKey, sequence: branch.marker.sequence })
      const row = (await db.productRuntimeSessions.get(branch.sessionId))!
      expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), events)).toEqual(actual)
      const count = events.length
      await settleOpenPaidTurnsV1({ sessionId: branch.sessionId, operationKey: branch.op.operationKey,
        frozenPlanHash: branch.op.planHash, viewerKey: OPEN_HUMAN_VIEWER })
      expect(await db.productRuntimeEvents.where('sessionId').equals(branch.sessionId).count()).toBe(count)
    },
  )
  it('keeps the original random source and remaining prefix in a second-generation branch', async () => {
    const parent = await parentAtCut('rule')
    const child = await forkAndStart(parent.sessionId)
    await approve(child.sessionId, child.op.operationKey)
    await applyTtrpgOpenOperationEffectV1({ ...await operationInput(child.sessionId, child.op.operationKey, 'mechanics'), stepKey: 'mechanics' })
    await completeTtrpgOpenOperationStepV1({ ...await operationInput(child.sessionId, child.op.operationKey, 'mechanics.receipt'), stepKey: 'mechanics' })
    await advanceTtrpgWorldTurnV1({ ...await operationInput(child.sessionId, child.op.operationKey, 'time.1'), stepKey: 'time.1', reason: 'game-action' })
    const grandchild = await forkAndStart(child.sessionId)
    await approve(grandchild.sessionId, grandchild.op.operationKey)
    await settleOpenPaidTurnsV1({ sessionId: grandchild.sessionId, operationKey: grandchild.op.operationKey,
      frozenPlanHash: grandchild.op.planHash, viewerKey: OPEN_HUMAN_VIEWER })
    const final = rt(await readProductRuntimeState(grandchild.sessionId)), original = rt(await readProductRuntimeState(parent.sessionId)).openRun!.ruleReceipts[0]
    expect(final.branchLineage!.ancestors).toHaveLength(2)
    expect(final.openRun!.worldTime.worldTurn).toBe(3)
    expect(final.openRun!.ruleReceipts[0].inheritedFrom!.originalSourceRef).toEqual(original.sourceRef)
    expect(await db.productRuntimeEvents.where('sessionId').equals(grandchild.sessionId).filter(event => event.type === 'ttrpg.rule.action.resolved').count()).toBe(0)
  })
  it.each([false, true])('preserves the parent choice contract (already chosen: %s) without inventing a new choice', async chosen => {
    const fixture = await readyOpenTtrpgSessionV1('inherited choice', pkg => {
      const content = pkg.ttrpg!, base = content.campaign.effectPlanTemplates[0]
      content.campaign.effectPlanTemplates = DEGREES.map(degree => ({ ...structuredClone(base), planKey: `choice.${degree}`, degree,
        effects: [], alternatives: [{ alternativeKey: 'small', title: '少量', effects: [{ ...base.effects[0], effectKey: 'choice.small' }] },
          { alternativeKey: 'large', title: '较多', effects: [{ ...base.effects[0], effectKey: 'choice.large' }] }] }))
      content.rulePack.content.genericChecks[0].effectPlanByDegree = Object.fromEntries(DEGREES.map(degree => [degree, `choice.${degree}`]))
      content.campaign.clocks[0].onCompleteEffectPlanRef = 'choice.success'
      content.campaign.situationTemplates[0].consequences[0].effectPlanRef = 'choice.success'
    })
    const sessionId = fixture.sessionId
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, 'epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput: '调查' })
    const rule = fixture.runtimePackage.ttrpg!.rulePack.content.genericChecks[0]
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(sessionId, 'plan'), viewerKey: OPEN_HUMAN_VIEWER,
      request: { route: 'generic-check', ruleKey: rule.checkKey, actorKey: 'hero', targetKey: 'hero', controllerMode: 'human',
        effectBindings: Object.fromEntries(fixture.runtimePackage.ttrpg!.campaign.effectPlanTemplates.map(plan => [plan.planKey, { actor: 'hero' }])) } })
    const op = rt(await readProductRuntimeState(sessionId)).openRun!.operations[0]
    await approve(sessionId, op.operationKey)
    await settleOpenPaidTurnsV1({ sessionId, operationKey: op.operationKey, frozenPlanHash: op.planHash, viewerKey: OPEN_HUMAN_VIEWER })
    if (chosen) {
      const disclosureHash = await discloseChoice(sessionId,op.operationKey)
      await selectTtrpgOpenOperationEffectV1({ ...await operationInput(sessionId, op.operationKey, 'effect-choice'),
        alternativeKey: 'large', riskHash: op.riskHash,disclosureHash })
    }
    const child = await forkAndStart(sessionId)
    await approve(child.sessionId, child.op.operationKey)
    let result = await settleOpenPaidTurnsV1({ sessionId: child.sessionId, operationKey: child.op.operationKey,
      frozenPlanHash: child.op.planHash, viewerKey: OPEN_HUMAN_VIEWER })
    if (!chosen) {
      expect(result).toEqual({ status: 'awaiting-choice', nextStepKey: 'effect' })
      const disclosureHash = await discloseChoice(child.sessionId,child.op.operationKey)
      await selectTtrpgOpenOperationEffectV1({ ...await operationInput(child.sessionId, child.op.operationKey, 'effect-choice'),
        alternativeKey: 'large', riskHash: child.op.riskHash,disclosureHash })
      result = await settleOpenPaidTurnsV1({ sessionId: child.sessionId, operationKey: child.op.operationKey,
        frozenPlanHash: child.op.planHash, viewerKey: OPEN_HUMAN_VIEWER })
    }
    expect(result).toEqual({ status: 'executing',nextStepKey: 'terminal' })
    const final = rt(await readProductRuntimeState(child.sessionId))
    expect(final.product.effectLedger.entries[0].transitions[0].effectKey).toBe('choice.large')
    expect(final.openRun!.operations[0].pendingChoice!.selectionRef!.sessionKey).toBe(final.sessionKey)
    const events = await db.productRuntimeEvents.where('sessionId').equals(child.sessionId).sortBy('sequence')
    expect(events.filter(event => event.type === 'ttrpg.rule.action.resolved')).toEqual([])
    expect(replayProductRuntimeEvents(parseProductRuntimeState(child.child.initialStateJson), events)).toEqual(await readProductRuntimeState(child.sessionId))
  })
  it('retains a rejected recovery for inspection and retries only after a new explicit epoch', async () => {
    const parent = await parentAtCut('rule'), child = await forkAndStart(parent.sessionId)
    const required = child.op.plan.requiredApprovals[0]
    await confirmTtrpgOpenOperationV1({ ...await operationInput(child.sessionId, child.op.operationKey, `approval.${required.actorKey}`),
      actorKey: required.actorKey, riskHash: child.op.riskHash, decision: 'reject' })
    const rejected = rt(await readProductRuntimeState(child.sessionId))
    expect(rejected.openRun!.operations[0].status).toBe('rejected')
    expect(rejected.branchLineage!.recoveryTasks[0].status).toBe('ready')
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.sessionId, 'close'), viewerKey: OPEN_HUMAN_VIEWER,
      epochKey: rejected.openRun!.coordination.activeEpochKey!, reason: '拒绝本次恢复，保留已提交结果' })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.sessionId, 'epoch.new'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'continue-host', rawInput: '明确重新授权恢复' })
    await startTtrpgOpenInheritedOperationV1({ ...await openEnvelopeV1(child.sessionId, 'retry'), taskKey: child.taskKey, viewerKey: OPEN_HUMAN_VIEWER })
    const retry = rt(await readProductRuntimeState(child.sessionId)).openRun!.operations[1]
    await approve(child.sessionId, retry.operationKey)
    await settleOpenPaidTurnsV1({ sessionId: child.sessionId, operationKey: retry.operationKey,
      frozenPlanHash: retry.planHash, viewerKey: OPEN_HUMAN_VIEWER })
    expect(rt(await readProductRuntimeState(child.sessionId)).openRun!.worldTime.worldTurn).toBe(3)
  })
})

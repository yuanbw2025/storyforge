import * as timingPlans from '../../src/lib/ttrpg/open-rule-plan'
import { settleOpenPaidTurnsV1 } from '../helpers/open-ttrpg-paid-turns'
import { prepareTtrpgOpenPrivateChoiceDisclosureV1,discloseTtrpgOpenPrivateChoiceV1 } from '../../src/lib/ttrpg/runtime-commands'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from '../../src/lib/ttrpg/open-operation'
import { startTtrpgOpenEpochV1, startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1,
  resolveTtrpgOpenOperationRuleV1, applyTtrpgOpenOperationEffectV1, completeTtrpgOpenOperationStepV1,
  advanceTtrpgWorldTurnV1, completeTtrpgOpenOperationV1, ttrpgOpenOperationCommandIdV1 } from '../../src/lib/ttrpg/runtime-commands'
import { selectTtrpgOpenOperationEffectV1, disposeTtrpgOpenIntentV1, changeTtrpgSafetyStatus, closeTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import type { TtrpgOpenRuleRequestV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { openEnvelopeV1, readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { DEGREES } from '../../src/lib/ttrpg/open-contract-parse'

async function runtime(sessionId: number) {
  const state = await readProductRuntimeState(sessionId)
  return { state, runtime: parseTtrpgRuntimeStateV2(state.ttrpg)! }
}
async function setup(route: 'existing-action' | 'generic-check' = 'existing-action', actorKey = 'hero', configure?: Parameters<typeof readyOpenTtrpgSessionV1>[1]) {
  const fixture = await readyOpenTtrpgSessionV1('operation fixture', configure)
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'operation.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
    triggerKind: 'submit-action', rawInput: '检查灯塔' })
  const rule = fixture.runtimePackage.ttrpg!.rulePack.content
  const action = rule.actions[0]
  const request: TtrpgOpenRuleRequestV1 = { route, actorKey, controllerMode: actorKey === 'hero' ? 'human' : 'ai',
    ruleKey: route === 'existing-action' ? action.key : rule.checks[0].key,
    targetKey: route === 'generic-check' || action.target === 'self' ? actorKey : action.target === 'scene' ? null : 'keeper',
    effectBindings: route === 'generic-check' ? Object.fromEntries(fixture.campaign.effectPlanTemplates.map(template => [template.planKey, { actor: 'hero' }])) : {} }
  await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId, 'operation.start'), viewerKey: OPEN_HUMAN_VIEWER, request })
  return { ...fixture, request }
}
async function input(sessionId: number, stepKey: string, viewerKey = OPEN_HUMAN_VIEWER) {
  const value = (await runtime(sessionId)).runtime
  const operation = value.openRun!.operations[0]
  return { ...await openEnvelopeV1(sessionId, await ttrpgOpenOperationCommandIdV1(value.sessionKey, operation.operationKey, stepKey)),
    operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey }
}
async function approve(sessionId: number) {
  const operation = (await runtime(sessionId)).runtime.openRun!.operations[0]
  for (const required of operation.plan.requiredApprovals) await confirmTtrpgOpenOperationV1({
    ...await input(sessionId, `approval.${required.actorKey}`), actorKey: required.actorKey, riskHash: operation.riskHash, decision: 'approve' })
}
async function finishMechanical(sessionId: number) {
  for (let count = 0; count < 32; count++) {
    const { runtime: value } = await runtime(sessionId), operation = value.openRun!.operations[0]
    const step = nextTtrpgOpenOperationStepV1(operation)!
    if (['pressure', 'situations', 'terminal', 'gates', 'narration', 'handoff'].includes(step.kind)) return step.kind
    if (!operation.businessRefs.some(ref => ref.stepKey === step.stepKey)) {
      if (step.kind === 'rule') await resolveTtrpgOpenOperationRuleV1(await input(sessionId, step.stepKey))
      else if (step.kind === 'mechanics' || step.kind === 'effect') await applyTtrpgOpenOperationEffectV1({ ...await input(sessionId, step.stepKey), stepKey: step.kind })
      else if (step.kind === 'time') await advanceTtrpgWorldTurnV1({ ...await input(sessionId, step.stepKey), stepKey: step.stepKey,
        reason: operation.plan.request.controllerMode === 'ai' ? 'ai-companion-action' : 'game-action' })
    }
    await completeTtrpgOpenOperationStepV1({ ...await input(sessionId, `${step.stepKey}.receipt`), stepKey: step.stepKey })
  }
  throw new Error('bounded recovery did not stop')
}
async function assertReplay(sessionId: number) {
  const session = (await db.productRuntimeSessions.get(sessionId))!
  const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
  expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)).toEqual(await readProductRuntimeState(sessionId))
}

describe('R-TTRPGOPEN1 deterministic operations and causal time', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('persists an uncharged plan, requires real approvals and rejects fabricated completion', async () => {
    const fixture = await setup()
    const before = await runtime(fixture.sessionId)
    expect(before.runtime.scene).toBeNull()
    expect(before.runtime.openRun!.operations[0].status).toBe('awaiting-approval')
    await expect(resolveTtrpgOpenOperationRuleV1(await input(fixture.sessionId, 'rule'))).rejects.toThrow(/未批准/)
    await expect(completeTtrpgOpenOperationStepV1({ ...await input(fixture.sessionId, 'rule.receipt'), stepKey: 'rule' })).rejects.toThrow(/真实业务/)
    await expect(confirmTtrpgOpenOperationV1({ ...await input(fixture.sessionId, 'approval.hero', 'viewer.gm'), actorKey: 'hero',
      riskHash: before.runtime.openRun!.operations[0].riskHash, decision: 'approve' })).rejects.toThrow(/真人主持授权/)
    expect(await runtime(fixture.sessionId)).toEqual(before)
  })

  it('settles an existing action without a scene and advances time only from its committed cause', async () => {
    const fixture = await setup()
    await approve(fixture.sessionId)
    const before = await runtime(fixture.sessionId)
    const result = await resolveTtrpgOpenOperationRuleV1(await input(fixture.sessionId, 'rule'))
    const rolled = await runtime(fixture.sessionId)
    expect(rolled.state.entities).toEqual(before.state.entities)
    expect(rolled.state.clock).toBe(0)
    expect(rolled.runtime.openRun!.ruleReceipts[0].sourceRef.sequence).toBe(result.sequence)
    expect(await finishMechanical(fixture.sessionId)).toBe('pressure')
    const after = await runtime(fixture.sessionId)
    expect(after.state.clock).toBe(1)
    expect(after.runtime.round).toBe(0)
    expect(after.runtime.scene).toBeNull()
    const tick = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).filter(event => event.type === 'ttrpg.world-turn.advanced').first()
    expect(JSON.parse(tick!.payloadJson).byEventSequence).toBe(result.sequence)
    expect(JSON.parse(tick!.payloadJson).byEventSequence).not.toBe(tick!.sequence)
    await expect(completeTtrpgOpenOperationV1(await input(fixture.sessionId, 'completed'))).rejects.toThrow(/必需 owner/)
    expect(after.runtime.openRun!.operations[0].status).toBe('executing')
    await assertReplay(fixture.sessionId)
  })

  it('uses frozen generic difficulty and costs, rejects client difficulty and leaves source identity intact', async () => {
    const fixture = await setup('generic-check')
    await approve(fixture.sessionId)
    const op = (await runtime(fixture.sessionId)).runtime.openRun!.operations[0]
    expect(op.plan.genericCheck!.difficulty).toBe(10)
    await finishMechanical(fixture.sessionId)
    const after = await runtime(fixture.sessionId)
    expect(after.runtime.openRun!.ruleReceipts[0].result.check!.dc).toBe(10)
    expect(after.runtime.product.rulePackContentHash).toBe(fixture.runtimePackage.ttrpg!.rulePack.contentHash)
    expect(after.state.clock).toBe(1)
    await expect(startTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId, 'invent.dc'), viewerKey: OPEN_HUMAN_VIEWER,
      request: { ...fixture.request, difficulty: 1 } as TtrpgOpenRuleRequestV1 })).rejects.toThrow(/字段不精确/)
    await assertReplay(fixture.sessionId)
  })

  it.each(['existing-action', 'generic-check'] as const)('keeps the frozen hidden dice policy for %s', async route => {
    const fixture = await setup(route)
    await approve(fixture.sessionId)
    await resolveTtrpgOpenOperationRuleV1(await input(fixture.sessionId, 'rule'))
    const after = await runtime(fixture.sessionId)
    expect(after.runtime.openRun!.operations[0].plan.rollVisibility).toBe('gm-only')
    expect(after.runtime.openRun!.ruleReceipts[0].result.check!.visibility).toBe('gm-only')
    await assertReplay(fixture.sessionId)
  })

  it.each(['rule', 'mechanics', 'time.1', 'time.1.receipt'])('recovers after interruption at %s without duplicate effects or time', async boundary => {
    const fixture = await setup()
    await approve(fixture.sessionId)
    let reached = false
    for (let count = 0; count < 16 && !reached; count++) {
      const op = (await runtime(fixture.sessionId)).runtime.openRun!.operations[0], step = nextTtrpgOpenOperationStepV1(op)!
      if (step.kind === 'rule') await resolveTtrpgOpenOperationRuleV1(await input(fixture.sessionId, step.stepKey))
      else if (step.kind === 'mechanics') await applyTtrpgOpenOperationEffectV1({ ...await input(fixture.sessionId, step.stepKey), stepKey: 'mechanics' })
      else if (step.kind === 'time') await advanceTtrpgWorldTurnV1({ ...await input(fixture.sessionId, step.stepKey), stepKey: step.stepKey, reason: 'game-action' })
      if (step.stepKey === boundary) reached = true
      else { await completeTtrpgOpenOperationStepV1({ ...await input(fixture.sessionId, `${step.stepKey}.receipt`), stepKey: step.stepKey }); if (`${step.stepKey}.receipt` === boundary) reached = true }
    }
    const beforeReload = await runtime(fixture.sessionId)
    db.close(); await db.open()
    expect(await runtime(fixture.sessionId)).toEqual(beforeReload)
    await finishMechanical(fixture.sessionId)
    const final = await runtime(fixture.sessionId)
    expect(final.state.clock).toBe(1)
    expect(final.runtime.openRun!.ruleReceipts).toHaveLength(1)
    expect(final.runtime.openRun!.operations[0].businessRefs.filter(ref => ref.stepKey === 'mechanics')).toHaveLength(1)
    const count = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).count()
    await finishMechanical(fixture.sessionId)
    expect(await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).count()).toBe(count)
    await assertReplay(fixture.sessionId)
  })

  it('makes exact step retries idempotent at a later head and rejects changed plans', async () => {
    const fixture = await setup()
    await approve(fixture.sessionId)
    const original = await resolveTtrpgOpenOperationRuleV1(await input(fixture.sessionId, 'rule'))
    await finishMechanical(fixture.sessionId)
    const count = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).count()
    expect(await resolveTtrpgOpenOperationRuleV1(await input(fixture.sessionId, 'rule'))).toEqual(original)
    expect(await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).count()).toBe(count)
    await expect(resolveTtrpgOpenOperationRuleV1({ ...await input(fixture.sessionId, 'rule'), frozenPlanHash: '0'.repeat(64) })).rejects.toThrow(/变化/)
  })

  it('only explicit recovery writes events and stops honestly at an unimplemented owner', async () => {
    const fixture = await setup()
    await approve(fixture.sessionId)
    const operation = (await runtime(fixture.sessionId)).runtime.openRun!.operations[0]
    const resumeInput = { sessionId: fixture.sessionId, operationKey: operation.operationKey,
      frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER }
    const count = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).count()
    await runtime(fixture.sessionId); await runtime(fixture.sessionId)
    expect(await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).count()).toBe(count)
    expect(await resumeTtrpgOpenOperationV1(resumeInput)).toEqual({ status: 'awaiting-owner', nextStepKey: 'pressure' })
    const after = await runtime(fixture.sessionId)
    const afterCount = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).count()
    expect(after.state.clock).toBe(1)
    expect(await resumeTtrpgOpenOperationV1(resumeInput)).toEqual({ status: 'awaiting-owner', nextStepKey: 'pressure' })
    expect(await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).count()).toBe(afterCount)
    await assertReplay(fixture.sessionId)
  })

  it('keeps AI action limits after game time advances and forbids concurrent operations', async () => {
    const fixture = await setup('existing-action', 'companion.1')
    await approve(fixture.sessionId)
    await finishMechanical(fixture.sessionId)
    const after = await runtime(fixture.sessionId)
    expect(after.runtime.openRun!.coordination.epochs[0].successfulActorKeys).toEqual(['companion.1'])
    expect(after.runtime.openRun!.worldTime.worldTurn).toBe(1)
    await expect(startTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId, 'companion.again'),
      viewerKey: OPEN_HUMAN_VIEWER, request: fixture.request })).rejects.toThrow(/未完成操作/)
  })

  it.each([0, 3])('consumes the frozen %i-tick time cost exactly once across repeated recovery', async timeCost => {
    const fixture = await setup('existing-action', 'hero', runtimePackage => {
      const content = runtimePackage.ttrpg!
      if (content.rulePack.content.version !== 2) throw new Error('fixture V2')
      content.rulePack.content.timePolicy.existingAction = timeCost
    })
    await approve(fixture.sessionId)
    await settleOpenPaidTurnsV1({ sessionId: fixture.sessionId,operationKey: (await runtime(fixture.sessionId)).runtime.openRun!.operations[0].operationKey,frozenPlanHash: (await runtime(fixture.sessionId)).runtime.openRun!.operations[0].planHash,viewerKey: OPEN_HUMAN_VIEWER })
    const after = await runtime(fixture.sessionId)
    expect(after.state.clock).toBe(timeCost)
    const ticks = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).filter(event => event.type === 'ttrpg.world-turn.advanced').toArray()
    expect(ticks).toHaveLength(timeCost)
    const cause = after.runtime.openRun!.ruleReceipts[0].sourceRef
    expect(ticks.every(tick => JSON.parse(tick.payloadJson).causeRef.sequence === cause.sequence)).toBe(true)
    await settleOpenPaidTurnsV1({ sessionId: fixture.sessionId,operationKey: (await runtime(fixture.sessionId)).runtime.openRun!.operations[0].operationKey,frozenPlanHash: (await runtime(fixture.sessionId)).runtime.openRun!.operations[0].planHash,viewerKey: OPEN_HUMAN_VIEWER })
    expect((await runtime(fixture.sessionId)).state.clock).toBe(timeCost)
    await assertReplay(fixture.sessionId)
  },20000)

  it('persists bounded alternatives, awaits the human and applies only the chosen frozen option', async () => {
    const fixture = await setup('generic-check', 'hero', runtimePackage => {
      const content = runtimePackage.ttrpg!
      if (content.campaign.version !== 2 || content.rulePack.content.version !== 2) throw new Error('fixture V2')
      const base = content.campaign.effectPlanTemplates[0]
      content.campaign.effectPlanTemplates = DEGREES.map(degree => ({ ...structuredClone(base), planKey: `choice.${degree}`, degree,
        effects: [], alternatives: [{ alternativeKey: 'small', title: '少量恢复', effects: [{ ...base.effects[0], effectKey: 'choice.small' }] },
          { alternativeKey: 'large', title: '较多恢复', effects: [{ ...base.effects[0], effectKey: 'choice.large' }] }] }))
      content.rulePack.content.genericChecks[0].effectPlanByDegree = Object.fromEntries(DEGREES.map(degree => [degree, `choice.${degree}`])) as Record<typeof DEGREES[number], string>
      content.campaign.clocks[0].onCompleteEffectPlanRef = 'choice.success'
      content.campaign.situationTemplates[0].consequences[0].effectPlanRef = 'choice.success'
    })
    await approve(fixture.sessionId)
    const operation = (await runtime(fixture.sessionId)).runtime.openRun!.operations[0]
    const resumeInput = { sessionId: fixture.sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER }
    expect(await resumeTtrpgOpenOperationV1(resumeInput)).toEqual({ status: 'awaiting-choice', nextStepKey: 'effect' })
    const pending = await runtime(fixture.sessionId)
    expect(pending.runtime.openRun!.operations[0].pendingChoice!.selectedAlternativeKey).toBeNull()
    expect(pending.state.clock).toBe(0)
    db.close(); await db.open()
    expect(await runtime(fixture.sessionId)).toEqual(pending)
    const disclosure = await prepareTtrpgOpenPrivateChoiceDisclosureV1({ sessionId: fixture.sessionId,operationKey: operation.operationKey,frozenPlanHash: operation.planHash,viewerKey: OPEN_HUMAN_VIEWER,kind: 'effect',templateKey: pending.runtime.openRun!.operations[0].pendingChoice!.templateKey })
    await discloseTtrpgOpenPrivateChoiceV1({ ...await input(fixture.sessionId,`private-disclosure.${disclosure.reviewHash}`),kind: 'effect',templateKey: pending.runtime.openRun!.operations[0].pendingChoice!.templateKey,reviewHash: disclosure.reviewHash })
    await expect(selectTtrpgOpenOperationEffectV1({ ...await input(fixture.sessionId, 'effect-choice', 'viewer.gm'),
      alternativeKey: 'large', riskHash: operation.riskHash,disclosureHash: disclosure.reviewHash })).rejects.toThrow(/真人主持授权/)
    await expect(selectTtrpgOpenOperationEffectV1({ ...await input(fixture.sessionId, 'effect-choice'),
      alternativeKey: 'invented', riskHash: operation.riskHash,disclosureHash: disclosure.reviewHash })).rejects.toThrow(/真人选择/)
    const selected = await selectTtrpgOpenOperationEffectV1({ ...await input(fixture.sessionId, 'effect-choice'), alternativeKey: 'large', riskHash: operation.riskHash,disclosureHash: disclosure.reviewHash })
    await resumeTtrpgOpenOperationV1(resumeInput)
    const final = await runtime(fixture.sessionId)
    expect(final.runtime.openRun!.operations[0].pendingChoice!.selectionRef!.sequence).toBe(selected.sequence)
    expect(final.runtime.product.effectLedger.entries[0].transitions[0].effectKey).toBe('choice.large')
    expect(final.state.clock).toBe(1)
    await assertReplay(fixture.sessionId)
  })

  it.each(['rule', 'mechanics', 'time.1'])('rolls back a failed %s receipt and resumes its already committed business event', async boundary => {
    const fixture = await setup()
    await approve(fixture.sessionId)
    const operation = (await runtime(fixture.sessionId)).runtime.openRun!.operations[0]
    const resumeInput = { sessionId: fixture.sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER }
    const original = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    const spy = vi.spyOn(db.productRuntimeEvents, 'add').mockImplementation(async event => {
      if (event.type === 'ttrpg.open.operation.step.completed' && JSON.parse(event.payloadJson).stepKey === boundary) throw new Error('injected step receipt fault')
      return original(event)
    })
    await expect(resumeTtrpgOpenOperationV1(resumeInput)).rejects.toThrow(/injected/)
    spy.mockRestore()
    const checkpoint = await runtime(fixture.sessionId)
    expect(checkpoint.runtime.openRun!.operations[0].businessRefs.some(ref => ref.stepKey === boundary)).toBe(true)
    expect(checkpoint.runtime.openRun!.operations[0].receipts.some(ref => ref.stepKey === boundary)).toBe(false)
    await resumeTtrpgOpenOperationV1(resumeInput)
    const final = await runtime(fixture.sessionId)
    expect(final.state.clock).toBe(1)
    const rule = final.runtime.openRun!.ruleReceipts[0]
    expect(final.runtime.openRun!.ruleReceipts).toHaveLength(1)
    for (const change of rule.result.resourceChanges) expect(final.state.entities[change.entityKey].attributes[`resource.${change.resourceKey}`]).toBe(change.after)
    await assertReplay(fixture.sessionId)
  })

  it.each([true, false])('keeps old world-tick expiry and new actor-action timing distinct, with scripted round zero (legacy=%s)', async legacyTiming => {
    if (legacyTiming) {
      const create = timingPlans.createTtrpgOpenRulePlanV1
      vi.spyOn(timingPlans, 'createTtrpgOpenRulePlanV1').mockImplementation(async input => {
        const plan = await create(input); Reflect.deleteProperty(plan, 'conditionTiming'); return plan
      })
    }

    const fixture = await setup('existing-action', 'hero', runtimePackage => {
      const rule = runtimePackage.ttrpg!.rulePack.content
      rule.conditions[0].defaultDurationRounds = 1
      rule.actions[0].effects.push({ kind: 'condition', conditionKey: rule.conditions[0].key,
        stacks: 1, targetScope: 'actor', appliesOnDegrees: [...DEGREES] })
    })
    await approve(fixture.sessionId)
    await resolveTtrpgOpenOperationRuleV1(await input(fixture.sessionId, 'rule'))
    await completeTtrpgOpenOperationStepV1({ ...await input(fixture.sessionId, 'rule.receipt'), stepKey: 'rule' })
    await applyTtrpgOpenOperationEffectV1({ ...await input(fixture.sessionId, 'mechanics'), stepKey: 'mechanics' })
    expect((await runtime(fixture.sessionId)).runtime.product.conditions.hero).toHaveLength(1)
    await completeTtrpgOpenOperationStepV1({ ...await input(fixture.sessionId, 'mechanics.receipt'), stepKey: 'mechanics' })
    await finishMechanical(fixture.sessionId)
    expect((await runtime(fixture.sessionId)).runtime.product.conditions.hero).toHaveLength(legacyTiming ? 0 : 1)
    expect((await runtime(fixture.sessionId)).runtime.round).toBe(0)
    await assertReplay(fixture.sessionId)
  })

  it('applies a frozen move once through the entity owner and restores it without repeating time', async () => {
    const fixture = await setup('generic-check', 'hero', pkg => {
      const campaign = pkg.ttrpg!.campaign
      campaign.entityBindings.push({ bindingKey: 'market', templateKey: 'market', kind: 'location', sourceResourceRef: null,
        sourceFieldRefs: [], initialLocationRef: null, initialInventoryRefs: [], audience: 'public', knownByActorKeys: [] })
      const base = campaign.effectPlanTemplates[0]
      campaign.effectPlanTemplates = DEGREES.map(degree => ({ ...structuredClone(base), degree,
        planKey: degree === 'success' ? 'plan.success' : `move.${degree}`,
        effects: [{ effectKey: 'move.market', family: 'story', operation: 'location.set',
          targetRef: 'parameter:actor', storyKey: 'market', value: 'market' }] }))
      for (const template of campaign.effectPlanTemplates) pkg.ttrpg!.rulePack.content.genericChecks[0].effectPlanByDegree[template.degree] = template.planKey
    })
    await approve(fixture.sessionId)
    await finishMechanical(fixture.sessionId)
    const after = await runtime(fixture.sessionId), op = after.runtime.openRun!.operations[0]
    expect(after.state.entities.hero.locationKey).toBe('market')
    expect(after.state.clock).toBe(1)
    await resumeTtrpgOpenOperationV1({ sessionId: fixture.sessionId, operationKey: op.operationKey, frozenPlanHash: op.planHash, viewerKey: OPEN_HUMAN_VIEWER })
    expect((await runtime(fixture.sessionId)).state.clock).toBe(1)
    await assertReplay(fixture.sessionId)
  })

  it('initializes one frozen shared pool and charges it once through recovery', async () => {
    const fixture = await setup('existing-action', 'hero', runtimePackage => {
      runtimePackage.ttrpg!.rulePack.content.actions[0].usage = { mode: 'shared-pool', maximum: 3,
        resourceKey: null, cost: 2, sharedPoolKey: 'party.pool', cooldownRounds: null, reset: ['session'] }
    })
    expect((await runtime(fixture.sessionId)).runtime.product.usagePools['party.pool'].remaining).toBe(3)
    await approve(fixture.sessionId)
    await finishMechanical(fixture.sessionId)
    const op = (await runtime(fixture.sessionId)).runtime.openRun!.operations[0]
    await resumeTtrpgOpenOperationV1({ sessionId: fixture.sessionId, operationKey: op.operationKey, frozenPlanHash: op.planHash, viewerKey: OPEN_HUMAN_VIEWER })
    expect((await runtime(fixture.sessionId)).runtime.product.usagePools['party.pool'].remaining).toBe(1)
    await assertReplay(fixture.sessionId)
  })

  it('withdraws an uncharged plan while paused, retains evidence and releases the epoch', async () => {
    const fixture = await setup()
    await approve(fixture.sessionId)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'pause.withdraw'), viewerKey: OPEN_HUMAN_VIEWER,
      status: 'paused', reason: '等待重新提交', changedBy: 'hero' })
    await expect(disposeTtrpgOpenIntentV1({ ...await input(fixture.sessionId, 'disposed', 'viewer.gm'), reason: 'AI 撤销' })).rejects.toThrow()
    const disposed = await disposeTtrpgOpenIntentV1({ ...await input(fixture.sessionId, 'disposed'), reason: '改用其他行动' })
    expect(await disposeTtrpgOpenIntentV1({ ...await input(fixture.sessionId, 'disposed'), reason: '改用其他行动' })).toEqual(disposed)
    const after = await runtime(fixture.sessionId)
    expect(after.state.clock).toBe(0)
    expect(after.runtime.openRun!.operations[0].status).toBe('stale')
    const epochKey = after.runtime.openRun!.coordination.activeEpochKey!
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'withdraw.close'), epochKey, viewerKey: OPEN_HUMAN_VIEWER, reason: '已撤销' })
    await assertReplay(fixture.sessionId)
  })

  it('resumes the committed rule after safety pause without rerolling or abandoning business', async () => {
    const fixture = await setup()
    await approve(fixture.sessionId)
    const rolled = await resolveTtrpgOpenOperationRuleV1(await input(fixture.sessionId, 'rule'))
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'pause.result'), viewerKey: OPEN_HUMAN_VIEWER,
      status: 'paused', reason: '休息', changedBy: 'hero' })
    await expect(disposeTtrpgOpenIntentV1({ ...await input(fixture.sessionId, 'disposed'), reason: '抹掉骰子' })).rejects.toThrow(/已提交后果/)
    await expect(completeTtrpgOpenOperationStepV1({ ...await input(fixture.sessionId, 'rule.receipt'), stepKey: 'rule' })).rejects.toThrow(/暂停/)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'resume.result'), viewerKey: OPEN_HUMAN_VIEWER,
      status: 'active', reason: null, changedBy: 'hero' })
    await finishMechanical(fixture.sessionId)
    const after = await runtime(fixture.sessionId)
    expect(after.runtime.openRun!.ruleReceipts).toHaveLength(1)
    expect(after.runtime.openRun!.ruleReceipts[0].sourceRef.sequence).toBe(rolled.sequence)
    expect(after.state.clock).toBe(1)
    await assertReplay(fixture.sessionId)
  })
})

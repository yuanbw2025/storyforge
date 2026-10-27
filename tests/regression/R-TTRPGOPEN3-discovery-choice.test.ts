import { prepareTtrpgOpenPrivateChoiceDisclosureV1,discloseTtrpgOpenPrivateChoiceV1 } from '../../src/lib/ttrpg/runtime-commands'
import { nextTtrpgOpenOperationStepV1 } from '../../src/lib/ttrpg/open-operation'
import { ttrpgOpenDiscoveryEffectTemplatesV1 } from '../../src/lib/ttrpg/open-knowledge-settlement'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { selectTtrpgOpenDiscoveryEffectV1, discoverTtrpgOpenKnowledgeV1, ttrpgOpenOperationCommandIdV1, changeTtrpgSafetyStatus, resolveTtrpgOpenOperationRuleV1, applyTtrpgOpenOperationEffectV1, completeTtrpgOpenOperationStepV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { parseTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation'
import { setup, start } from '../helpers/open-ttrpg-knowledge'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { rt, forkAndStart, approve } from '../helpers/open-ttrpg-branch-recovery'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

async function fixture(generic = false, failForward = false) {
  return setup({ generic, cost: !failForward, failForward }, pkg => {
    const template = pkg.ttrpg!.campaign.effectPlanTemplates.find(t => t.planKey === 'plan.discovery.cost')!
    const cost = template.effects[0]
    template.effects = []
    template.alternatives = [
      { alternativeKey: 'small', title: '付出一份资源', effects: [{ ...cost, effectKey: 'small.cost', amount: 1 }] },
      { alternativeKey: 'large', title: '付出两份资源', effects: [{ ...cost, effectKey: 'large.cost', amount: 2 }] },
    ]
  })
}
async function select(command: Awaited<ReturnType<typeof start>>, alternativeKey = 'large', templateKey = 'plan.discovery.cost') {
  let state = await readProductRuntimeState(command.sessionId)
  const runtime = rt(state), operation = runtime.openRun!.operations[0]
  let disclosureHash = [...(operation.privateChoiceDisclosures ?? [])].reverse().find(d => d.body.templateKey === templateKey)?.reviewHash
  const receipt = runtime.openRun!.ruleReceipts.find(r => r.operationKey === operation.operationKey)
  // These fixtures now perform the real explicit host disclosure before a
  // valid private choice; malformed/pre-result probes remain unprepared.
  if (!disclosureHash && operation.plan.rollVisibility !== 'public' && nextTtrpgOpenOperationStepV1(operation)?.kind === 'knowledge'
    && receipt && ttrpgOpenDiscoveryEffectTemplatesV1(operation,receipt).some(t => t.planKey === templateKey && t.alternatives.length)) {
    const gm = runtime.authorization!.seats.find(s => s.role === 'gm')!,viewerKey = gm.controller === 'ai' ? runtime.authorization!.viewerKey : gm.viewerKey
    const prepared = await prepareTtrpgOpenPrivateChoiceDisclosureV1({ ...command,viewerKey,kind: 'knowledge',templateKey })
    await discloseTtrpgOpenPrivateChoiceV1({ ...command,...await openEnvelopeV1(command.sessionId,await ttrpgOpenOperationCommandIdV1(runtime.sessionKey,operation.operationKey,`private-disclosure.${prepared.reviewHash}`)),
      viewerKey,kind: 'knowledge',templateKey,reviewHash: prepared.reviewHash })
    disclosureHash = prepared.reviewHash;state = await readProductRuntimeState(command.sessionId)
  }
  return { ...await openEnvelopeV1(command.sessionId, await ttrpgOpenOperationCommandIdV1(rt(state).sessionKey, operation.operationKey, `knowledge-choice.${templateKey}`)),
    ...command, riskHash: operation.riskHash, templateKey, alternativeKey, ...(disclosureHash ? { disclosureHash } : {}) }
}
async function assertReplay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), events)).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN3 frozen discovery cost alternatives', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it.each(['small', 'large'])('waits for %s human choice and charges the selected cost once across reload/recovery', async alternative => {
    const f = await fixture(), command = await start(f), resource = f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    const before = Number((await readProductRuntimeState(f.sessionId)).entities.hero.attributes[`resource.${resource}`])
    expect(await resumeTtrpgOpenOperationV1(command)).toEqual({ status: 'awaiting-choice', nextStepKey: 'knowledge', templateKeys: ['plan.discovery.cost'] })
    expect(Number((await readProductRuntimeState(f.sessionId)).entities.hero.attributes[`resource.${resource}`])).toBe(before)
    expect(rt(await readProductRuntimeState(f.sessionId)).openRun!.knowledge).toEqual([])
    const input = await select(command, alternative), selected = await selectTtrpgOpenDiscoveryEffectV1(input)
    expect(await selectTtrpgOpenDiscoveryEffectV1(input)).toEqual(selected)
    db.close(); await db.open()
    expect(rt(await readProductRuntimeState(f.sessionId)).openRun!.operations[0].discoveryChoices).toEqual([{ templateKey: input.templateKey, alternativeKey: alternative,
      selectionRef: { sessionKey: rt(await readProductRuntimeState(f.sessionId)).sessionKey, sequence: selected.sequence } }])
    expect(await resumeTtrpgOpenOperationV1(command)).toEqual({ status: 'awaiting-owner', nextStepKey: 'pressure' })
    const final = await readProductRuntimeState(f.sessionId)
    expect(Number(final.entities.hero.attributes[`resource.${resource}`])).toBe(before - (alternative === 'small' ? 1 : 2))
    expect(rt(final).openRun!.knowledge).toHaveLength(1)
    await resumeTtrpgOpenOperationV1(command)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(final)
    await assertReplay(f.sessionId)
  })
  it('requires a fail-forward choice after the real failed roll rather than granting knowledge first', async () => {
    const f = await fixture(true, true), command = await start(f)
    expect(await resumeTtrpgOpenOperationV1(command)).toMatchObject({ status: 'awaiting-choice', nextStepKey: 'knowledge' })
    expect(rt(await readProductRuntimeState(f.sessionId)).openRun!.ruleReceipts[0].result.outcome).toMatch(/failure/)
    const state = await readProductRuntimeState(f.sessionId), resource = f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    const input = { ...await openEnvelopeV1(f.sessionId, await ttrpgOpenOperationCommandIdV1(rt(state).sessionKey, command.operationKey, 'knowledge')), ...command }
    await expect(discoverTtrpgOpenKnowledgeV1(input)).rejects.toThrow(/真人选择/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
    await selectTtrpgOpenDiscoveryEffectV1(await select(command, 'small'))
    await resumeTtrpgOpenOperationV1(command)
    const final = await readProductRuntimeState(f.sessionId)
    expect(Number(final.entities.hero.attributes[`resource.${resource}`])).toBe(Number(state.entities.hero.attributes[`resource.${resource}`]) - 1)
    expect(rt(final).openRun!.knowledge).toHaveLength(1)
    await assertReplay(f.sessionId)
  })
  it('rejects unneeded fail-forward alternatives after success without blocking discovery', async () => {
    const f = await fixture(false, true), command = await start(f)
    for (const kind of ['rule', 'mechanics'] as const) {
      const state = await readProductRuntimeState(f.sessionId)
      const input = { ...await openEnvelopeV1(f.sessionId, await ttrpgOpenOperationCommandIdV1(rt(state).sessionKey, command.operationKey, kind)), ...command }
      if (kind === 'rule') await resolveTtrpgOpenOperationRuleV1(input)
      else await applyTtrpgOpenOperationEffectV1({ ...input, stepKey: kind })
      await completeTtrpgOpenOperationStepV1({ ...await openEnvelopeV1(f.sessionId, await ttrpgOpenOperationCommandIdV1(rt(state).sessionKey, command.operationKey, `${kind}.receipt`)), ...command, stepKey: kind })
    }
    await expect(selectTtrpgOpenDiscoveryEffectV1(await select(command))).rejects.toThrow(/真人选择/)
    expect(await resumeTtrpgOpenOperationV1(command)).toEqual({ status: 'awaiting-owner', nextStepKey: 'pressure' })
    expect(rt(await readProductRuntimeState(f.sessionId)).openRun!.operations[0].discoveryChoices).toBeUndefined()
    expect(rt(await readProductRuntimeState(f.sessionId)).openRun!.knowledge).toHaveLength(1)
  })
  it('requires both independent frozen choices before committing either cost or the knowledge grant', async () => {
    const f = await setup({ generic: true, cost: true }, pkg => {
      const cost = pkg.ttrpg!.campaign.effectPlanTemplates.find(t => t.planKey === 'plan.discovery.cost')!
      cost.alternatives = [{ alternativeKey: 'pay', title: '支付代价', effects: cost.effects }, { alternativeKey: 'other', title: '另一个代价', effects: cost.effects }]
      cost.effects = []
      const forward = structuredClone(cost)
      forward.planKey = 'plan.discovery.forward'
      pkg.ttrpg!.campaign.effectPlanTemplates.push(forward)
      pkg.ttrpg!.campaign.situationTemplates[0].evidence[0].discoveryPolicy.failForwardEffectPlanRef = forward.planKey
    })
    Object.assign(f.request.discovery.effectBindings, { 'plan.discovery.forward': { actor: 'hero' } })
    const command = await start(f), resource = f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    await resumeTtrpgOpenOperationV1(command)
    const before = await readProductRuntimeState(f.sessionId)
    await selectTtrpgOpenDiscoveryEffectV1(await select(command, 'pay'))
    expect(await resumeTtrpgOpenOperationV1(command)).toEqual({ status: 'awaiting-choice', nextStepKey: 'knowledge', templateKeys: ['plan.discovery.forward'] })
    const waiting = await readProductRuntimeState(f.sessionId)
    expect(waiting.entities).toEqual(before.entities)
    expect(rt(waiting).openRun!.knowledge).toEqual([])
    await selectTtrpgOpenDiscoveryEffectV1(await select(command, 'pay', 'plan.discovery.forward'))
    await resumeTtrpgOpenOperationV1(command)
    const final = await readProductRuntimeState(f.sessionId)
    expect(Number(final.entities.hero.attributes[`resource.${resource}`])).toBe(Number(before.entities.hero.attributes[`resource.${resource}`]) - 2)
    expect(rt(final).openRun!.knowledge).toHaveLength(1)
    expect(rt(final).openRun!.operations[0].discoveryChoices).toHaveLength(2)
    await assertReplay(f.sessionId)
  })
  it('rejects wrong viewer, stale risk, invented option, pre-result and changed retry while preserving state', async () => {
    const f = await fixture(), command = await start(f)
    await expect(selectTtrpgOpenDiscoveryEffectV1(await select(command))).rejects.toThrow(/真实规则/)
    await resumeTtrpgOpenOperationV1(command)
    const input = await select(command), before = await readProductRuntimeState(f.sessionId)
    for (const patch of [{ viewerKey: 'viewer.gm' }, { riskHash: 'f'.repeat(64) }, { alternativeKey: 'invented' }]) {
      await expect(selectTtrpgOpenDiscoveryEffectV1({ ...input, ...patch })).rejects.toThrow()
      expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    }
    const event = await selectTtrpgOpenDiscoveryEffectV1(input)
    await expect(selectTtrpgOpenDiscoveryEffectV1({ ...input, alternativeKey: 'small' })).rejects.toThrow()
    const payload = JSON.parse(event.payloadJson); payload.alternativeKey = 'invented'
    expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })).toThrow(/真人选择/)
    const operation = rt(await readProductRuntimeState(f.sessionId)).openRun!.operations[0]
    expect(() => parseTtrpgOpenOperationV1({ ...operation, discoveryChoices: [...operation.discoveryChoices!, ...operation.discoveryChoices!] })).toThrow(/重复/)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.sessionId, 'pause'), status: 'paused', changedBy: 'hero', viewerKey: OPEN_HUMAN_VIEWER, reason: '暂停' })
    await expect(resumeTtrpgOpenOperationV1(command)).rejects.toThrow(/暂停/)
  })
  it.each([false, true])('retains selected=%s across a fresh child approval and backup without rerolling', async chosen => {
    const f = await fixture(), command = await start(f)
    await resumeTtrpgOpenOperationV1(command)
    if (chosen) await selectTtrpgOpenDiscoveryEffectV1(await select(command))
    const parent = await readProductRuntimeState(f.sessionId), child = await forkAndStart(f.sessionId)
    await approve(child.sessionId, child.op.operationKey)
    const childCommand = { sessionId: child.sessionId, operationKey: child.op.operationKey, frozenPlanHash: child.op.planHash, viewerKey: OPEN_HUMAN_VIEWER }
    if (!chosen) {
      expect(await resumeTtrpgOpenOperationV1(childCommand)).toMatchObject({ status: 'awaiting-choice', nextStepKey: 'knowledge' })
      await selectTtrpgOpenDiscoveryEffectV1(await select(childCommand))
    }
    expect(await resumeTtrpgOpenOperationV1(childCommand)).toEqual({ status: 'awaiting-owner', nextStepKey: 'pressure' })
    const actual = await readProductRuntimeState(child.sessionId), resource = f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    expect(Number(actual.entities.hero.attributes[`resource.${resource}`])).toBe(Number(parent.entities.hero.attributes[`resource.${resource}`]) - 2)
    expect(rt(actual).openRun!.ruleReceipts[0].result).toEqual(rt(parent).openRun!.ruleReceipts[0].result)
    expect(rt(actual).openRun!.operations[0].discoveryChoices![0].selectionRef.sessionKey).toBe(rt(actual).sessionKey)
    const childEvents = await db.productRuntimeEvents.where('sessionId').equals(child.sessionId).toArray()
    expect(childEvents.filter(e => e.type === 'ttrpg.rule.action.resolved')).toEqual([])
    expect(childEvents.filter(e => e.type === 'ttrpg.open.knowledge.discovered')).toHaveLength(1)
    const importedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const sessions = await db.productRuntimeSessions.where('projectId').equals(importedProject).toArray()
    const importedStates = await Promise.all(sessions.map(s => readProductRuntimeState(s.id!)))
    const importedState = importedStates.find(s => rt(s).sessionKey === rt(actual).sessionKey)!
    expect(rt(importedState).openRun!.operations[0].discoveryChoices).toEqual(rt(actual).openRun!.operations[0].discoveryChoices)
    await assertReplay(child.sessionId)
  })
})

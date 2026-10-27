import { beforeEach,afterEach,describe,expect,it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedOpenInteractionV1 } from '../helpers/open-ttrpg-interaction'
import { proposeTtrpgOpenManualActionV1,confirmTtrpgOpenTableRiskV1,readTtrpgOpenTableV1,readTtrpgOpenManualActionCatalogV1,prepareTtrpgOpenTablePrivateChoiceV1,discloseTtrpgOpenTablePrivateChoiceV1,chooseTtrpgOpenTableConsequenceV1 } from '../../src/lib/ttrpg/open-table-service'
import { settleOpenPaidTurnsV1 } from '../helpers/open-ttrpg-paid-turns'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { parseRulePackV2 } from '../../src/lib/ttrpg/rule-pack-v2'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { parseTtrpgOpenRuleRequestV1,parseTtrpgOpenRulePlanV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1,startTtrpgOpenIntentCandidateOperationV1,changeTtrpgSituationV1,preauthorizeTtrpgOpenCompanionV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenIntentCandidateV1,generateTtrpgOpenCompanionCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { routeTtrpgOpenIntentV1 } from '../../src/lib/ttrpg/open-intent'
import { ttrpgOpenPredicateContextV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { TTRPG_OPEN_AUTHORITY_PROVIDER_V1 } from '../../src/lib/ttrpg/open-context-provider'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
async function propose(x: Awaited<ReturnType<typeof seedOpenInteractionV1>>) {
  const result = await proposeTtrpgOpenManualActionV1({ ...x.input,request: x.request,submissionKey: 'interaction.first',basisHash: x.catalog.basisHash,rawInput: '我明确选择这个冻结互动' })
  const op = (await readTtrpgOpenTableV1(x.input)).player!.operation!
  for (const a of op.approvals) await confirmTtrpgOpenTableRiskV1({ ...x.input,operationKey: op.operationKey,riskHash: op.riskHash,actorKey: a.actorKey,decision: 'approve' })
  return { result,command: { ...x.input,operationKey: op.operationKey,frozenPlanHash: rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations[0].planHash } }
}
describe('R-TTRPGOPEN3 frozen no-roll interaction kernel', { timeout: 60000 },() => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  it.each(['dialogue','observe','move','assist','retreat'] as const)('settles %s through the real action/effect/time journal without dice',async kind => {
    const x = await seedOpenInteractionV1(kind),before = await readProductRuntimeState(x.f.sessionId),{ command } = await propose(x)
    await settleOpenPaidTurnsV1(command)
    const after = await readProductRuntimeState(x.f.sessionId),run = rt(after).openRun!,op = run.operations[0]
    expect(op.plan.interaction?.kind).toBe(kind);expect(run.ruleReceipts[0].result).toMatchObject({ outcome: 'automatic',check: null })
    expect(run.ruleReceipts[0].result.resourceChanges.every(c => c.proofHash === null)).toBe(true)
    expect(run.worldTime.worldTurn).toBe(x.rule.timeCostWorldTurns);expect(run.coordination.calls).toEqual([])
    if (kind === 'move' || kind === 'retreat') expect(after.entities.hero.locationKey).toBe('market')
    else expect(after.entities.hero.locationKey).toBe(before.entities.hero.locationKey)
    if (kind === 'assist') {
      const resource = x.f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
      expect(after.entities.hero.attributes[`resource.${resource}`]).toBe(Number(before.entities.hero.attributes[`resource.${resource}`]) - 1)
    }
    if (kind === 'retreat') expect(run.chaos.value).toBe(rt(before).openRun!.chaos.value + 1)
    await settleOpenPaidTurnsV1(command);expect(await readProductRuntimeState(x.f.sessionId)).toEqual(after)
    const row = (await db.productRuntimeSessions.get(x.f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence'))).toEqual(after)
    if (kind === 'retreat') {
      const events = await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence')
      const event = events.find(e => e.type === 'ttrpg.rule.action.resolved')!,payload = JSON.parse(event.payloadJson)
      delete payload.recordChaos
      expect(() => replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),events.map(e => e.sequence === event.sequence ? { ...e,payloadJson: JSON.stringify(payload) } : e))).toThrow()
    }
  })
  it('does not let the base action, a generic check or a forged interaction replace the frozen binding',async () => {
    const x = await seedOpenInteractionV1('dialogue'),before = await readProductRuntimeState(x.f.sessionId)
    const { interactionKey: _binding,...base } = x.request
    for (const request of [base,{ ...x.request,interactionKey: 'invented.binding' },{ ...x.request,ruleKey: 'invented.action' }]) {
      await expect(proposeTtrpgOpenManualActionV1({ ...x.input,request,submissionKey: crypto.randomUUID(),basisHash: x.catalog.basisHash,rawInput: '非法互动必须零写入' })).rejects.toThrow()
      expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    }
    expect(() => parseTtrpgOpenRuleRequestV1({ ...x.request,route: 'generic-check' })).toThrow()
  })
  it('keeps unmet interaction conditions unavailable and blocks them before authority',async () => {
    const x = await seedOpenInteractionV1('observe',p => { p.ttrpg!.rulePack.content.interactionBindings![0].preconditions = [{ op: 'world-turn-at-least',value: 1 }] })
    expect(x.rule.available).toBe(false)
    const model = await loadTtrpgOpenPlayerContextV1({ ...x.input,actorKey: 'hero' })
    expect(model.view.rules.interactions![0]).toMatchObject({ available: false })
    expect(JSON.stringify(model.view.rules.interactions)).not.toContain('world-turn-at-least')
    const before = await readProductRuntimeState(x.f.sessionId)
    await expect(propose(x)).rejects.toThrow()
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
  })
  it('rejects an unaffordable combined base action and interaction before saving any authority',async () => {
    const x = await seedOpenInteractionV1('assist',p => {
      const c = p.ttrpg!,action = c.rulePack.content.actions[0]
      action.costResourceKey = c.rulePack.content.resources[0].key;action.costAmount = 5
      const effect = c.campaign.effectPlanTemplates.find(t => t.planKey === 'interaction.cost')!.effects[0]
      if (effect.family === 'numeric') effect.amount = 5
    })
    const before = await readProductRuntimeState(x.f.sessionId),resource = x.f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    expect(Number(before.entities.hero.attributes[`resource.${resource}`])).toBeGreaterThanOrEqual(5)
    expect(Number(before.entities.hero.attributes[`resource.${resource}`])).toBeLessThan(10)
    await expect(propose(x)).rejects.toThrow(/合计|费用/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
  })
  it('checks mixed-actor costs without exposing another actor balance or committing a partial operation',async () => {
    const x = await seedOpenInteractionV1('assist',p => {
      const c = p.ttrpg!,t = c.campaign.effectPlanTemplates.find(t => t.planKey === 'interaction.cost')!
      t.effects.push({ effectKey: 'other.cost',family: 'numeric',operation: 'resource.spend',targetRef: 'companion.1',valueKey: c.rulePack.content.resources[0].key,amount: 99 })
    }),before = await readProductRuntimeState(x.f.sessionId)
    await expect(propose(x)).rejects.toThrow('当前状态无法完成原行动与互动后果的合计费用或效果')
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
  })
  it('discovers observations only through the actual frozen evidence path and receiver list',async () => {
    const x = await seedOpenInteractionV1('observe',p => {
      const c = p.ttrpg!,t = c.campaign.situationTemplates[0],e = t.evidence[0]
      e.discoveryPolicy.paths = [{ kind: 'action',key: c.rulePack.content.actions[0].key,interventionPointKey: t.interventionPoints[0].pointKey }]
      e.discoverableBy = [c.rulePack.content.actions[0].key];e.discoveryPolicy.allowedAudience = 'private';e.discoveryPolicy.recipientActorKeys = ['hero']
      e.discoveryPolicy.costEffectPlanRef = null;e.discoveryPolicy.failForwardEffectPlanRef = null
    })
    await changeTtrpgSituationV1({ ...await openEnvelopeV1(x.f.sessionId,'interaction.opening'),templateKey: x.f.campaign.openingSituationKeys[0],activationReason: 'opening',mode: 'activated' })
    x.catalog = await readTtrpgOpenManualActionCatalogV1(x.input)
    const path = x.catalog.discoveries.find(d => d.route === x.request.route && d.ruleKey === x.request.ruleKey)!
    expect(path).toBeTruthy()
    const request = { ...x.request,discovery: { situationKey: path.situationKey,evidenceRef: path.evidenceRef,interventionPointKey: path.interventionPointKey,effectBindings: {} } }
    const before = await readProductRuntimeState(x.f.sessionId),{ command } = await propose({ ...x,request })
    expect(rt(await readProductRuntimeState(x.f.sessionId)).openRun!.knowledge).toEqual(rt(before).openRun!.knowledge)
    await settleOpenPaidTurnsV1(command)
    const after = rt(await readProductRuntimeState(x.f.sessionId)).openRun!
    expect(after.knowledge.find(k => k.evidenceRef === path.evidenceRef)).toMatchObject({ audience: 'private',recipientActorKeys: ['hero'],reliability: 'observed' })
    expect(after.ruleReceipts[0].result).toMatchObject({ outcome: 'automatic',check: null })
  })
  it.each(['party','actor:hero'] as const)('keeps affordable %s alternatives available and refuses an unaffordable selection without consuming the choice',async audience => {
    const x = await seedOpenInteractionV1('assist',p => {
      const t = p.ttrpg!.campaign.effectPlanTemplates.find(t => t.planKey === 'interaction.cost')!
      t.audience = audience
      t.alternatives = [{ alternativeKey: 'small',title: '支付一份资源',effects: t.effects },
        { alternativeKey: 'large',title: '支付九十九份资源',effects: t.effects.map(e => e.family === 'numeric' ? { ...e,amount: 99 } : e) }]
      t.effects = []
    }),{ command } = await propose(x)
    await settleOpenPaidTurnsV1(command)
    const locator = { operationKey: command.operationKey,kind: 'effect' as const,templateKey: 'interaction.cost' }
    let disclosureHash: string | undefined
    if (audience === 'actor:hero') {
      const prepared = await prepareTtrpgOpenTablePrivateChoiceV1({ ...x.input,...locator })
      await discloseTtrpgOpenTablePrivateChoiceV1({ ...x.input,...locator,reviewHash: prepared.reviewHash })
      disclosureHash = prepared.reviewHash
    }
    const before = await readProductRuntimeState(x.f.sessionId),op = (await readTtrpgOpenTableV1(x.input)).player!.operation!
    expect(op.risk.privateRoll).toBe(audience === 'actor:hero')
    const selection = { ...x.input,...locator,riskHash: op.riskHash,...(disclosureHash ? { disclosureHash } : {}) }
    await expect(chooseTtrpgOpenTableConsequenceV1({ ...selection,alternativeKey: 'large' })).rejects.toThrow(/费用|资源/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    const event = await chooseTtrpgOpenTableConsequenceV1({ ...selection,alternativeKey: 'small' })
    const payload = JSON.parse(event.payloadJson);payload.alternativeKey = 'large'
    expect(() => replayProductRuntimeEvents(before,[{ ...event,payloadJson: JSON.stringify(payload) }])).toThrow()
    await settleOpenPaidTurnsV1(command)
    const after = await readProductRuntimeState(x.f.sessionId),resource = x.f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    expect(after.entities.hero.attributes[`resource.${resource}`]).toBe(Number(before.entities.hero.attributes[`resource.${resource}`]) - 1)
    await settleOpenPaidTurnsV1(command);expect(await readProductRuntimeState(x.f.sessionId)).toEqual(after)
  })
  it('admits an actual governed semantic candidate only through the actor-visible frozen interaction',async () => {
    const x = await seedOpenInteractionV1('move',p => { p.ttrpg!.campaign.runtimePolicy.enabled = true; p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000 })
    const view = await loadTtrpgOpenPlayerContextV1({ ...x.input,actorKey: 'hero' })
    expect(view.view.rules.interactions).toContainEqual(expect.objectContaining({ interactionKey: x.rule.interactionKey,kind: 'move',timeCostWorldTurns: 2 }))
    expect(JSON.stringify(view.view.rules.interactions)).not.toMatch(/location.set|effectPlanRef|preconditions/)
    const resources = await TTRPG_OPEN_AUTHORITY_PROVIDER_V1.listMetadata({ scope: { ...x.f.scope,productRuntimeSessionId: x.f.sessionId,runtimeActorKey: 'hero' },limit: 100 })
    expect(resources.items.find(r => r.title === '当前角色的冻结无检定互动')?.priority).toBe('must-read')
    const rawInput = `我选择${x.rule.title}`
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(x.f.sessionId,'interaction.semantic.epoch'),viewerKey: x.input.viewerKey,triggerKind: 'submit-action',rawInput })
    const generated = await generateTtrpgOpenIntentCandidateV1({ ...await openEnvelopeV1(x.f.sessionId,'interaction.semantic.prepare'),...x.input,
      actorKey: 'hero',rawInput,maximumOutputTokens: 800,maximumCostUsd: 0.1,runAI: async messages => {
        expect(messages[0].content).toContain('method 精确填写该 interactionKey')
        expect(messages[1].content).toContain(x.rule.interactionKey!)
        return JSON.stringify({ goal: rawInput,method: x.rule.interactionKey,targetRefs: [],declaredResources: [],declaredAssumptions: [],requestedOutcome: null })
      } })
    const before = await readProductRuntimeState(x.f.sessionId)
    const preview = routeTtrpgOpenIntentV1(generated.candidate.intent!,{ rulePack: x.f.runtimePackage.ttrpg!.rulePack.content,
      campaign: x.f.runtimePackage.ttrpg!.campaign,predicateContext: ttrpgOpenPredicateContextV1(before,x.f.runtimePackage.ttrpg!) })
    expect(preview).toMatchObject({ route: 'no-roll',routeDetail: { interactionKey: x.rule.interactionKey },timeCostWorldTurns: 2 })
    const event = await startTtrpgOpenIntentCandidateOperationV1({ ...await openEnvelopeV1(x.f.sessionId,'interaction.semantic.confirm'),viewerKey: x.input.viewerKey,
      ...generated.prepared,candidateHash: generated.candidate.candidateHash,decision: 'start',effectBindings: x.request.effectBindings })
    expect(event.type).toBe('ttrpg.open.operation.started')
    const operation = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations[0]
    expect(operation.plan.request).toMatchObject({ route: 'existing-action',interactionKey: x.rule.interactionKey })
    expect(operation.status).toBe('awaiting-approval');expect(operation.intentEvidence?.candidateHash).toBe(generated.candidate.candidateHash)
    expect((await readProductRuntimeState(x.f.sessionId)).entities).toEqual(before.entities)
    const table = (await readTtrpgOpenTableV1(x.input)).player!.operation!
    for (const a of table.approvals) await confirmTtrpgOpenTableRiskV1({ ...x.input,operationKey: operation.operationKey,riskHash: table.riskHash,actorKey: a.actorKey,decision: 'approve' })
    await settleOpenPaidTurnsV1({ ...x.input,operationKey: operation.operationKey,frozenPlanHash: operation.planHash })
    const after = await readProductRuntimeState(x.f.sessionId)
    expect(after.entities.hero.locationKey).toBe('market');expect(rt(after).openRun!.ruleReceipts[0].result.check).toBeNull()
    expect(rt(after).openRun!.coordination.calls).toHaveLength(1)
  })
  it('uses the original Session Zero permission for a safe companion interaction and consumes its real bounded action slot',async () => {
    const x = await seedOpenInteractionV1('observe',p => { p.ttrpg!.campaign.runtimePolicy.enabled = true; p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000 })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(x.f.sessionId,'interaction.companion.epoch'),viewerKey: x.input.viewerKey,triggerKind: 'continue-host',rawInput: '给队友一次建议机会' })
    const generated = await generateTtrpgOpenCompanionCandidateV1({ ...await openEnvelopeV1(x.f.sessionId,'interaction.companion.prepare'),...x.input,
      actorKey: 'companion.1',rawInput: '只观察自己可见的环境',maximumOutputTokens: 800,maximumCostUsd: 0.1,
      runAI: async () => JSON.stringify({ goal: '观察环境',method: x.rule.interactionKey,targetRefs: [],declaredResources: [],declaredAssumptions: [],requestedOutcome: null }) })
    const candidate = { viewerKey: x.input.viewerKey,runId: generated.prepared.runId,requestKey: generated.prepared.requestKey,candidateHash: generated.candidate.candidateHash }
    await startTtrpgOpenIntentCandidateOperationV1({ ...await openEnvelopeV1(x.f.sessionId,'interaction.companion.start'),...candidate,decision: 'start' })
    const op = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations[0],command = { ...x.input,operationKey: op.operationKey,frozenPlanHash: op.planHash }
    await preauthorizeTtrpgOpenCompanionV1({ ...await operationInput(x.f.sessionId,op.operationKey,'preauthorization'),...candidate,operationKey: op.operationKey,frozenPlanHash: op.planHash })
    await settleOpenPaidTurnsV1(command)
    const after = rt(await readProductRuntimeState(x.f.sessionId)).openRun!
    expect(after.operations[0].preauthorization?.basis).toBe('session-zero-policy');expect(after.operations[0].approvals).toEqual([])
    expect(after.coordination.epochs[0].successfulActorKeys).toEqual(['companion.1'])
    expect(after.ruleReceipts[0].result).toMatchObject({ outcome: 'automatic',check: null })
  })
  it('rejects check and random-damage bindings, invalid movement and preserves absent legacy metadata',async () => {
    const x = await seedOpenInteractionV1('dialogue'),rule = x.f.runtimePackage.ttrpg!.rulePack.content
    const legacy = structuredClone(rule);delete legacy.interactionBindings
    expect(parseRulePackV2(legacy)).not.toHaveProperty('interactionBindings')
    const random = structuredClone(rule);random.interactionBindings![0].actionKey = random.actions.find(a => a.effects.some(e => e.kind === 'check' || e.kind === 'damage'))!.key
    expect(() => parseRulePackV2(random)).toThrow(/no-roll/)
    const move = structuredClone(rule);move.interactionBindings![0].kind = 'move'
    expect(() => parseRulePackV2(move)).toThrow(/移动/)
    const { command } = await propose(x),plan = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations[0].plan
    expect(() => parseTtrpgOpenRulePlanV1({ ...plan,interaction: { ...plan.interaction,timeCostWorldTurns: 10 } })).toThrow()
    await settleOpenPaidTurnsV1(command)
    const projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId)),copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    expect(rt(await readProductRuntimeState(copy.id!)).openRun!.operations[0].plan.interaction).toEqual(plan.interaction)
  })
})

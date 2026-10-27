/** Isolated real API fixture, no model transport or private config. */
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { startTtrpgOpenEpochV1, startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1, changeTtrpgSituationV1,
  ttrpgOpenOperationCommandIdV1 } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1, readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from './open-ttrpg-session'

const rt = (state: Awaited<ReturnType<typeof readProductRuntimeState>>) => parseTtrpgRuntimeStateV2(state.ttrpg)!
export async function setup(options: { released?: boolean; private?: boolean; generic?: boolean; failForward?: boolean; cost?: boolean } = {}, configure?: Parameters<typeof readyOpenTtrpgSessionV1>[1]) {
  const fixture = await readyOpenTtrpgSessionV1('real knowledge path', pkg => {
    const content = pkg.ttrpg!, template = content.campaign.situationTemplates[0], evidence = template.evidence[0]
    evidence.discoveryPolicy.allowedAudience = options.private ? 'private' : 'party'
    evidence.discoveryPolicy.recipientActorKeys = options.private ? ['hero'] : ['hero', 'companion.1', 'companion.2']
    evidence.discoveryPolicy.requiresPlayerConfirmation = true
    if (!options.generic) content.rulePack.content.actions[0].effects = []
    if (options.generic) {
      const check = content.rulePack.content.genericChecks[0]
      check.difficulty = 100
      evidence.discoverableBy = [check.checkKey]
      evidence.discoveryPolicy.paths = [{ kind: 'generic-check', key: check.checkKey, interventionPointKey: template.interventionPoints[0].pointKey }]
    }
    if (options.cost || options.failForward) {
      const resource = content.rulePack.content.resources[0].key
      content.campaign.effectPlanTemplates.push({ planKey: 'plan.discovery.cost', degree: 'failure', ruleRef: content.rulePack.content.ruleSystemId,
        reason: '冻结发现代价', audience: 'party', parameters: [{ parameterKey: 'actor', entityKinds: ['actor'], allowedRefs: ['hero'], allowDynamicFromTemplateKeys: [], required: true }],
        effects: [{ effectKey: 'cost', family: 'numeric', operation: 'resource.spend', targetRef: 'parameter:actor', valueKey: resource, amount: 1 }], alternatives: [] })
      if (options.cost) evidence.discoveryPolicy.costEffectPlanRef = 'plan.discovery.cost'
      if (options.failForward) evidence.discoveryPolicy.failForwardEffectPlanRef = 'plan.discovery.cost'
    }
    configure?.(pkg)
  }, undefined, options.released)
  await changeTtrpgSituationV1({ ...await openEnvelopeV1(fixture.sessionId, 'opening'), templateKey: fixture.campaign.openingSituationKeys[0], activationReason: 'opening', mode: 'activated' })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput: '在门口检查线索' })
  const state = await readProductRuntimeState(fixture.sessionId), template = fixture.campaign.situationTemplates[0]
  const action = fixture.runtimePackage.ttrpg!.rulePack.content.actions[0], check = fixture.runtimePackage.ttrpg!.rulePack.content.genericChecks[0]
  const discovery = { situationKey: rt(state).openRun!.situations.active[0].situationKey, evidenceRef: template.evidence[0].clueRef,
    interventionPointKey: template.interventionPoints[0].pointKey,
    effectBindings: options.cost || options.failForward ? { 'plan.discovery.cost': { actor: 'hero' } } : {} }
  const request = { route: options.generic ? 'generic-check' as const : 'existing-action' as const, actorKey: 'hero', controllerMode: 'human' as const,
    ruleKey: options.generic ? check.checkKey : action.key,
    targetKey: options.generic || action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper',
    effectBindings: options.generic ? { 'plan.success': { actor: 'hero' } } : {}, discovery }
  return { ...fixture, request }
}
export async function start(fixture: Awaited<ReturnType<typeof setup>>) {
  await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId, 'operation'), viewerKey: OPEN_HUMAN_VIEWER, request: fixture.request })
  const operation = rt(await readProductRuntimeState(fixture.sessionId)).openRun!.operations[0]
  for (const required of operation.plan.requiredApprovals) await confirmTtrpgOpenOperationV1({
    ...await openEnvelopeV1(fixture.sessionId, await ttrpgOpenOperationCommandIdV1(operation.startedRef.sessionKey, operation.operationKey, `approval.${required.actorKey}`)),
    viewerKey: OPEN_HUMAN_VIEWER, actorKey: required.actorKey, riskHash: operation.riskHash, decision: 'approve', operationKey: operation.operationKey, frozenPlanHash: operation.planHash })
  return { sessionId: fixture.sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER }
}

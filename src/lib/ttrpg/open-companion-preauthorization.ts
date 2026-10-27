/** Deterministic Session Zero permission, explicitly distinct from a new human risk approval. */
import type { ProductRuntimeState, ProductRuntimeEvent } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenIntentV1, routeTtrpgOpenIntentV1, routeTtrpgOpenIntentV2 } from './open-intent'
import { parseTtrpgOpenSituationFrozenContentV1 } from './open-situation-runtime'
import { ttrpgOpenPredicateContextV1 } from './open-rule-plan'
import * as p from './open-contract-parse'
import { assertTtrpgOpenDelegatedCompanionProposalV1 } from './open-hosting-delegation'
import { resolveTtrpgOpenIntentTargetV1, resolveTtrpgOpenIntentTargetV2 } from './open-rule-request-contract'
export interface TtrpgOpenCompanionPreauthorizationV1 {
  hostingDelegationRef?: TtrpgOpenSourceRefV1
  sourceRef: TtrpgOpenSourceRefV1; authorizationRef: TtrpgOpenSourceRefV1; candidateHash: string; actionKind: 'observe' | 'talk' | 'assist' | 'move' | 'low-risk-check'; basis: 'session-zero-policy'
}
export function parseTtrpgOpenCompanionPreauthorizationV1(value: unknown): TtrpgOpenCompanionPreauthorizationV1 {
  const hasDelegation = Object.prototype.hasOwnProperty.call(p.object(value,'companion permission'),'hostingDelegationRef')
  const r = p.record(value, ['sourceRef', 'authorizationRef', 'candidateHash', 'actionKind', 'basis',...(hasDelegation ? ['hostingDelegationRef'] : [])], 'companion original consent')
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef),hostingDelegationRef = hasDelegation ? parseTtrpgOpenSourceRefV1(r.hostingDelegationRef) : undefined
  if (hostingDelegationRef && (hostingDelegationRef.sessionKey !== sourceRef.sessionKey || hostingDelegationRef.sequence >= sourceRef.sequence)) p.fail('队友系统执行必须绑定真实先前委托')
  return { ...(hostingDelegationRef ? { hostingDelegationRef } : {}),sourceRef, authorizationRef: parseTtrpgOpenSourceRefV1(r.authorizationRef), candidateHash: p.hash(r.candidateHash, 'companion candidate'), actionKind: p.oneOf(r.actionKind, ['observe', 'talk', 'assist', 'move', 'low-risk-check'], 'preauthorized kind'), basis: p.literal(r.basis, 'session-zero-policy', 'original permission basis') }
}
export function previewTtrpgOpenCompanionPermissionV1(state: ProductRuntimeState, frozenContent: unknown, semanticIntent: unknown, operationKey: string) {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, run = runtime.openRun!, auth = runtime.authorization!, content = parseTtrpgOpenSituationFrozenContentV1(frozenContent)
  const operation = run.operations.find(o => o.operationKey === operationKey) ?? p.fail('预授权操作不存在'), actorKey = operation.plan.request.actorKey
  const seat = auth.seats.find(s => s.actorKey === actorKey), intent = parseTtrpgOpenIntentV1(semanticIntent), context = ttrpgOpenPredicateContextV1(state, content)
  const actors = content.campaign.characterTemplates.map(t => { const s = auth.seats.find(s => s.actorKey === t.characterKey); return { ...t, ...(s ? { controller: s.controller, seatKey: s.seatKey } : {}), ...(t.characterKey === actorKey ? { actionKeys: context.actors![actorKey].abilityKeys } : {}) } })
  const preview = (operation.intentEvidence?.routingVersion === 2 ? routeTtrpgOpenIntentV2 : routeTtrpgOpenIntentV1)(intent, { rulePack: content.rulePack.content, campaign: content.campaign, actors, predicateContext: context })
  const action = operation.plan.rulePack.actions.find(a => a.key === operation.plan.request.ruleKey)
  if (operation.intentEvidence?.sceneScope) {
    const target = (operation.intentEvidence?.routingVersion === 2 ? resolveTtrpgOpenIntentTargetV2 : resolveTtrpgOpenIntentTargetV1)({ route: operation.plan.request.route,actionTarget: action?.target,
      actorKey,targetRefs: intent.targetRefs,currentLocationRef: state.entities[actorKey]?.locationKey ?? null })
    if (target.targetKey !== operation.plan.request.targetKey || stable(target.sceneScope ?? null) !== stable(operation.intentEvidence.sceneScope)) p.fail('队友预授权的原意图与当前场景范围不一致')
  }
  if (!seat || seat.controller !== 'ai' || !seat.consent.aiAdviceAllowed || intent.actorKey !== actorKey || intent.source !== `companion:${actorKey}` || operation.inheritance
    || operation.status !== 'awaiting-approval' || operation.approvals.length || operation.businessRefs.length || operation.preauthorization || operation.plan.request.controllerMode !== 'ai'
    || run.stage.status !== 'open' || runtime.product.safety.status !== 'active' || preview.authorization !== 'preauthorized' || preview.requiresConfirmation || preview.confirmationReasonKinds.length
    || !['existing-action','no-roll'].includes(preview.route) || preview.routeDetail.interactionKey !== operation.plan.request.interactionKey
    || preview.routeDetail.actionKey !== operation.plan.request.ruleKey || !action || action.effects.length || action.costAmount > 0 || action.usage.mode !== 'unlimited'
    || operation.plan.effectTemplates.length || operation.plan.requiredApprovals.length !== 1 || operation.plan.requiredApprovals[0].actorKey !== actorKey
    || operation.plan.affectedActorKeys.some(key => key !== actorKey) || content.rulePack.contentHash !== operation.plan.rulePackContentHash) p.fail('当前队友行动超出原 Session Zero 预授权范围，必须由真实受影响者确认')
  return preview
}
export function applyTtrpgOpenCompanionPreauthorizationEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type !== 'ttrpg.open.companion.preauthorized') return false
  p.exact(payload, ['operationKey', 'frozenPlanHash', 'permission', 'semanticIntent', 'frozenContent', 'preview', 'intent'], 'companion policy admission')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) p.fail('队友预授权需要当前已确认团局')
  state.ttrpg = runtime
  const operation = run.operations.find(o => o.operationKey === payload.operationKey), permission = parseTtrpgOpenCompanionPreauthorizationV1(payload.permission)
  const epoch = run.coordination.epochs.find(e => e.epochKey === operation?.authorizationEpochKey), intent = p.record(payload.intent, ['operationKey', 'frozenPlanHash', 'viewerKey', 'candidateHash',...(permission.hostingDelegationRef ? ['hostingDelegationRef'] : [])], 'companion admission intent')
  if (!operation || !epoch || epoch.status !== 'active' || epoch.epochKey !== run.coordination.activeEpochKey || epoch.viewerKey !== intent.viewerKey
    || payload.frozenPlanHash !== operation.planHash || intent.operationKey !== operation.operationKey || intent.frozenPlanHash !== operation.planHash || event.actorKey !== 'gm' || event.targetKey !== operation.plan.request.actorKey
    || permission.sourceRef.sessionKey !== runtime.sessionKey || permission.sourceRef.sequence !== event.sequence || stable(permission.authorizationRef) !== stable(auth.sourceRef)
    || permission.candidateHash !== operation.intentEvidence?.candidateHash || intent.candidateHash !== permission.candidateHash
    || !run.coordination.calls.some(c => c.skillId === 'prose.ttrpg-open-companion' && c.status === 'succeeded' && c.actorKey === operation.plan.request.actorKey && c.runContractHash === operation.intentEvidence?.runContractHash)) p.fail('预授权没有原始真人授权、本候选及实际队友请求依据')
  if (permission.hostingDelegationRef) {
    if (stable(intent.hostingDelegationRef) !== stable(permission.hostingDelegationRef)) p.fail('队友系统执行的委托来源不一致')
    assertTtrpgOpenDelegatedCompanionProposalV1(state,{ epochKey: epoch.epochKey,viewerKey: epoch.viewerKey,delegationRef: permission.hostingDelegationRef,
      runContractHash: operation.intentEvidence!.runContractHash,actorKey: operation.plan.request.actorKey })
  }
  const preview = previewTtrpgOpenCompanionPermissionV1(state, payload.frozenContent, payload.semanticIntent, operation.operationKey)
  if (preview.actionKind !== permission.actionKind || stable(preview) !== stable(payload.preview)) p.fail('队友预授权不是当前实际规则与风险预检')
  operation.preauthorization = permission;operation.status = 'executing'
  return true
}

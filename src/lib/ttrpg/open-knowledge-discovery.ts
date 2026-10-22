import { ttrpgOpenSituationCatalogV1, ttrpgOpenSessionSituationActorAccessV1, ttrpgOpenSessionSituationDiscoveryPolicyV1 } from './open-session-situation-catalog'
import { parseTtrpgOpenSessionSituationReceiptV2, type TtrpgOpenSessionSituationReceipt } from './open-session-situation-contract'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
/** Frozen discovery path; action names alone never grant knowledge. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgRuntimeContentVersionedV1, isTtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { evaluateTtrpgPredicateV1 } from './predicate'
import { ttrpgOpenPredicateContextV1 } from './open-rule-plan'
import { hashTtrpgOpenEvidenceFieldsV1 } from './open-knowledge'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { effectTemplate } from './open-content-templates'
import type { TtrpgOpenEffectPlanTemplateV1 } from './open-contract'
import * as p from './open-contract-parse'
import { parseTtrpgOpenDiscoveryRequestV1,type TtrpgOpenDiscoveryRequestV1 } from './open-rule-request-contract'
export { parseTtrpgOpenDiscoveryRequestV1,type TtrpgOpenDiscoveryRequestV1 } from './open-rule-request-contract'

export interface TtrpgOpenDiscoveryPlanV1 {
  sessionSituation?: TtrpgOpenSessionSituationReceipt
  request: TtrpgOpenDiscoveryRequestV1
  frozenContent: TtrpgRuntimeContentV2
  contentHash: string
  publicFieldsHash: string
  recipientActorKeys: string[]
  actorKey: string
  route: 'existing-action' | 'generic-check'
  ruleKey: string
  effectTemplates: TtrpgOpenEffectPlanTemplateV1[]
}
export function parseTtrpgOpenDiscoveryPlanV1(value: unknown): TtrpgOpenDiscoveryPlanV1 {
  const hasSession = Object.prototype.hasOwnProperty.call(p.object(value, 'discovery plan'), 'sessionSituation')
  const r = p.record(value, [...(hasSession ? ['sessionSituation'] : []), 'request', 'frozenContent', 'contentHash', 'publicFieldsHash', 'recipientActorKeys', 'actorKey', 'route', 'ruleKey', 'effectTemplates'], 'discovery plan')
  const raw = p.object(r.frozenContent, 'discovery frozen content'), campaign = p.object(raw.campaign, 'discovery campaign')
  const sourceWorld = p.object(campaign.sourceWorld, 'discovery world')
  const frozenContent = parseTtrpgRuntimeContentVersionedV1(raw, p.hash(sourceWorld.contentHash, 'discovery world hash'), 2)
  if (!isTtrpgRuntimeContentV2(frozenContent)) p.fail('发现只能使用冻结 open 内容')
  const sessionSituation = hasSession ? parseTtrpgOpenSessionSituationReceiptV2(r.sessionSituation) : undefined
  const result = { ...(sessionSituation ? { sessionSituation } : {}), request: parseTtrpgOpenDiscoveryRequestV1(r.request), frozenContent,
    contentHash: p.hash(r.contentHash, 'discovery content hash'), publicFieldsHash: p.hash(r.publicFieldsHash, 'discovery public fields'),
    recipientActorKeys: p.keys(r.recipientActorKeys, 'discovery recipients', 1000), actorKey: p.key(r.actorKey, 'discovery actor'),
    route: p.oneOf(r.route, ['existing-action', 'generic-check'], 'discovery route'), ruleKey: p.key(r.ruleKey, 'discovery rule'),
    effectTemplates: p.list(r.effectTemplates, 'discovery effects', effectTemplate, 2) }
  const evidence = ttrpgOpenSituationCatalogV1(frozenContent.campaign, { situationReceipts: sessionSituation ? [sessionSituation] : [] }).evidence.get(result.request.evidenceRef)?.evidence
  if (sessionSituation && !sessionSituation.template.evidence.some(e => e.clueRef === result.request.evidenceRef)) p.fail('发现快照不是本线索实际已采用的定义')
  if (!evidence || result.recipientActorKeys.some(actor => !frozenContent.campaign.characterTemplates.some(character => character.role === 'player' && character.characterKey === actor))) p.fail('发现引用或接收者不在冻结内容中')
  if (sessionSituation?.version === 2 && (!sessionSituation.disclosure.authorization.basis.recipientActorKeys.includes(result.actorKey)
    || result.recipientActorKeys.some(actor => !sessionSituation.disclosure.authorization.basis.recipientActorKeys.includes(actor)))) p.fail('共同局势发现不能扩大本次原接收者范围')
  const planKeys = [...new Set([evidence.discoveryPolicy.costEffectPlanRef, evidence.discoveryPolicy.failForwardEffectPlanRef].filter((ref): ref is string => ref !== null))]
  if (result.effectTemplates.map(template => template.planKey).sort().join(',') !== planKeys.sort().join(',')
    || result.effectTemplates.some(template => JSON.stringify(template) !== JSON.stringify(frozenContent.campaign.effectPlanTemplates.find(original => original.planKey === template.planKey)))
    || Object.keys(result.request.effectBindings).sort().join(',') !== planKeys.sort().join(',')) p.fail('发现代价/失败前进只能来自冻结模板和完整绑定')
  return result
}
/** Broad audiences without an explicit subset resolve once to the current
 * authorized party. Private audiences never acquire an implicit recipient. */
export function resolveTtrpgOpenDiscoveryRecipientsV1(policy: { allowedAudience: string; recipientActorKeys: string[] },selectedActorKeys: string[]) {
  return policy.recipientActorKeys.length ? policy.recipientActorKeys.filter(key => selectedActorKeys.includes(key))
    : policy.allowedAudience === 'party' || policy.allowedAudience === 'public' ? [...selectedActorKeys] : []
}
export function assertTtrpgOpenDiscoveryPathV1(state: ProductRuntimeState, plan: TtrpgOpenDiscoveryPlanV1) {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun
  const instance = run?.situations.active.find(instance => instance.situationKey === plan.request.situationKey)
  const catalog = ttrpgOpenSituationCatalogV1(plan.frozenContent.campaign, run)
  const template = instance ? catalog.byKey.get(instance.templateKey) : undefined
  const owner = run?.situationReceipts?.find(r => r.template.templateKey === instance?.templateKey)
  if (stable(owner) !== stable(plan.sessionSituation)) p.fail('发现的会话局势快照没有同一真实采用回执')
  const evidence = template?.evidence.find(evidence => evidence.clueRef === plan.request.evidenceRef)
  const point = template?.interventionPoints.find(point => point.pointKey === plan.request.interventionPointKey)
  if (!runtime?.authorization || !run || !instance || !template || !evidence || !point
    || !ttrpgOpenSessionSituationActorAccessV1(run, template.templateKey, plan.actorKey)
    || (point.visibleTo === 'private' && !point.knownByActorKeys.includes(plan.actorKey))
    || (plan.route === 'existing-action' && !point.suggestedActionKeys.includes(plan.ruleKey))
    || !evidence.discoveryPolicy.paths.some(path => path.interventionPointKey === point.pointKey && path.key === plan.ruleKey
      && path.kind === (plan.route === 'existing-action' ? 'action' : 'generic-check'))) p.fail('知识发现没有本局势、本介入点与真实规则路径')
  const context = ttrpgOpenPredicateContextV1(state, plan.frozenContent)
  if ((point.requiresPredicate !== null && !evaluateTtrpgPredicateV1(point.requiresPredicate, context))
    || evidence.discoveryPolicy.preconditions.some(predicate => !evaluateTtrpgPredicateV1(predicate, context))) p.fail('知识发现前置条件未满足')
  const recipients = resolveTtrpgOpenDiscoveryRecipientsV1(ttrpgOpenSessionSituationDiscoveryPolicyV1(owner, evidence.discoveryPolicy),runtime.authorization!.selectedActorKeys)
  if (evidence.discoveryPolicy.allowedAudience !== 'gm-only' && !recipients.length
    || JSON.stringify([...recipients].sort()) !== JSON.stringify([...plan.recipientActorKeys].sort())) p.fail('知识发现接收者或授权已经 stale')
  return { runtime, instance, template, evidence, point }
}
export async function createTtrpgOpenDiscoveryPlanV1(input: {
  state: ProductRuntimeState; content: TtrpgRuntimeContentV2; request: TtrpgOpenDiscoveryRequestV1;
  actorKey: string; route: TtrpgOpenDiscoveryPlanV1['route']; ruleKey: string;
}): Promise<TtrpgOpenDiscoveryPlanV1> {
  const runtime = parseTtrpgRuntimeStateV2(input.state.ttrpg)
  if (!runtime?.authorization) p.fail('知识发现需要本桌授权')
  const catalog = ttrpgOpenSituationCatalogV1(input.content.campaign, runtime.openRun)
  const evidence = catalog.evidence.get(input.request.evidenceRef)?.evidence
  const owner = runtime.openRun?.situationReceipts?.find(r => r.template.evidence.some(e => e.clueRef === input.request.evidenceRef))
  if (!evidence) p.fail('没有该冻结 evidence')
  const plan = parseTtrpgOpenDiscoveryPlanV1({ ...(owner ? { sessionSituation: owner } : {}), request: input.request, frozenContent: input.content,
    contentHash: await hashProductProductionValueV2(input.content), publicFieldsHash: await hashTtrpgOpenEvidenceFieldsV1(catalog.validationView, evidence.clueRef),
    recipientActorKeys: resolveTtrpgOpenDiscoveryRecipientsV1(ttrpgOpenSessionSituationDiscoveryPolicyV1(owner, evidence.discoveryPolicy),runtime.authorization!.selectedActorKeys),
    actorKey: input.actorKey, route: input.route, ruleKey: input.ruleKey,
    effectTemplates: [...new Set([evidence.discoveryPolicy.costEffectPlanRef, evidence.discoveryPolicy.failForwardEffectPlanRef].filter((ref): ref is string => ref !== null))]
      .map(ref => input.content.campaign.effectPlanTemplates.find(template => template.planKey === ref) ?? p.fail('发现后果模板不存在')) })
  assertTtrpgOpenDiscoveryPathV1(input.state, plan)
  return plan
}

/** Exact frozen plan lookup; the actual action path separately checks this snapshot against its session. */
export function ttrpgOpenDiscoveryEvidenceV1(plan: TtrpgOpenDiscoveryPlanV1) {
  return ttrpgOpenSituationCatalogV1(plan.frozenContent.campaign, { situationReceipts: plan.sessionSituation ? [plan.sessionSituation] : [] })
    .evidence.get(plan.request.evidenceRef)?.evidence ?? p.fail('发现计划没有原始线索定义')
}

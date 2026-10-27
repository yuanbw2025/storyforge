import { applyTtrpgEffectPlanToRuntimeV2 } from './effect-runtime'
import { projectTtrpgRulePackMechanicalCoreV1 } from './rule-pack-v2'
/** Explicit frozen pressure consequence selection and stakeholder consent; no AI or DB writes. */
import type { ProductRuntimeState, TtrpgEffectPrimitiveV2, TtrpgEffectPlanV2 } from '../types'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import type { TtrpgOpenPressureCycleV1, TtrpgOpenPressureWorkV1 } from './open-pressure-cycle'
export type TtrpgOpenConsequenceEffectBasisV1 = Pick<TtrpgOpenPressureCycleV1, 'cycleKey' | 'frozenContent' | 'contentHash' | 'runtimeSourceHash'>
export type TtrpgOpenConsequenceEffectWorkV1 = Pick<TtrpgOpenPressureWorkV1, 'workKey' | 'templateKey' | 'situationTemplateKey' | 'causeRef' | 'completedRef' | 'effectReviews'>
import { assertTtrpgOpenPressureGmV1 } from './open-pressure-cycle'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { projectTtrpgOpenMechanicalBasisV1 } from './open-rule-plan'
import { validateTtrpgOpenEffectBindingsV1 } from './open-effect-binding'
import { parseTtrpgEffectPlanV2 } from './effect-plan'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashProductProductionValueV2 } from '../product-production/hash'
import * as p from './open-contract-parse'

export interface TtrpgOpenPressureEffectRequestV1 { bindings: Record<string, string | null>; alternativeKey: string | null }
export interface TtrpgOpenPressureEffectReviewV1 {
  reviewKey: string; revision: number; request: TtrpgOpenPressureEffectRequestV1
  mechanicalStateJson: string; authorizationEpochKey: string; authorizationHash: string; riskHash: string
  requiredApprovals: Array<{ actorKey: string; allowedSeatKeys: string[] }>
  decisions: Array<{ actorKey: string; seatKey: string; viewerKey: string; decision: 'approve' | 'reject'; sourceRef: TtrpgOpenSourceRefV1 }>
  status: 'awaiting-approval' | 'approved' | 'rejected' | 'stale' | 'unpayable'
}
export function parseTtrpgOpenPressureEffectRequestV1(value: unknown): TtrpgOpenPressureEffectRequestV1 {
  const r = p.record(value, ['bindings', 'alternativeKey'], 'pressure effect request')
  return { bindings: Object.fromEntries(Object.entries(p.object(r.bindings, 'pressure bindings')).map(([key, value]) => [p.key(key, 'pressure parameter'), p.nullable(value, p.key, 'pressure target')])),
    alternativeKey: p.nullable(r.alternativeKey, p.key, 'pressure alternative') }
}
export function parseTtrpgOpenPressureEffectReviewV1(value: unknown): TtrpgOpenPressureEffectReviewV1 {
  const r = p.record(value, ['reviewKey', 'revision', 'request', 'mechanicalStateJson', 'authorizationEpochKey', 'authorizationHash', 'riskHash', 'requiredApprovals', 'decisions', 'status'], 'pressure effect review')
  if (typeof r.mechanicalStateJson !== 'string' || r.mechanicalStateJson.length > 4000000) p.fail('压力后果状态依据不是有界 JSON')
  p.object(p.json(r.mechanicalStateJson), 'pressure mechanical basis')
  const requiredApprovals = p.list(r.requiredApprovals, 'pressure approvals', value => {
    const a = p.record(value, ['actorKey', 'allowedSeatKeys'], 'pressure approval requirement')
    return { actorKey: p.key(a.actorKey, 'pressure approval actor'), allowedSeatKeys: p.keys(a.allowedSeatKeys, 'pressure human approvers', 1000, 1) }
  }, 1000, 1)
  const decisions = p.list(r.decisions, 'pressure decisions', value => {
    const d = p.record(value, ['actorKey', 'seatKey', 'viewerKey', 'decision', 'sourceRef'], 'pressure decision')
    return { actorKey: p.key(d.actorKey, 'pressure decision actor'), seatKey: p.key(d.seatKey, 'pressure approver seat'), viewerKey: p.key(d.viewerKey, 'pressure viewer'),
      decision: p.oneOf(d.decision, ['approve', 'reject'], 'pressure decision'), sourceRef: parseTtrpgOpenSourceRefV1(d.sourceRef) }
  }, 1000)
  const status = p.oneOf(r.status, ['awaiting-approval', 'approved', 'rejected', 'stale', 'unpayable'], 'pressure review status')
  if (new Set(requiredApprovals.map(a => a.actorKey)).size !== requiredApprovals.length || new Set(decisions.map(d => d.actorKey)).size !== decisions.length
    || decisions.some(d => !requiredApprovals.some(a => a.actorKey === d.actorKey && a.allowedSeatKeys.includes(d.seatKey)))
    || ['approved', 'unpayable'].includes(status) && !requiredApprovals.every(a => decisions.some(d => d.actorKey === a.actorKey && d.decision === 'approve'))
    || status === 'rejected' && !decisions.some(d => d.decision === 'reject')) p.fail('压力后果批准范围或状态不一致')
  return { reviewKey: p.key(r.reviewKey, 'pressure review key'), revision: p.integer(r.revision, 'pressure review revision', 1, 1000), request: parseTtrpgOpenPressureEffectRequestV1(r.request),
    mechanicalStateJson: r.mechanicalStateJson, authorizationEpochKey: p.key(r.authorizationEpochKey, 'pressure effect epoch'), authorizationHash: p.hash(r.authorizationHash, 'pressure approval hash'), riskHash: p.hash(r.riskHash, 'pressure risk hash'),
    requiredApprovals, decisions, status }
}
export function ttrpgOpenPressureEffectDefinitionV1(input: { state: ProductRuntimeState; runtime: TtrpgRuntimeStateV2; cycle: TtrpgOpenConsequenceEffectBasisV1; work: TtrpgOpenConsequenceEffectWorkV1; request: TtrpgOpenPressureEffectRequestV1 }) {
  const { runtime, cycle, work, request } = input, auth = runtime.authorization ?? p.fail('压力效果需要实际授权')
  const template = cycle.frozenContent.campaign.effectPlanTemplates.find(t => t.planKey === work.templateKey) ?? p.fail('压力效果模板不存在')
  if (work.situationTemplateKey || work.completedRef) p.fail('本待办不是未完成的效果 owner')
  const primitives = template.alternatives.length ? template.alternatives.find(a => a.alternativeKey === request.alternativeKey)?.effects
    : request.alternativeKey === null ? template.effects : undefined
  if (!primitives) p.fail('压力后果必须明确选择冻结选项，不能默认选择第一个')
  validateTtrpgOpenEffectBindingsV1({ state: input.state, templates: [template], bindings: { [template.planKey]: request.bindings }, authorization: auth, readableBinding: () => true })
  const effects: TtrpgEffectPrimitiveV2[] = primitives.flatMap(effect => {
    if (effect.family === 'knowledge' || effect.family === 'story' && effect.operation !== 'location.set') p.fail('该压力后果仍需要明确的知识/故事 owner，不能代写')
    const targetRef = effect.targetRef.startsWith('parameter:') ? request.bindings[effect.targetRef.slice(10)] : effect.targetRef
    if (targetRef === null) return []
    if (!targetRef || !input.state.entities[targetRef] || input.state.entities[targetRef].lifecycleStatus !== 'active') p.fail('压力后果引用的实体不存在或已失效')
    return [{ ...effect, targetRef }]
  })
  const affected = [...new Set(effects.filter(effect => input.state.entities[effect.targetRef]?.kind === 'player').map(effect => effect.targetRef))]
  if (affected.some(actor => !auth.selectedActorKeys.includes(actor))) p.fail('压力后果不能影响未确认加入的玩家')
  const gm = auth.seats.find(s => s.role === 'gm') ?? p.fail('压力效果缺少 GM 控制权')
  const gmSeats = gm.controller === 'ai' ? [auth.completedBySeatKey] : auth.seats.filter(s => s.role === 'gm' && s.controller !== 'ai' && s.assignmentState === 'claimed').map(s => s.seatKey)
  const requiredApprovals = [{ actorKey: 'gm', allowedSeatKeys: gmSeats }, ...affected.map(actorKey => {
    const seat = auth.seats.find(s => s.actorKey === actorKey && s.role === 'player') ?? p.fail('压力受影响玩家不在已确认席位')
    if (seat.controller === 'ai') {
      const binding = auth.approvalBindings.find(b => b.companionActorKey === actorKey) ?? p.fail('压力 AI 队友需要真人批准关系')
      return { actorKey, allowedSeatKeys: [...binding.approverSeatKeys] }
    }
    if (seat.assignmentState !== 'claimed') p.fail('压力代价需要实际已认领的真人玩家')
    return { actorKey, allowedSeatKeys: [seat.seatKey] }
  })]
  return { template, effects, requiredApprovals }
}
export function ttrpgOpenPressureEffectReviewCurrentV1(state: ProductRuntimeState, runtime: TtrpgRuntimeStateV2, epochKey: string, review: TtrpgOpenPressureEffectReviewV1) {
  return review.authorizationEpochKey === epochKey && review.mechanicalStateJson === stable(projectTtrpgOpenMechanicalBasisV1(state))
    && runtime.openRun?.coordination.activeEpochKey === epochKey
}
export async function prepareTtrpgOpenPressureEffectReviewV1(input: { state: ProductRuntimeState; runtime: TtrpgRuntimeStateV2; cycle: TtrpgOpenConsequenceEffectBasisV1; work: TtrpgOpenConsequenceEffectWorkV1;
  request: TtrpgOpenPressureEffectRequestV1; epochKey: string; viewerKey: string }) {
  const { runtime, work, cycle } = input
  assertTtrpgOpenPressureGmV1(runtime.authorization!, input.viewerKey)
  const previous = currentTtrpgOpenPressureEffectReviewV1(work)
  if (previous) pressureEffectRevisionReasonV1({ ...input, review: previous })
  const request = parseTtrpgOpenPressureEffectRequestV1(input.request), { requiredApprovals } = ttrpgOpenPressureEffectDefinitionV1({ ...input, request })
  const revision = (previous?.revision ?? 0) + 1, reviewKey = `pressure-review.${revision}`
  const basis = { cycleKey: cycle.cycleKey, workKey: work.workKey, causeRef: work.causeRef, contentHash: cycle.contentHash, runtimeSourceHash: cycle.runtimeSourceHash,
    revision, request, mechanicalStateJson: stable(projectTtrpgOpenMechanicalBasisV1(input.state)), authorizationEpochKey: input.epochKey,
    authorizationHash: await hashProductProductionValueV2(runtime.authorization), requiredApprovals }
  return parseTtrpgOpenPressureEffectReviewV1({ reviewKey, ...Object.fromEntries(Object.entries(basis).filter(([key]) => !['cycleKey', 'workKey', 'causeRef', 'contentHash', 'runtimeSourceHash'].includes(key))),
    riskHash: await hashProductProductionValueV2(basis), decisions: [], status: 'awaiting-approval' })
}
export function createTtrpgOpenPressureEffectPlanV1(input: { state: ProductRuntimeState; runtime: TtrpgRuntimeStateV2; cycle: TtrpgOpenConsequenceEffectBasisV1; work: TtrpgOpenConsequenceEffectWorkV1;
  review: TtrpgOpenPressureEffectReviewV1; commandId: string }): TtrpgEffectPlanV2 {
  const { template, effects } = ttrpgOpenPressureEffectDefinitionV1({ ...input, request: input.review.request })
  const approvalRef = input.review.decisions[input.review.decisions.length - 1]?.sourceRef
  if (!approvalRef || approvalRef.sessionKey !== input.runtime.sessionKey) p.fail('压力效果需要本分支真实真人批准事件作为本地效果来源')
  return parseTtrpgEffectPlanV2({ schema: 'storyforge.ttrpg-effect-plan', version: 2, planKey: input.commandId,
    degree: template.degree, sourceEventId: `event.${approvalRef.sequence}`, ruleRef: template.ruleRef,
    reason: template.reason, audience: template.audience, status: 'immediate', effects, idempotencyKey: input.commandId })
}

export function currentTtrpgOpenPressureEffectReviewV1(work: TtrpgOpenConsequenceEffectWorkV1) {
  return work.effectReviews?.[work.effectReviews.length - 1]
}

/** Existing kernel plus exact-payment receipt validation; failed payment never commits a partial consequence. */
export function settleTtrpgOpenPressureEffectPlanV1(input: { state: ProductRuntimeState; cycle: TtrpgOpenConsequenceEffectBasisV1; plan: TtrpgEffectPlanV2; sequence: number }) {
  const applied = applyTtrpgEffectPlanToRuntimeV2({ state: input.state, rulePack: projectTtrpgRulePackMechanicalCoreV1(input.cycle.frozenContent.rulePack.content), plan: input.plan, eventSequence: input.sequence })
  for (const effect of input.plan.effects) {
    if (effect.family !== 'numeric' || effect.operation !== 'resource.spend') continue
    const transition = applied.transitions.find(t => t.effectKey === effect.effectKey)
    if (!transition) p.fail('压力支付缺少实际资源收据')
    const before = p.number(p.json(transition.beforeJson), 'pressure payment before', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), after = p.number(p.json(transition.afterJson), 'pressure payment after', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    if (before - after !== Math.abs(effect.amount)) throw new TtrpgOpenPressurePaymentErrorV1()
  }
  return applied
}

export class TtrpgOpenPressurePaymentErrorV1 extends Error {
  constructor() { super('[ttrpg-pressure] 压力代价资源不足，不能以截断支付宣称完成') }
}
export function pressureEffectRevisionReasonV1(input: { state: ProductRuntimeState; runtime: TtrpgRuntimeStateV2; cycle: TtrpgOpenConsequenceEffectBasisV1; work: TtrpgOpenConsequenceEffectWorkV1;
  review: TtrpgOpenPressureEffectReviewV1; epochKey: string }): 'rejected' | 'stale' | 'unpayable' {
  if (input.review.status === 'rejected') return 'rejected'
  if (['stale', 'unpayable'].includes(input.review.status)) return input.review.status === 'stale' ? 'stale' : 'unpayable'
  if (!ttrpgOpenPressureEffectReviewCurrentV1(input.state, input.runtime, input.epochKey, input.review)) return 'stale'
  if (input.review.status === 'approved') {
    try {
      const plan = createTtrpgOpenPressureEffectPlanV1({ ...input, commandId: 'pressure-revision-read-only' })
      settleTtrpgOpenPressureEffectPlanV1({ state: input.state, cycle: input.cycle, plan, sequence: input.state.lastSequence + 1 })
    } catch (error) { if (error instanceof TtrpgOpenPressurePaymentErrorV1) return 'unpayable'; throw error }
  }
  return p.fail('已有仍可执行的真人选择，不能替换或跳过批准')
}

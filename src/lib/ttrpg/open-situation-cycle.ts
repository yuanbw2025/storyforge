import { parseTtrpgOpenSessionSituationRefsV1, type TtrpgOpenSessionSituationRefV1 } from './open-session-situation-catalog'
import { ttrpgOpenSituationCatalogV1 } from './open-session-situation-catalog'
import { ttrpgOpenTurnCycleIdentityV1 } from './open-turn-settlement'
import { parseTtrpgOpenPressureEffectReviewV1, type TtrpgOpenPressureEffectReviewV1, type TtrpgOpenConsequenceEffectWorkV1 } from './open-pressure-effect'
/** Durable E11 maintenance. The journal owns causal work; no DB/provider/world writes. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgOpenOperationV1 } from './open-operation'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgRuntimeStateV2, parseTtrpgOpenSituationRuntimeStateV1 } from './open-runtime-contract'
import { parseTtrpgOpenSituationFrozenContentV1, settleTtrpgOpenSituationQueueV1, admitTtrpgOpenSituationV1, ttrpgOpenSituationProjectionActorV1 } from './open-situation-runtime'
import { sameTtrpgOpenPressureSourceV1,ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle'
import { evaluateTtrpgSituationProgressV1, evaluateTtrpgSituationMaintenanceV1 } from './situation-engine'
import { ttrpgOpenPredicateContextV1 } from './open-rule-plan'
import { changeTtrpgOpenChaosV1 } from './open-chaos'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'
export interface TtrpgOpenSituationCycleWorkV1 {
  workKey: string; kind: 'effect' | 'clock' | 'activate'; targetKey: string;
  causeRef: TtrpgOpenSourceRefV1; completedRef: TtrpgOpenSourceRefV1 | null; effectReviews?: TtrpgOpenPressureEffectReviewV1[]
}
export interface TtrpgOpenSituationCycleV1 {
  operationStepKey?: string
  sessionSituationRefs?: TtrpgOpenSessionSituationRefV1[]
  cycleKey: string; ruleSourceRef: TtrpgOpenSourceRefV1; startedRef: TtrpgOpenSourceRefV1;
  frozenContent: TtrpgRuntimeContentV2; contentHash: string; runtimeSourceHash: string;
  situationKeys: string[]; maintenanceRefs: TtrpgOpenSourceRefV1[];
  queueCredits: number; queueRefs: TtrpgOpenSourceRefV1[];
  work: TtrpgOpenSituationCycleWorkV1[]; completedRef: TtrpgOpenSourceRefV1 | null
}
export function parseTtrpgOpenSituationCycleV1(value: unknown): TtrpgOpenSituationCycleV1 {
  const hasStep = Object.prototype.hasOwnProperty.call(p.object(value,'situation cycle'),'operationStepKey')
  const hasRefs = Object.prototype.hasOwnProperty.call(p.object(value, 'situation cycle'), 'sessionSituationRefs')
  const r = p.record(value, [...(hasStep ? ['operationStepKey'] : []), ...(hasRefs ? ['sessionSituationRefs'] : []),'cycleKey', 'ruleSourceRef', 'startedRef', 'frozenContent', 'contentHash', 'runtimeSourceHash', 'situationKeys', 'maintenanceRefs', 'queueCredits', 'queueRefs', 'work', 'completedRef'], 'situation cycle')
  const sessionSituationRefs = hasRefs ? parseTtrpgOpenSessionSituationRefsV1(r.sessionSituationRefs) : undefined
  const operationStepKey = hasStep ? p.key(r.operationStepKey,'situation owner step') : undefined
  if (operationStepKey && !/^situations\.(?:[1-9]|10)$/.test(operationStepKey)) p.fail('局势 owner 必须是实际逐轮步骤')
  const frozenContent = parseTtrpgOpenSituationFrozenContentV1(r.frozenContent), situationKeys = p.keys(r.situationKeys, 'situation cycle instances', 5)
  const work = p.list(r.work, 'situation causal work', value => {
    const raw = p.object(value, 'situation work'), hasReviews = Object.prototype.hasOwnProperty.call(raw, 'effectReviews')
    const w = p.record(value, ['workKey', 'kind', 'targetKey', 'causeRef', 'completedRef', ...(hasReviews ? ['effectReviews'] : [])], 'situation work')
    const kind = p.oneOf(w.kind, ['effect', 'clock', 'activate'], 'situation work owner'), targetKey = p.key(w.targetKey, 'situation work target')
    if (kind === 'effect' ? !frozenContent.campaign.effectPlanTemplates.some(t => t.planKey === targetKey)
      : kind === 'clock' ? !frozenContent.campaign.clocks.some(t => t.clockKey === targetKey)
      : !frozenContent.campaign.situationTemplates.some(t => t.templateKey === targetKey) && !sessionSituationRefs?.some(r => r.templateKey === targetKey)) p.fail('局势后果目标不在冻结内容')
    if (hasReviews && kind !== 'effect') p.fail('只有真实效果 owner 可以保存批准')
    const effectReviews = hasReviews ? p.list(w.effectReviews, 'situation effect revisions', parseTtrpgOpenPressureEffectReviewV1, 1000, 1) : undefined
    if (effectReviews?.some((review, i) => review.revision !== i + 1 || i < effectReviews.length - 1 && !['rejected', 'stale', 'unpayable'].includes(review.status))) p.fail('局势效果修订必须保留被拒绝或失效的真实记录')
    return { workKey: p.key(w.workKey, 'situation work key'), kind, targetKey, causeRef: parseTtrpgOpenSourceRefV1(w.causeRef), completedRef: p.nullable(w.completedRef, parseTtrpgOpenSourceRefV1, 'situation work receipt'), ...(effectReviews ? { effectReviews } : {}) }
  }, 10000)
  if (new Set(work.map(w => w.workKey)).size !== work.length || work.some((w, i) => w.completedRef && work.slice(0, i).some(prior => !prior.completedRef))) p.fail('局势后果必须有序且唯一')
  const maintenanceRefs = p.list(r.maintenanceRefs, 'maintenance sources', parseTtrpgOpenSourceRefV1, situationKeys.length)
  const completedRef = p.nullable(r.completedRef, parseTtrpgOpenSourceRefV1, 'situation cycle completion'), queueCredits = p.integer(r.queueCredits, 'queue release credits', 0, 5)
  if (completedRef && (maintenanceRefs.length !== situationKeys.length || work.some(w => !w.completedRef) || queueCredits)) p.fail('局势维护仍有真实待办')
  return { ...(sessionSituationRefs ? { sessionSituationRefs } : {}), ...(operationStepKey ? { operationStepKey } : {}),cycleKey: p.key(r.cycleKey, 'situation cycle key'), ruleSourceRef: parseTtrpgOpenSourceRefV1(r.ruleSourceRef), startedRef: parseTtrpgOpenSourceRefV1(r.startedRef), frozenContent,
    contentHash: p.hash(r.contentHash, 'situation content hash'), runtimeSourceHash: p.hash(r.runtimeSourceHash, 'situation source hash'), situationKeys, maintenanceRefs,
    queueCredits, queueRefs: p.list(r.queueRefs, 'queue attempts', parseTtrpgOpenSourceRefV1, 10000), work, completedRef }
}
/** A later real maintenance window may reuse an already vacant slot after cooldown. */
export function ttrpgOpenSituationQueueCreditsV1(state: ProductRuntimeState): number {
  const run = parseTtrpgRuntimeStateV2(state.ttrpg)!.openRun!
  return Math.min(5 - run.situations.active.length, run.situations.queued.length)
}
export type TtrpgOpenSituationCycleActionV1 = { kind: 'maintain'; situationKey: string } | { kind: 'queue'; situationKey: string } | { kind: 'queue-drained' } | { kind: 'work'; workKey: string }
export function nextTtrpgOpenSituationCycleActionV1(state: ProductRuntimeState, cycle: TtrpgOpenSituationCycleV1): TtrpgOpenSituationCycleActionV1 | null {
  if (cycle.completedRef) return null
  const pending = cycle.work.find(w => !w.completedRef)
  if (pending) return { kind: 'work', workKey: pending.workKey }
  const run = parseTtrpgRuntimeStateV2(state.ttrpg)!.openRun!
  if (cycle.queueCredits) {
    const first = [...run.situations.queued].sort((a, b) => a.queuePosition! - b.queuePosition!)[0]
    return first ? { kind: 'queue', situationKey: first.situationKey } : { kind: 'queue-drained' }
  }
  const key = cycle.situationKeys[cycle.maintenanceRefs.length]
  return key ? { kind: 'maintain', situationKey: key } : null
}
export function ttrpgOpenSituationCycleActionKeyV1(action: TtrpgOpenSituationCycleActionV1 | null, cycle: TtrpgOpenSituationCycleV1 | undefined,stepKey = 'situations'): string {
  const scope = cycle?.operationStepKey ?? stepKey
  if (!cycle) return `${scope}.plan`
  if (!action) return `${scope}.settled`
  if (action.kind === 'maintain') return `${scope}.maintain.${action.situationKey}`
  if (action.kind === 'work') return `${scope}.work.${action.workKey}`
  return `${scope}.queue.${cycle.queueRefs.length}`
}
export function settleTtrpgOpenSituationCycleActionV1(input: { state: ProductRuntimeState; cycle: TtrpgOpenSituationCycleV1; operation: TtrpgOpenOperationV1;
  action: TtrpgOpenSituationCycleActionV1; sequence: number; instanceKey: string | null }) {
  const state = structuredClone(input.state), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, run = runtime.openRun!, cycle = structuredClone(input.cycle), content = cycle.frozenContent
  state.ttrpg = runtime
  const sourceRef = { sessionKey: runtime.sessionKey, sequence: input.sequence }, action = input.action
  const addWork = (kind: TtrpgOpenSituationCycleWorkV1['kind'], targetKey: string, suffix: string) => cycle.work.push({ workKey: `${kind}.${input.sequence}.${suffix}`, kind, targetKey, causeRef: sourceRef, completedRef: null })
  let result: unknown
  if (action.kind === 'maintain') {
    const instance = run.situations.active.find(i => i.situationKey === action.situationKey) ?? p.fail('维护实例不在真实 active')
    const template = ttrpgOpenSituationCatalogV1(content.campaign, run).templates.find(t => t.templateKey === instance.templateKey) ?? p.fail('维护模板不存在')
    const context = ttrpgOpenPredicateContextV1(state, content)
    const progress = evaluateTtrpgSituationProgressV1({ template, instance, predicateContext: context })
    const maintained = evaluateTtrpgSituationMaintenanceV1({ template, instance: { ...instance, satisfiedObstacleKeys: progress.satisfiedObstacleKeys }, predicateContext: context,
      worldTurn: run.worldTime.worldTurn, resolvedAtSequence: input.sequence, activeInstances: run.situations.active, queuedTemplateKeys: [], templateContext: ttrpgOpenSituationCatalogV1(content.campaign, run).validationView })
    const next = parseTtrpgOpenSituationRuntimeStateV1({ ...maintained.instance, queuePosition: null }, 'maintained actual situation')
    if (maintained.transition === 'unchanged') run.situations.active = run.situations.active.map(i => i.situationKey === instance.situationKey ? next : i)
    else {
      run.situations.active = run.situations.active.filter(i => i.situationKey !== instance.situationKey)
      run.situations.history = [...(run.situations.history ?? []), { sourceRef, causeRef: cycle.ruleSourceRef, instance: next }]
      run.situations.cooldowns[template.templateKey] = maintained.cooldownUntilWorldTurn!
      cycle.queueCredits++
      if (next.resolutionKind === 'intervened') changeTtrpgOpenChaosV1(run, 'situation-resolved', input.sequence)
      if (next.resolutionKind === 'no-intervention') {
        template.noInterventionOutcome.advancesClockKeys.forEach((key, i) => addWork('clock', key, `expiry.${i}`))
        if (template.noInterventionOutcome.effectPlanRef) addWork('effect', template.noInterventionOutcome.effectPlanRef, 'expiry')
      }
      template.consequences.forEach((c, i) => {
        addWork('effect', c.effectPlanRef, `consequence.${i}`)
        if (c.nextSituationTemplateKey) addWork('activate', c.nextSituationTemplateKey, `consequence.${i}`)
      })
    }
    cycle.maintenanceRefs.push(sourceRef)
    result = { transition: maintained.transition === 'unchanged' ? 'progressed' : maintained.transition, instance: next, newlySatisfiedObstacleKeys: progress.newlySatisfiedObstacleKeys }
  } else if (action.kind === 'queue-drained') {
    cycle.queueCredits = 0; cycle.queueRefs.push(sourceRef)
    result = { transition: 'queue-drained' }
  } else if (action.kind === 'queue') {
    const queued = settleTtrpgOpenSituationQueueV1({ state, content, actorKey: ttrpgOpenSituationProjectionActorV1(runtime, input.operation.plan.request.actorKey), situationKey: action.situationKey, sequence: input.sequence })
    run.situations = queued.runtime.openRun!.situations; run.failures = queued.runtime.openRun!.failures
    if (queued.result.transition === 'activated' || queued.result.transition === 'retained') cycle.queueCredits--
    cycle.queueRefs.push(sourceRef);result = queued.result
  } else {
    const work = cycle.work.find(w => w.workKey === action.workKey && !w.completedRef) ?? p.fail('局势待办不存在')
    if (work.kind === 'activate') {
      const admitted = admitTtrpgOpenSituationV1({ state, content, templateKey: work.targetKey, actorKey: ttrpgOpenSituationProjectionActorV1(runtime, input.operation.plan.request.actorKey),
        sequence: input.sequence, instanceKey: p.key(input.instanceKey, 'consequence instance'), activationReason: 'consequence', recordRejection: true })
      run.situations = admitted.runtime.openRun!.situations; run.failures = admitted.runtime.openRun!.failures
      work.completedRef = sourceRef
      return { state, runtime, cycle: parseTtrpgOpenSituationCycleV1(cycle), result: admitted.result }
    }
    if (work.kind !== 'clock') p.fail('该后果需要其真实 owner，不可伪造完成')
    const clock = run.clocks.find(c => c.clockKey === work.targetKey) ?? p.fail('到期后果时钟不存在')
    const definition = content.campaign.clocks.find(c => c.clockKey === work.targetKey)!
    const before = clock.value, after = Math.min(clock.maximum, before + 1), crossed = before < clock.maximum && after === clock.maximum
    clock.value = after; clock.completed = after === clock.maximum
    if (after !== before) clock.lastAdvancedWorldTurn = run.worldTime.worldTurn
    if (crossed) {
      changeTtrpgOpenChaosV1(run, 'clock-complete', input.sequence)
      if (definition.onCompleteEffectPlanRef) {
        const followup = { workKey: `effect.${input.sequence}.clock-complete`, kind: 'effect' as const, targetKey: definition.onCompleteEffectPlanRef, causeRef: sourceRef, completedRef: null }
        cycle.work.splice(cycle.work.indexOf(work) + 1, 0, followup)
      }
    }
    work.completedRef = sourceRef
    result = { transition: 'clock', triggerSource: 'situation-outcome', causeRef: work.causeRef, clockKey: clock.clockKey, before, after, crossed, atWorldTurn: run.worldTime.worldTurn }
  }
  return { state, runtime, cycle: parseTtrpgOpenSituationCycleV1(cycle), result }
}
export function assertTtrpgOpenSituationCycleHistoryV1(runtime: ReturnType<typeof parseTtrpgRuntimeStateV2>): void {
  if (!runtime) return
  const cycles = runtime.openRun?.situationCycles ?? []
  if (new Set(cycles.map(c => c.cycleKey)).size !== cycles.length || new Set(cycles.map(ttrpgOpenTurnCycleIdentityV1)).size !== cycles.length) p.fail('局势周期或真实裁定重复')
  for (const cycle of cycles) {
    for (const ref of [cycle.ruleSourceRef, cycle.startedRef, ...cycle.maintenanceRefs, ...cycle.queueRefs, ...cycle.work.flatMap(w => [w.causeRef, ...(w.completedRef ? [w.completedRef] : []), ...(w.effectReviews?.flatMap(review => review.decisions.map(d => d.sourceRef)) ?? [])]), ...(cycle.completedRef ? [cycle.completedRef] : [])]) {
      if (ref.sessionKey === runtime.sessionKey) continue
      const ancestor = runtime.branchLineage?.ancestors.find(a => a.sessionKey === ref.sessionKey && a.throughSequence >= ref.sequence)
      if (cycle.startedRef.sessionKey === runtime.sessionKey && sameTtrpgOpenPressureSourceV1(ref,cycle.ruleSourceRef)
        && runtime.openRun?.ruleReceipts.some(r => sameTtrpgOpenPressureSourceV1(ttrpgOpenPressureRuleSourceV1(r),ref))
        && ancestor?.snapshot.openRun?.ruleReceipts.some(r => sameTtrpgOpenPressureSourceV1(ttrpgOpenPressureRuleSourceV1(r),ref))) continue
      if (!ancestor?.snapshot.openRun?.situationCycles?.some(c => c.cycleKey === cycle.cycleKey && (stable(c) === stable(cycle)
        || [c.ruleSourceRef, c.startedRef, ...c.maintenanceRefs, ...c.queueRefs, ...c.work.flatMap(w => [w.causeRef, ...(w.completedRef ? [w.completedRef] : []), ...(w.effectReviews?.flatMap(review => review.decisions.map(d => d.sourceRef)) ?? [])]), ...(c.completedRef ? [c.completedRef] : [])].some(r => sameTtrpgOpenPressureSourceV1(r, ref))))) p.fail('局势周期缺少实际祖先依据')
    }
  }
}

/** Narrow semantic view of a real situation-owned effect; never fabricate a pressure cycle. */
export function ttrpgOpenSituationEffectWorkV1(work: TtrpgOpenSituationCycleWorkV1): TtrpgOpenConsequenceEffectWorkV1 {
  if (work.kind !== 'effect') p.fail('该局势待办不是效果 owner')
  return { workKey: work.workKey, templateKey: work.targetKey, situationTemplateKey: null, causeRef: work.causeRef, completedRef: work.completedRef, ...(work.effectReviews ? { effectReviews: work.effectReviews } : {}) }
}

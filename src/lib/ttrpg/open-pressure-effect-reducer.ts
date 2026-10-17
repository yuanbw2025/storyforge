import { ttrpgOpenTurnCycleMatchesV1 } from './open-turn-settlement'
import { ttrpgOpenSituationEffectWorkV1 } from './open-situation-cycle'
/** Pure approval and effect application with exact frozen selection, scope and current basis. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { sameTtrpgOpenPressureSourceV1, ttrpgOpenPressureRuleSourceV1, assertTtrpgOpenPressureGmV1 } from './open-pressure-cycle'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { currentTtrpgOpenPressureEffectReviewV1, parseTtrpgOpenPressureEffectReviewV1, ttrpgOpenPressureEffectDefinitionV1, ttrpgOpenPressureEffectReviewCurrentV1, createTtrpgOpenPressureEffectPlanV1, settleTtrpgOpenPressureEffectPlanV1, pressureEffectRevisionReasonV1 } from './open-pressure-effect'
import * as p from './open-contract-parse'
export function applyTtrpgOpenPressureEffectEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (!['ttrpg.open.pressure.effect.confirmed', 'ttrpg.open.pressure.effect.applied', 'ttrpg.open.situations.effect.confirmed', 'ttrpg.open.situations.effect.applied', 'ttrpg.open.stage.effect.confirmed', 'ttrpg.open.stage.effect.applied'].includes(event.type)) return false
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) p.fail('压力后果需要已授权团局')
  state.ttrpg = runtime
  const operation = run.operations.find(o => o.operationKey === payload.operationKey), epoch = run.coordination.epochs.find(e => e.epochKey === operation?.authorizationEpochKey)
  const receipt = run.ruleReceipts.find(r => r.operationKey === operation?.operationKey)
  const owner = event.type.startsWith('ttrpg.open.stage.') ? 'stage' : event.type.startsWith('ttrpg.open.situations.') ? 'situations' : 'pressure'
  const ownerStep = owner === 'stage' ? 'gates' : owner
  const actualSituationWork = owner === 'situations' ? run.situationCycles?.find(c => c.cycleKey === payload.cycleKey)?.work.find(w => w.workKey === payload.workKey) : undefined
  const cycle = owner === 'stage' ? run.stageClosures?.find(c => c.cycleKey === payload.cycleKey) : owner === 'situations' ? run.situationCycles?.find(c => c.cycleKey === payload.cycleKey) : run.pressureCycles?.find(c => c.cycleKey === payload.cycleKey)
  const work = owner === 'stage' ? run.stageClosures?.find(c => c.cycleKey === payload.cycleKey)?.work.find(w => w.workKey === payload.workKey) : owner === 'situations' ? actualSituationWork && ttrpgOpenSituationEffectWorkV1(actualSituationWork) : run.pressureCycles?.find(c => c.cycleKey === payload.cycleKey)?.work.find(w => w.workKey === payload.workKey)
  const causeRef = parseTtrpgOpenSourceRefV1(payload.causeRef), eventRef = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  const intent = p.object(payload.intent, 'pressure effect intent'), seat = auth.seats.find(s => s.viewerKey === intent.viewerKey)
  if (!operation || !epoch || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey || !receipt || !cycle || !work || work.completedRef
    || operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== ownerStep || operation.businessRefs.some(r => r.stepKey === nextTtrpgOpenOperationStepV1(operation)?.stepKey)
    || payload.frozenPlanHash !== operation.planHash || intent.operationKey !== operation.operationKey || intent.frozenPlanHash !== operation.planHash
    || intent.cycleKey !== cycle.cycleKey || intent.workKey !== work.workKey || !sameTtrpgOpenPressureSourceV1(cycle.ruleSourceRef, ttrpgOpenPressureRuleSourceV1(receipt))
    || owner !== 'stage' && !ttrpgOpenTurnCycleMatchesV1(cycle,operation,ttrpgOpenPressureRuleSourceV1(receipt),owner)
    || cycle.completedRef || cycle.work.find(w => !w.completedRef)?.workKey !== work.workKey
    || !sameTtrpgOpenPressureSourceV1(causeRef, work.causeRef) || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || event.actorKey !== seat.actorKey || event.targetKey !== null) p.fail('压力后果的真实任务、顺序、窗口或真人身份不一致')
  const previous = currentTtrpgOpenPressureEffectReviewV1(work)
  if (event.type.endsWith('.effect.confirmed')) {
    p.exact(payload, ['operationKey', 'frozenPlanHash', 'cycleKey', 'workKey', 'causeRef', 'review', 'actorKey', 'decision', 'proposed', 'intent'], 'pressure consequence confirmation')
    const review = parseTtrpgOpenPressureEffectReviewV1(payload.review), actorKey = p.key(payload.actorKey, 'pressure approval actor'), decision = p.oneOf(payload.decision, ['approve', 'reject'], 'pressure approval')
    if (intent.riskHash !== review.riskHash || intent.actorKey !== actorKey || intent.decision !== decision || intent.reviewKey !== review.reviewKey) p.fail('压力后果真人确认没有绑定本修订风险')
    if (payload.proposed === true) {
      p.exact(intent, ['operationKey', 'frozenPlanHash', 'cycleKey', 'workKey', 'viewerKey', 'riskHash', 'actorKey', 'decision', 'reviewKey', 'request'], 'pressure proposal intent')
      assertTtrpgOpenPressureGmV1(auth, seat.viewerKey)
      const definition = ttrpgOpenPressureEffectDefinitionV1({ state, runtime, cycle, work, request: review.request })
      if (actorKey !== 'gm' || decision !== 'approve' || review.revision !== (previous?.revision ?? 0) + 1 || review.decisions.length || review.status !== 'awaiting-approval'
        || stable(review.request) !== stable(intent.request) || stable(review.requiredApprovals) !== stable(definition.requiredApprovals)
        || review.authorizationHash !== epoch.authorizationHash || !ttrpgOpenPressureEffectReviewCurrentV1(state, runtime, epoch.epochKey, review)) p.fail('压力后果提案必须由真实 GM 明确冻结选项与受影响范围')
      if (previous) previous.status = pressureEffectRevisionReasonV1({ state, runtime, cycle, work, review: previous, epochKey: epoch.epochKey })
      work.effectReviews = [...(work.effectReviews ?? []), review]
    } else {
      p.literal(payload.proposed, false, 'pressure existing approval')
      p.exact(intent, ['operationKey', 'frozenPlanHash', 'cycleKey', 'workKey', 'viewerKey', 'riskHash', 'actorKey', 'decision', 'reviewKey'], 'pressure approval intent')
      if (!previous || stable(review) !== stable(previous) || previous.status !== 'awaiting-approval'
        || !ttrpgOpenPressureEffectReviewCurrentV1(state, runtime, epoch.epochKey, previous)) p.fail('压力后果修订已变化、被拒绝或过期')
    }
    const active = currentTtrpgOpenPressureEffectReviewV1(work)!, required = active.requiredApprovals.find(a => a.actorKey === actorKey)
    if (!required?.allowedSeatKeys.includes(seat.seatKey) || active.decisions.some(d => d.actorKey === actorKey)) p.fail('压力代价只能由对应真人批准，不能 AI 自批或重复确认')
    active.decisions.push({ actorKey, seatKey: seat.seatKey, viewerKey: seat.viewerKey, decision, sourceRef: eventRef })
    if (decision === 'reject') active.status = 'rejected'
    else if (active.requiredApprovals.every(a => active.decisions.some(d => d.actorKey === a.actorKey && d.decision === 'approve'))) active.status = 'approved'
  } else {
    p.exact(payload, ['operationKey', 'frozenPlanHash', 'cycleKey', 'workKey', 'causeRef', 'reviewKey', 'effectPlan', 'intent'], 'pressure effect applied')
    p.exact(intent, ['operationKey', 'frozenPlanHash', 'cycleKey', 'workKey', 'viewerKey', 'reviewKey'], 'pressure effect application intent')
    if (seat.viewerKey !== epoch.viewerKey || !previous || previous.status !== 'approved' || payload.reviewKey !== previous.reviewKey || intent.reviewKey !== previous.reviewKey
      || !ttrpgOpenPressureEffectReviewCurrentV1(state, runtime, epoch.epochKey, previous)) p.fail('压力后果未获全部真人批准或授权/状态已经 stale')
    const expected = createTtrpgOpenPressureEffectPlanV1({ state, runtime, cycle, work, review: previous, commandId: p.key(event.commandId, 'pressure effect command') })
    if (stable(payload.effectPlan) !== stable(expected)) p.fail('压力效果不是真人已批准的冻结参数/选项')
    const applied = settleTtrpgOpenPressureEffectPlanV1({ state, cycle, plan: expected, sequence: event.sequence })
    state.entities = applied.state.entities
    runtime.product = applied.state.ttrpg!.product
    work.completedRef = eventRef
  }
  if (actualSituationWork) {
    if (work.effectReviews) actualSituationWork.effectReviews = work.effectReviews
    actualSituationWork.completedRef = work.completedRef
  }
  return true
}

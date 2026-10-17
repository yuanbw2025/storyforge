import { ttrpgOpenTurnCycleMatchesV1 } from './open-turn-settlement'
import { assertTtrpgSituationInstanceGatesV1, instantiateTtrpgSituationV1 } from './situation-engine'
import { parseTtrpgOpenSituationRuntimeStateV1 } from './open-runtime-contract'
/** Pressure-driven admission/cleanup consumes a real pending cause, never an AI-declared completion. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { sameTtrpgOpenPressureSourceV1, ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle'
import { settleTtrpgOpenSituationWorkV1, ttrpgOpenSituationGateContextV1, parseTtrpgOpenSituationFrozenContentV1, ttrpgOpenSituationProjectionActorV1 } from './open-situation-runtime'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'
export function applyTtrpgOpenSituationWorkEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type === 'ttrpg.situation.changed' && Object.prototype.hasOwnProperty.call(payload, 'admission')) {
    p.exact(payload, ['intent', 'mode', 'situation', 'admission'], 'opening admission')
    const admission = p.record(payload.admission, ['frozenContent', 'runtimeSourceHash', 'viewerKey', 'actorKey'], 'opening authority')
    const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
    if (!runtime || !run || !auth) p.fail('开局局势需要真实运行授权')
    const content = parseTtrpgOpenSituationFrozenContentV1(admission.frozenContent), instance = parseTtrpgOpenSituationRuntimeStateV1(payload.situation, 'opening instance')
    const intent = p.object(payload.intent, 'opening intent'), template = content.campaign.situationTemplates.find(t => t.templateKey === intent.templateKey)
    const seat = auth.seats.find(s => s.viewerKey === admission.viewerKey)
    p.exact(intent, ['templateKey', 'activationReason', 'mode', ...(Object.prototype.hasOwnProperty.call(intent, 'viewerKey') ? ['viewerKey'] : [])], 'opening intent')
    if (!template || !content.campaign.openingSituationKeys.includes(template.templateKey) || intent.activationReason !== 'opening'
      || admission.actorKey !== seat?.actorKey || admission.viewerKey !== auth.viewerKey || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed'
      || intent.viewerKey !== undefined && intent.viewerKey !== seat.viewerKey || run.operations.length || run.worldTime.worldTurn !== 0 || runtime.branchLineage
      || content.rulePack.contentHash !== runtime.product.rulePackContentHash || event.actorKey !== null || event.targetKey !== template.templateKey) p.fail('开局必须来自冻结开局清单与当前开始授权')
    p.hash(admission.runtimeSourceHash, 'opening runtime source')
    let queued = false
    try { assertTtrpgSituationInstanceGatesV1({ template, actorKey: ttrpgOpenSituationProjectionActorV1(runtime, seat.actorKey), predicateContext: ttrpgOpenSituationGateContextV1(state, content, ttrpgOpenSituationProjectionActorV1(runtime, seat.actorKey)), worldTurn: run.worldTime.worldTurn,
      activeInstances: run.situations.active, cooldownUntilWorldTurn: run.situations.cooldowns, templateContext: content.campaign, rulePack: content.rulePack.content }) }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (/I[1-5]:/.test(reason) || !/I[67]:/.test(reason)) throw error
      queued = true
    }
    const expected = { ...instantiateTtrpgSituationV1({ template, activatedAtSequence: event.sequence, activatedAtWorldTurn: run.worldTime.worldTurn, activationReason: 'opening' }),
      situationKey: instance.situationKey, status: queued ? 'queued' : 'active', queuePosition: queued ? Math.max(-1, ...run.situations.queued.map(i => i.queuePosition!)) + 1 : null }
    if (stable(instance) !== stable(expected) || payload.mode !== (queued ? 'queued' : 'activated') || intent.mode !== 'auto' && intent.mode !== payload.mode) p.fail('开局实例必须通过真实实例门及队列约束')
    if (queued) run.situations.queued.push(instance); else run.situations.active.push(instance)
    state.ttrpg = runtime
    return true
  }
  if (event.type !== 'ttrpg.open.pressure.situation.completed') return false
  p.exact(payload, ['operationKey', 'frozenPlanHash', 'cycleKey', 'workKey', 'causeRef', 'instanceKey', 'result', 'intent', ...(Object.prototype.hasOwnProperty.call(payload, 'recordRejection') ? ['recordRejection'] : [])], 'situation work receipt')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) p.fail('局势后果需要已授权团局')
  state.ttrpg = runtime
  const operation = run.operations.find(o => o.operationKey === payload.operationKey), receipt = run.ruleReceipts.find(r => r.operationKey === operation?.operationKey)
  const cycle = run.pressureCycles?.find(c => c.cycleKey === payload.cycleKey), work = cycle?.work.find(w => w.workKey === payload.workKey)
  const epoch = run.coordination.epochs.find(e => e.epochKey === operation?.authorizationEpochKey)
  const intent = p.record(payload.intent, ['operationKey', 'frozenPlanHash', 'cycleKey', 'workKey', 'viewerKey'], 'situation work intent')
  const seat = auth.seats.find(s => s.viewerKey === intent.viewerKey)
  if (!operation || operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'pressure' || !receipt || !cycle || !work || work.completedRef
    || cycle.work.find(w => !w.completedRef)?.workKey !== work.workKey || payload.frozenPlanHash !== operation.planHash
    || !ttrpgOpenTurnCycleMatchesV1(cycle,operation,ttrpgOpenPressureRuleSourceV1(receipt),'pressure')
    || !sameTtrpgOpenPressureSourceV1(parseTtrpgOpenSourceRefV1(payload.causeRef), work.causeRef)
    || !epoch || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed'
    || seat.viewerKey !== epoch.viewerKey || event.actorKey !== 'gm' || event.targetKey !== work.situationTemplateKey
    || intent.operationKey !== operation.operationKey || intent.frozenPlanHash !== operation.planHash || intent.cycleKey !== cycle.cycleKey || intent.workKey !== work.workKey) p.fail('局势后果不是本窗口当前真实未完成的任务')
  const recordRejection = Object.prototype.hasOwnProperty.call(payload, 'recordRejection')
  if (recordRejection) p.literal(payload.recordRejection, true, 'record situation rejection')
  const settled = settleTtrpgOpenSituationWorkV1({ state, cycle, work, actorKey: operation.plan.request.actorKey, sequence: event.sequence, instanceKey: p.key(payload.instanceKey, 'situation key'), recordRejection })
  if (stable(payload.result) !== stable(settled.result)) p.fail('局势实例、队列或终态不是冻结后果的确定性结果')
  runtime.openRun!.situations = settled.runtime.openRun!.situations
  runtime.openRun!.failures = settled.runtime.openRun!.failures
  if (recordRejection) work.situationDisposition = settled.result.transition
  work.completedRef = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  return true
}

import { ttrpgOpenSituationCatalogSnapshotV1 } from './open-session-situation-catalog'
import { ttrpgOpenTurnOwnerStepV1,ttrpgOpenTurnCycleMatchesV1,ttrpgOpenTurnCycleMetadataV1 } from './open-turn-settlement'
/** Actual owner-stage journal with exact deterministic replay. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { sameTtrpgOpenPressureSourceV1, ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle'
import { parseTtrpgOpenSituationCycleV1, nextTtrpgOpenSituationCycleActionV1, ttrpgOpenSituationCycleActionKeyV1, settleTtrpgOpenSituationCycleActionV1, ttrpgOpenSituationQueueCreditsV1 } from './open-situation-cycle'
import * as p from './open-contract-parse'
export function applyTtrpgOpenSituationCycleEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (!['ttrpg.open.situations.planned', 'ttrpg.open.situations.changed', 'ttrpg.open.situations.settled'].includes(event.type)) return false
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) p.fail('局势维护需要已授权团局')
  state.ttrpg = runtime
  const operation = run.operations.find(o => o.operationKey === payload.operationKey), receipt = run.ruleReceipts.find(r => r.operationKey === operation?.operationKey)
  const intent = p.record(payload.intent, ['operationKey', 'frozenPlanHash', 'viewerKey', 'actionKey'], 'situation maintenance intent'), seat = auth.seats.find(s => s.viewerKey === intent.viewerKey)
  const epoch = run.coordination.epochs.find(e => e.epochKey === operation?.authorizationEpochKey), sourceRef = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  if (!operation || !receipt || operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'situations'
    || operation.businessRefs.some(r => r.stepKey === nextTtrpgOpenOperationStepV1(operation)?.stepKey) || payload.frozenPlanHash !== operation.planHash
    || !epoch || epoch.status !== 'active' || epoch.epochKey !== run.coordination.activeEpochKey || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || seat.viewerKey !== epoch.viewerKey
    || intent.operationKey !== operation.operationKey || intent.frozenPlanHash !== operation.planHash || event.actorKey !== 'gm' || event.targetKey !== null
    || !sameTtrpgOpenPressureSourceV1(parseTtrpgOpenSourceRefV1(payload.causeRef), receipt.sourceRef)) p.fail('局势维护不是当前真实操作、窗口与规则因果')
  const ownerStep = ttrpgOpenTurnOwnerStepV1(operation,'situations')
  if (event.type === 'ttrpg.open.situations.planned') {
    p.exact(payload, ['operationKey', 'frozenPlanHash', 'causeRef', 'cycle', 'intent'], 'situation planned')
    const cycle = parseTtrpgOpenSituationCycleV1(payload.cycle)
    if (intent.actionKey !== `${ownerStep}.plan` || cycle.operationStepKey !== ttrpgOpenTurnCycleMetadataV1(operation,'situations').operationStepKey || !sameTtrpgOpenPressureSourceV1(cycle.startedRef, sourceRef)
      || !ttrpgOpenTurnCycleMatchesV1(cycle,operation,ttrpgOpenPressureRuleSourceV1(receipt),'situations') || cycle.runtimeSourceHash !== operation.plan.runtimeSourceHash
      || cycle.frozenContent.rulePack.contentHash !== operation.plan.rulePackContentHash || cycle.maintenanceRefs.length || cycle.queueRefs.length || cycle.work.length || cycle.completedRef || cycle.queueCredits !== ttrpgOpenSituationQueueCreditsV1(state)
      || stable(cycle.sessionSituationRefs) !== stable(ttrpgOpenSituationCatalogSnapshotV1(cycle.frozenContent.campaign, run).sessionSituationRefs)
      || stable(cycle.situationKeys) !== stable(run.situations.active.map(i => i.situationKey))
      || run.situationCycles?.some(c => c.cycleKey === cycle.cycleKey || ttrpgOpenTurnCycleMatchesV1(c,operation,cycle.ruleSourceRef,'situations'))) p.fail('局势维护计划必须冻结真实 active 清单和原始裁定')
    run.situationCycles = [...(run.situationCycles ?? []), cycle]
    return true
  }
  const cycle = run.situationCycles?.find(c => c.cycleKey === payload.cycleKey) ?? p.fail('真实局势周期不存在')
  if (cycle.completedRef || !sameTtrpgOpenPressureSourceV1(cycle.ruleSourceRef, ttrpgOpenPressureRuleSourceV1(receipt))) p.fail('局势周期已完成或不属于本裁定')
  const action = nextTtrpgOpenSituationCycleActionV1(state, cycle)
  if (intent.actionKey !== ttrpgOpenSituationCycleActionKeyV1(action, cycle)) p.fail('局势动作不是当前待办')
  if (event.type === 'ttrpg.open.situations.settled') {
    p.exact(payload, ['operationKey', 'frozenPlanHash', 'causeRef', 'cycleKey', 'intent'], 'situation settled')
    if (action) p.fail('局势仍有真实维护、后果或队列任务')
    cycle.completedRef = sourceRef; operation.businessRefs.push({ stepKey: ownerStep, sourceRef })
    return true
  }
  p.exact(payload, ['operationKey', 'frozenPlanHash', 'causeRef', 'cycleKey', 'action', 'instanceKey', 'result', 'intent'], 'situation changed')
  if (!action || stable(action) !== stable(payload.action)) p.fail('局势动作没有实际依据')
  const instanceKey = p.nullable(payload.instanceKey, p.key, 'consequence instance')
  const activation = action.kind === 'work' && cycle.work.find(w => w.workKey === action.workKey)?.kind === 'activate'
  if (activation ? instanceKey === null : instanceKey !== null) p.fail('只有真实后果准入可以携带新实例身份')
  const settled = settleTtrpgOpenSituationCycleActionV1({ state, cycle, operation, action, sequence: event.sequence, instanceKey })
  if (stable(payload.result) !== stable(settled.result)) p.fail('局势进展、终态、队列或时钟不是确定性结果')
  run.situations = settled.runtime.openRun!.situations; run.failures = settled.runtime.openRun!.failures; run.chaos = settled.runtime.openRun!.chaos; run.clocks = settled.runtime.openRun!.clocks
  run.situationCycles = run.situationCycles!.map(c => c.cycleKey === cycle.cycleKey ? settled.cycle : c)
  return true
}

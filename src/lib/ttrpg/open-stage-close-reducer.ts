/** E13 changes stage/chaos once; clocks/effects each have their own real receipt. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { sameTtrpgOpenPressureSourceV1, ttrpgOpenPressureRuleSourceV1, assertTtrpgOpenPressureGmV1 } from './open-pressure-cycle'
import { parseTtrpgOpenStageClosureV1, planTtrpgOpenStageClosureTicksV1, settleTtrpgOpenStageClockV1, assertTtrpgOpenStageClosureEligibleV1 } from './open-stage-close'
import { changeTtrpgOpenChaosV1 } from './open-chaos'
import * as p from './open-contract-parse'
export function applyTtrpgOpenStageClosureEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (!['ttrpg.open.stage.closed', 'ttrpg.open.stage.clock.advanced', 'ttrpg.open.stage.settled'].includes(event.type)) return false
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) p.fail('阶段收束需要真实授权团局')
  state.ttrpg = runtime
  const intent = p.object(payload.intent, 'stage close intent'), operation = run.operations.find(o => o.operationKey === payload.operationKey), rule = run.ruleReceipts.find(r => r.operationKey === operation?.operationKey)
  const epoch = run.coordination.epochs.find(e => e.epochKey === operation?.authorizationEpochKey), seat = auth.seats.find(s => s.viewerKey === intent.viewerKey)
  if (!operation || !rule || operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'gates'
    || payload.frozenPlanHash !== operation.planHash || intent.operationKey !== operation.operationKey || intent.frozenPlanHash !== operation.planHash
    || !epoch || epoch.status !== 'active' || epoch.epochKey !== run.coordination.activeEpochKey || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed'
    || event.actorKey !== 'gm' || event.targetKey !== null) p.fail('阶段收束不属于本操作真实真人窗口')
  const logical = ttrpgOpenPressureRuleSourceV1(rule), sourceRef = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  if (event.type === 'ttrpg.open.stage.closed') {
    assertTtrpgOpenPressureGmV1(auth, p.key(intent.viewerKey, 'stage human GM'))
    p.exact(payload, ['operationKey', 'frozenPlanHash', 'closure', 'intent'], 'stage closed')
    p.exact(intent, ['operationKey', 'frozenPlanHash', 'viewerKey', 'summary', 'actionKey'], 'stage closure intent')
    const closure = parseTtrpgOpenStageClosureV1(payload.closure), terminal = run.terminalReceipts?.find(r => sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, logical))
    const decision = assertTtrpgOpenStageClosureEligibleV1(state, closure.frozenContent)
    if (intent.actionKey !== 'stage.close' || !terminal || !sameTtrpgOpenPressureSourceV1(closure.terminalRef, terminal.sourceRef) || !sameTtrpgOpenPressureSourceV1(closure.ruleSourceRef, logical)
      || !sameTtrpgOpenPressureSourceV1(closure.sourceRef, sourceRef) || closure.contentHash !== terminal.contentHash || closure.runtimeSourceHash !== terminal.runtimeSourceHash
      || stable(closure.frozenContent) !== stable(terminal.frozenContent) || closure.stageIndex !== (run.stageClosures?.length ?? 0) || closure.atWorldTurn !== run.worldTime.worldTurn
      || closure.summary.text !== p.text(intent.summary, 'human summary') || closure.triggerKey !== decision.closure.triggerKey || closure.maximumReached !== decision.closure.maximumReached
      || closure.completedRef || closure.work.length || closure.ticks.some(t => t.completedRef) || stable(closure.ticks) !== stable(planTtrpgOpenStageClosureTicksV1(state, closure.frozenContent, sourceRef))) p.fail('阶段收束必须绑定真人摘要、真实判定与实际时钟后果')
    run.stage.status = 'closed'; run.stage.closedAtWorldTurn = run.worldTime.worldTurn
    changeTtrpgOpenChaosV1(run, 'stage-closed', event.sequence); run.stageClosures = [...(run.stageClosures ?? []), closure]
    return true
  }
  if (seat.viewerKey !== epoch.viewerKey) p.fail('确定性阶段续作只能由本窗口启动者继续')
  const closure = run.stageClosures?.find(c => c.cycleKey === payload.cycleKey) ?? p.fail('真实阶段收束周期不存在')
  p.exact(intent, ['operationKey', 'frozenPlanHash', 'viewerKey', 'actionKey', 'cycleKey'], 'stage continuation intent')
  if (!sameTtrpgOpenPressureSourceV1(closure.ruleSourceRef, logical) || closure.completedRef || run.stage.status !== 'closed' || closure.work.some(w => !w.completedRef) || intent.cycleKey !== closure.cycleKey) p.fail('阶段续作没有当前真实关闭及后果依据')
  const next = closure.ticks.find(t => !t.completedRef)
  if (event.type === 'ttrpg.open.stage.settled') {
    p.exact(payload, ['operationKey', 'frozenPlanHash', 'cycleKey', 'intent'], 'stage settled')
    if (next || intent.actionKey !== 'stage.settled') p.fail('阶段仍有真实时钟或效果待办')
    closure.completedRef = sourceRef; return true
  }
  p.exact(payload, ['operationKey', 'frozenPlanHash', 'cycleKey', 'result', 'intent'], 'stage clock')
  if (!next || intent.actionKey !== `stage.clock.${next.clockKey}`) p.fail('阶段时钟不是当前实际待办')
  const settled = settleTtrpgOpenStageClockV1({ state, closure, sequence: event.sequence })
  if (stable(payload.result) !== stable(settled.result)) p.fail('阶段时钟不是确定性后果')
  run.clocks = settled.runtime.openRun!.clocks; run.chaos = settled.runtime.openRun!.chaos
  run.stageClosures = run.stageClosures!.map(c => c.cycleKey === closure.cycleKey ? settled.closure : c)
  return true
}

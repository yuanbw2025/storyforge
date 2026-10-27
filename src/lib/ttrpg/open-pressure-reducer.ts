import { ttrpgOpenSituationCatalogV1, ttrpgOpenSituationCatalogSnapshotV1 } from './open-session-situation-catalog'
import { ttrpgOpenTurnOwnerStepV1,ttrpgOpenTurnCycleMatchesV1,ttrpgOpenTurnCycleMetadataV1 } from './open-turn-settlement'
/** E8/E9/E10/E12 are pure journal reducers; consequences remain explicit recoverable work. */
import type { ProductRuntimeState, ProductRuntimeEvent } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenPressureCycleV1, parseTtrpgOpenPressureSignalV1, assertTtrpgOpenPressureGmV1, planTtrpgOpenPressureTicksV1, sameTtrpgOpenPressureSourceV1, ttrpgOpenPressureRuleSourceV1,
  nextTtrpgOpenPressureActionV1, ttrpgOpenPressureRuntimeProjectionV1 } from './open-pressure-cycle'
import { evaluateTtrpgFrontTelegraphV1, evaluateTtrpgFrontAdvanceV1, evaluateTtrpgFrontDefeatV1 } from './pressure-runtime'
import { ttrpgOpenPredicateContextV1 } from './open-rule-plan'
import { changeTtrpgOpenChaosV1 } from './open-chaos'
import * as p from './open-contract-parse'

const types = ['ttrpg.open.pressure.planned', 'ttrpg.open.pressure.settled', 'ttrpg.clock.ticked', 'ttrpg.front.telegraphed', 'ttrpg.front.advanced', 'ttrpg.front.defeated']
export function applyTtrpgOpenPressureEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (!types.includes(event.type)) return false
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) p.fail('压力事件需要已授权 open 团局')
  state.ttrpg = runtime
  if (event.type === 'ttrpg.front.telegraphed' && Object.prototype.hasOwnProperty.call(payload, 'signal')) {
    p.exact(payload, ['signal', 'intent'], 'pressure opening signal')
    const signal = parseTtrpgOpenPressureSignalV1(payload.signal), intent = p.record(payload.intent, ['viewerKey', 'frontKey', 'telegraphKey'], 'opening signal intent')
    assertTtrpgOpenPressureGmV1(auth, p.key(intent.viewerKey, 'signal viewer'))
    const epoch = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
    const front = signal.frozenContent.campaign.fronts.find(f => f.frontKey === signal.frontKey)!, current = run.fronts.find(f => f.frontKey === signal.frontKey)
    const next = front.escalationStages[(current?.stageKey === null ? -1 : front.escalationStages.findIndex(s => s.stageKey === current?.stageKey)) + 1]
    const definition = front.telegraph.find(t => t.telegraphKey === signal.telegraphKey)!
    if (!epoch || epoch.status !== 'active' || epoch.viewerKey !== intent.viewerKey || run.stage.status !== 'open' || runtime.product.safety.status !== 'active'
      || !current || current.defeated || !next || definition.beforeStageKey !== next.stageKey || current.telegraphWorldTurns?.[signal.telegraphKey] !== undefined
      || run.operations.some(o => ['awaiting-approval', 'executing'].includes(o.status))
      || runtime.branchLineage?.recoveryTasks.some(t => !['completed', 'withdrawn'].includes(t.status))
      || intent.frontKey !== signal.frontKey || intent.telegraphKey !== signal.telegraphKey || signal.worldTurn !== run.worldTime.worldTurn
      || event.actorKey !== 'gm' || event.targetKey !== null || !sameTtrpgOpenPressureSourceV1(signal.sourceRef, { sessionKey: runtime.sessionKey, sequence: event.sequence })
      || stable(signal.recipientActorKeys) !== stable(auth.selectedActorKeys) || signal.frozenContent.rulePack.contentHash !== runtime.product.rulePackContentHash) p.fail('征兆必须在真实主持窗口提前发布，不能回填或伪造接收者')
    current.telegraphWorldTurns = { ...(current.telegraphWorldTurns ?? {}), [signal.telegraphKey]: signal.worldTurn }
    if (!current.telegraphedStageKeys.includes(definition.beforeStageKey)) current.telegraphedStageKeys.push(definition.beforeStageKey)
    run.pressureSignals = [...(run.pressureSignals ?? []), signal]
    return true
  }
  const operation = run.operations.find(o => o.operationKey === payload.operationKey) ?? p.fail('压力操作不存在')
  const receipt = run.ruleReceipts.find(r => r.operationKey === operation.operationKey) ?? p.fail('压力缺少真实检定')
  const epoch = run.coordination.epochs.find(e => e.epochKey === operation.authorizationEpochKey)
  const intent = p.record(payload.intent, ['operationKey', 'frozenPlanHash', 'viewerKey', 'actionKey'], 'pressure intent')
  const seat = auth.seats.find(s => s.viewerKey === intent.viewerKey)
  const causeRef = parseTtrpgOpenSourceRefV1(payload.causeRef), eventRef = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  if (payload.frozenPlanHash !== operation.planHash || payload.stepKey !== nextTtrpgOpenOperationStepV1(operation)?.stepKey || operation.status !== 'executing'
    || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'pressure' || operation.businessRefs.some(r => r.stepKey === payload.stepKey)
    || !epoch || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey
    || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || seat.viewerKey !== epoch.viewerKey
    || intent.operationKey !== operation.operationKey || intent.frozenPlanHash !== operation.planHash
    || stable(causeRef) !== stable(receipt.sourceRef) || event.actorKey !== 'gm' || event.targetKey !== null) p.fail('压力顺序、真人窗口或真实规则因果不一致')
  const ownerStep = ttrpgOpenTurnOwnerStepV1(operation,'pressure')
  if (event.type === 'ttrpg.open.pressure.planned') {
    p.exact(payload, ['operationKey', 'frozenPlanHash', 'stepKey', 'causeRef', 'cycle', 'intent'], 'pressure planned')
    const cycle = parseTtrpgOpenPressureCycleV1(payload.cycle)
    const expected = planTtrpgOpenPressureTicksV1({ state, operation, receipt, content: cycle.frozenContent })
    if (intent.actionKey !== `${ownerStep}.plan` || cycle.operationStepKey !== ttrpgOpenTurnCycleMetadataV1(operation,'pressure').operationStepKey || cycle.tickRefs.length || cycle.frontReceipts.length || cycle.work.length || cycle.completedRef
      || !sameTtrpgOpenPressureSourceV1(cycle.startedRef, eventRef) || !sameTtrpgOpenPressureSourceV1(cycle.ruleSourceRef, ttrpgOpenPressureRuleSourceV1(receipt))
      || stable(cycle.sessionSituationRefs) !== stable(ttrpgOpenSituationCatalogSnapshotV1(cycle.frozenContent.campaign, run).sessionSituationRefs)
      || cycle.runtimeSourceHash !== operation.plan.runtimeSourceHash || cycle.frozenContent.rulePack.contentHash !== operation.plan.rulePackContentHash
      || stable(cycle.tickQueue) !== stable(expected.tickQueue) || stable(cycle.consumedOracleRefs) !== stable(expected.consumedOracleRefs)
      || run.pressureCycles?.some(c => c.cycleKey === cycle.cycleKey || ttrpgOpenTurnCycleMatchesV1(c,operation,cycle.ruleSourceRef,'pressure'))) p.fail('压力计划必须来自真实行动、全部轮次与未消费 Oracle')
    run.pressureCycles = [...(run.pressureCycles ?? []), cycle]
    return true
  }
  const cycle = run.pressureCycles?.find(c => c.cycleKey === payload.cycleKey) ?? p.fail('压力周期不存在')
  if (!ttrpgOpenTurnCycleMatchesV1(cycle,operation,ttrpgOpenPressureRuleSourceV1(receipt),'pressure') || cycle.completedRef) p.fail('压力周期不属于此裁定或已完成')
  if (event.type === 'ttrpg.open.pressure.settled') {
    p.exact(payload, ['operationKey', 'frozenPlanHash', 'stepKey', 'causeRef', 'cycleKey', 'intent'], 'pressure settled')
    if (intent.actionKey !== `${ownerStep}.settled` || cycle.tickRefs.length !== cycle.tickQueue.length || cycle.work.some(w => !w.completedRef)
      || nextTtrpgOpenPressureActionV1(state, cycle)) p.fail('压力仍有真实推进、后果或征兆待办')
    cycle.completedRef = eventRef
    operation.businessRefs.push({ stepKey: ownerStep, sourceRef: eventRef })
    return true
  }
  p.exact(payload, ['operationKey', 'frozenPlanHash', 'stepKey', 'causeRef', 'cycleKey', 'action', 'result', 'intent', ...(Object.prototype.hasOwnProperty.call(payload, 'recordSituationAction') ? ['recordSituationAction'] : [])], 'pressure action')
  const recordSituationAction = Object.prototype.hasOwnProperty.call(payload, 'recordSituationAction')
  if (recordSituationAction) p.literal(payload.recordSituationAction, true, 'record situation work')
  const action = nextTtrpgOpenPressureActionV1(state, cycle)
  if (recordSituationAction && action?.kind !== 'advance' && action?.kind !== 'defeat') p.fail('局势待办标志只允许用于真实威胁变化')
  if (!action || stable(payload.action) !== stable(action) || intent.actionKey !== pressureActionKeyV1(action,ownerStep)) p.fail('压力动作不是当前确定性待办')
  if (action.kind === 'tick') {
    const tick = cycle.tickQueue[action.tickIndex], clock = run.clocks.find(c => c.clockKey === tick.clockKey) ?? p.fail('压力时钟不存在')
    const definition = cycle.frozenContent.campaign.clocks.find(c => c.clockKey === tick.clockKey)!
    if (event.type !== 'ttrpg.clock.ticked' || stable(payload.result) !== stable(tick) || clock.value !== tick.valueBefore) p.fail('压力时钟事件不符合冻结 tick')
    const crossed = clock.value < clock.maximum && tick.valueAfter === clock.maximum
    clock.value = tick.valueAfter; clock.completed = clock.value === clock.maximum; clock.lastAdvancedWorldTurn = tick.atWorldTurn
    cycle.tickRefs.push(eventRef)
    if (crossed) {
      changeTtrpgOpenChaosV1(run, 'clock-complete', event.sequence)
      if (definition.onCompleteEffectPlanRef) cycle.work.push({ workKey: `clock.${definition.clockKey}.complete.effect`, templateKey: definition.onCompleteEffectPlanRef,
        situationTemplateKey: null, causeRef: eventRef, completedRef: null })
    }
    return true
  }
  const front = cycle.frozenContent.campaign.fronts.find(f => f.frontKey === action.frontKey)!, current = run.fronts.find(f => f.frontKey === front.frontKey)!
  const projection = ttrpgOpenPressureRuntimeProjectionV1(state), frontState = projection.fronts[front.frontKey]
  let expected: unknown
  if (action.kind === 'telegraph') {
    const signal = front.telegraph.find(t => t.telegraphKey === action.telegraphKey)!
    expected = { ...evaluateTtrpgFrontTelegraphV1({ front, frontState, telegraphKey: signal.telegraphKey, audience: signal.audience, worldTime: run.worldTime }),
      signalText: signal.signalText, recipientActorKeys: [...auth.selectedActorKeys] }
    if (event.type !== 'ttrpg.front.telegraphed' || stable(payload.result) !== stable(expected)) p.fail('征兆文本、受众或冻结提前轮次不一致')
    current.telegraphWorldTurns = { ...(current.telegraphWorldTurns ?? {}), [signal.telegraphKey]: run.worldTime.worldTurn }
    if (!current.telegraphedStageKeys.includes(signal.beforeStageKey)) current.telegraphedStageKeys.push(signal.beforeStageKey)
    cycle.frontReceipts.push({ kind: 'telegraph', frontKey: front.frontKey, definitionKey: signal.telegraphKey, atWorldTurn: run.worldTime.worldTurn,
      audience: signal.audience, recipientActorKeys: [...auth.selectedActorKeys], sourceRef: eventRef })
  } else if (action.kind === 'advance') {
    expected = evaluateTtrpgFrontAdvanceV1({ front, frontState, clockStates: projection.clocks, stageKey: action.stageKey, worldTime: run.worldTime })
    if (event.type !== 'ttrpg.front.advanced' || stable(payload.result) !== stable(expected)) p.fail('威胁升级缺少真实阈值与征兆提前证据')
    current.stageKey = action.stageKey
    changeTtrpgOpenChaosV1(run, 'front-advanced', event.sequence)
    cycle.frontReceipts.push({ kind: 'advanced', frontKey: front.frontKey, definitionKey: action.stageKey, atWorldTurn: run.worldTime.worldTurn, audience: null, recipientActorKeys: [], sourceRef: eventRef })
    const stage = front.escalationStages.find(s => s.stageKey === action.stageKey)!
    if (stage.effectPlanRef) cycle.work.push({ workKey: `front.${front.frontKey}.${stage.stageKey}.effect`, templateKey: stage.effectPlanRef, situationTemplateKey: null, causeRef: eventRef, completedRef: null })
    if (stage.newSituationTemplateKey) cycle.work.push({ workKey: `front.${front.frontKey}.${stage.stageKey}.situation`, templateKey: null, situationTemplateKey: stage.newSituationTemplateKey, causeRef: eventRef, completedRef: null, ...(recordSituationAction ? { situationAction: { kind: 'activate', activationReason: 'front-escalation' } as const } : {}) })
  } else {
    expected = evaluateTtrpgFrontDefeatV1({ front, frontState, predicateContext: ttrpgOpenPredicateContextV1(state, cycle.frozenContent) })
    if (event.type !== 'ttrpg.front.defeated' || stable(payload.result) !== stable(expected)) p.fail('威胁击败缺少真实谓词依据')
    current.defeated = true; changeTtrpgOpenChaosV1(run, 'front-defeated', event.sequence)
    cycle.frontReceipts.push({ kind: 'defeated', frontKey: front.frontKey, definitionKey: null, atWorldTurn: run.worldTime.worldTurn, audience: null, recipientActorKeys: [], sourceRef: eventRef })
    // Formal situation cleanup is owned by P6; it cannot be silently skipped here.
    for (const instance of [...run.situations.active, ...(recordSituationAction ? run.situations.queued : [])].filter(i => {
      const driver = ttrpgOpenSituationCatalogV1(cycle.frozenContent.campaign, run).templates.find(t => t.templateKey === i.templateKey)?.driverBinding
      return driver?.kind === 'front' && driver.frontKey === front.frontKey
    })) {
      cycle.work.push({ workKey: `front.${front.frontKey}.defeated.${instance.situationKey}`, templateKey: null, situationTemplateKey: instance.templateKey, causeRef: eventRef, completedRef: null, ...(recordSituationAction ? { situationAction: { kind: 'resolve-front-defeated', situationKey: instance.situationKey, frontKey: front.frontKey } as const } : {}) })
    }
  }
  current.lastEvaluatedWorldTurn = run.worldTime.worldTurn
  return true
}
export function pressureActionKeyV1(action: NonNullable<ReturnType<typeof nextTtrpgOpenPressureActionV1>>,stepKey = 'pressure') {
  return action.kind === 'tick' ? `${stepKey}.tick.${action.tickIndex}` : action.kind === 'telegraph' ? `${stepKey}.front.${action.frontKey}.signal.${action.telegraphKey}`
    : action.kind === 'advance' ? `${stepKey}.front.${action.frontKey}.stage.${action.stageKey}` : `${stepKey}.front.${action.frontKey}.defeat`
}

/** Closed terminal/gate evidence; true failures never become a fabricated business success. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { sameTtrpgOpenPressureSourceV1, ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle'
import { parseTtrpgOpenTerminalReceiptV1, evaluateTtrpgOpenTerminalV1, parseTtrpgOpenGateReceiptV1, evaluateTtrpgOpenPlayerGatesV1, ttrpgOpenGateBasisJsonV1, ttrpgOpenGateHumanActorsV1 } from './open-terminal-gates'
import * as p from './open-contract-parse'
export function applyTtrpgOpenTerminalGateEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (!['ttrpg.open.terminal.evaluated', 'ttrpg.open.gates.evaluated', 'ttrpg.open.gates.settled'].includes(event.type)) return false
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) p.fail('终态与门检查需要已授权 open 团局')
  state.ttrpg = runtime
  const operation = run.operations.find(o => o.operationKey === payload.operationKey), rule = run.ruleReceipts.find(r => r.operationKey === operation?.operationKey)
  const intent = p.record(payload.intent, ['operationKey', 'frozenPlanHash', 'viewerKey', 'actionKey'], 'terminal/gate intent'), seat = auth.seats.find(s => s.viewerKey === intent.viewerKey)
  const epoch = run.coordination.epochs.find(e => e.epochKey === operation?.authorizationEpochKey), step = operation && nextTtrpgOpenOperationStepV1(operation), sourceRef = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  const kind = event.type === 'ttrpg.open.terminal.evaluated' ? 'terminal' : 'gates'
  if (!operation || !rule || operation.status !== 'executing' || step?.kind !== kind || operation.businessRefs.some(r => r.stepKey === kind)
    || payload.frozenPlanHash !== operation.planHash || intent.operationKey !== operation.operationKey || intent.frozenPlanHash !== operation.planHash
    || !epoch || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || seat.viewerKey !== epoch.viewerKey
    || event.actorKey !== 'gm' || event.targetKey !== null) p.fail('终态/门不属于当前真实操作或真人窗口')
  const logicalRule = ttrpgOpenPressureRuleSourceV1(rule)
  if (kind === 'terminal') {
    p.exact(payload, ['operationKey', 'frozenPlanHash', 'receipt', 'intent'], 'terminal evaluated')
    const receipt = parseTtrpgOpenTerminalReceiptV1(payload.receipt)
    if (intent.actionKey !== 'terminal' || !sameTtrpgOpenPressureSourceV1(receipt.sourceRef, sourceRef) || !sameTtrpgOpenPressureSourceV1(receipt.ruleSourceRef, logicalRule)
      || receipt.runtimeSourceHash !== operation.plan.runtimeSourceHash || receipt.frozenContent.rulePack.contentHash !== operation.plan.rulePackContentHash
      || stable(receipt.decision) !== stable(evaluateTtrpgOpenTerminalV1(state, receipt.frozenContent)) || run.terminalReceipts?.some(r => sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, logicalRule))) p.fail('终态必须来自当前真实状态与冻结阶段规则')
    run.terminalReceipts = [...(run.terminalReceipts ?? []), receipt]; operation.businessRefs.push({ stepKey: 'terminal', sourceRef })
    return true
  }
  const terminal = run.terminalReceipts?.find(r => sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, logicalRule)) ?? p.fail('四门缺少实际终态判定')
  if (event.type === 'ttrpg.open.gates.settled') {
    p.exact(payload, ['operationKey', 'frozenPlanHash', 'intent'], 'gates settled')
    const current = ttrpgOpenGateBasisJsonV1(state)
    if (run.stageClosures?.some(c => sameTtrpgOpenPressureSourceV1(c.ruleSourceRef, logicalRule) && !c.completedRef)) p.fail('阶段收束仍有真实时钟/效果待办')
    if (intent.actionKey !== 'gates.settled' || ttrpgOpenGateHumanActorsV1(runtime).some(s => !run.gateReceipts?.some(r => r.actorKey === s.actorKey && r.viewerKey === s.viewerKey
      && r.authorizationEpochKey === epoch.epochKey && sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, logicalRule) && r.evaluationBasisJson === current && r.result.allApplicablePassed))) p.fail('仍有真实玩家投影失败或过期的门，不能结束检查')
    if (!ttrpgOpenGateHumanActorsV1(runtime).length) p.fail('无真实真人角色回应时不能伪造四门通过')
    operation.businessRefs.push({ stepKey: 'gates', sourceRef }); return true
  }
  p.exact(payload, ['operationKey', 'frozenPlanHash', 'receipt', 'intent'], 'gates evaluated')
  const receipt = parseTtrpgOpenGateReceiptV1(payload.receipt)
  const previous = run.gateReceipts?.filter(r => sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, logicalRule) && r.actorKey === receipt.actorKey) ?? []
  if (intent.actionKey !== `gates.${receipt.actorKey}.${previous.length}` || !sameTtrpgOpenPressureSourceV1(receipt.sourceRef, sourceRef) || !sameTtrpgOpenPressureSourceV1(receipt.ruleSourceRef, logicalRule)
    || !sameTtrpgOpenPressureSourceV1(receipt.terminalRef, terminal.sourceRef) || receipt.authorizationEpochKey !== epoch.epochKey
    || receipt.evaluationBasisJson !== ttrpgOpenGateBasisJsonV1(state) || previous.some(r => r.authorizationEpochKey === epoch.epochKey && r.evaluationBasisJson === receipt.evaluationBasisJson)
    || stable(receipt.result) !== stable(evaluateTtrpgOpenPlayerGatesV1({ state, terminal, actorKey: receipt.actorKey, viewerKey: receipt.viewerKey, basisHash: receipt.result.evaluationBasisHash! }))) p.fail('四门结果不是当前该真人投影的真实评估')
  run.gateReceipts = [...(run.gateReceipts ?? []), receipt]
  return true
}

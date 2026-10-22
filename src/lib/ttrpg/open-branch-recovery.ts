/** Fresh child recovery binds the submitted ancestor prefix, never a new roll or semantic plan. */
import type { TtrpgOpenBranchLineageV1, TtrpgOpenBranchRecoveryTaskV1 } from './open-branch-contract'
import { ttrpgOpenAncestorSourceAllowedV1 } from './open-branch-contract'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import type { TtrpgOpenOperationV1, TtrpgOpenRuleReceiptV1 } from './open-operation'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
export function ttrpgOpenRecoveryApprovalsV1(task: TtrpgOpenBranchRecoveryTaskV1, authorization: TtrpgOpenAuthorizationV1, lineage: TtrpgOpenBranchLineageV1) {
  return task.operation.plan.requiredApprovals.map(required => {
    const seat = authorization.seats.find(seat => seat.role === 'player' && seat.actorKey === required.actorKey)
    if (!seat) throw new Error('[ttrpg-open-recovery] 原受影响真人角色尚未重新确认')
    const originalSeat = lineage.ancestors.find(a => a.sessionKey === task.ancestorSessionKey)?.snapshot.authorization?.seats.find(s => s.actorKey === required.actorKey && s.role === 'player')
    if (!originalSeat) throw new Error('[ttrpg-open-recovery] 原受影响角色缺少冻结控制权证据')
    if ((required.actorKey === task.operation.plan.request.actorKey && task.operation.plan.request.controllerMode === 'ai') || originalSeat.controller === 'ai') {
      if (!['ai', 'hybrid'].includes(seat.controller)) throw new Error('[ttrpg-open-recovery] 原 AI 受影响角色需要新的明确真人批准关系')
      const binding = authorization.approvalBindings.find(binding => binding.companionActorKey === required.actorKey)
      if (!binding) throw new Error('[ttrpg-open-recovery] AI 原行动缺少新的真人批准关系')
      return { actorKey: required.actorKey, allowedSeatKeys: [...binding.approverSeatKeys] }
    }
    if (seat.controller === 'ai' || seat.assignmentState !== 'claimed') throw new Error('[ttrpg-open-recovery] 原真人代价不能由 AI 自批')
    return { actorKey: required.actorKey, allowedSeatKeys: [seat.seatKey] }
  })
}
export function ttrpgOpenAncestorRuleReceiptForTaskV1(lineage: TtrpgOpenBranchLineageV1, task: TtrpgOpenBranchRecoveryTaskV1) {
  const ancestor = lineage.ancestors.find(ancestor => ancestor.sessionKey === task.ancestorSessionKey)
  const receipt = ancestor?.snapshot.openRun?.ruleReceipts.find(receipt => receipt.operationKey === task.operation.operationKey)
  if (!receipt) throw new Error('[ttrpg-open-recovery] 祖先缺少真实裁定回执')
  return receipt
}
export function ttrpgOpenCoveredBusinessKeysV1(task: TtrpgOpenBranchRecoveryTaskV1): string[] {
  return [...(task.operation.inheritance?.coveredStepKeys ?? []), ...task.operation.businessRefs.map(business => business.stepKey)]
}
export function assertTtrpgOpenRecoveredOperationV1(input: {
  lineage: TtrpgOpenBranchLineageV1; authorization: TtrpgOpenAuthorizationV1;
  operation: TtrpgOpenOperationV1; receipt: TtrpgOpenRuleReceiptV1; mode: 'candidate' | 'stored';
}): TtrpgOpenBranchRecoveryTaskV1 {
  const { operation, receipt, lineage } = input, inherited = operation.inheritance
  const task = lineage.recoveryTasks.find(task => task.taskKey === inherited?.taskKey)
  if (!task || !inherited || !task.inheritedRef
    || (input.mode === 'candidate' ? task.status !== 'ready' || task.childOperationKey !== null
      : operation.status !== 'rejected' && (!['executing', 'completed'].includes(task.status)
        || task.childOperationKey !== operation.operationKey))) throw new Error('[ttrpg-open-recovery] 恢复操作缺少可绑定的本地继承任务')
  const original = ttrpgOpenAncestorRuleReceiptForTaskV1(lineage, task)
  const originalSourceRef = original.inheritedFrom?.originalSourceRef ?? original.sourceRef
  const { epochKey: _e, authorizationHash: _a, mechanicalStateHash: _m, requiredApprovals: _r, ...semantic } = operation.plan
  const { epochKey: _pe, authorizationHash: _pa, mechanicalStateHash: _pm, requiredApprovals: _pr, ...originalSemantic } = task.operation.plan
  if (inherited.ancestorSessionKey !== task.ancestorSessionKey || inherited.ancestorOperationKey !== task.operation.operationKey
    || stable(inherited.coveredStepKeys) !== stable(ttrpgOpenCoveredBusinessKeysV1(task))
    || stable(inherited.ruleCauseRef) !== stable(task.inheritedRef) || stable(inherited.originalRuleRef) !== stable(originalSourceRef)
    || inherited.selectedAlternativeKey !== (task.operation.pendingChoice?.selectedAlternativeKey ?? null)
    || stable(inherited.discoveryChoices ?? []) !== stable(task.operation.discoveryChoices?.map(({ templateKey, alternativeKey }) => ({ templateKey, alternativeKey })) ?? [])
    || stable(operation.pressureTurnConditions?.filter(t => inherited.coveredStepKeys.includes(`time.${t.tickIndex}`)) ?? []) !== stable(task.operation.pressureTurnConditions ?? [])
    || operation.settlementOrder !== task.operation.settlementOrder
    || stable(semantic) !== stable(originalSemantic)
    || stable(operation.plan.requiredApprovals) !== stable(ttrpgOpenRecoveryApprovalsV1(task, input.authorization, lineage))
    || operation.plannedSteps.map(step => step.stepKey).join(',') !== task.remainingStepKeys.join(',')
    || receipt.operationKey !== operation.operationKey || receipt.frozenPlanHash !== operation.planHash
    || stable(receipt.sourceRef) !== stable(task.inheritedRef) || stable(receipt.inheritedFrom?.originalSourceRef) !== stable(originalSourceRef)
    || stable(receipt.result) !== stable(original.result)
    || !ttrpgOpenAncestorSourceAllowedV1(lineage, originalSourceRef, ['ttrpg.rule.action.resolved'])) {
    throw new Error('[ttrpg-open-recovery] 恢复不能更换原裁定、冻结后果、已提交前缀或来源')
  }
  return task
}

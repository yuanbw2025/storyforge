import type { AssembleContextResult } from '../registry/types'
import type { TtrpgViewerProjectionV1 } from './viewer-projection'

/** Rule receipts remain in the ledger; role reasoning receives their observable results. */
export function projectTtrpgObservedActionsV1(actions: TtrpgViewerProjectionV1['recentActions']) {
  return actions.map(action => ({ eventSequence: action.eventSequence, actorKey: action.actorKey,
    targetKey: action.targetKey, actionKey: action.actionKey, actionName: action.actionName, outcome: action.outcome,
    ownDeclaredIntent: action.receipt?.declaredIntent?.rawInput ?? null,
    resourceChanges: action.resourceChanges, conditionChanges: action.conditionChanges }))
}

/** JSON context is indivisible. Never send a prefix that drops permissions or legal choices. */
export function assertTtrpgCompleteContextV1(assembled: AssembleContextResult, sourceKey: string) {
  const evidence = assembled.sourceEvidence?.find(source => source.key === sourceKey)
  if (!assembled.included.includes(sourceKey) || assembled.overBudgetAfterTrim || evidence?.delivery === 'truncated'
    || assembled.trimmed.includes(sourceKey)) throw new Error('[ttrpg-context] 当前角色资料超出完整上下文预算，已停止模型调用。进度已保留，请先保存本场记录。')
}

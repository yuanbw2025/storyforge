import { ttrpgOpenDiscoveryEvidenceV1 } from './open-knowledge-discovery'
/** Frozen outcome-dependent template selection, shared by replay and human review. */
import type { TtrpgOpenOperationV1,TtrpgOpenRuleReceiptV1 } from './open-operation'
import { ttrpgDegreeSucceededV2 } from './runtime-state'
import * as p from './open-contract-parse'
export function ttrpgOpenDiscoveryEffectTemplatesV1(operation: TtrpgOpenOperationV1, receipt: TtrpgOpenRuleReceiptV1) {
  const plan = operation.plan.discoveryPlan ?? p.fail('结算缺少冻结知识发现计划')
  if (receipt.operationKey !== operation.operationKey || receipt.frozenPlanHash !== operation.planHash) p.fail('发现选择缺少本操作真实规则回执')
  const evidence = ttrpgOpenDiscoveryEvidenceV1(plan)
  const passed = receipt.result.outcome === 'automatic' || ttrpgDegreeSucceededV2(receipt.result.outcome)
  const keys = [...new Set([evidence.discoveryPolicy.costEffectPlanRef, ...(!passed ? [evidence.discoveryPolicy.failForwardEffectPlanRef] : [])].filter((ref): ref is string => ref !== null))]
  return keys.map(key => plan.effectTemplates.find(t => t.planKey === key) ?? p.fail('冻结发现后果不存在'))
}

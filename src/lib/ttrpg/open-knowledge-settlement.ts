import { ttrpgOpenDiscoveryEffectTemplatesV1 } from './open-discovery-effect-templates'
import { ttrpgOpenSessionSituationDiscoveryPolicyV1 } from './open-session-situation-catalog'
export { ttrpgOpenDiscoveryEffectTemplatesV1 } from './open-discovery-effect-templates'
/** One causal discovery settlement: frozen costs, unchanged dice outcome and an explicit recipient grant. */
import type { ProductRuntimeState, TtrpgEffectPrimitiveV2, TtrpgEffectPlanV2 } from '../types'
import type { TtrpgOpenOperationV1, TtrpgOpenRuleReceiptV1 } from './open-operation'
import { assertTtrpgOpenDiscoveryPathV1 } from './open-knowledge-discovery'
import { ttrpgDegreeSucceededV2 } from './runtime-state'
import { parseTtrpgEffectPlanV2 } from './effect-plan'
import { applyTtrpgEffectPlanToRuntimeV2 } from './effect-runtime'
import { projectTtrpgRulePackMechanicalCoreV1 } from './rule-pack-v2'
import { parseTtrpgOpenKnowledgeEntryV1, type TtrpgOpenKnowledgeEntryV1 } from './open-knowledge'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'

export interface TtrpgOpenKnowledgeSettlementV1 {
  outcome: 'discovered' | 'not-discovered'
  effectPlans: TtrpgEffectPlanV2[]
  knowledge: TtrpgOpenKnowledgeEntryV1 | null
}

export function settleTtrpgOpenKnowledgeV1(input: {
  state: ProductRuntimeState; operation: TtrpgOpenOperationV1; ruleReceipt: TtrpgOpenRuleReceiptV1;
  sequence: number; commandId: string; knowledgeKey: string;
}): { state: ProductRuntimeState; settlement: TtrpgOpenKnowledgeSettlementV1 } {
  const plan = input.operation.plan.discoveryPlan ?? p.fail('结算缺少冻结知识发现计划')
  const { runtime, evidence } = assertTtrpgOpenDiscoveryPathV1(input.state, plan)
  if (input.ruleReceipt.operationKey !== input.operation.operationKey || input.ruleReceipt.frozenPlanHash !== input.operation.planHash
    || input.ruleReceipt.sourceRef.sessionKey !== runtime.sessionKey || input.ruleReceipt.sourceRef.sequence >= input.sequence) p.fail('知识结算必须引用真实本地规则/继承回执')
  const passed = input.ruleReceipt.result.outcome === 'automatic' || ttrpgDegreeSucceededV2(input.ruleReceipt.result.outcome)
  const discovered = passed || evidence.discoveryPolicy.failForwardEffectPlanRef !== null
  const templates = ttrpgOpenDiscoveryEffectTemplatesV1(input.operation, input.ruleReceipt)
  let state = structuredClone(input.state)
  const effectPlans: TtrpgEffectPlanV2[] = []
  for (const template of templates) {
    const choice = input.operation.discoveryChoices?.find(c => c.templateKey === template.planKey)
    const primitives = template.alternatives.length ? template.alternatives.find(a => a.alternativeKey === choice?.alternativeKey)?.effects : template.effects
    if (!primitives || (choice && (choice.selectionRef.sessionKey !== runtime.sessionKey || choice.selectionRef.sequence >= input.sequence))) p.fail('发现后果选项必须先有独立真人选择，不能默认选择第一项')
    const bindings = plan.request.effectBindings[template.planKey]
    const effects: TtrpgEffectPrimitiveV2[] = primitives.flatMap(effect => {
      if (effect.family === 'knowledge') return [] // The single knowledge owner below commits only the frozen public fields.
      if (effect.family === 'story' && effect.operation !== 'location.set') p.fail('发现后果仍缺少对应正式 owner')
      const targetRef = effect.targetRef.startsWith('parameter:') ? bindings[effect.targetRef.slice(10)] : effect.targetRef
      return targetRef === null ? [] : [{ ...effect, targetRef }]
    })
    const effectPlan = parseTtrpgEffectPlanV2({ schema: 'storyforge.ttrpg-effect-plan', version: 2,
      planKey: `${input.knowledgeKey}.cost.${effectPlans.length}`, degree: input.ruleReceipt.result.outcome === 'automatic' ? 'success' : input.ruleReceipt.result.outcome,
      sourceEventId: `event.${input.ruleReceipt.sourceRef.sequence}`, ruleRef: template.ruleRef, reason: template.reason,
      audience: template.audience, status: 'immediate', effects, idempotencyKey: `${input.commandId}.cost.${effectPlans.length}` })
    state = applyTtrpgEffectPlanToRuntimeV2({ state, rulePack: projectTtrpgRulePackMechanicalCoreV1(plan.frozenContent.rulePack.content),
      plan: effectPlan, eventSequence: input.sequence }).state
    effectPlans.push(effectPlan)
  }
  const knowledge = discovered ? parseTtrpgOpenKnowledgeEntryV1({ knowledgeKey: input.knowledgeKey,
    evidenceRef: evidence.clueRef, sourceFactRefs: evidence.sourceFactRefs, sourceResourceRefs: evidence.sourceResourceRefs,
    acquisitionRef: { sessionKey: runtime.sessionKey, sequence: input.sequence }, audience: ttrpgOpenSessionSituationDiscoveryPolicyV1(plan.sessionSituation, evidence.discoveryPolicy).allowedAudience,
    recipientActorKeys: plan.recipientActorKeys, publicFieldsHash: plan.publicFieldsHash, reliability: 'observed' }) : null
  if (knowledge) {
    const run = state.ttrpg!.openRun as typeof runtime.openRun
    if (!run || run.knowledge.some(entry => entry.knowledgeKey === knowledge.knowledgeKey)) p.fail('知识发现身份重复或运行 owner 不存在')
    run.knowledge.push(knowledge)
    const instance = run.situations.active.find(instance => instance.situationKey === plan.request.situationKey)!
    if (!instance.discoveredEvidenceRefs.includes(evidence.clueRef)) instance.discoveredEvidenceRefs.push(evidence.clueRef)
  }
  return { state, settlement: { outcome: discovered ? 'discovered' : 'not-discovered', effectPlans, knowledge } }
}
export function assertTtrpgOpenKnowledgeSettlementEqualV1(actual: unknown, expected: TtrpgOpenKnowledgeSettlementV1): void {
  if (stable(actual) !== stable(expected)) p.fail('知识、代价或接收者不是冻结路径与真实检定结果的确定性结算')
}

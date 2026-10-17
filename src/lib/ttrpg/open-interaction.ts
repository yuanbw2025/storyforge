/** Explicit no-roll bindings reuse actual granted actions and existing effect owners. */
import type { ProductRuntimeState,RulePackV1 } from '../types'
import type { TtrpgOpenInteractionBindingV1 } from './open-contract'
import type { TtrpgOpenRulePlanV1 } from './open-rule-plan'
import type { TtrpgMechanicalResultV1 } from './rule-action-mechanical'
import { parseTtrpgPredicateV1 } from './predicate'
import { parseTtrpgEffectPlanV2 } from './effect-plan'
import { applyTtrpgEffectPlanToRuntimeV2 } from './effect-runtime'
import { resolveTtrpgRuleActionMechanicalV1,applyTtrpgMechanicalResultV1 } from './rule-action-mechanical'
import * as p from './open-contract-parse'
export function parseTtrpgOpenInteractionBindingV1(value: unknown,label = 'interaction binding'): TtrpgOpenInteractionBindingV1 {
  const r = p.record(value,['interactionKey','kind','title','actionKey','effectPlanRef','preconditions','timeCostWorldTurns'],label)
  return { interactionKey: p.key(r.interactionKey,label),kind: p.oneOf(r.kind,['dialogue','observe','move','assist','retreat'],label),
    title: p.text(r.title,label,200),actionKey: p.key(r.actionKey,label),effectPlanRef: p.nullable(r.effectPlanRef,p.key,label),
    preconditions: p.list(r.preconditions,label,parseTtrpgPredicateV1,30),timeCostWorldTurns: p.integer(r.timeCostWorldTurns,label,0,10) }
}
export function assertTtrpgOpenInteractionActionV1(binding: TtrpgOpenInteractionBindingV1,rules: RulePackV1): void {
  const action = rules.actions.find(a => a.key === binding.actionKey)
  if (!action || action.effects.some(e => e.kind === 'check' || e.kind === 'damage')) p.fail('no-roll 互动必须绑定真实无检定、无随机伤害的行动')
  if ((binding.kind === 'move' || binding.kind === 'retreat') && binding.effectPlanRef === null) p.fail('移动或撤退必须绑定真实效果模板')
}
export function ttrpgOpenOperationEffectTemplateKeyV1(plan: TtrpgOpenRulePlanV1,outcome: TtrpgMechanicalResultV1['outcome']): string | null {
  if (plan.interaction) {
    if (outcome !== 'automatic') p.fail('冻结 no-roll 互动不得产生骰点裁定')
    return plan.interaction.effectPlanRef
  }
  return outcome === 'automatic' ? null : plan.genericCheck?.effectPlanByDegree[outcome] ?? null
}
export function ttrpgOpenOperationEffectDegreeV1(plan: TtrpgOpenRulePlanV1,outcome: TtrpgMechanicalResultV1['outcome']) {
  return plan.interaction && outcome === 'automatic' ? 'success' as const : outcome
}
export function buildTtrpgOpenInteractionEffectV1(plan: TtrpgOpenRulePlanV1,alternativeKey: string | null,identity: { planKey: string; commandId: string; sourceEventId: string }) {
  if (!plan.interaction?.effectPlanRef) return null
  const template = plan.effectTemplates.find(t => t.planKey === plan.interaction!.effectPlanRef) ?? p.fail('互动缺少原冻结效果')
  const alternative = alternativeKey === null ? null : template.alternatives.find(a => a.alternativeKey === alternativeKey)
  if (template.alternatives.length ? !alternative : alternativeKey !== null) p.fail('互动后果必须选择原冻结选项')
  const bindings = plan.request.effectBindings[template.planKey],primitives = alternative ? alternative.effects : template.effects
  const effects = primitives.flatMap(effect => {
    if (effect.family === 'knowledge') {
      if (!plan.discoveryPlan || effect.evidenceRef !== plan.discoveryPlan.request.evidenceRef) p.fail('互动知识效果缺少原发现路径')
      return []
    }
    if (effect.family === 'story' && effect.operation !== 'location.set') p.fail('互动效果 owner 尚未接入')
    const targetRef = effect.targetRef.startsWith('parameter:') ? bindings[effect.targetRef.slice(10)] : effect.targetRef
    return targetRef === null ? [] : [{ ...effect,targetRef }]
  })
  return parseTtrpgEffectPlanV2({ schema: 'storyforge.ttrpg-effect-plan',version: 2,planKey: identity.planKey,degree: 'success',
    sourceEventId: identity.sourceEventId,ruleRef: template.ruleRef,reason: template.reason,audience: template.audience,status: 'immediate',effects,idempotencyKey: identity.commandId })
}
/** Isolated, deterministic dry run. No receipt, event or projected preview state is persisted.
 * Reports only a generic admission failure, never private actor balances or transitions. */
export function assertTtrpgOpenInteractionChoiceCostV1(state: ProductRuntimeState,plan: TtrpgOpenRulePlanV1,alternativeKey: string | null): void {
  if (!plan.interaction?.effectPlanRef) return
  const key = `interaction.preflight.${state.lastSequence}`
  const effect = buildTtrpgOpenInteractionEffectV1(plan,alternativeKey,{ planKey: key,commandId: key,sourceEventId: `event.${state.lastSequence}` })
  if (!effect) return
  let preview: ReturnType<typeof applyTtrpgEffectPlanToRuntimeV2>
  try { preview = applyTtrpgEffectPlanToRuntimeV2({ state,rulePack: plan.rulePack,plan: effect,eventSequence: state.lastSequence + 1 }) }
  catch { p.fail('当前状态无法完成所选互动后果') }
  for (const transition of preview.transitions) {
    const primitive = effect.effects.find(e => e.effectKey === transition.effectKey)!
    if (primitive.family === 'numeric' && primitive.operation === 'resource.spend'
      && Number(JSON.parse(transition.beforeJson)) < Math.abs(primitive.amount)) p.fail('当前状态无法支付所选互动后果费用')
  }
}
export async function assertTtrpgOpenInteractionKnownCostsV1(state: ProductRuntimeState,plan: TtrpgOpenRulePlanV1,worldTurn: number): Promise<void> {
  if (!plan.interaction) return
  const action = plan.rulePack.actions.find(a => a.key === plan.request.ruleKey)!
  assertTtrpgOpenInteractionActionV1(plan.interaction,plan.rulePack)
  const result = await resolveTtrpgRuleActionMechanicalV1({ state,rulePack: plan.rulePack,action,actorKey: plan.request.actorKey,targetKey: plan.request.targetKey,
    seed: 'preflight.no-dice',commandId: 'interaction.preflight',sequence: state.lastSequence + 1,currentRound: worldTurn,advanceConditions: false,
    situationalModifier: 0,rollVisibility: 'public',actorSkill: { skillKey: action.key,skillValue: plan.skillValues[plan.request.actorKey] ?? 0 },opponentSkill: null })
  const preview = structuredClone(state);applyTtrpgMechanicalResultV1(preview,result)
  const template = plan.effectTemplates.find(t => t.planKey === plan.interaction!.effectPlanRef)
  const choices = template?.alternatives.length ? template.alternatives.map(a => a.alternativeKey) : [null]
  for (const choice of choices) {
    try { assertTtrpgOpenInteractionChoiceCostV1(preview,plan,choice);return } catch { /* Try other frozen choices without selecting one. */ }
  }
  p.fail('当前状态无法完成原行动与互动后果的合计费用或效果')
}

import { ttrpgOpenDiscoveryEvidenceV1 } from './open-knowledge-discovery'
import { currentTtrpgOpenPrivateChoiceV1 } from './open-private-choice'
/** Human-only display of a frozen plan. Never exposes the frozen plan itself. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenOperationV1 } from './open-operation'
import type { TtrpgOpenEffectPlanTemplateV1, TtrpgOpenEffectPrimitiveV1 } from './open-contract'
import { ttrpgOpenDiscoveryEffectTemplatesV1 } from './open-discovery-effect-templates'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'

const degrees: Record<string, string> = { automatic: '免掷骰', 'critical-success': '大成功', 'extreme-success': '极难成功', 'hard-success': '困难成功', success: '成功', 'partial-success': '部分成功', failure: '失败', 'critical-failure': '大失败' }
const operations: Record<string, string> = { 'resource.gain': '增加', 'resource.spend': '消耗', 'resource.set': '设为', damage: '伤害', healing: '治疗', stress: '压力变化', currency: '货币变化', 'condition.apply': '添加状态', 'condition.remove': '移除状态', 'item.grant': '获得物品', 'item.remove': '移除物品', 'item.transfer': '转交物品', 'item.use': '使用物品', 'item.damage': '损坏物品', 'item.repair': '修复物品', 'item.equip': '装备物品', 'ability.unlock': '解锁能力', 'ability.disable': '禁用能力', 'usage.consume': '消耗次数', 'usage.restore': '恢复次数', 'usage.reset': '重置次数', 'cooldown.start': '开始冷却', 'cooldown.clear': '清除冷却' }
export function describeTtrpgOpenHumanEffectV1(input: {
  state: ProductRuntimeState; rules: TtrpgOpenOperationV1['plan']['rulePack']; actorKey: string;
  effect: TtrpgOpenEffectPrimitiveV1; bindings: Record<string, string | null>; name: (ref: string | null) => string | null; host?: boolean
}) {
  const { state, rules, actorKey, effect, bindings, name, host = false } = input
  let reviewable = true
  const hidden = () => { reviewable = false;return '有待主持人审查的后果' }
  const resource = (key: string) => rules.resources.find(r => r.key === key)?.name ?? null
  const condition = (key: string) => rules.conditions.find(c => c.key === key)?.name ?? null
  const describe = () => {
    const ref = effect.targetRef.startsWith('parameter:') ? bindings[effect.targetRef.slice(10)] : effect.targetRef
    if (ref === null) return '此可选参数未绑定，不产生后果'
    const target = ref ? name(ref) : null
    if (!target) return hidden()
    const verb = operations[effect.operation]
    if (effect.family === 'numeric') { const label = resource(effect.valueKey);return label && verb ? `${target}：${label}${verb} ${effect.amount}` : hidden() }
    if (effect.family === 'condition') { const label = condition(effect.conditionKey);return label && verb ? `${target}：${verb}「${label}」${effect.stacks} 层，持续${effect.duration === null ? '至明确解除' : `${effect.duration} 轮`}` : hidden() }
    if (effect.family === 'ability') { const label = rules.actions.find(a => a.key === effect.abilityKey)?.name;return label && verb && (effect.clockRef === null || host) ? `${target}：${label}${verb}${effect.amount === null ? '' : ` ${effect.amount}`}` : hidden() }
    if (effect.family === 'item') {
      const item = effect.itemInstanceRef ? state.ttrpg!.product.inventory.items[effect.itemInstanceRef] : null
      const definition = effect.itemDefinitionRef ?? item?.definitionRef, defined = rules.items.find(i => i.key === definition)
      // The inventory kernel grants identified items; existing unknown items retain their boundary.
      const label = defined ? host || effect.operation === 'item.grant' || item?.ownerRef === actorKey && item.identification === 'identified' ? defined.name : '尚未辨识的物品' : null
      const destination = effect.destinationRef === null ? null : name(effect.destinationRef)
      return label && verb && (effect.destinationRef === null || destination) ? `${target}：${verb}「${label}」×${effect.amount}${destination ? `，接收者：${destination}` : ''}` : hidden()
    }
    if (host && effect.family === 'advancement') return `${target}：${effect.operation}（${effect.advancementKey}）变化 ${effect.amount}`
    if (host && effect.family === 'social') return `${target}：${effect.operation}（${effect.socialKey}）变化 ${effect.amount}`
    if (effect.family === 'story' && effect.operation === 'location.set' && typeof effect.value === 'string') { const destination = name(effect.value);return destination ? `${target}：前往${destination}` : hidden() }
    return hidden()
  }
  const text = describe()
  return { text, reviewable }
}
export function projectTtrpgOpenTableRiskV1(input: { state: ProductRuntimeState; content: TtrpgRuntimeContentV2; operation: TtrpgOpenOperationV1; actorKey: string; seatKey: string; host?: boolean }) {
  const { state, content, operation: op, actorKey, seatKey, host = false } = input, plan = op.plan, rules = plan.rulePack
  const blocked = new Set<string>(), lines: string[] = []
  const permitted = (audience: string) => host || audience === 'public' || audience === 'party' || audience === `actor:${actorKey}`
  const visible = (ref: string) => host || ref === actorKey || ref === state.entities[actorKey]?.locationKey || content.campaign.entityBindings.some(b => b.bindingKey === ref && (b.audience === 'public' || b.audience === 'party' || b.audience === 'private' && b.knownByActorKeys.includes(actorKey)))
  const name = (ref: string | null) => ref && visible(ref) ? state.entities[ref]?.name ?? null : null
  const resource = (key: string) => rules.resources.find(r => r.key === key)?.name ?? null
  const condition = (key: string) => rules.conditions.find(c => c.key === key)?.name ?? null
  const hidden = () => { blocked.add('有未公开或尚不能完整展示的后果，请由主持人先完成审查。');return '有待主持人审查的后果' }
  const describe = (effect: TtrpgOpenEffectPrimitiveV1, bindings: Record<string, string | null>) => {
    const result = describeTtrpgOpenHumanEffectV1({ state, rules, actorKey, effect, bindings, name, host })
    if (!result.reviewable) hidden()
    return result.text
  }
  const templateView = (t: TtrpgOpenEffectPlanTemplateV1, bindings: Record<string, string | null>) => {
    if (!permitted(t.audience)) { hidden();return { templateKey: t.planKey, degree: degrees[t.degree], lines: ['有待主持人审查的后果'], alternatives: [] as Array<{ alternativeKey: string; title: string; lines: string[] }>, reviewable: false } }
    const before = blocked.size
    const parameters = t.parameters.map(p => { const ref = bindings[p.parameterKey];if (ref === null) return '可选参数：不绑定';const label = ref ? name(ref) : null;return label ? `后果对象：${label}` : hidden() })
    const effects = t.alternatives.length ? ['从下列后果中选择一项，不叠加执行'] : t.effects.map(e => describe(e, bindings))
    const alternatives = t.alternatives.map(a => ({ alternativeKey: a.alternativeKey, title: a.title, lines: a.effects.map(e => describe(e, bindings)) }))
    return { templateKey: t.planKey, degree: degrees[t.degree], lines: [...parameters, ...effects], alternatives, reviewable: blocked.size === before && ![...parameters, ...effects, ...alternatives.flatMap(a => a.lines)].some(s => s.includes('待主持人审查')) }
  }
  if (plan.interaction?.kind === 'retreat') lines.push('撤退会使混乱值增加 1（达到 9 时不再增加）。')
  const action = plan.request.route === 'existing-action' ? rules.actions.find(a => a.key === plan.request.ruleKey) : null
  if (!name(plan.request.actorKey) || plan.request.targetKey && !name(plan.request.targetKey)) hidden()
  if (action) {
    if (action.costResourceKey && action.costAmount) lines.push(`行动者消耗：${resource(action.costResourceKey) ?? hidden()} ${action.costAmount}`)
    const u = action.usage
    if (u.mode === 'charges') lines.push('行动者消耗 1 次能力使用次数')
    if (u.mode === 'resource-cost') lines.push(`能力另消耗：${resource(u.resourceKey!) ?? hidden()} ${u.cost}`)
    if (u.mode === 'cooldown') lines.push(`能力进入 ${u.cooldownRounds} 轮冷却`)
    if (u.mode === 'shared-pool') lines.push(`消耗共享次数池 ${u.cost} 次`)
    for (const effect of action.effects) {
      if (effect.kind === 'check') continue
      const target = name(effect.targetScope === 'actor' ? plan.request.actorKey : plan.request.targetKey ?? plan.request.actorKey)
      const when = effect.appliesOnDegrees?.length ? effect.appliesOnDegrees.map(d => degrees[d]).join('、') : '成功'
      if (!target) { lines.push(hidden());continue }
      if (effect.kind === 'resource') lines.push(`${when}：${target}的${resource(effect.resourceKey) ?? hidden()} ${effect.delta >= 0 ? '+' : ''}${effect.delta}`)
      if (effect.kind === 'condition') lines.push(`${when}：${target}添加「${condition(effect.conditionKey) ?? hidden()}」${effect.stacks} 层`)
      if (effect.kind === 'damage') {
        const dice = rules.diceModels.find(d => d.key === effect.diceModelKey), modifier = effect.modifierAttributeKey ? rules.attributes.find(a => a.key === effect.modifierAttributeKey)?.name : null
        if (!dice || effect.modifierAttributeKey && !modifier) { lines.push(hidden());continue }
        lines.push(`${when}：${target}的${resource(effect.resourceKey) ?? hidden()}受到 ${dice.count}d${dice.sides}${dice.keep === 'all' ? '' : dice.keep === 'highest' ? '取最高骰' : '取最低骰'}${modifier ? ` 加${modifier}修正` : ''} 伤害`)
      }
    }
  } else if (plan.genericCheck) {
    if (!permitted(plan.genericCheck.audience)) hidden()
    else {
      if (plan.rollVisibility === 'public') lines.push(`检定难度：${plan.genericCheck.difficulty}`)
      for (const cost of plan.genericCheck.resourceCosts) lines.push(`行动者消耗：${resource(cost.resourceKey) ?? hidden()} ${cost.amount}`)
    }
  }
  const templates = plan.effectTemplates.map(t => ({ ...templateView(t, plan.request.effectBindings[t.planKey]), when: plan.interaction ? '自动成功后' : `${Object.entries(plan.genericCheck?.effectPlanByDegree ?? {}).filter(([, key]) => key === t.planKey).map(([degree]) => degrees[degree]).join('、') || degrees[t.degree]}时` }))
  const discoveryEvidence = plan.discoveryPlan ? ttrpgOpenDiscoveryEvidenceV1(plan.discoveryPlan) : undefined
  const discovery = (plan.discoveryPlan?.effectTemplates ?? []).map(t => ({ ...templateView(t, plan.discoveryPlan!.request.effectBindings[t.planKey]), when: discoveryEvidence?.discoveryPolicy.costEffectPlanRef === t.planKey ? '尝试发现线索时' : '发现检定未成功后的继续推进' }))
  const canChoose = plan.requiredApprovals.some(a => a.actorKey === plan.request.actorKey && a.allowedSeatKeys.includes(seatKey))
  const receipt = parseTtrpgRuntimeStateV2(state.ttrpg)?.openRun?.ruleReceipts.find(r => r.operationKey === op.operationKey)
  const next = nextTtrpgOpenOperationStepV1(op)?.kind
  const choices: Array<{ kind: 'effect' | 'knowledge'; templateKey: string; alternatives: Array<{ alternativeKey: string; title: string; lines: string[] }>; canChoose: boolean; disclosureHash?: string }> = []
  if ((host || plan.rollVisibility === 'public') && op.status === 'executing' && next === 'effect' && op.pendingChoice?.selectedAlternativeKey === null) {
    const t = templates.find(t => t.templateKey === op.pendingChoice!.templateKey)
    if (t) choices.push({ kind: 'effect', templateKey: t.templateKey, alternatives: t.alternatives, canChoose: canChoose && t.reviewable })
  }
  if ((host || plan.rollVisibility === 'public') && op.status === 'executing' && next === 'knowledge' && receipt && plan.discoveryPlan) for (const actual of ttrpgOpenDiscoveryEffectTemplatesV1(op, receipt)) {
    const t = discovery.find(t => t.templateKey === actual.planKey)!
    if (actual.alternatives.length && !op.discoveryChoices?.some(c => c.templateKey === actual.planKey)) choices.push({ kind: 'knowledge', templateKey: t.templateKey, alternatives: t.alternatives, canChoose: canChoose && t.reviewable })
  }
  if (plan.rollVisibility !== 'public') {
    const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!
    if (host) for (const choice of choices) {
      const review = currentTtrpgOpenPrivateChoiceV1({ state,runtime,operation: op,kind: choice.kind,templateKey: choice.templateKey })
      choice.canChoose = choice.canChoose && review !== null
      if (review) choice.disclosureHash = review.reviewHash
    }
    else if (canChoose) for (const candidate of op.privateChoiceDisclosures ?? []) {
      if (choices.some(c => c.kind === candidate.body.kind && c.templateKey === candidate.body.templateKey)) continue
      const review = currentTtrpgOpenPrivateChoiceV1({ state,runtime,operation: op,kind: candidate.body.kind,templateKey: candidate.body.templateKey })
      if (review) choices.push({ kind: review.body.kind,templateKey: review.body.templateKey,alternatives: structuredClone(review.body.alternatives),canChoose: true,disclosureHash: review.reviewHash })
    }
  }
  return { lines, templates: [...templates, ...discovery], blockers: [...blocked], reviewable: blocked.size === 0, privateRoll: plan.rollVisibility !== 'public', choices }
}

import { ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'
import { ttrpgOpenSituationCatalogV1 } from './open-session-situation-catalog'
import { isTtrpgOpenPassiveEpochV1 } from './open-coordination'
import { parseTtrpgOpenInteractionBindingV1,assertTtrpgOpenInteractionActionV1 } from './open-interaction'
import { projectTtrpgOpenWorldFactsV1 } from './open-fact-authority'
import { ttrpgOpenSessionFactsV1 } from './open-fact-ledger'
import { parseTtrpgOpenDiscoveryPlanV1, createTtrpgOpenDiscoveryPlanV1,
  type TtrpgOpenDiscoveryPlanV1 } from './open-knowledge-discovery'
import { parseTtrpgOpenRuleRequestV1,type TtrpgOpenRuleRequestV1 } from './open-rule-request-contract'
export { parseTtrpgOpenRuleRequestV1,type TtrpgOpenRuleRequestV1 } from './open-rule-request-contract'
import { validateTtrpgOpenEffectBindingsV1 } from './open-effect-binding'
/** Frozen deterministic rule admission. Model suggestions cannot set difficulty or costs. */
import type { ProductRuntimeState, RulePackV1 } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenGenericCheckV1, TtrpgOpenEffectPlanTemplateV1,TtrpgOpenInteractionBindingV1 } from './open-contract'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseRulePackV1 } from './rule-pack'
import { projectTtrpgRulePackMechanicalCoreV1, parseTtrpgOpenGenericCheckV1 } from './rule-pack-v2'
import { effectTemplate } from './open-content-templates'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { evaluateTtrpgActionRequirementsV2 } from './action-requirement'
import { consumeTtrpgAbilityV2, ttrpgAbilityStateKeyV2 } from './ability-ledger'
import { evaluateTtrpgPredicateV1, type TtrpgPredicateEvaluationContextV1 } from './predicate'
import * as p from './open-contract-parse'

export interface TtrpgOpenRulePlanV1 {
  schema: 'storyforge.ttrpg-open-rule-plan'
  version: 1
  request: TtrpgOpenRuleRequestV1
  epochKey: string
  rulePackContentHash: string
  runtimeSourceHash: string
  authorizationHash: string
  mechanicalStateHash: string
  rulePack: RulePackV1
  genericCheck: TtrpgOpenGenericCheckV1 | null
  effectTemplates: TtrpgOpenEffectPlanTemplateV1[]
  timeCostWorldTurns: number
  affectedActorKeys: string[]
  requiredApprovals: Array<{ actorKey: string; allowedSeatKeys: string[] }>
  skillValues: Record<string, number>
  rollVisibility: 'public' | 'gm-only'
  discoveryPlan?: TtrpgOpenDiscoveryPlanV1
  interaction?: TtrpgOpenInteractionBindingV1
  stageTimeLimit?: { openedAtWorldTurn: number; maximumWorldTurns: number }
}
function fail(message: string): never { throw new Error(`[ttrpg-open-rule-plan] ${message}`) }

/** Admission owners contribute; confirmations and display events do not stale a plan. */
export function projectTtrpgOpenMechanicalBasisV1(state: ProductRuntimeState) {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun) fail('open 团局未启动')
  return { entities: state.entities, conditions: runtime.product.conditions,
    inventory: runtime.product.inventory, abilities: runtime.product.abilityStates, pools: runtime.product.usagePools,
    effectLedger: runtime.product.effectLedger, customizations: runtime.product.characterCustomizations,
    worldTime: runtime.openRun.worldTime, clocks: runtime.openRun.clocks, fronts: runtime.openRun.fronts,
    knowledge: runtime.openRun.knowledge,
    ...(runtime.openRun.factLedger ? { sessionFacts: ttrpgOpenSessionFactsV1(runtime.openRun.factLedger) } : {}),
    situations: runtime.openRun.situations, safetyStatus: runtime.product.safety.status }
}
export async function ttrpgOpenMechanicalStateHashV1(state: ProductRuntimeState): Promise<string> {
  return hashProductProductionValueV2(projectTtrpgOpenMechanicalBasisV1(state))
}

export function ttrpgOpenPredicateContextV1(state: ProductRuntimeState, content: TtrpgRuntimeContentV2): TtrpgPredicateEvaluationContextV1 {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun) fail('open 团局未启动')
  const product = runtime.product
  const rulePack = projectTtrpgRulePackMechanicalCoreV1(content.rulePack.content)
  const sessionFacts = ttrpgOpenSessionFactsV1(runtime.openRun.factLedger)
  const availableAbilityKeys = (actorKey: string, granted: readonly string[]) => granted.filter(abilityKey => {
    const actor = state.entities[actorKey]
    const action = rulePack.actions.find(action => action.key === abilityKey)
    const ability = product.abilityStates[ttrpgAbilityStateKeyV2(actorKey, abilityKey)]
    if (!actor || !action || !ability) fail('能力谓词缺少冻结定义或当前账本')
    if (ability.actorInstanceId !== actorKey || ability.abilityKey !== abilityKey) fail('能力谓词账本身份不匹配')
    if (action.usage.mode === 'shared-pool') {
      const pool = product.usagePools[action.usage.sharedPoolKey!]
      if (!pool || pool.poolKey !== action.usage.sharedPoolKey) fail('能力谓词共享池身份不匹配')
    }
    if (actor.lifecycleStatus !== 'active' || product.safety.status !== 'active'
      || !evaluateTtrpgActionRequirementsV2({ action, rulePack, actorAttributes: actor.attributes, actorConditions: product.conditions[actorKey] }).met) return false
    try {
      const use = consumeTtrpgAbilityV2({ definition: { abilityKey, actionDefinitionKey: abilityKey, usage: action.usage }, state: ability,
        eventId: 'predicate.preflight', currentRound: runtime.openRun!.worldTime.worldTurn,
        resourceCurrent: action.usage.resourceKey === null ? null : Number(actor.attributes[`resource.${action.usage.resourceKey}`]),
        sharedPool: action.usage.sharedPoolKey === null ? null : product.usagePools[action.usage.sharedPoolKey] ?? null })
      if (action.costResourceKey !== null) {
        const current = actor.attributes[`resource.${action.costResourceKey}`]
        const required = action.costAmount + (action.costResourceKey === action.usage.resourceKey ? Math.max(0, -use.resourceDelta) : 0)
        if (typeof current !== 'number' || !Number.isSafeInteger(current) || current < required) return false
      }
      return true
    } catch (error) {
      if (error instanceof Error && /^\[ttrpg-ability\].*(已禁用|耗尽|资源不足|共享次数池不足|冷却)/u.test(error.message)) return false
      throw error
    }
  })
  return {
    frozenWorldPredicateIndex: content.campaign.frozenWorldPredicateIndex,
    sessionFacts,
    knowledge: runtime.openRun.knowledge,
    worldFacts: projectTtrpgOpenWorldFactsV1({ state, content, sessionFacts }),
    effectLedger: { storyFacts: product.effectLedger.storyFacts, socialBalances: product.effectLedger.socialBalances },
    pressure: {
      clocks: Object.fromEntries(runtime.openRun.clocks.map(clock => [clock.clockKey, { value: clock.value }])),
      fronts: Object.fromEntries(runtime.openRun.fronts.map(front => [front.frontKey, { currentStageKey: front.stageKey,
        escalationStages: content.campaign.fronts.find(definition => definition.frontKey === front.frontKey)?.escalationStages ?? [] }])),
    },
    actors: Object.fromEntries(ttrpgOpenEntityIdentityCatalogV1(content, runtime.openRun.entityOperations ?? []).filter(row => row.kind === 'actor').map(identity => {
      const actor = content.campaign.characterTemplates.find(row => row.characterKey === identity.templateKey)!
      return [identity.entityKey, {
      locationRef: state.entities[identity.entityKey]?.locationKey ?? null,
      itemKeys: Object.values(product.inventory.items).filter(item => item.ownerRef === identity.entityKey && item.quantity > 0 && !item.stateTags.includes('broken'))
        .flatMap(item => [item.itemInstanceId, item.definitionRef]),
      abilityKeys: availableAbilityKeys(identity.entityKey, [...new Set([...actor.actionKeys,
        ...Object.values(product.inventory.items).filter(item => item.ownerRef === identity.entityKey && item.quantity > 0 && !item.stateTags.includes('broken'))
          .flatMap(item => rulePack.items.find(definition => definition.key === item.definitionRef)?.grantedActionKeys ?? [])])]),
      resources: Object.fromEntries(content.rulePack.content.resources.map(resource => [resource.key,
        Number(state.entities[identity.entityKey]?.attributes[`resource.${resource.key}`])])),
    }]
    })),
    situations: { active: runtime.openRun.situations.active, templates: ttrpgOpenSituationCatalogV1(content.campaign, runtime.openRun).templates },
    chaos: runtime.openRun.chaos.value, worldTurn: runtime.openRun.worldTime.worldTurn,
    // Existence and current availability are separate: an exhausted/condition-blocked frozen ability is a valid false predicate.
    knownRefs: [...new Set([...ttrpgOpenSituationCatalogV1(content.campaign, runtime.openRun).templates.map(t => t.templateKey), ...ttrpgOpenEntityIdentityCatalogV1(content, runtime.openRun.entityOperations ?? []).map(binding => binding.entityKey),
      ...rulePack.actions.map(action => action.key), ...rulePack.items.map(item => item.key), ...rulePack.resources.map(resource => resource.key)])],
  }
}

export function parseTtrpgOpenRulePlanV1(value: unknown): TtrpgOpenRulePlanV1 {
  const hasInteraction = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value,'interaction')
  const hasDiscovery = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'discoveryPlan')
  const hasStageLimit = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'stageTimeLimit')
  const r = p.record(value, ['schema', 'version', 'request', 'epochKey', 'rulePackContentHash', 'runtimeSourceHash',
    'authorizationHash', 'mechanicalStateHash', 'rulePack', 'genericCheck', 'effectTemplates', 'timeCostWorldTurns',
    'affectedActorKeys', 'requiredApprovals', 'skillValues', 'rollVisibility', ...(hasDiscovery ? ['discoveryPlan'] : []), ...(hasStageLimit ? ['stageTimeLimit'] : []),...(hasInteraction ? ['interaction'] : [])], 'rule plan')
  p.literal(r.schema, 'storyforge.ttrpg-open-rule-plan', 'schema'); p.literal(r.version, 1, 'version')
  const request = parseTtrpgOpenRuleRequestV1(r.request), rulePack = parseRulePackV1(r.rulePack)
  const interaction = hasInteraction ? parseTtrpgOpenInteractionBindingV1(r.interaction) : undefined
  if (Boolean(request.interactionKey) !== Boolean(interaction) || interaction && (interaction.interactionKey !== request.interactionKey || interaction.actionKey !== request.ruleKey || r.timeCostWorldTurns !== interaction.timeCostWorldTurns)) fail('互动计划未绑定原请求/行动/耗时')
  if (interaction) { assertTtrpgOpenInteractionActionV1(interaction,rulePack);if (interaction.kind === 'retreat' && request.controllerMode !== 'human') fail('撤退须由真人发起') }
  const genericCheck = r.genericCheck === null ? null : parseTtrpgOpenGenericCheckV1(r.genericCheck, 'genericCheck', rulePack)
  if ((request.route === 'generic-check') !== (genericCheck !== null)
    || (genericCheck !== null && request.ruleKey !== genericCheck.checkKey)
    || (request.route === 'existing-action' && !rulePack.actions.some(action => action.key === request.ruleKey))) fail('规则路由与冻结定义不一致')
  const affectedActorKeys = p.keys(r.affectedActorKeys, 'affectedActorKeys', 1000, 1)
  const requiredApprovals = p.list(r.requiredApprovals, 'requiredApprovals', value => {
    const a = p.record(value, ['actorKey', 'allowedSeatKeys'], 'required approval')
    return { actorKey: p.key(a.actorKey, 'approval actor'), allowedSeatKeys: p.keys(a.allowedSeatKeys, 'allowedSeatKeys', 1000, 1) }
  }, 1000, 1)
  if (new Set(requiredApprovals.map(approval => approval.actorKey)).size !== requiredApprovals.length) fail('批准要求重复')
  const effectTemplates = p.list(r.effectTemplates, 'effectTemplates', effectTemplate, 7)
  if (interaction && (effectTemplates.map(t => t.planKey).join(',') !== (interaction.effectPlanRef ?? '') || effectTemplates.some(t => t.degree !== 'success'))) fail('互动效果必须精确来自冻结成功模板')
  const discoveryPlan = hasDiscovery ? parseTtrpgOpenDiscoveryPlanV1(r.discoveryPlan) : undefined
  if (Boolean(request.discovery) !== Boolean(discoveryPlan) || (discoveryPlan && (JSON.stringify(request.discovery) !== JSON.stringify(discoveryPlan.request)
    || request.actorKey !== discoveryPlan.actorKey || request.route !== discoveryPlan.route || request.ruleKey !== discoveryPlan.ruleKey
    || discoveryPlan.frozenContent.rulePack.contentHash !== r.rulePackContentHash))) fail('发现计划必须绑定本次真实规则请求')
  const limit = hasStageLimit ? p.record(r.stageTimeLimit, ['openedAtWorldTurn', 'maximumWorldTurns'], 'stage time limit') : undefined
  const stageTimeLimit = limit ? { openedAtWorldTurn: p.integer(limit.openedAtWorldTurn, 'stage opened turn'), maximumWorldTurns: p.integer(limit.maximumWorldTurns, 'stage maximum', 10, 1000) } : undefined
  if (stageTimeLimit && stageTimeLimit.openedAtWorldTurn >= stageTimeLimit.maximumWorldTurns) fail('阶段起点必须早于绝对最大世界轮次')
  return { schema: 'storyforge.ttrpg-open-rule-plan', version: 1,...(interaction ? { interaction } : {}),request, rulePack, genericCheck, effectTemplates,
    epochKey: p.key(r.epochKey, 'epochKey'), rulePackContentHash: p.hash(r.rulePackContentHash, 'rule hash'),
    runtimeSourceHash: p.hash(r.runtimeSourceHash, 'source hash'), authorizationHash: p.hash(r.authorizationHash, 'authorization hash'),
    mechanicalStateHash: p.hash(r.mechanicalStateHash, 'mechanical hash'),
    timeCostWorldTurns: p.integer(r.timeCostWorldTurns, 'time cost', 0, 10), affectedActorKeys, requiredApprovals,
    skillValues: p.numericRecord(r.skillValues, 'skillValues'), rollVisibility: p.oneOf(r.rollVisibility, ['public', 'gm-only'], 'roll visibility'),
    ...(discoveryPlan ? { discoveryPlan } : {}), ...(stageTimeLimit ? { stageTimeLimit } : {}) }
}

export async function createTtrpgOpenRulePlanV1(input: {
  state: ProductRuntimeState; content: TtrpgRuntimeContentV2; runtimeSourceHash: string; request: TtrpgOpenRuleRequestV1
}): Promise<TtrpgOpenRulePlanV1> {
  const request = parseTtrpgOpenRuleRequestV1(input.request)
  const runtime = parseTtrpgRuntimeStateV2(input.state.ttrpg)
  const auth = runtime?.authorization, run = runtime?.openRun
  if (!runtime || !auth || !run || runtime.product.safety.status !== 'active' || run.stage.status !== 'open') fail('当前团局不能计划规则行动')
  if (run.worldTime.worldTurn >= input.content.campaign.stageClosurePolicy.maximumWorldTurns) fail('该阶段已达最大世界轮次；请明确收束/存档，不能继续耗时行动')
  const epoch = run.coordination.epochs.find(epoch => epoch.epochKey === run.coordination.activeEpochKey)
  if (!epoch || epoch.status !== 'active') fail('需要真人启动的 active epoch')
  if (isTtrpgOpenPassiveEpochV1(epoch)) fail('复盘授权不能结算角色或队友行动')
  const seat = auth.seats.find(seat => seat.actorKey === request.actorKey && seat.role === 'player')
  if (!seat || !auth.selectedActorKeys.includes(request.actorKey)) fail('行动者不在已确认活动席位')
  if ((request.controllerMode === 'human' && (seat.controller === 'ai' || seat.assignmentState !== 'claimed'))
    || (request.controllerMode === 'ai' && (seat.controller === 'human' || !seat.consent.aiAdviceAllowed))) fail('行动控制模式与席位/同意策略不一致')
  if (request.controllerMode === 'ai' && (epoch.successfulActorKeys.includes(request.actorKey)
    || epoch.successfulActorKeys.length >= epoch.budget.maximumAiActions)) fail('该 epoch 队友成功执行额度不足')
  const actor = input.state.entities[request.actorKey]
  const location = actor?.locationKey
  if (!actor || actor.lifecycleStatus !== 'active' || !location || input.state.entities[location]?.kind !== 'location') fail('行动者缺少可解析地点或不可行动')
  const readableBinding = (entityKey: string) => {
    if (entityKey === request.actorKey) return true
    const binding = ttrpgOpenEntityIdentityCatalogV1(input.content, run.entityOperations ?? []).find(binding => binding.entityKey === entityKey)
    return Boolean(binding && ttrpgOpenEntityReferenceVisibleV1(binding.audience, binding.recipientActorKeys, request.actorKey, false, binding.dynamic))
  }
  const target = request.targetKey === null ? null : input.state.entities[request.targetKey]
  if (request.targetKey !== null && !readableBinding(request.targetKey)) fail('目标不在该行动者获授权的信息范围')
  if (target?.kind === 'player' && !auth.selectedActorKeys.includes(target.entityKey)) fail('目标真人角色不在已确认活动名单')
  if (request.targetKey !== null && (!target || target.lifecycleStatus !== 'active'
    || (target.entityKey !== request.actorKey && target.kind !== 'location' && target.locationKey !== location)
    || (target.kind === 'location' && target.entityKey !== location))) fail('目标不存在或不在同一地点')
  const rulePack = projectTtrpgRulePackMechanicalCoreV1(input.content.rulePack.content)
  const template = input.content.campaign.characterTemplates.find(template => template.characterKey === request.actorKey)!
  const interaction = request.interactionKey ? input.content.rulePack.content.interactionBindings?.find(b => b.interactionKey === request.interactionKey) : undefined
  if (request.interactionKey && (!interaction || request.route !== 'existing-action' || interaction.actionKey !== request.ruleKey)) fail('没有该冻结互动绑定')
  if (!interaction && input.content.rulePack.content.interactionBindings?.some(b => b.actionKey === request.ruleKey) && request.route === 'existing-action') fail('该自动行动必须明确选择冻结互动，不能绕过互动条件与代价')
  if (interaction) {
    assertTtrpgOpenInteractionActionV1(interaction,rulePack)
    if (interaction.kind === 'retreat' && request.controllerMode !== 'human') fail('撤退必须由真人明确发起')
    if (interaction.preconditions.some(p => !evaluateTtrpgPredicateV1(p,ttrpgOpenPredicateContextV1(input.state,input.content)))) fail('互动前置条件尚未满足')
  }
  let genericCheck: TtrpgOpenGenericCheckV1 | null = null, timeCostWorldTurns: number
  let effectTemplates: TtrpgOpenEffectPlanTemplateV1[] = []
  const affected = new Set([request.actorKey])
  if (request.route === 'existing-action') {
    const action = rulePack.actions.find(action => action.key === request.ruleKey)
    const inventory = Object.values(runtime.product.inventory.items).filter(item => item.ownerRef === request.actorKey && item.quantity > 0 && !item.stateTags.includes('broken'))
    if (!action || (!template.actionKeys.includes(action.key) && !inventory.some(item => rulePack.items.find(definition => definition.key === item.definitionRef)?.grantedActionKeys.includes(action.key)))) fail('角色或现持物品未授予该冻结行动')
    if ((action.target === 'self' && request.targetKey !== request.actorKey)
      || (action.target === 'scene' && request.targetKey !== null)
      || (['single-ally', 'single-enemy'].includes(action.target) && (!target || target.entityKey === actor.entityKey || !['player', 'npc', 'character'].includes(target.kind)))) fail('行动目标种类不合法')
    const requirement = evaluateTtrpgActionRequirementsV2({ action, rulePack,
      actorAttributes: actor.attributes, actorConditions: runtime.product.conditions[request.actorKey] })
    if (!requirement.met) fail(requirement.reason ?? '行动前置条件不满足')
    const ability = runtime.product.abilityStates[ttrpgAbilityStateKeyV2(request.actorKey, action.key)]
    if (!ability) fail('冻结能力账本缺失')
    const use = consumeTtrpgAbilityV2({ definition: { abilityKey: action.key, actionDefinitionKey: action.key, usage: action.usage },
      state: ability, eventId: 'preflight', currentRound: run.worldTime.worldTurn,
      resourceCurrent: action.usage.resourceKey === null ? null : Number(actor.attributes[`resource.${action.usage.resourceKey}`]),
      sharedPool: action.usage.sharedPoolKey === null ? null : runtime.product.usagePools[action.usage.sharedPoolKey] ?? null })
    const cost = action.costAmount + (action.costResourceKey === action.usage.resourceKey ? Math.max(0, -use.resourceDelta) : 0)
    if (action.costResourceKey) {
      const current = actor.attributes[`resource.${action.costResourceKey}`]
      if (typeof current !== 'number' || !Number.isSafeInteger(current) || current < cost) fail('行动资源不足或缺少权威数值')
    }
    if (action.effects.some(effect => effect.kind !== 'check' && effect.targetScope !== 'actor') && request.targetKey) affected.add(request.targetKey)
    timeCostWorldTurns = input.content.rulePack.content.timePolicy.actionOverrides.find(override => override.actionKey === action.key)?.timeCostWorldTurns
      ?? input.content.rulePack.content.timePolicy.existingAction
    if (interaction) {
      timeCostWorldTurns = interaction.timeCostWorldTurns
      effectTemplates = interaction.effectPlanRef ? [input.content.campaign.effectPlanTemplates.find(t => t.planKey === interaction.effectPlanRef) ?? fail('互动后果模板不存在')] : []
      if (Object.keys(request.effectBindings).sort().join(',') !== effectTemplates.map(t => t.planKey).sort().join(',') || effectTemplates.some(t => t.degree !== 'success')) fail('互动必须绑定全部冻结成功模板')
      for (const actor of validateTtrpgOpenEffectBindingsV1({ state: input.state,templates: effectTemplates,bindings: request.effectBindings,authorization: auth,readableBinding })) affected.add(actor)
      if (interaction.kind === 'move' || interaction.kind === 'retreat') for (const template of effectTemplates) {
        const choices = template.alternatives.length ? template.alternatives.map(a => a.effects) : [template.effects]
        if (choices.some(effects => !effects.some(effect => effect.family === 'story' && effect.operation === 'location.set'
          && (effect.targetRef.startsWith('parameter:') ? request.effectBindings[template.planKey][effect.targetRef.slice(10)] : effect.targetRef) === request.actorKey))) fail('移动/撤退的每个冻结选项必须真实移动行动者')
      }
    } else if (Object.keys(request.effectBindings).length !== 0) fail('existing-action 不接受外加后果参数')
  } else {
    genericCheck = input.content.rulePack.content.genericChecks.find(check => check.checkKey === request.ruleKey) ?? null
    if (!genericCheck) fail('没有该冻结 generic check 定义')
    const kind = request.targetKey === request.actorKey ? 'self' : target?.kind === 'location' ? 'location' : target?.kind === 'item' ? 'item' : target ? 'actor' : null
    if (!kind || !genericCheck.targetKinds.includes(kind)) fail('通用检定目标种类不合法')
    const context = ttrpgOpenPredicateContextV1(input.state, input.content)
    if (genericCheck.preconditions.some(predicate => !evaluateTtrpgPredicateV1(predicate, context))) fail('通用检定前置谓词未满足')
    for (const cost of genericCheck.resourceCosts) {
      const current = actor.attributes[`resource.${cost.resourceKey}`]
      if (typeof current !== 'number' || current < cost.amount) fail('通用检定资源不足')
    }
    timeCostWorldTurns = genericCheck.timeCostWorldTurns
    const planKeys = [...new Set(Object.values(genericCheck.effectPlanByDegree).filter((key): key is string => key !== null))]
    effectTemplates = planKeys.map(planKey => input.content.campaign.effectPlanTemplates.find(template => template.planKey === planKey) ?? fail('后果模板缺失'))
    if (Object.keys(request.effectBindings).sort().join(',') !== [...planKeys].sort().join(',')) fail('后果参数必须覆盖所有冻结后果模板')
    for (const actor of validateTtrpgOpenEffectBindingsV1({ state: input.state, templates: effectTemplates, bindings: request.effectBindings, authorization: auth, readableBinding })) affected.add(actor)
  }
  const discoveryPlan = request.discovery ? await createTtrpgOpenDiscoveryPlanV1({ state: input.state, content: input.content,
    request: request.discovery, actorKey: request.actorKey, route: request.route, ruleKey: request.ruleKey }) : undefined
  if (discoveryPlan) {
    for (const actor of validateTtrpgOpenEffectBindingsV1({ state: input.state, templates: discoveryPlan.effectTemplates,
      bindings: discoveryPlan.request.effectBindings, authorization: auth, readableBinding })) affected.add(actor)
    for (const actor of discoveryPlan.recipientActorKeys) affected.add(actor)
  }
  for (const template of [...effectTemplates, ...(discoveryPlan?.effectTemplates ?? [])]) {
    const bindings = discoveryPlan?.effectTemplates.includes(template) ? discoveryPlan.request.effectBindings[template.planKey] : request.effectBindings[template.planKey]
    for (const effect of [...template.effects, ...template.alternatives.flatMap(alternative => alternative.effects)]) {
      if (effect.family !== 'knowledge') continue
      const target = effect.targetRef.startsWith('parameter:') ? bindings[effect.targetRef.slice(10)] : effect.targetRef
      if (!discoveryPlan || effect.evidenceRef !== discoveryPlan.request.evidenceRef
        || (discoveryPlan.recipientActorKeys.length && (target === null || !discoveryPlan.recipientActorKeys.includes(target)))) fail('知识效果必须绑定明确发现路径和冻结接收者')
    }
  }
  const requiredApprovals = [...affected].flatMap(actorKey => {
    const affectedSeat = auth.seats.find(seat => seat.actorKey === actorKey && seat.role === 'player')
    if (!affectedSeat) return []
    if ((actorKey === request.actorKey && request.controllerMode === 'ai') || affectedSeat.controller === 'ai') {
      const binding = auth.approvalBindings.find(binding => binding.companionActorKey === actorKey)
      if (!binding) fail('AI 行动缺少真人批准关系')
      return [{ actorKey, allowedSeatKeys: [...binding.approverSeatKeys] }]
    }
    return [{ actorKey, allowedSeatKeys: [affectedSeat.seatKey] }]
  })
  const maximumWorldTurns = input.content.campaign.stageClosurePolicy.maximumWorldTurns
  if (run.worldTime.worldTurn >= maximumWorldTurns || run.worldTime.worldTurn + timeCostWorldTurns > maximumWorldTurns) fail('该阶段已达或将超过最大世界轮次；请明确收束/存档，不能继续耗时行动')
  return parseTtrpgOpenRulePlanV1({ schema: 'storyforge.ttrpg-open-rule-plan', version: 1, request,
    epochKey: epoch.epochKey, rulePackContentHash: input.content.rulePack.contentHash, runtimeSourceHash: input.runtimeSourceHash,
    authorizationHash: await hashProductProductionValueV2(auth), mechanicalStateHash: await ttrpgOpenMechanicalStateHashV1(input.state),
    ...(interaction ? { interaction } : {}),rulePack, genericCheck, effectTemplates, timeCostWorldTurns, affectedActorKeys: [...affected], requiredApprovals,
    stageTimeLimit: { openedAtWorldTurn: run.stage.openedAtWorldTurn, maximumWorldTurns },
    ...(discoveryPlan ? { discoveryPlan } : {}),
    rollVisibility: runtime.product.hiddenDicePolicy === 'gm-only' || genericCheck?.audience === 'gm'
      || genericCheck?.audience.startsWith('actor:') ? 'gm-only' : 'public',
    skillValues: Object.fromEntries([...new Set([request.actorKey, ...(request.targetKey ? [request.targetKey] : [])])].map(actorKey => {
      const template = input.content.campaign.characterTemplates.find(template => template.characterKey === actorKey)
      const custom = runtime.product.characterCustomizations.find(custom => custom.characterKey === actorKey)
      return [actorKey, custom?.characterSheet.rules.skills[request.ruleKey] ?? template?.characterSheet.rules.skills[request.ruleKey] ?? template?.skills[request.ruleKey] ?? 0]
    })) })
}

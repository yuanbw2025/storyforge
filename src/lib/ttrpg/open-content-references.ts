import type { RulePackV2, TtrpgCampaignContentV2, TtrpgPredicateV1, TtrpgOpenScalar, TtrpgOpenEffectPrimitiveV1, TtrpgOpenEffectPlanTemplateV1, TtrpgOpenEntityKind, TtrpgSituationTemplateV1, TtrpgOpenAudience } from './open-contract'
import { parseTtrpgSessionFactV1, type TtrpgSessionFactV1 } from './session-facts'
import * as p from './open-contract-parse'
import type { TtrpgOpenApprovalActorV1, TtrpgOpenCompanionPolicyV1 } from './open-contract'
import { companionPolicy } from './open-content-templates'
import type { TtrpgOpenRuntimeEntityReferenceV1 } from './open-runtime-entity-references'

/** Static relationship only. Session Zero must still verify human control, claims and consent. */
export function validateTtrpgOpenApprovalBindingsV1(
  policy: TtrpgOpenCompanionPolicyV1,
  characters: readonly TtrpgOpenApprovalActorV1[],
): void {
  const parsed = companionPolicy(policy, 'companionPolicy')
  p.unique(characters.map(a => a.characterKey), 'approvalBindings.characterKeys')
  p.unique(characters.flatMap(a => a.seatKey === null ? [] : [a.seatKey]), 'approvalBindings.seatKeys')
  const actors = new Map(characters.map(a => [a.characterKey, a]))
  const seats = new Map(characters.flatMap(a => a.seatKey === null ? [] : [[a.seatKey, a] as const]))
  const companions = characters.filter(a => a.role === 'player' && (a.controller === 'ai' || a.controller === 'hybrid'))
  if (companions.length < parsed.minimumCompanions || companions.length > parsed.maximumCompanions) {
    p.fail('companionPolicy: 队友数量不匹配')
  }
  for (const binding of parsed.approvalBindings) {
    const companion = actors.get(binding.companionActorKey)
    if (!companion || companion.role !== 'player' || companion.seatKey === null
      || (companion.controller !== 'ai' && companion.controller !== 'hybrid')) {
      p.fail(`approvalBindings: companionActorKey 必须引用有席位的 AI/hybrid 玩家队友 ${binding.companionActorKey}`)
    }
    for (const seatKey of binding.approverSeatKeys) {
      const approver = seats.get(seatKey)
      if (!approver || approver.role !== 'player') p.fail(`approvalBindings: 未知或非玩家批准席位 ${seatKey}`)
      else if (approver.characterKey === binding.companionActorKey) p.fail(`approvalBindings: 队友不得自批 ${seatKey}`)
      else if (approver.controller !== 'human' && approver.controller !== 'hybrid') {
        p.fail(`approvalBindings: 批准者必须为 human/hybrid 玩家席位 ${seatKey}`)
      }
    }
  }
  const configured = new Set(parsed.approvalBindings.map(binding => binding.companionActorKey))
  if (companions.some(a => !configured.has(a.characterKey))) p.fail('approvalBindings: 正式 Campaign 必须覆盖每个 AI/hybrid 队友')
}

/** Cross-document references are checked only after every nested object was parsed. */
export function validateOpenContentReferences(c: TtrpgCampaignContentV2, rule: RulePackV2): void {
  validateReferences(c, rule)
}

/** A reference view includes retired identities for old accepted definitions, never current truth.
 * Every new definition must separately pass assertTtrpgOpenSituationUsesCurrentFactsV1. */
export function validateTtrpgOpenSessionSituationReferencesV1(input: {
  campaign: TtrpgCampaignContentV2; rule: RulePackV2; sessionTemplates: readonly TtrpgSituationTemplateV1[]; sessionFacts: readonly TtrpgSessionFactV1[];
  runtimeEntityReferences?: readonly TtrpgOpenRuntimeEntityReferenceV1[];
  /** Validate this new definition with only its current source identities, while keeping the
   * complete accepted-template directory for explicit next-template/evidence references. */
  onlySessionTemplateKey?: string;
}): void {
  const facts = input.sessionFacts.map(parseTtrpgSessionFactV1)
  p.unique(facts.map(f => f.factKey), 'session situation facts')
  if (facts.some(f => input.campaign.frozenWorldPredicateIndex.entries.some(original => original.factKey === f.factKey))) p.fail('session situation: 不得遮蔽冻结事实身份')
  // The original author content must remain valid without session instances. The additional map
  // only resolves session-owned definitions and never expands the frozen Campaign's bindings.
  if (input.runtimeEntityReferences?.length) validateReferences(input.campaign, input.rule)
  if (input.onlySessionTemplateKey && !input.sessionTemplates.some(row => row.templateKey === input.onlySessionTemplateKey)) p.fail('局势引用检查缺少实际新候选')
  validateReferences({ ...input.campaign, situationTemplates: [...input.campaign.situationTemplates, ...input.sessionTemplates] }, input.rule, facts, input.runtimeEntityReferences, input.onlySessionTemplateKey)
}

/** Historical reference resolution never lets a newly proposed definition revive a retired fact. */
export function assertTtrpgOpenSituationUsesCurrentFactsV1(t: TtrpgSituationTemplateV1, facts: readonly TtrpgSessionFactV1[]) {
  const retired = facts.filter(f => f.retired), active = facts.filter(f => !f.retired)
  if (!retired.length) return
  const keys = new Set(retired.map(f => f.factKey)), refs = [
    ...(t.driverBinding.kind === 'world-event' || t.driverBinding.kind === 'player-commitment' ? [t.driverBinding.factRef] : []),
    ...t.driverBeliefs.flatMap(b => b.factRef ? [b.factRef] : []), ...t.obstacles.flatMap(o => o.ref ? [o.ref] : []),
    ...t.evidence.flatMap(e => e.sourceFactRefs), ...t.sourceRefs, ...t.consequences.map(c => c.ref),
    ...t.whyNowRefs.filter(r => r.startsWith('session:')).map(r => r.slice('session:'.length)),
  ]
  if (refs.some(r => keys.has(r))) p.fail('新局势不能把已退休的会话事实作为当前依据')
  const check = (v: TtrpgPredicateV1): void => {
    if (v.op === 'all' || v.op === 'any') { v.of.forEach(check); return }
    if (v.op === 'not') { check(v.of); return }
    if (v.op === 'session-fact' && !active.some(f => f.subjectRef === v.subjectRef && f.predicateKey === v.predicateKey && f.objectRef === v.objectRef)
      && retired.some(f => f.subjectRef === v.subjectRef && f.predicateKey === v.predicateKey && f.objectRef === v.objectRef)) p.fail('新局势谓词不能把退休会话事实当作当前事实')
  }
  ;[...t.preconditions, ...t.obstacles.map(o => o.predicate), ...t.interventionPoints.flatMap(i => i.requiresPredicate ? [i.requiresPredicate] : []),
    ...t.evidence.flatMap(e => e.discoveryPolicy.preconditions)].forEach(check)
}

function validateReferences(c: TtrpgCampaignContentV2, rule: RulePackV2, sessionFacts: readonly TtrpgSessionFactV1[] = [], runtimeReferences: readonly TtrpgOpenRuntimeEntityReferenceV1[] = [], onlySessionTemplateKey?: string): void {
  const index = <T>(rows: T[], get: (r: T) => string, label: string) => {
    p.unique(rows.map(get), label)
    return new Map(rows.map(row => [get(row), row]))
  }
  const actors = index(c.characterTemplates, a => a.characterKey, 'characters')
  const bindings = index(c.entityBindings, a => a.bindingKey, 'entityBindings')
  p.unique(runtimeReferences.map(row => row.entityRef), 'session runtime reference identities')
  if (runtimeReferences.some(row => bindings.has(row.entityRef) || actors.has(row.entityRef))) p.fail('运行实例不得遮蔽冻结实体身份')
  const runtimeActors = new Map(runtimeReferences.filter(row => row.kind === 'actor').map(row => {
    const definition = actors.get(row.templateKey)
    if (!definition || definition.role !== 'npc') p.fail('运行角色引用缺少原冻结 NPC 定义')
    return [row.entityRef, definition] as const
  }))
  const actorKeys = new Set([...actors.keys(), ...runtimeActors.keys()])
  const locations = [...c.entityBindings.filter(b => b.kind === 'location').map(b => b.bindingKey), ...runtimeReferences.filter(row => row.kind === 'location').map(row => row.entityRef)]
  const items = [...c.entityBindings.filter(b => b.kind === 'item').map(b => b.bindingKey), ...runtimeReferences.filter(row => row.kind === 'item').map(row => row.entityRef)]
  const templates = index(c.dynamicEntityTemplates, a => a.templateKey, 'dynamicEntityTemplates')
  const plans = index(c.effectPlanTemplates, a => a.planKey, 'effectPlanTemplates')
  const situations = index(c.situationTemplates, a => a.templateKey, 'situationTemplates')
  const clocks = index(c.clocks, a => a.clockKey, 'clocks')
  const fronts = index(c.fronts, a => a.frontKey, 'fronts')
  const facts = index(c.frozenWorldPredicateIndex.entries, a => a.factKey, 'frozenWorldPredicateIndex')
  const sessionKeys = new Set(sessionFacts.map(f => f.factKey))
  const referenceFacts = new Map<string, { audience: TtrpgOpenAudience; knownByActorKeys: readonly string[] }>([
    ...facts, ...sessionFacts.map(f => [f.factKey, { audience: f.audience, knownByActorKeys: f.knownBy }] as const),
  ])
  const slotKey = (subject: string, predicate: string, object: string | null) => JSON.stringify([subject, predicate, object])
  const factSlots = index(c.frozenWorldPredicateIndex.entries, f => slotKey(f.subjectRef, f.predicateKey, f.objectRef), 'fact slots')
  const evidence = index(c.situationTemplates.flatMap(s => s.evidence), a => a.clueRef, 'evidence')
  const scenes = index(c.scenes, a => a.sceneKey, 'scenes')
  const secrets = index(c.secrets, a => a.secretKey, 'secrets')
  const quests = index(c.quests, a => a.questKey, 'quests')
  index(c.endings, a => a.endingKey, 'endings')
  index(c.handouts, a => a.handoutKey, 'handouts')
  index(c.advancementMilestones, a => a.milestoneKey, 'milestones')
  const telegraphs = index(c.fronts.flatMap(f => f.telegraph), a => a.telegraphKey, 'telegraphs')
  const actionKeys = rule.actions.map(a => a.key), checkKeys = rule.genericChecks.map(a => a.checkKey)
  const resources = new Set(c.frozenWorldPredicateIndex.entries.flatMap(f => f.sourceResourceRefs))
  for (const b of c.entityBindings) if (b.sourceResourceRef !== null) resources.add(b.sourceResourceRef)
  const entityRefs = new Set([...bindings.keys(), ...actors.keys(), ...runtimeReferences.map(row => row.entityRef)])
  const allRefs = new Set([c.campaignKey, ...entityRefs, ...resources, ...facts.keys(), ...sessionKeys, ...fronts.keys(), ...clocks.keys(), ...situations.keys(), ...secrets.keys(), ...evidence.keys()])
  const sourceRefs = new Set([...allRefs, rule.ruleSystemId, ...rule.compendium.map(r => r.key)])
  const abilityKeys = new Set(c.characterTemplates.flatMap(a => a.characterSheet.rules.abilityKeys))
  const allEffects = c.effectPlanTemplates.flatMap(t => [...t.effects, ...t.alternatives.flatMap(a => a.effects)])
  const socialKeys = new Set([
    ...rule.socialTierMappings.map(m => m.balanceKey),
    ...allEffects.flatMap(e => e.family === 'social' ? [e.socialKey] : []),
    ...c.frozenWorldPredicateIndex.entries.filter(f => f.owner === 'social-ledger').map(f => f.factKey),
  ])
  const storyKeys = new Set(allEffects.flatMap(e => e.family === 'story' && e.operation === 'quest.set' ? [e.storyKey] : []))
  const refs = (values: string[], known: Iterable<string>, label: string) => {
    // Map.keys() is a consumable iterator; materialize once for the whole list.
    const allowed = known instanceof Set ? known : new Set(known)
    values.forEach(k => p.known(k, allowed, label))
  }
  const audience = (a: string, knownBy: string[], label: string) => {
    p.recipients(a, knownBy, label); refs(knownBy, actors.keys(), label)
  }
  const effectAudience = (a: string, label: string) => { if (a.startsWith('actor:')) p.known(a.slice(6), actors.keys(), label) }
  const sources = (values: string[], label: string) => refs(values, sourceRefs, label)
  const planRef = (ref: string | null, label: string) => p.known(ref, plans.keys(), label)
  const valueType = (predicateKey: string, value: TtrpgOpenScalar, label: string) => {
    const policy = rule.factPolicy.find(f => f.predicateKey === predicateKey)
    if (!policy) return p.fail(`${label}: predicate-unresolvable`)
    if (policy.valueType === 'entity-ref') {
      if (typeof value !== 'string') p.fail(`${label}: entity-ref 必须是 key`)
      else p.known(value, entityRefs, label)
    } else if (typeof value !== policy.valueType) p.fail(`${label}: 值类型不匹配`)
  }
  function predicate(t: TtrpgPredicateV1, label: string, invariant = false): void {
    if (t.op === 'all' || t.op === 'any') { t.of.forEach(x => predicate(x, label, invariant)); return }
    if (t.op === 'not') { predicate(t.of, label, invariant); return }
    if (invariant && t.op !== 'world-fact') p.fail(`${label}: 不变量不得引用可变机械状态`)
    switch (t.op) {
      case 'world-fact':
      case 'session-fact': {
        p.known(t.subjectRef, allRefs, label)
        const policy = rule.factPolicy.find(f => f.predicateKey === t.predicateKey)
        if (!policy || (policy.cardinality === 'many') !== (t.objectRef !== null)) p.fail(`${label}: 多值槽必须携带 objectRef`)
        p.known(t.objectRef, allRefs, label)
        if (t.value !== undefined) valueType(t.predicateKey, t.value, label)
        if (t.op === 'world-fact') {
          const fact = factSlots.get(slotKey(t.subjectRef, t.predicateKey, t.objectRef))
          if (!fact) p.fail(`${label}: 未知冻结事实槽`)
          else if (invariant && fact.authority !== 'invariant') p.fail(`${label}: 初值不能声明为不变量`)
        } else if (policy?.authority.session === null) p.fail(`${label}: 未授权 session 谓词`)
        return
      }
      case 'evidence-known-by': p.known(t.clueRef, evidence.keys(), label); p.known(t.actorKey, actorKeys, label); return
      case 'clock-at-least': {
        const clock = clocks.get(t.clockKey)
        if (!clock || t.value > clock.maximum) p.fail(`${label}: 时钟引用/阈值不可满足`)
        return
      }
      case 'story-fact': p.known(t.factKey, storyKeys, label); return
      case 'actor-at': p.known(t.actorKey, actorKeys, label); p.known(t.locationRef, locations, label); return
      case 'item-held': p.known(t.actorKey, actorKeys, label); p.known(t.itemKey, items, label); return
      case 'ability-available': p.known(t.actorKey, actorKeys, label); p.known(t.abilityKey, (actors.get(t.actorKey) ?? runtimeActors.get(t.actorKey))?.characterSheet.rules.abilityKeys ?? [], label); return
      case 'resource-at-least': p.known(t.actorKey, actorKeys, label); p.known(t.resourceKey, rule.resources.map(r => r.key), label); return
      case 'social-balance-at-least': p.known(t.balanceKey, socialKeys, label); return
      case 'situation-active': p.known(t.templateKey, situations.keys(), label); return
      case 'front-stage-at-least': p.known(t.frontKey, fronts.keys(), label); p.known(t.stageKey, fronts.get(t.frontKey)?.escalationStages.map(s => s.stageKey) ?? [], label); return
      case 'world-turn-at-least': if (t.value > c.stageClosurePolicy.maximumWorldTurns) p.fail(`${label}: 回合阈值不可满足`); return
      case 'chaos-at-least': return
    }
  }
  for (const kind of ['actor', 'location', 'item']) if (c.entityBindings.filter(b => b.kind === kind).length > 1000) p.fail(`entityBindings: ${kind} 超过1000`)
  for (const b of c.entityBindings) {
    audience(b.audience, b.knownByActorKeys, b.bindingKey)
    p.known(b.initialLocationRef, locations, b.bindingKey)
    refs(b.initialInventoryRefs, items, b.bindingKey)
    if (b.kind === 'actor') {
      if (b.initialLocationRef === null) p.fail(`${b.bindingKey}: actor 必须具有可解析初始地点`)
      p.known(b.templateKey, actors.keys(), b.bindingKey)
      if (b.bindingKey !== b.templateKey) p.fail(`${b.bindingKey}: actor key 必须沿用角色模板 key`)
    } else if (b.kind === 'item') p.known(b.templateKey, rule.items.map(i => i.key), b.bindingKey)
    else if (b.templateKey !== b.bindingKey) p.fail(`${b.bindingKey}: location 的 templateKey 必须等于冻结地点 key`)
    b.sourceFieldRefs.forEach(f => p.known(f.resourceKey, resources, b.bindingKey))
  }
  for (const a of c.characterTemplates) {
    if (bindings.get(a.characterKey)?.kind !== 'actor') p.fail(`${a.characterKey}: 角色缺初始实体绑定`)
    sources(a.sourceRefs, a.characterKey)
    for (const m of Object.values(a.attributeMappings)) sources(m.sourceRefs, a.characterKey)
    sources(a.characterSheet.authoring.sourceRefs, a.characterKey)
    for (const b of a.characterSheet.identity.worldBindings) sources(b.sourceRefs, a.characterKey)
    for (const relationship of a.characterSheet.identity.relationships) p.known(relationship.targetRef, allRefs, a.characterKey)
    const inventoryDefinitions = (bindings.get(a.characterKey)?.initialInventoryRefs ?? []).map(k => bindings.get(k)?.templateKey)
    if (a.itemKeys.some(k => !inventoryDefinitions.includes(k)) || inventoryDefinitions.some(k => k === undefined || !a.itemKeys.includes(k))) p.fail(`${a.characterKey}: itemKeys/初始库存不一致`)
  }
  p.unique(c.entityBindings.flatMap(b => b.initialInventoryRefs), 'initialInventoryRefs: 物品不能同时属于两角色')
  if (!templates.size && rule.oracles.some(o => o.interpretation.maxNewEntities !== 0)) p.fail('Oracle maxNewEntities: 没有动态模板时必须为0')
  for (const t of c.dynamicEntityTemplates) {
    audience(t.audience, t.knownByActorKeys, t.templateKey); sources(t.sourceRefs, t.templateKey)
    if (t.characterTemplateKey !== null) {
      const actor = actors.get(t.characterTemplateKey)
      if (!actor || actor.role !== 'npc' || actor.controller !== 'gm' || actor.seatKey !== null) p.fail(`${t.templateKey}: 动态角色只允许冻结 NPC，不得创建真人席位`)
    }
    p.known(t.itemDefinitionKey, rule.items.map(i => i.key), t.templateKey)
  }
  for (const f of c.frozenWorldPredicateIndex.entries) {
    p.known(f.subjectRef, allRefs, f.factKey); p.known(f.objectRef, allRefs, f.factKey)
    audience(f.audience, f.knownByActorKeys, f.factKey); valueType(f.predicateKey, f.canonicalValue, f.factKey)
    const policy = rule.factPolicy.find(p => p.predicateKey === f.predicateKey)
    if (!policy || policy.authority[f.authority === 'invariant' ? 'invariant' : 'initialState'] !== f.owner) p.fail(`${f.factKey}: 权威映射不匹配`)
    if (policy && ((policy.cardinality === 'many') !== (f.objectRef !== null))) p.fail(`${f.factKey}: 多值事实必须包含 objectRef`)
    if (f.predicateKey === 'located-at') {
      p.known(String(f.canonicalValue), locations, f.factKey)
      if (bindings.get(f.subjectRef)?.initialLocationRef !== f.canonicalValue) p.fail(`${f.factKey}: 初始位置与实体绑定冲突`)
    }
    if (f.predicateKey === 'owns') {
      p.known(f.subjectRef, items, f.factKey); p.known(String(f.canonicalValue), actors.keys(), f.factKey)
      if (!bindings.get(String(f.canonicalValue))?.initialInventoryRefs.includes(f.subjectRef)) p.fail(`${f.factKey}: 初始持有者与库存冲突`)
    }
    if (f.owner !== 'semantic-fact' && !bindings.has(f.subjectRef)) p.fail(`${f.factKey}: 机械初值缺实体`)
    if (f.predicateKey === 'damaged' && typeof f.canonicalValue === 'number' && f.canonicalValue < 0) p.fail(`${f.factKey}: 损伤初值不得为负`)
    for (const opposite of policy?.mutuallyExclusiveWith ?? []) {
      if (f.canonicalValue === true && factSlots.get(slotKey(f.subjectRef, opposite, f.objectRef))?.canonicalValue === true) p.fail(`${f.factKey}: 互斥事实`)
    }
  }
  function invariantSatisfied(t: TtrpgPredicateV1): boolean {
    if (t.op === 'all') return t.of.every(invariantSatisfied)
    if (t.op === 'any') return t.of.some(invariantSatisfied)
    if (t.op === 'not') return !invariantSatisfied(t.of)
    if (t.op !== 'world-fact') return p.fail('canonInvariantPredicates: 非冻结语义谓词')
    const fact = factSlots.get(slotKey(t.subjectRef, t.predicateKey, t.objectRef))
    return fact !== undefined && (t.value === undefined || t.value === fact.canonicalValue)
  }
  c.canonInvariantPredicates.forEach(t => {
    predicate(t, 'canonInvariantPredicates', true)
    if (!invariantSatisfied(t)) p.fail('canonInvariantPredicates: 与冻结不变量冲突')
  })
  function target(ref: string, template: TtrpgOpenEffectPlanTemplateV1, kinds: TtrpgOpenEntityKind[]): void {
    if (ref.startsWith('parameter:')) {
      const parameter = template.parameters.find(p => p.parameterKey === ref.slice(10))
      if (!parameter || parameter.entityKinds.some(k => !kinds.includes(k))) p.fail(`${template.planKey}: 未声明或类型错误的参数槽 ${ref}`)
    } else {
      const binding = bindings.get(ref)
      if (!binding || !kinds.includes(binding.kind)) p.fail(`${template.planKey}: 无效实体目标 ${ref}`)
    }
  }
  function effect(e: TtrpgOpenEffectPrimitiveV1, template: TtrpgOpenEffectPlanTemplateV1): void {
    target(e.targetRef, template, e.family === 'story' ? ['actor', 'location', 'item'] : ['actor'])
    switch (e.family) {
      case 'numeric':
        p.known(e.valueKey, rule.resources.map(r => r.key), e.effectKey)
        if (e.operation !== 'resource.set' && e.operation !== 'currency' && e.amount < 0) p.fail(`${e.effectKey}: 负数效果量`)
        break
      case 'condition': p.known(e.conditionKey, rule.conditions.map(r => r.key), e.effectKey); break
      case 'item':
        p.known(e.itemDefinitionRef, rule.items.map(r => r.key), e.effectKey)
        if (e.itemInstanceRef) target(e.itemInstanceRef, template, ['item'])
        if (e.destinationRef) target(e.destinationRef, template, ['actor'])
        break
      case 'ability': p.known(e.abilityKey, abilityKeys, e.effectKey); p.known(e.clockRef, clocks.keys(), e.effectKey); break
      case 'advancement': p.known(e.advancementKey, [...c.advancementMilestones.map(m => m.milestoneKey), ...rule.attributes.map(a => a.key), ...rule.characterSheetUi.sections.flatMap(s => s.fieldKeys), rule.advancement.currencyKey], e.effectKey); break
      case 'social': p.known(e.socialKey, socialKeys, e.effectKey); break
      case 'story':
        if (e.operation === 'location.set') {
          target(e.targetRef, template, ['actor']); p.known(e.storyKey, locations, e.effectKey)
          if (e.value !== e.storyKey) p.fail(`${e.effectKey}: location.set 的 value 必须等于冻结地点 storyKey`)
        }
        if (e.operation === 'secret.reveal') p.known(e.storyKey, secrets.keys(), e.effectKey)
        if (e.operation === 'quest.set') p.known(e.storyKey, quests.keys(), e.effectKey)
        if (e.operation === 'world-fact.candidate') p.known(e.storyKey, facts.keys(), e.effectKey)
        break
      case 'knowledge': p.known(e.evidenceRef, evidence.keys(), e.effectKey); break
    }
  }
  for (const t of c.effectPlanTemplates) {
    effectAudience(t.audience, t.planKey)
    p.known(t.ruleRef, [rule.ruleSystemId, ...actionKeys, ...rule.checks.map(k => k.key), ...rule.oracles.map(o => o.oracleKey)], t.planKey)
    for (const param of t.parameters) {
      for (const ref of param.allowedRefs) target(ref, { ...t, parameters: [] }, param.entityKinds)
      for (const ref of param.allowDynamicFromTemplateKeys) {
        const definition = templates.get(ref)
        if (!definition || !param.entityKinds.includes(definition.kind)) p.fail(`${t.planKey}: 动态参数模板/类型无效`)
      }
    }
    t.effects.forEach(e => effect(e, t))
    t.alternatives.forEach(a => a.effects.forEach(e => effect(e, t)))
  }
  for (const interaction of rule.interactionBindings ?? []) {
    interaction.preconditions.forEach(t => predicate(t,interaction.interactionKey))
    planRef(interaction.effectPlanRef,interaction.interactionKey)
    if (interaction.effectPlanRef !== null && plans.get(interaction.effectPlanRef)?.degree !== 'success') p.fail(`${interaction.interactionKey}: no-roll 互动只引用确定成功模板`)
    if (interaction.kind === 'move' || interaction.kind === 'retreat') {
      const plan = plans.get(interaction.effectPlanRef!)!
      const choices = plan.alternatives.length ? plan.alternatives.map(a => a.effects) : [plan.effects]
      if (choices.some(effects => !effects.some(e => e.family === 'story' && e.operation === 'location.set'))) p.fail(`${interaction.interactionKey}: 移动/撤退必须有真实位置后果`)
    }
  }
  for (const check of rule.genericChecks) {
    effectAudience(check.audience, check.checkKey)
    check.preconditions.forEach(t => predicate(t, check.checkKey))
    refs(check.riskFactRefs, facts.keys(), check.checkKey); sources(check.sourceRefs, check.checkKey)
    for (const [degree, ref] of Object.entries(check.effectPlanByDegree)) {
      planRef(ref, check.checkKey)
      if (ref !== null && plans.get(ref)?.degree !== degree) p.fail(`${check.checkKey}: 七档效果 degree 不匹配`)
    }
  }
  for (const oracle of rule.oracles) sources(oracle.sourceRefs, oracle.oracleKey)
  for (const clock of c.clocks) {
    sources(clock.sourceRefs, clock.clockKey); planRef(clock.onCompleteEffectPlanRef, clock.clockKey)
    for (const trigger of clock.advanceTriggers) {
      p.known(trigger.actionKey, actionKeys, clock.clockKey)
      if (trigger.condition) predicate(trigger.condition, clock.clockKey)
    }
  }
  for (const front of c.fronts) {
    sources(front.sourceRefs, front.frontKey); refs(front.participantKeys, actors.keys(), front.frontKey); refs(front.clockKeys, clocks.keys(), front.frontKey)
    for (const stage of front.escalationStages) {
      const maximum = clocks.get(stage.clockKey)?.maximum
      if (maximum === undefined || stage.atClockValue > maximum) p.fail(`${front.frontKey}: stage 阈值超过时钟`)
      planRef(stage.effectPlanRef, front.frontKey); p.known(stage.newSituationTemplateKey, situations.keys(), front.frontKey)
    }
    front.telegraph.forEach(t => p.known(t.mediaSlotKey, c.mediaManifest.slots.map(s => s.slotKey), t.telegraphKey))
    front.defeatPredicates.forEach(t => predicate(t, front.frontKey))
  }
  for (const s of c.situationTemplates) {
    if (onlySessionTemplateKey && s.templateKey !== onlySessionTemplateKey) continue
    sources(s.sourceRefs, s.templateKey)
    const driver = s.driverBinding
    if (driver.kind === 'npc' && (actors.get(driver.characterKey) ?? runtimeActors.get(driver.characterKey))?.role !== 'npc') p.fail(`${s.templateKey}: driver 必须是 NPC`)
    if (driver.kind === 'front') p.known(driver.frontKey, fronts.keys(), s.templateKey)
    if (driver.kind === 'world-event' || driver.kind === 'player-commitment') p.known(driver.factRef, referenceFacts.keys(), s.templateKey)
    s.driverBeliefs.forEach(b => p.known(b.factRef, allRefs, s.templateKey))
    s.preconditions.forEach(t => predicate(t, s.templateKey))
    s.obstacles.forEach(o => { p.known(o.ref, allRefs, o.obstacleKey); predicate(o.predicate, o.obstacleKey) })
    for (const point of s.interventionPoints) {
      audience(point.visibleTo, point.knownByActorKeys, point.pointKey)
      refs(point.suggestedActionKeys, actionKeys, point.pointKey)
      if (point.requiresPredicate) predicate(point.requiresPredicate, point.pointKey)
    }
    for (const e of s.evidence) {
      audience(e.audience, e.knownByActorKeys, e.clueRef)
      refs(e.sourceFactRefs, referenceFacts.keys(), e.clueRef); refs(e.sourceResourceRefs, resources, e.clueRef)
      const visibility = { public: 0, party: 1, private: 2, 'gm-only': 3 }
      for (const sourceRef of e.sourceFactRefs) {
        const source = referenceFacts.get(sourceRef)
        if (source && (visibility[e.audience] < visibility[source.audience]
          || (source.audience === 'private' && e.audience === 'private' && e.knownByActorKeys.some(k => !source.knownByActorKeys.includes(k))))) {
          p.fail(`${e.clueRef}: 初始 evidence 受众不得降低来源密级或扩大 private 接收者`)
        }
      }
      const d = e.discoveryPolicy
      audience(d.allowedAudience, d.recipientActorKeys, e.clueRef)
      d.preconditions.forEach(t => predicate(t, e.clueRef))
      for (const path of d.paths) {
        p.known(path.key, path.kind === 'action' ? actionKeys : checkKeys, e.clueRef)
        if (path.kind === 'action' && !s.interventionPoints.find(i => i.pointKey === path.interventionPointKey)?.suggestedActionKeys.includes(path.key)) p.fail(`${e.clueRef}: discovery path 未绑定介入行动`)
      }
      planRef(d.failForwardEffectPlanRef, e.clueRef); planRef(d.costEffectPlanRef, e.clueRef)
    }
    for (const ref of s.whyNowRefs) {
      const colon = ref.indexOf(':'), prefix = ref.slice(0, colon), key = ref.slice(colon + 1)
      if (prefix === 'world') {
        // Use the same immutable subject/predicate reference as S9 and I2 at runtime.
        p.known(key, new Set(c.frozenWorldPredicateIndex.entries.map(f => `${f.subjectRef}:${f.predicateKey}`)), `${s.templateKey}.whyNowRefs`)
      }
      else if (prefix === 'clock') p.known(key, clocks.keys(), s.templateKey)
      else if (prefix === 'telegraph') p.known(key, telegraphs.keys(), s.templateKey)
      else if (prefix === 'session' && sessionFacts.length) p.known(key, sessionKeys, s.templateKey)
      else p.fail(`${s.templateKey}: 冻结内容不能引用未提交 session 来源或未知 whyNow 前缀`)
    }
    planRef(s.noInterventionOutcome.effectPlanRef, s.templateKey)
    refs(s.noInterventionOutcome.advancesClockKeys, clocks.keys(), s.templateKey)
    for (const consequence of s.consequences) {
      p.known(consequence.ref, consequence.scope === 'actor' ? actors.keys() : consequence.scope === 'location' ? locations : allRefs, s.templateKey)
      planRef(consequence.effectPlanRef, s.templateKey); p.known(consequence.nextSituationTemplateKey, situations.keys(), s.templateKey)
    }
  }
  refs(c.openingSituationKeys, situations.keys(), 'openingSituationKeys')
  for (const t of c.stageClosurePolicy.triggers) predicate(t.predicate, t.triggerKey)
  for (const { trigger } of c.contextPolicy?.triggers ?? []) {
    for (const actorKey of trigger.knownByActorKeys) p.known(actorKey, new Set([...actors.keys(), 'gm']), trigger.triggerKey)
    if (trigger.predicate) predicate(trigger.predicate, trigger.triggerKey)
  }
  if (c.runtimePolicy.maximumCallsPerEpoch > c.companionPolicy.maximumCompanions + 4 || c.runtimePolicy.maxAiActions > c.companionPolicy.maximumCompanions) p.fail('runtimePolicy: 超过队友数+4预算/队友动作上限')
  validateTtrpgOpenApprovalBindingsV1(c.companionPolicy, c.characterTemplates)
  p.known(c.openingSceneKey, scenes.keys(), 'openingSceneKey')
  if (!c.scenes.length && c.openingSceneKey !== null) p.fail('openingSceneKey: 空 scene 不得伪造入口')
  for (const s of c.scenes) {
    p.known(s.locationKey, locations, s.sceneKey); refs(s.participantKeys, actors.keys(), s.sceneKey)
    refs(s.clueKeys, evidence.keys(), s.sceneKey); refs(s.actionKeys, actionKeys, s.sceneKey); refs(s.nextSceneKeys, scenes.keys(), s.sceneKey)
    p.known(s.tabletopMapKey, c.tabletop?.maps.map(m => m.mapKey) ?? [], s.sceneKey); sources(s.sourceRefs, s.sceneKey)
  }
  for (const e of c.endings) {
    p.known(e.trigger.sceneKey, scenes.keys(), e.endingKey)
    refs([...e.trigger.requiredConclusionKeys, ...e.trigger.forbiddenConclusionKeys], evidence.keys(), e.endingKey)
  }
  c.quests.forEach(q => refs(q.requiredConclusionKeys, evidence.keys(), q.questKey))
  c.handouts.forEach(h => p.known(h.revealClueKey, evidence.keys(), h.handoutKey))
  for (const s of c.secrets) { refs(s.holderKeys, actors.keys(), s.secretKey); refs(s.relatedClueKeys, evidence.keys(), s.secretKey); sources(s.sourceRefs, s.secretKey) }
  for (const map of c.tabletop?.maps ?? []) for (const token of map.tokens) {
    p.known(token.entityKey, entityRefs, token.tokenKey); p.known(token.controllerKey, actors.keys(), token.tokenKey)
  }
  for (const slot of c.mediaManifest.slots) {
    if (slot.audience === 'private') p.known(slot.targetRef, actors.keys(), slot.slotKey)
  }
  sources(c.bible.sourceRefs, 'bible.sourceRefs')
}

import type {
  TextOpenWorldActionDefinitionV1,
  TextOpenWorldConditionExpressionV1,
  TextOpenWorldConditionDefinitionV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldQuestDesignDocumentsV1,
  TextOpenWorldQuestFulfillmentSelectionsV1,
} from '../types'
import { resolveTextOpenWorldVendorServiceV1 } from './npc-runtime-catalog-production'
import type { TextOpenWorldQuestFinalizeInputContextV1 } from './quest-finalize-production'

type Context = TextOpenWorldQuestFinalizeInputContextV1
type Selections = TextOpenWorldQuestFulfillmentSelectionsV1
type Candidate = {
  candidateNumber: number
  kind: 'recipe' | 'interaction' | 'purchase' | 'teaching' | 'skill' | 'dialogue'
  key: string; title: string; actionKey: string; locationKeys: string[]
  actorKey?: string; skillKey?: string; itemKey?: string; vendorKeys?: string[]
}
function actionEvidence(context: Context) { return context.objectiveEvidenceContract === 'action-paths-v2' }
function extraCandidates(context: Context, objective: Context['questSkeletons']['objectives'][number]): Omit<Candidate, 'candidateNumber'>[] {
  if (!actionEvidence(context)) return []
  const fulfills = (item: { fulfilledRequirementKeys: string[] }) => item.fulfilledRequirementKeys.some(key => objective.requirementKeys.includes(key))
  const result: Omit<Candidate, 'candidateNumber'>[] = []
  if (objective.playerIntent === 'trade') for (const vendor of context.craftingEconomyCatalog.vendors.filter(fulfills)) {
    const service = resolveTextOpenWorldVendorServiceV1(context.npcRuntimeCatalog, { ...vendor, actorRequirementKey: vendor.runtimeBinding.actorRequirementKey })
    for (const item of context.itemRewardCatalog.items.filter(item => fulfills(item) && vendor.inventoryEntries.some(entry => entry.itemKey === item.key))) result.push({
      kind: 'purchase', key: `${vendor.key}.${item.key}`, title: `向${vendor.title}购买${item.title}`,
      actionKey: `action.buy.${vendor.key}`, locationKeys: [vendor.locationKey], itemKey: item.key,
      vendorKeys: [vendor.key, ...(service.replacement ? [`vendor.replacement.${vendor.key}`] : [])],
    })
  }
  const actors = context.npcRuntimeCatalog.actors.filter(fulfills)
  const skills = context.progressionCatalogs.skills.filter(fulfills)
  if (['interact', 'dialogue'].includes(objective.playerIntent) && skills.length) for (const skill of skills) {
    if (!actors.length) result.push({ kind: 'skill', key: skill.key, title: `已学会${skill.title}`, actionKey: '', locationKeys: [], skillKey: skill.key })
    else for (const actor of actors) result.push({ kind: 'teaching', key: `${objective.key}.${actor.key}.${skill.key}`,
      title: `向${actor.name}请教${skill.title}`, actionKey: `action.teach.${objective.key}.${actor.key}.${skill.key}`,
      locationKeys: [actor.homeLocationKey], actorKey: actor.key, skillKey: skill.key })
  } else if (objective.playerIntent === 'dialogue') for (const actor of actors) result.push({
    kind: 'dialogue', key: `${objective.key}.${actor.key}`, title: `与${actor.name}核对此任务`,
    actionKey: `action.dialogue.${objective.key}.${actor.key}`, locationKeys: [actor.homeLocationKey], actorKey: actor.key,
  })
  return result
}

function fail(message: string): never { throw new Error(`[text-open-world-objective-fulfillment] ${message}`) }
function row(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  const result = value as Record<string, unknown>
  if (Object.keys(result).sort().join(',') !== [...fields].sort().join(',')) fail(`${label}字段不精确`)
  return result
}
function list(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label}超过数组边界`)
  return value
}
function integer(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) fail(`${label}编号或数量越界`)
  return Number(value)
}
function sorted(values: number[], label: string): number[] {
  if (values.some((value, index) => index > 0 && value <= values[index - 1]!)) fail(`${label}必须严格升序且不重复`)
  return values
}
function proofFlag(kind: Candidate['kind'], key: string): string {
  return `flag.fulfillment.${kind}.${key}`
}

/** Selection candidates come only from the frozen content requirements. */
export function buildTextOpenWorldObjectiveFulfillmentDemandsV1(context: Context) {
  return context.questSkeletons.objectives.flatMap((objective, index) => {
    const quest = context.questSkeletons.quests.find(item => item.key === objective.questKey)!
    if (quest.type === 'template') return []
    const fulfills = (item: { fulfilledRequirementKeys: string[] }) => item.fulfilledRequirementKeys
      .some(key => objective.requirementKeys.includes(key))
    const candidates: Candidate[] = [
      ...context.craftingEconomyCatalog.recipes.filter(fulfills).map(recipe => ({
        kind: 'recipe' as const, key: recipe.key, title: recipe.title,
        actionKey: `action.craft.${recipe.key}`, locationKeys: recipe.stationLocationKeys,
      })),
      ...context.mapInteractionCatalog.interactions.filter(fulfills).map(interaction => ({
        kind: 'interaction' as const, key: interaction.key, title: interaction.playerPrompt,
        actionKey: `action.interaction.${interaction.key}`, locationKeys: [interaction.locationKey],
      })),
      ...extraCandidates(context, objective),
    ].map((candidate, candidateIndex) => ({ candidateNumber: candidateIndex + 1, ...candidate }))
    return [{
      objectiveNumber: index + 1, objectiveKey: objective.key, questKey: quest.key,
      playerIntent: objective.playerIntent, title: objective.title, candidates,
      itemNumbers: context.itemRewardCatalog.items.flatMap((item, itemIndex) => fulfills(item) ? [itemIndex + 1] : []),
    }]
  })
}

/** Lossless prompt projection; the frozen Context and candidate numbering are unchanged. */
export function projectTextOpenWorldObjectiveFulfillmentTableV1(context: Context) {
  const objectiveFields = ['objectiveNumber', 'objectiveKey', 'questKey', 'playerIntent', 'title', 'candidates', 'itemNumbers'] as const
  const candidateFields = ['candidateNumber', 'kind', 'key', 'title', 'actionKey', 'locationKeys', 'actorKey', 'skillKey', 'itemKey', 'vendorKeys'] as const
  return {
    format: 'objective-fulfillment-table-v1', objectiveFields, candidateFields,
    rows: buildTextOpenWorldObjectiveFulfillmentDemandsV1(context).map(demand => objectiveFields.map(field => field === 'candidates'
      ? demand.candidates.map(candidate => candidateFields.map(key => candidate[key] ?? null))
      : demand[field])),
  }
}

export function parseTextOpenWorldQuestFulfillmentSelectionsV1(value: unknown, context: Context): Selections {
  const root = row(value, ['version', 'objectives', 'interactions', 'endings'], 'fulfillmentSelections')
  const modern = actionEvidence(context)
  if (root.version !== (modern ? 2 : 1)) fail('fulfillmentSelections.version无效')
  const itemRows = (value: unknown, consume: boolean | null, label: string) => {
    const parsed = list(value, 8, label).map((value, index) => {
      const item = row(value, consume === null ? ['itemNumber', 'quantity', 'consume'] : ['itemNumber', 'quantity'], `${label}[${index}]`)
      const itemNumber = integer(item.itemNumber, context.itemRewardCatalog.items.length, label)
      const definition = context.itemRewardCatalog.items[itemNumber - 1]!
      const willConsume = consume ?? item.consume
      if (typeof willConsume !== 'boolean') fail(`${label}.consume必须为布尔值`)
      if (willConsume && (definition.critical || (definition.stackPolicy !== 'stacked' && (!modern || definition.unique || definition.kind !== 'equipment')))) fail(`${label}不能消耗关键物品、唯一装备或旧合同实例装备`)
      return { itemNumber, quantity: integer(item.quantity, definition.maximumStack ?? 1, label), consume: willConsume }
    })
    sorted(parsed.map(item => item.itemNumber), label)
    return parsed
  }
  const demands = buildTextOpenWorldObjectiveFulfillmentDemandsV1(context)
  const objectiveRows = list(root.objectives, demands.length, 'fulfillmentSelections.objectives')
  if (objectiveRows.length !== demands.length) fail('固定目标完成证据必须精确覆盖，不能包含模板实例')
  const objectives = objectiveRows.map((value, index) => {
    const selection = row(value, ['objectiveNumber', 'anyActionGroups', 'items', ...(modern ? ['groupItems'] : [])], `fulfillmentSelections.objectives[${index}]`)
    const demand = demands[index]!
    if (selection.objectiveNumber !== demand.objectiveNumber) fail('固定目标证据顺序无效')
    const anyActionGroups = list(selection.anyActionGroups, 4, 'anyActionGroups').map(value => {
      const group = sorted(list(value, 8, 'action group').map(value => integer(value, demand.candidates.length, 'action candidate')), 'action group')
      if (!group.length) fail('操作证据替代组不能为空')
      if (demand.playerIntent === 'craft' && !group.some(number => demand.candidates[number - 1]!.kind === 'recipe')) {
        fail('制作目标每条路径必须含真实制作证据')
      }
      if (modern) {
        const requiredKind = demand.playerIntent === 'trade' ? 'purchase'
          : demand.candidates.some(candidate => candidate.kind === 'teaching') ? 'teaching'
          : demand.candidates.some(candidate => candidate.kind === 'skill') ? 'skill'
          : demand.playerIntent === 'dialogue' && demand.candidates.some(candidate => candidate.kind === 'dialogue') ? 'dialogue' : null
        if (requiredKind && !group.some(number => demand.candidates[number - 1]!.kind === requiredKind)) fail('每条路径必须包含匹配的真实交易、教学或对话证据')
      }
      return group
    })
    if (new Set(anyActionGroups.map(group => group.join(','))).size !== anyActionGroups.length) fail('操作证据替代组不能重复')
    if ((demand.playerIntent === 'craft' || demand.candidates.some(candidate => candidate.kind === 'interaction')) && !anyActionGroups.length) {
      fail('制作或地点交互目标不能跳过实际操作证据')
    }
    if (modern && ['trade', 'dialogue'].includes(demand.playerIntent) && !anyActionGroups.length) fail(`交易或对话目标不能跳过实际操作:${demand.objectiveKey}（${demand.title}）`)
    if (modern && demand.candidates.some(candidate => ['teaching', 'skill'].includes(candidate.kind)) && !anyActionGroups.length) fail('技能目标不能跳过实际学习')
    const groupItems = modern ? list(selection.groupItems, 4, 'groupItems').map(value => itemRows(value, false, 'groupItems').map(({ itemNumber, quantity }) => ({ itemNumber, quantity }))) : undefined
    if (groupItems && (groupItems.length !== anyActionGroups.length || groupItems.flat().some(item => !demand.itemNumbers.includes(item.itemNumber)))) fail('路径物品必须逐组对应并来自目标需求')
    const items = itemRows(selection.items, null, 'objective items')
    if (items.some(item => !demand.itemNumbers.includes(item.itemNumber))) fail('目标物品必须来自该目标的冻结需求')
    if (demand.playerIntent === 'collect' && !items.length) fail('收集目标必须核验实际持有物品')
    return { objectiveNumber: demand.objectiveNumber, anyActionGroups, ...(groupItems ? { groupItems } : {}), items }
  })
  const interactionRows = list(root.interactions, context.mapInteractionCatalog.interactions.length, 'fulfillmentSelections.interactions')
  if (interactionRows.length !== context.mapInteractionCatalog.interactions.length) fail('交互结算必须逐项覆盖')
  const interactions = interactionRows.map((value, index) => {
    const selection = row(value, ['interactionNumber', 'consumedItems'], `fulfillmentSelections.interactions[${index}]`)
    if (selection.interactionNumber !== index + 1) fail('交互结算顺序无效')
    const consumedItems = itemRows(selection.consumedItems, true, 'interaction consumedItems')
      .map(({ itemNumber, quantity }) => ({ itemNumber, quantity }))
    const definition = context.mapInteractionCatalog.interactions[index]!
    const consumerRequirements = new Set(context.questSkeletons.objectives
      .filter(objective => objective.requirementKeys.some(key => definition.fulfilledRequirementKeys.includes(key)))
      .flatMap(objective => objective.requirementKeys))
    if (modern && consumedItems.some(item => !context.itemRewardCatalog.items[item.itemNumber - 1]!.fulfilledRequirementKeys
      .some(key => consumerRequirements.has(key)))) fail('交互消耗必须来自该交互消费者的冻结物品需求')
    if (consumedItems.length && definition.questConsumerKeys.some(key => context.questSkeletons.quests.some(quest => quest.key === key && quest.type === 'template'))) {
      fail('重复模板不能消费全局一次性修复证据')
    }
    return { interactionNumber: index + 1, consumedItems }
  })
  if (modern) objectives.forEach((selection, index) => {
    const demand = demands[index]!
    selection.anyActionGroups.forEach((group, groupIndex) => {
      const consumed = new Set(group.flatMap(number => {
        const candidate = demand.candidates[number - 1]!
        if (candidate.kind !== 'interaction') return []
        const interactionIndex = context.mapInteractionCatalog.interactions.findIndex(item => item.key === candidate.key)
        return interactions[interactionIndex]!.consumedItems.map(item => item.itemNumber)
      }))
      if ([...selection.items, ...(selection.groupItems?.[groupIndex] ?? [])].some(item => consumed.has(item.itemNumber))) {
        fail('同一路径的交互已消耗物品，目标不能再次要求持有或重复交付')
      }
    })
  })
  const endingRows = list(root.endings, context.mainlineThread.endingRoutes.length, 'fulfillmentSelections.endings')
  if (endingRows.length !== context.mainlineThread.endingRoutes.length) fail('结局操作证据必须逐项声明')
  const endings = endingRows.map((value, index) => {
    const selection = row(value, ['endingNumber', 'requiredInteractionNumbers'], `fulfillmentSelections.endings[${index}]`)
    if (selection.endingNumber !== index + 1) fail('结局证据顺序无效')
    const requiredInteractionNumbers = sorted(list(selection.requiredInteractionNumbers, 8, 'ending interactions')
      .map(value => integer(value, interactions.length, 'ending interaction')), 'ending interactions')
    return { endingNumber: index + 1, requiredInteractionNumbers }
  })
  return { version: modern ? 2 : 1, objectives, interactions, endings }
}

/** Extends the generated graph, never mutable runtime state. The existing
 * atomic Effect batch owns material consumption and the success proof. */
export function compileTextOpenWorldObjectiveFulfillmentV1(input: {
  context: Context
  selections: Selections
  conditions: TextOpenWorldConditionDefinitionV1[]
  effects: TextOpenWorldEffectDefinitionV1[]
  actions: TextOpenWorldActionDefinitionV1[]
  objectives: TextOpenWorldQuestDesignDocumentsV1['objectives']
  interactions: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['interactions']
  endings: TextOpenWorldQuestDesignDocumentsV1['endingBindings']['routes']
  actors?: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['actors']
}): void {
  const { context, selections, conditions, effects, actions } = input
  const action = (key: string) => actions.find(item => item.key === key) ?? fail(`操作不存在:${key}`)
  const appendCondition = (owner: TextOpenWorldActionDefinitionV1, condition: TextOpenWorldConditionDefinitionV1) => {
    if (conditions.some(item => item.key === condition.key)) fail(`条件重复:${condition.key}`)
    conditions.push(condition)
    owner.requirementConditionKeys = [...owner.requirementConditionKeys, condition.key]
  }
  const proof = (kind: Candidate['kind'], key: string, owner: TextOpenWorldActionDefinitionV1) => {
    const effectKey = `effect.fulfillment.${kind}.${key}`
    effects.push({ key: effectKey, operation: 'set-world-flag', payload: { flagKey: proofFlag(kind, key), value: true } })
    owner.successEffectKeys.push(effectKey)
  }
  const requireItems = (owner: TextOpenWorldActionDefinitionV1, items: Array<{ itemNumber: number; quantity: number; consume: boolean }>) => {
    items.forEach(item => {
      const definition = context.itemRewardCatalog.items[item.itemNumber - 1]!
      appendCondition(owner, {
        key: `condition.fulfillment.${owner.key}.${definition.key}`,
        expression: { op: 'inventory-quantity', itemKey: definition.key, comparator: 'gte', value: item.quantity },
        failureMessage: `需要持有${item.quantity}份${definition.title}。`,
      })
      if (item.consume) {
        const key = `effect.fulfillment.${owner.key}.consume.${definition.key}`
        effects.push({ key, operation: 'remove-item', payload: { itemKey: definition.key, quantity: item.quantity, reason: 'fulfillment' } })
        owner.costEffectKeys.push(key)
      }
    })
  }
  context.craftingEconomyCatalog.recipes.forEach(recipe => proof('recipe', recipe.key, action(`action.craft.${recipe.key}`)))
  selections.interactions.forEach(selection => {
    const definition = context.mapInteractionCatalog.interactions[selection.interactionNumber - 1]!
    const owner = action(`action.interaction.${definition.key}`)
    requireItems(owner, selection.consumedItems.map(item => ({ ...item, consume: true })))
    if (selection.consumedItems.length) appendCondition(owner, {
      key: `condition.fulfillment.${definition.key}.unsettled`,
      expression: { op: 'not', condition: { op: 'world-flag', flagKey: proofFlag('interaction', definition.key), value: true } },
      failureMessage: '这项实体修复已经结算，无需再次消耗材料。',
    })
    proof('interaction', definition.key, owner)
    const binding = input.interactions.find(item => item.interactionKey === definition.key)!
    binding.conditionKeys = [...owner.requirementConditionKeys]
    binding.effectKeys = [...owner.costEffectKeys, ...owner.successEffectKeys]
  })
  if (selections.version === 2) actions.filter(owner => owner.category === 'buy').forEach(owner => {
    const transaction = effects.find(effect => owner.successEffectKeys.includes(effect.key) && effect.operation === 'perform-transaction')
    if (transaction?.operation !== 'perform-transaction') fail('购买操作缺少真实交易Effect')
    const key = `effect.fulfillment.purchase.${transaction.payload.vendorKey}`
    effects.push({ key, operation: 'prove-purchase', payload: { vendorKey: transaction.payload.vendorKey } })
    owner.successEffectKeys.push(key)
  })
  const demands = buildTextOpenWorldObjectiveFulfillmentDemandsV1(context)
  selections.objectives.forEach((selection, index) => {
    const demand = demands[index]!
    const objective = input.objectives.find(item => item.key === demand.objectiveKey)!
    const owner = action(objective.completionActionKey)
    if (selections.version === 2) requireItems(owner, selection.items)
    const selected = [...new Set(selection.anyActionGroups.flat())].map(number => demand.candidates[number - 1]!)
    if (selections.version === 2) selected.filter(candidate => candidate.kind === 'teaching' || candidate.kind === 'dialogue').forEach(candidate => {
      const conditionKey = `condition.fulfillment.actor.${candidate.key}`
      conditions.push({ key: conditionKey, expression: { op: 'all', conditions: [
        { op: 'actor-boolean', actorKey: candidate.actorKey!, field: 'alive', value: true },
        { op: 'actor-boolean', actorKey: candidate.actorKey!, field: 'present', value: true },
        ...context.questSkeletons.objectives.filter(other => other.stageKey === objective.stageKey && other.order < objective.order && !other.optional)
          .map(other => ({ op: 'quest-objective' as const, objectiveKey: other.key, status: 'completed' as const })),
      ] }, failureMessage: '需要在此处与任务指定的人物交谈。' })
      const teaching: TextOpenWorldActionDefinitionV1 = { ...structuredClone(owner), key: candidate.actionKey,
        category: 'talk', label: candidate.title, description: candidate.title, targetScope: 'actor', locationKeys: candidate.locationKeys,
        requirementConditionKeys: [...owner.requirementConditionKeys, conditionKey], costEffectKeys: [], successEffectKeys: [], failureEffectKeys: [],
        timeCostMinutes: 0, confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null }
      if (candidate.kind === 'teaching') {
        const key = `effect.teach.${candidate.key}`
        effects.push({ key, operation: 'learn-skill', payload: { skillKey: candidate.skillKey!, ifUnknown: true } })
        teaching.successEffectKeys.push(key)
      }
      proof(candidate.kind, candidate.key, teaching)
      actions.push(teaching)
      const actor = input.actors?.find(item => item.actorKey === candidate.actorKey) ?? fail('教学或对话缺少固定人物绑定')
      actor.actionKeys.push(teaching.key)
      if (!objective.supportActionKeys.includes(teaching.key)) objective.supportActionKeys.push(teaching.key)
    })
    const candidateCondition = (candidate: Candidate): TextOpenWorldConditionExpressionV1 => {
      if (candidate.kind === 'skill') return { op: 'player-skill', skillKey: candidate.skillKey!, known: true }
      if (candidate.kind === 'purchase') return { op: 'any', conditions: candidate.vendorKeys!.map(key => ({ op: 'world-flag', flagKey: proofFlag('purchase', `${key}.${candidate.itemKey}`), value: true })) }
      return { op: 'world-flag', flagKey: proofFlag(candidate.kind, candidate.key), value: true }
    }
    if (selection.anyActionGroups.length) appendCondition(owner, {
      key: `condition.fulfillment.${demand.objectiveKey}.operations`,
      expression: { op: 'any', conditions: selection.anyActionGroups.map((group, groupIndex) => ({
        op: 'all', conditions: [
          ...group.map(number => candidateCondition(demand.candidates[number - 1]!)),
          ...(selection.groupItems?.[groupIndex] ?? []).map(item => ({ op: 'inventory-quantity' as const,
            itemKey: context.itemRewardCatalog.items[item.itemNumber - 1]!.key, comparator: 'gte' as const, value: item.quantity })),
        ],
      })) },
      failureMessage: selections.version === 2 ? '需要先完成此目标指定的操作并满足该路径的物品条件。' : '需要先完成此目标指定的实际制作或地点交互。',
    })
    if (selections.version === 1) requireItems(owner, selection.items)
    objective.completionConditionKeys = [...owner.requirementConditionKeys]
    // A craft objective cannot depend on learning its recipe only after its
    // own quest reward. Learning stays in the normal accepted/restarted batch.
    const recipeKeys = new Set(selection.anyActionGroups.flat().map(number => demand.candidates[number - 1]!)
      .filter(candidate => candidate.kind === 'recipe').map(candidate => candidate.key))
    recipeKeys.forEach(key => {
      const learnEffectKey = `effect.learn.${key}`
      if (!effects.some(effect => effect.key === learnEffectKey)) return
      for (const actionKey of [`action.accept.${demand.questKey}`, `action.restart.${demand.questKey}`]) {
        const owner = actions.find(item => item.key === actionKey)
        if (owner && !owner.successEffectKeys.includes(learnEffectKey)) owner.successEffectKeys.push(learnEffectKey)
      }
    })
  })
  selections.endings.forEach(selection => {
    const endingKey = context.mainlineThread.thread.endingKeys[selection.endingNumber - 1]!
    if (!selection.requiredInteractionNumbers.length) return
    const route = input.endings.find(item => item.endingKey === endingKey)!
    const eligibility = conditions.find(item => item.key === route.eligibilityConditionKey)
    if (!eligibility || eligibility.expression.op !== 'all') fail('结局缺少受治理资格条件')
    eligibility.expression.conditions.push(...selection.requiredInteractionNumbers.map(number => ({
        op: 'world-flag', flagKey: proofFlag('interaction', context.mapInteractionCatalog.interactions[number - 1]!.key), value: true,
      } as const)))
  })
}

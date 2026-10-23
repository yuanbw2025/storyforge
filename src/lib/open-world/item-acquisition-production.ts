import type {
  TextOpenWorldConditionExpressionV1,
  TextOpenWorldItemAcquisitionSelectionV1,
  TextOpenWorldQuestDesignDocumentsV1,
  TextOpenWorldQuestFulfillmentSelectionsV1,
} from '../types'
import type { TextOpenWorldQuestFinalizeInputContextV1 } from './quest-finalize-production'
import { buildTextOpenWorldObjectiveFulfillmentDemandsV1 } from './objective-fulfillment-production'
import { hasTextOpenWorldExplicitItemSourcesV1, itemHasPlannedSourceV1 } from './item-source-production'

type Context = TextOpenWorldQuestFinalizeInputContextV1
function fail(message: string): never { throw new Error(`[text-open-world-item-acquisition] ${message}`) }
function row(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) fail('领取选择字段不精确')
  return value as Record<string, unknown>
}
function ordinal(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) fail('领取编号或数量越界')
  return Number(value)
}

export function parseTextOpenWorldItemAcquisitionsV1(
  value: unknown, context: Context, fulfillment: TextOpenWorldQuestFulfillmentSelectionsV1,
): TextOpenWorldItemAcquisitionSelectionV1[] {
  if (!Array.isArray(value) || value.length > context.mapInteractionCatalog.interactions.length) fail('领取选择必须是有界数组')
  const demands = buildTextOpenWorldObjectiveFulfillmentDemandsV1(context)
  let previous = 0
  return value.map(value => {
    const modern = context.objectiveEvidenceContract === 'action-paths-v2'
    const selection = row(value, ['objectiveNumber', 'interactionNumber', 'items', ...(modern ? ['replacementPolicy'] : [])])
    if (modern && selection.replacementPolicy !== 'never' && selection.replacementPolicy !== 'missing-ordinary') fail('领取补给策略无效')
    const objectiveNumber = ordinal(selection.objectiveNumber, context.questSkeletons.objectives.length)
    const interactionNumber = ordinal(selection.interactionNumber, context.mapInteractionCatalog.interactions.length)
    if (interactionNumber <= previous) fail('领取交互必须严格升序且唯一')
    previous = interactionNumber
    const demand = demands.find(item => item.objectiveNumber === objectiveNumber)
    const interaction = context.mapInteractionCatalog.interactions[interactionNumber - 1]!
    if (!demand || !['collect', 'interact', 'investigate'].includes(demand.playerIntent)
      || !demand.candidates.some(candidate => candidate.kind === 'interaction' && candidate.key === interaction.key)
      || interaction.questConsumerKeys.length !== 1 || interaction.questConsumerKeys[0] !== demand.questKey
      || demands.some(other => other.objectiveNumber !== objectiveNumber
        && other.candidates.some(candidate => candidate.kind === 'interaction' && candidate.key === interaction.key))) {
      fail('领取交互必须独占同一固定收集或调查目标的冻结需求')
    }
    if (fulfillment.interactions[interactionNumber - 1]!.consumedItems.length) fail('领取交互不能兼作消耗材料的修复')
    if (!Array.isArray(selection.items) || !selection.items.length || selection.items.length > 8) fail('领取物品必须有1到8项')
    let previousItem = 0
    const items = selection.items.map(value => {
      const item = row(value, ['itemNumber', 'quantity'])
      const itemNumber = ordinal(item.itemNumber, context.itemRewardCatalog.items.length)
      const definition = context.itemRewardCatalog.items[itemNumber - 1]!
      if (itemNumber <= previousItem || !demand.itemNumbers.includes(itemNumber)
        || !['quest', 'misc'].includes(definition.kind)) fail('领取只能使用该目标已有的任务物品，不能重复或生成装备、材料、消耗品')
      if (hasTextOpenWorldExplicitItemSourcesV1(context.itemRewardCatalog)
        && !itemHasPlannedSourceV1(context.itemRewardCatalog, definition.key, 'acquisition', demand.objectiveKey)) {
        fail('领取必须履行物品目录中同一目标的明确来源')
      }
      previousItem = itemNumber
      const quantity = ordinal(item.quantity, Math.min(8, definition.maximumStack ?? 1))
      if (definition.unique && quantity !== 1) fail('独特物品只能领取一件')
      return { itemNumber, quantity }
    })
    if (selection.replacementPolicy === 'missing-ordinary') {
      const definition = context.itemRewardCatalog.items[items[0]!.itemNumber - 1]!
      const quest = context.questSkeletons.quests.find(quest => quest.key === demand.questKey)!
      const deliveries = fulfillment.objectives.filter(other => other.items.some(item => item.itemNumber === items[0]!.itemNumber && item.consume && item.quantity === 1))
        .map(other => context.questSkeletons.objectives[other.objectiveNumber - 1]!)
      const pickup = context.questSkeletons.objectives[objectiveNumber - 1]!
      const later = (delivery: typeof pickup) => delivery.questKey === pickup.questKey && (delivery.stageKey === pickup.stageKey
        ? delivery.order > pickup.order
        : context.questSkeletons.stages.some(stage => stage.key === delivery.stageKey && stage.order
          > (context.questSkeletons.stages.find(stage => stage.key === pickup.stageKey)?.order ?? Number.POSITIVE_INFINITY)))
      if (quest.type !== 'ordinary' || items.length !== 1 || items[0]!.quantity !== 1 || definition.critical || definition.unique || definition.sellable
        || deliveries.length !== 1 || !deliveries.every(later)) fail('补领只能服务普通任务的单件不可售非关键交付物，且必须有唯一后续交付')
    }
    return { objectiveNumber, interactionNumber, items, ...(modern ? { replacementPolicy: selection.replacementPolicy as 'never' | 'missing-ordinary' } : {}) }
  })
}

/** Pickup proof and grants commit in the same governed Effect batch. Legacy
 * and critical pickups remain one-time. Explicit ordinary replacement requires
 * an active delivery, no held parcel and an unsellable, noncritical item. */
export function compileTextOpenWorldItemAcquisitionsV1(input: {
  context: Context
  selections: TextOpenWorldItemAcquisitionSelectionV1[]
  fulfillment: TextOpenWorldQuestFulfillmentSelectionsV1
} & Pick<TextOpenWorldQuestDesignDocumentsV1, 'conditions' | 'effects' | 'actions'> & {
  interactions: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['interactions']
}): void {
  const { context, selections, fulfillment, conditions, effects, actions } = input
  for (const selection of selections) {
    const objective = context.questSkeletons.objectives[selection.objectiveNumber - 1]!
    const interaction = context.mapInteractionCatalog.interactions[selection.interactionNumber - 1]!
    const owner = actions.find(action => action.key === `action.interaction.${interaction.key}`)!
    const replacement = selection.replacementPolicy === 'missing-ordinary'
    const deliveries = replacement ? fulfillment.objectives.filter(other => other.items.some(item => item.itemNumber === selection.items[0]!.itemNumber && item.consume))
      .map(other => context.questSkeletons.objectives[other.objectiveNumber - 1]!) : []
    const prerequisites: TextOpenWorldConditionExpressionV1[] = [
      { op: 'quest-status', questKey: objective.questKey, statuses: ['active'] },
      ...(replacement ? [
        { op: 'any' as const, conditions: [...new Set([objective.stageKey, ...deliveries.map(item => item.stageKey)])].map(stageKey => ({ op: 'quest-stage' as const, questKey: objective.questKey, stageKey })) },
        ...deliveries.map(item => ({ op: 'not' as const, condition: { op: 'quest-objective' as const, objectiveKey: item.key, status: 'completed' as const } })),
        { op: 'inventory-quantity' as const, itemKey: context.itemRewardCatalog.items[selection.items[0]!.itemNumber - 1]!.key, comparator: 'eq' as const, value: 0 },
      ] : [
        { op: 'quest-stage' as const, questKey: objective.questKey, stageKey: objective.stageKey },
        { op: 'not' as const, condition: { op: 'quest-objective' as const, objectiveKey: objective.key, status: 'completed' as const } },
        { op: 'not' as const, condition: { op: 'world-flag' as const, flagKey: `flag.fulfillment.interaction.${interaction.key}`, value: true } },
      ]),
      ...context.questSkeletons.objectives.filter(other => other.stageKey === objective.stageKey
        && other.order < objective.order && !other.optional).map(other => ({
          op: 'quest-objective' as const, objectiveKey: other.key, status: 'completed' as const,
        })),
    ]
    // Borrowing may require a permit; never require the very object being
    // acquired as an input to its own pickup.
    const acquired = new Set(selection.items.map(item => item.itemNumber))
    for (const item of fulfillment.objectives.find(item => item.objectiveNumber === selection.objectiveNumber)!.items) {
      if (!acquired.has(item.itemNumber)) prerequisites.push({
        op: 'inventory-quantity', itemKey: context.itemRewardCatalog.items[item.itemNumber - 1]!.key,
        comparator: 'gte', value: item.quantity,
      })
    }
    const conditionKey = `condition.acquisition.${interaction.key}`
    conditions.push({ key: conditionKey, expression: { op: 'all', conditions: prerequisites },
      failureMessage: replacement ? '仅限当前任务交付前遗失补领；持有包件时不能重复领取。' : '需进入对应任务阶段、完成前置目标并持有所需凭据；这处物品只能领取一次。' })
    owner.requirementConditionKeys.push(conditionKey)
    for (const item of selection.items) {
      const definition = context.itemRewardCatalog.items[item.itemNumber - 1]!
      const key = `effect.acquisition.${interaction.key}.${definition.key}`
      effects.push({ key, operation: 'grant-item', payload: {
        itemKey: definition.key, quantity: item.quantity, ...(definition.unique ? { ifAbsent: true as const } : {}),
      } })
      owner.successEffectKeys.push(key)
    }
    const binding = input.interactions.find(item => item.interactionKey === interaction.key)!
    binding.conditionKeys = [...owner.requirementConditionKeys]
    binding.effectKeys = [...owner.costEffectKeys, ...owner.successEffectKeys]
  }
}

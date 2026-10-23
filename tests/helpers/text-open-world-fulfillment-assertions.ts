import { expect } from 'vitest'
import type { TextOpenWorldQuestDesignDocumentsV1, TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import type { TextOpenWorldQuestFinalizeInputContextV1 } from '../../src/lib/open-world/quest-finalize-production'
import { buildTextOpenWorldObjectiveFulfillmentDemandsV1 } from '../../src/lib/open-world/objective-fulfillment-production'
import { createTextOpenWorldConditionCatalogV1 } from '../../src/lib/open-world/condition-dsl'
import { createTextOpenWorldCraftingCatalogV1 } from '../../src/lib/open-world/crafting'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'

/** Runs against the package produced by P8F -> P9 -> P10 -> V3, in isolated
 * fixture state. This is engineering evidence, never a real player receipt. */
export async function assertTextOpenWorldFulfillmentRuntimeV1(
  runtimePackage: TextOpenWorldRuntimePackageV1,
  quests: TextOpenWorldQuestDesignDocumentsV1,
  context: TextOpenWorldQuestFinalizeInputContextV1,
): Promise<void> {
  const modules = parseTextOpenWorldModulesV1(runtimePackage)
  const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const conditions = createTextOpenWorldConditionCatalogV1(runtimePackage)
  const effects = createTextOpenWorldEffectCatalogV1(runtimePackage)
  const crafting = createTextOpenWorldCraftingCatalogV1(runtimePackage)
  const demand = buildTextOpenWorldObjectiveFulfillmentDemandsV1(context).find(item => item.candidates.some(candidate => candidate.kind === 'recipe'))!
  expect(demand).toBeDefined()
  const selection = quests.fulfillmentSelections!.objectives.find(item => item.objectiveNumber === demand.objectiveNumber)!
  const operationsCondition = `condition.fulfillment.${demand.objectiveKey}.operations`
  const completed = () => conditions.evaluate(operationsCondition, deriveTextOpenWorldContextsV1(projection).condition).satisfied
  expect(completed()).toBe(false)
  for (const candidateNumber of selection.anyActionGroups[0]!) {
    const candidate = demand.candidates[candidateNumber - 1]!
    const action = modules.actions.actions.find(item => item.key === candidate.actionKey)!
    if (candidate.kind === 'recipe') {
      const recipe = modules.crafting.recipes.find(item => item.key === candidate.key)!
      const source = context.craftingEconomyCatalog.recipes.find(item => item.key === recipe.key)!
      if (!source.learnedByDefault) expect(quests.actions.find(item => item.key === `action.accept.${demand.questKey}`)!.successEffectKeys)
        .toContain(`effect.learn.${recipe.key}`)
      if (!projection.state.inventory.knownRecipeKeys.includes(recipe.key)) projection.state.inventory.knownRecipeKeys.push(recipe.key)
      projection.state.map.currentLocationKey = recipe.stationLocationKeys[0]!
      projection.state.map.locationKnowledgeByKey[projection.state.map.currentLocationKey] = 'visited'
      projection.state.map.regionKnowledgeByKey[modules.world.locations.find(item => item.key === projection.state.map.currentLocationKey)!.regionKey] = 'visited'
      for (const ingredient of recipe.ingredients) delete projection.state.inventory.stackQuantities[ingredient.itemKey]
      // A held/purchased component does not establish successful crafting.
      for (const output of recipe.outputs) {
        if (modules.items.items.find(item => item.key === output.itemKey)!.stackPolicy === 'stacked') {
          projection.state.inventory.stackQuantities[output.itemKey] = output.quantity
        }
      }
      expect(completed()).toBe(false)
      const before = structuredClone(projection.state)
      expect(() => crafting.prepare({ state: projection.state, recipeKey: recipe.key, quantity: 1, locationKey: projection.state.map.currentLocationKey }))
        .toThrow(/材料/)
      expect(projection.state).toEqual(before)
      for (const ingredient of recipe.ingredients) projection.state.inventory.stackQuantities[ingredient.itemKey] = ingredient.quantity
      const authorization = crafting.prepare({ state: projection.state, recipeKey: recipe.key, quantity: 1, locationKey: projection.state.map.currentLocationKey })
      const plan = await effects.plan({ effectKeys: action.successEffectKeys, state: projection.state, claimKey: `claim.proof.${recipe.key}`, authorization })
      expect(plan.impactDomains).toEqual(expect.arrayContaining(['inventory', 'time', 'world']))
      projection.state = (await effects.apply({ plan, state: projection.state })).state
      expect(projection.state.world.flags[`flag.fulfillment.recipe.${recipe.key}`]).toBe(true)
      for (const ingredient of recipe.ingredients) expect(projection.state.inventory.stackQuantities[ingredient.itemKey] ?? 0).toBe(0)
    } else {
      const plan = await effects.plan({ effectKeys: action.successEffectKeys, state: projection.state, claimKey: `claim.proof.${candidate.key}` })
      projection.state = (await effects.apply({ plan, state: projection.state })).state
    }
  }
  expect(completed()).toBe(true)

  const repairSelections = quests.fulfillmentSelections!.interactions.filter(item => item.consumedItems.length)
  expect(repairSelections).toHaveLength(2)
  const repairs = repairSelections.map(selection => ({
    selection,
    action: modules.actions.actions.find(action => action.key === quests.catalogBindings.interactions[selection.interactionNumber - 1]!.actionKey)!,
  }))
  const secondEnding = quests.endingBindings.routes[1]!
  const endingAvailable = () => {
    const conditionContext = deriveTextOpenWorldContextsV1(projection).condition
    const eligibility = secondEnding.eligibility!
    for (const key of [...eligibility.requiredQuestKeys, ...eligibility.anyQuestKeyGroups.flat()]) conditionContext.quests.statusByQuestKey[key] = 'completed'
    for (const affinity of eligibility.requiredFactionAffinities) conditionContext.relations.factionAffinityByKey[affinity.factionKey] = affinity.minimum
    conditionContext.inventory.knownRecipeKeys = [...new Set([...conditionContext.inventory.knownRecipeKeys, ...eligibility.requiredRecipeKeys])]
    return conditions.evaluate(secondEnding.eligibilityConditionKey!, conditionContext).satisfied
  }
  const settlementPlan = async (index: number) => {
    const action = repairs[index]!.action
    return effects.plan({ effectKeys: [...action.costEffectKeys, ...action.successEffectKeys], state: projection.state, claimKey: `claim.repair.${index}` })
  }
  const supply = (index: number) => {
    for (const item of repairs[index]!.selection.consumedItems) {
      projection.state.inventory.stackQuantities[context.itemRewardCatalog.items[item.itemNumber - 1]!.key] = item.quantity
    }
  }
  supply(0)
  const plan = await settlementPlan(0)
  projection.state = (await effects.apply({ plan, state: projection.state })).state
  const firstFlag = `flag.fulfillment.interaction.${context.mapInteractionCatalog.interactions[repairs[0]!.selection.interactionNumber - 1]!.key}`
  expect(projection.state.world.flags[firstFlag]).toBe(true)
  expect(endingAvailable()).toBe(false)
  const firstConditions = conditions.evaluateMany(repairs[0]!.action.requirementConditionKeys, deriveTextOpenWorldContextsV1(projection).condition)
  expect(Object.values(firstConditions).some(result => result.publicReason?.includes('已经结算'))).toBe(true)
  const settled = structuredClone(projection.state)
  await expect(effects.apply({ plan, state: projection.state })).rejects.toThrow('基线状态已变化')
  expect(projection.state).toEqual(settled)
  await expect(settlementPlan(1)).rejects.toThrow(/物品|数量|不足/)
  expect(projection.state).toEqual(settled)
  supply(1)
  projection.state = (await effects.apply({ plan: await settlementPlan(1), state: projection.state })).state
  expect(endingAvailable()).toBe(true)
  for (const repair of repairs) for (const item of repair.selection.consumedItems) {
    expect(projection.state.inventory.stackQuantities[context.itemRewardCatalog.items[item.itemNumber - 1]!.key] ?? 0).toBe(0)
  }

  // A forged second writer must not turn a grant/reward into craft evidence.
  const forged = structuredClone(runtimePackage)
  const actions = forged.modules.actions.payload as { actions: typeof modules.actions.actions }
  const craft = actions.actions.find(action => action.category === 'craft')!
  await expect(effects.plan({ effectKeys: [craft.successEffectKeys[1]!], state: projection.state, claimKey: 'claim.forged.craft-proof' }))
    .rejects.toThrow('制作证据不能脱离实际制作独立提交')
  actions.actions.find(action => action.category === 'talk')!.successEffectKeys.push(craft.successEffectKeys[1]!)
  expect(() => parseTextOpenWorldModulesV1(forged)).toThrow('真实制作证据必须由成功制作唯一写入')
}

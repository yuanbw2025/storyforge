import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldCraftingAuthorizationV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'
import { createTextOpenWorldItemInstanceIdV1, deriveTextOpenWorldInventoryQuantitiesV1 } from './inventory'

type Recipe = TextOpenWorldParsedModulesV1['crafting']['recipes'][number]

function fail(message: string): never { throw new Error(`[text-open-world-crafting] ${message}`) }
function quantity(value: unknown, maximum: number, label = 'quantity'): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) fail(`${label}必须是1到${maximum}的安全整数`)
  return Number(value)
}

function itemCount(modules: TextOpenWorldParsedModulesV1, state: TextOpenWorldEffectStateV1, itemKey: string): number {
  return deriveTextOpenWorldInventoryQuantitiesV1(modules, state.inventory)[itemKey] ?? 0
}

function maximumOutputQuantity(modules: TextOpenWorldParsedModulesV1, state: TextOpenWorldEffectStateV1, recipe: Recipe): number {
  let maximum = modules.crafting.rules.maximumBatchQuantity
  for (const output of recipe.outputs) {
    const item = modules.items.items.find(candidate => candidate.key === output.itemKey) ?? fail(`配方输出物品不存在:${output.itemKey}`)
    const before = itemCount(modules, state, output.itemKey)
    if (item.stackPolicy === 'stacked') maximum = Math.min(maximum, Math.floor((item.maximumStack! - before) / output.quantity))
    else if (item.unique) maximum = Math.min(maximum, before > 0 ? 0 : Math.floor(1 / output.quantity))
  }
  return Math.max(0, maximum)
}

function maximumMaterialQuantity(modules: TextOpenWorldParsedModulesV1, state: TextOpenWorldEffectStateV1, recipe: Recipe): number {
  return Math.max(0, Math.min(
    modules.crafting.rules.maximumBatchQuantity,
    ...recipe.ingredients.map(ingredient => Math.floor(itemCount(modules, state, ingredient.itemKey) / ingredient.quantity)),
  ))
}

function maximumUnitBoundQuantity(modules: TextOpenWorldParsedModulesV1, recipe: Recipe): number {
  const unitsPerBatch = [...recipe.ingredients, ...recipe.outputs].reduce((sum, item) => sum + item.quantity, 0)
  return Math.max(0, Math.floor(modules.crafting.rules.maximumTotalItemUnitsPerAction / unitsPerBatch))
}

export interface TextOpenWorldCraftingProjectionV1 {
  recipe: Recipe
  known: boolean
  atRequiredStation: boolean
  maximumCraftableQuantity: number
  available: boolean
  unavailableReasons: Array<'recipe-unknown' | 'wrong-station' | 'materials-insufficient' | 'output-capacity'>
}

export interface TextOpenWorldCraftingCatalogV1 {
  project(input: { state: TextOpenWorldEffectStateV1 }): TextOpenWorldCraftingProjectionV1[]
  prepare(input: { state: TextOpenWorldEffectStateV1; recipeKey: string; quantity: number; locationKey: string }): TextOpenWorldCraftingAuthorizationV1
  assertAuthorization(input: { state: TextOpenWorldEffectStateV1; authorization: TextOpenWorldCraftingAuthorizationV1 }): void
  applyAuthorization(input: {
    beforeState: TextOpenWorldEffectStateV1
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldCraftingAuthorizationV1
    claimKey: string
    effectKey: string
  }): void
}

export function createTextOpenWorldCraftingCatalogV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
  parsedModules?: TextOpenWorldParsedModulesV1,
): TextOpenWorldCraftingCatalogV1 {
  const modules = parsedModules ?? parseTextOpenWorldModulesV1(value)
  const recipes = new Map(modules.crafting.recipes.map(recipe => [recipe.key, recipe]))

  const project = ({ state }: { state: TextOpenWorldEffectStateV1 }): TextOpenWorldCraftingProjectionV1[] => modules.crafting.recipes.map(recipe => {
    const known = state.inventory.knownRecipeKeys.includes(recipe.key)
    const atRequiredStation = recipe.stationLocationKeys.length === 0 || recipe.stationLocationKeys.includes(state.map.currentLocationKey)
    const materialMaximum = maximumMaterialQuantity(modules, state, recipe)
    const outputMaximum = maximumOutputQuantity(modules, state, recipe)
    const maximumCraftableQuantity = Math.min(materialMaximum, outputMaximum, maximumUnitBoundQuantity(modules, recipe))
    const unavailableReasons: TextOpenWorldCraftingProjectionV1['unavailableReasons'] = []
    if (!known) unavailableReasons.push('recipe-unknown')
    if (!atRequiredStation) unavailableReasons.push('wrong-station')
    if (materialMaximum < 1) unavailableReasons.push('materials-insufficient')
    if (outputMaximum < 1) unavailableReasons.push('output-capacity')
    return {
      recipe: structuredClone(recipe), known, atRequiredStation, maximumCraftableQuantity,
      available: unavailableReasons.length === 0 && maximumCraftableQuantity >= 1,
      unavailableReasons,
    }
  })

  const prepare = (input: { state: TextOpenWorldEffectStateV1; recipeKey: string; quantity: number; locationKey: string }): TextOpenWorldCraftingAuthorizationV1 => {
    if (modules.crafting.sourceVersion !== 2) fail('旧Crafting Release没有正式制作运行合同')
    const recipe = recipes.get(input.recipeKey) ?? fail(`配方不存在:${input.recipeKey}`)
    const requestedQuantity = quantity(input.quantity, modules.crafting.rules.maximumBatchQuantity)
    if (input.locationKey !== input.state.map.currentLocationKey) fail('制作地点与玩家当前位置不一致')
    const projection = project({ state: input.state }).find(item => item.recipe.key === recipe.key)!
    if (!projection.known) fail(`尚未学习配方:${recipe.key}`)
    if (!projection.atRequiredStation) fail(`当前地点不能制作配方:${recipe.key}`)
    if (requestedQuantity > projection.maximumCraftableQuantity) fail(`制作数量超过当前材料或产出容量:${projection.maximumCraftableQuantity}`)
    const totalUnits = [...recipe.ingredients, ...recipe.outputs]
      .reduce((sum, item) => sum + item.quantity * requestedQuantity, 0)
    if (totalUnits > modules.crafting.rules.maximumTotalItemUnitsPerAction) fail('制作物品单位数超过单次事件上限')
    const timeCostMinutes = recipe.timeCostMinutes * requestedQuantity
    if (!Number.isSafeInteger(timeCostMinutes) || !Number.isSafeInteger(input.state.time.worldMinute + timeCostMinutes)) fail('制作耗时会导致世界时间溢出')
    return {
      kind: 'crafting', recipeKey: recipe.key, quantity: requestedQuantity,
      locationKey: input.locationKey, baseWorldMinute: input.state.time.worldMinute, timeCostMinutes,
      ingredients: recipe.ingredients.map(ingredient => {
        const beforeQuantity = itemCount(modules, input.state, ingredient.itemKey)
        const consumedQuantity = ingredient.quantity * requestedQuantity
        return { itemKey: ingredient.itemKey, quantity: consumedQuantity, beforeQuantity, afterQuantity: beforeQuantity - consumedQuantity }
      }),
      outputs: recipe.outputs.map(output => {
        const beforeQuantity = itemCount(modules, input.state, output.itemKey)
        const producedQuantity = output.quantity * requestedQuantity
        return { itemKey: output.itemKey, quantity: producedQuantity, beforeQuantity, afterQuantity: beforeQuantity + producedQuantity }
      }),
    }
  }

  const assertAuthorization = (input: { state: TextOpenWorldEffectStateV1; authorization: TextOpenWorldCraftingAuthorizationV1 }) => {
    const expected = prepare({
      state: input.state,
      recipeKey: input.authorization.recipeKey,
      quantity: input.authorization.quantity,
      locationKey: input.authorization.locationKey,
    })
    if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) fail('制作授权与当前状态或冻结配方不一致')
  }

  const applyAuthorization: TextOpenWorldCraftingCatalogV1['applyAuthorization'] = input => {
    assertAuthorization({ state: input.beforeState, authorization: input.authorization })
    input.authorization.ingredients.forEach(ingredient => {
      if (ingredient.afterQuantity === 0) delete input.state.inventory.stackQuantities[ingredient.itemKey]
      else input.state.inventory.stackQuantities[ingredient.itemKey] = ingredient.afterQuantity
    })
    let instanceOrdinal = 1
    input.authorization.outputs.forEach(output => {
      const item = modules.items.items.find(candidate => candidate.key === output.itemKey)!
      if (item.stackPolicy === 'stacked') input.state.inventory.stackQuantities[output.itemKey] = output.afterQuantity
      else {
        for (let ordinal = 1; ordinal <= output.quantity; ordinal += 1) {
          const instanceId = createTextOpenWorldItemInstanceIdV1({
            appliedClaimCount: input.state.appliedClaimKeys.length,
            effectKey: input.effectKey,
            ordinal: instanceOrdinal,
          })
          if (input.state.inventory.itemInstances[instanceId]) fail(`制作物品实例ID冲突:${instanceId}`)
          input.state.inventory.itemInstances[instanceId] = { itemKey: output.itemKey, acquiredByClaimKey: input.claimKey, stateTags: ['new'] }
          instanceOrdinal += 1
        }
      }
    })
    input.state.time.worldMinute += input.authorization.timeCostMinutes
  }

  return { project, prepare, assertAuthorization, applyAuthorization }
}

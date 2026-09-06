import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { createTextOpenWorldCraftingCatalogV1 } from '../../src/lib/open-world/crafting'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent, TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture, downgradeTextOpenWorldFixtureCraftingV1 } from '../helpers/text-open-world-vnext-fixture'

function addMaterialGrantAction(runtimePackage: TextOpenWorldRuntimePackageV1, quantity: number) {
  const actions = runtimePackage.modules.actions.payload as any
  actions.effects.push({ key: 'effect.test-grant-salt', operation: 'grant-item', payload: { itemKey: 'item.salt-crystal', quantity } })
  actions.actions.push({
    key: 'action.test-grant-salt', category: 'take', label: '测试领取盐晶', description: '测试专用的受治理材料领取。',
    actorScope: 'player', targetScope: 'none', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.test-grant-salt'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'never', repeatPolicy: 'once', cooldownMinutes: null,
  })
  return runtimePackage
}

function appliedAuthorizations(events: ProductRuntimeEvent[]) {
  return events.filter(event => event.type === 'text-open-world.effects.applied')
    .map(event => JSON.parse(event.payloadJson).plan.authorization)
    .filter(Boolean)
}

describe('Text Open World vNext · learned recipes and deterministic crafting', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('Crafting v2冻结100%成功、批量预算与每配方唯一Action，旧v1只读兼容且不被静默升级为可执行', () => {
    const modern = createTextOpenWorldVNextFixture()
    expect(parseTextOpenWorldModulesV1(modern)).toMatchObject({
      actions: { version: 12 },
      crafting: {
        version: 2, sourceVersion: 2,
        rules: { successPolicy: 'guaranteed', maximumBatchQuantity: 100, maximumTotalItemUnitsPerAction: 100_000 },
        recipes: [{ key: 'recipe.brine-tonic', category: 'consumable', requirementConditionKeys: [] }],
      },
    })

    const legacy = downgradeTextOpenWorldFixtureCraftingV1(createTextOpenWorldVNextFixture())
    expect(parseTextOpenWorldModulesV1(legacy)).toMatchObject({ actions: { version: 11 }, crafting: { version: 2, sourceVersion: 1 } })
    const legacyState = createInitialTextOpenWorldSessionProjectionV1(legacy).state
    legacyState.inventory.stackQuantities['item.salt-crystal'] = 2
    expect(() => createTextOpenWorldCraftingCatalogV1(legacy).prepare({
      state: legacyState, recipeKey: 'recipe.brine-tonic', quantity: 1, locationKey: 'location.salt-port',
    })).toThrow('旧Crafting Release没有正式制作运行合同')

    const missingAction = createTextOpenWorldVNextFixture()
    ;(missingAction.modules.actions.payload as any).actions = (missingAction.modules.actions.payload as any).actions
      .filter((action: any) => action.category !== 'craft')
    expect(() => parseTextOpenWorldModulesV1(missingAction)).toThrow('每个配方定义唯一制作Action')

    const criticalIngredient = createTextOpenWorldVNextFixture()
    const recipe = (criticalIngredient.modules.crafting.payload as any).recipes[0]
    recipe.ingredients = [{ itemKey: 'item.canal-seal', quantity: 1 }]
    expect(() => parseTextOpenWorldModulesV1(criticalIngredient)).toThrow('不能消耗关键物品')
  })

  it('目录只开放已学习、在正确工作地点且材料和产出容量充足的配方', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const catalog = createTextOpenWorldCraftingCatalogV1(runtimePackage)
    expect(catalog.project({ state: projection.state })[0]).toMatchObject({
      known: true, atRequiredStation: true, maximumCraftableQuantity: 0, available: false,
      unavailableReasons: ['materials-insufficient'],
    })

    projection.state.inventory.stackQuantities['item.salt-crystal'] = 4
    expect(catalog.project({ state: projection.state })[0]).toMatchObject({ maximumCraftableQuantity: 2, available: true })
    const contexts = deriveTextOpenWorldContextsV1(projection)
    expect(createTextOpenWorldActionRegistryV1(runtimePackage).project(contexts.action)
      .find(item => item.action.key === 'action.craft-brine-tonic')).toMatchObject({
        available: true, validTargetKeys: ['recipe.brine-tonic'],
      })

    projection.state.map.currentLocationKey = 'location.ridge-channel'
    expect(catalog.project({ state: projection.state })[0]).toMatchObject({ atRequiredStation: false, available: false })
    projection.state.map.currentLocationKey = 'location.salt-port'
    projection.state.inventory.knownRecipeKeys = []
    expect(catalog.project({ state: projection.state })[0]).toMatchObject({ known: false, available: false })

    const lockedPackage = createTextOpenWorldVNextFixture()
    ;(lockedPackage.modules.crafting.payload as any).recipes[0].learnedByDefault = false
    const actions = lockedPackage.modules.actions.payload as any
    actions.effects.push({ key: 'effect.learn-brine-recipe', operation: 'learn-recipe', payload: { recipeKey: 'recipe.brine-tonic' } })
    actions.actions.push({
      key: 'action.read-brine-recipe', category: 'read', label: '阅读盐露配方', description: '从配方册中学习盐露药剂。',
      actorScope: 'player', targetScope: 'none', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
      successEffectKeys: ['effect.learn-brine-recipe'], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'once', cooldownMinutes: null,
    })
    const lockedState = createInitialTextOpenWorldSessionProjectionV1(lockedPackage).state
    lockedState.inventory.stackQuantities['item.salt-crystal'] = 2
    expect(createTextOpenWorldCraftingCatalogV1(lockedPackage).project({ state: lockedState })[0].available).toBe(false)
    const learnPlan = await createTextOpenWorldEffectCatalogV1(lockedPackage).plan({
      effectKeys: ['effect.learn-brine-recipe'], claimKey: 'claim.learn.brine', state: lockedState,
    })
    const learned = await createTextOpenWorldEffectCatalogV1(lockedPackage).apply({ plan: learnPlan, state: lockedState })
    expect(learned.state.inventory.knownRecipeKeys).toEqual(['recipe.brine-tonic'])
    expect(createTextOpenWorldCraftingCatalogV1(lockedPackage).project({ state: learned.state })[0].available).toBe(true)
  })

  it('材料扣除、批量产物和耗时在一个EffectPlan内原子结算，并拒绝数量与容量越界', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    state.inventory.stackQuantities['item.salt-crystal'] = 4
    const crafting = createTextOpenWorldCraftingCatalogV1(runtimePackage)
    const authorization = crafting.prepare({ state, recipeKey: 'recipe.brine-tonic', quantity: 2, locationKey: 'location.salt-port' })
    expect(authorization).toMatchObject({
      quantity: 2, timeCostMinutes: 30,
      ingredients: [{ itemKey: 'item.salt-crystal', quantity: 4, beforeQuantity: 4, afterQuantity: 0 }],
      outputs: [{ itemKey: 'item.brine-tonic', quantity: 2, beforeQuantity: 0, afterQuantity: 2 }],
    })
    const effects = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await effects.plan({ effectKeys: ['effect.craft-brine-tonic'], claimKey: 'claim.craft.batch', state, authorization })
    expect(plan.impactDomains).toEqual(['inventory', 'time'])
    const applied = await effects.apply({ plan, state })
    expect(applied.state.inventory.stackQuantities).toMatchObject({ 'item.brine-tonic': 2 })
    expect(applied.state.inventory.stackQuantities['item.salt-crystal']).toBeUndefined()
    expect(applied.state.time.worldMinute).toBe(state.time.worldMinute + 30)
    expect(state.inventory.stackQuantities['item.salt-crystal']).toBe(4)

    expect(() => crafting.prepare({ state, recipeKey: 'recipe.brine-tonic', quantity: 101, locationKey: 'location.salt-port' })).toThrow('1到100')
    const full = structuredClone(state)
    full.inventory.stackQuantities['item.brine-tonic'] = 99
    expect(() => crafting.prepare({ state: full, recipeKey: 'recipe.brine-tonic', quantity: 1, locationKey: 'location.salt-port' })).toThrow('产出容量')
    expect(() => crafting.assertAuthorization({ state, authorization: { ...authorization, timeCostMinutes: 29 } })).toThrow('授权与当前状态')
  })

  it('真实Action按quantity制作且幂等；清空运行头后可从事件完整重放并拒绝篡改授权', async () => {
    const runtimePackage = addMaterialGrantAction(createTextOpenWorldVNextFixture(), 4)
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD 制作-${crypto.randomUUID()}`,
      textOpenWorldVNext: runtimePackage,
      title: '制作Session',
      seed: 'crafting-seed',
    })
    const sessionId = created.session.id!
    await executeTextOpenWorldActionV1({ sessionId, actionKey: 'action.test-grant-salt', commandId: 'command.craft.materials', requestedAt: 1 })
    const crafted = await executeTextOpenWorldActionV1({
      sessionId, actionKey: 'action.craft-brine-tonic', targetKey: 'recipe.brine-tonic', quantity: 2,
      commandId: 'command.craft.batch', requestedAt: 2,
    })
    expect(crafted).toMatchObject({ phase: 'terminal', status: 'succeeded' })
    const after = await readProductRuntimeState(sessionId)
    expect(after.textOpenWorld!.state.inventory.stackQuantities).toMatchObject({ 'item.brine-tonic': 2 })
    expect(after.textOpenWorld!.state.inventory.stackQuantities['item.salt-crystal']).toBeUndefined()
    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    expect(appliedAuthorizations(events).find(authorization => authorization.kind === 'crafting')).toMatchObject({
      recipeKey: 'recipe.brine-tonic', quantity: 2, timeCostMinutes: 30,
    })

    await executeTextOpenWorldActionV1({
      sessionId, actionKey: 'action.craft-brine-tonic', targetKey: 'recipe.brine-tonic', quantity: 2,
      commandId: 'command.craft.batch', requestedAt: 2,
    })
    expect(await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()).toBe(events.length)

    await db.productRuntimeSessions.update(sessionId, { runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null })
    expect((await readProductRuntimeState(sessionId)).textOpenWorld).toEqual(after.textOpenWorld)

    const tampered = structuredClone(events)
    const appliedEvent = tampered.find(event => event.type === 'text-open-world.effects.applied'
      && JSON.parse(event.payloadJson).plan.authorization?.kind === 'crafting')!
    const payload = JSON.parse(appliedEvent.payloadJson)
    payload.plan.authorization.quantity = 1
    appliedEvent.payloadJson = JSON.stringify(payload)
    expect(() => replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), tampered)).toThrow('制作授权与命令或Action不一致')
  }, 30_000)
})

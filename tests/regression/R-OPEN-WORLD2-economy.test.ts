import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldEconomyCatalogV1 } from '../../src/lib/open-world/economy'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture, downgradeTextOpenWorldFixtureEconomyV1 } from '../helpers/text-open-world-vnext-fixture'

function appliedAuthorizations(events: ProductRuntimeEvent[]) {
  return events.filter(event => event.type === 'text-open-world.effects.applied')
    .map(event => JSON.parse(event.payloadJson).plan.authorization)
    .filter(Boolean)
}

describe('Text Open World vNext · single-currency vendors and atomic transactions', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('Economy v2冻结单货币、整数价格、普通/特殊库存和每商店唯一买卖Action，旧v1保持只读', () => {
    const modern = createTextOpenWorldVNextFixture()
    expect(parseTextOpenWorldModulesV1(modern)).toMatchObject({
      actions: { version: 13 },
      economy: {
        version: 2, sourceVersion: 2,
        currency: { key: 'currency', label: '盐票' },
        rules: { maximumTransactionQuantity: 100, maximumTransactionTotal: 1_000_000_000 },
        vendors: [{
          key: 'vendor.caretaker', buyPriceMultiplierBasisPoints: 10_000, sellPriceMultiplierBasisPoints: 5_000,
          buyActionKey: 'action.buy-caretaker', sellActionKey: 'action.sell-caretaker',
          inventoryEntries: [
            { itemKey: 'item.brine-tonic', stockPolicy: 'unlimited', initialQuantity: null },
            { itemKey: 'item.salt-crystal', stockPolicy: 'limited', initialQuantity: 3 },
          ],
        }],
      },
    })

    const legacy = downgradeTextOpenWorldFixtureEconomyV1(createTextOpenWorldVNextFixture())
    expect(parseTextOpenWorldModulesV1(legacy)).toMatchObject({ actions: { version: 12 }, economy: { version: 2, sourceVersion: 1 } })
    expect(() => createTextOpenWorldEconomyCatalogV1(legacy).prepare({
      state: createInitialTextOpenWorldSessionProjectionV1(legacy).state,
      transactionKind: 'buy', vendorKey: 'vendor.caretaker', itemKey: 'item.brine-tonic', quantity: 1,
    })).toThrow('旧Economy Release没有正式交易运行合同')

    const missingAction = createTextOpenWorldVNextFixture()
    ;(missingAction.modules.actions.payload as any).actions = (missingAction.modules.actions.payload as any).actions
      .filter((action: any) => action.key !== 'action.buy-caretaker')
    expect(() => parseTextOpenWorldModulesV1(missingAction)).toThrow('vendor buy Action 引用不存在')

    const unlimitedUnique = createTextOpenWorldVNextFixture()
    const items = (unlimitedUnique.modules.items.payload as any).items
    items.find((item: any) => item.key === 'item.rust-sword').unique = true
    ;(unlimitedUnique.modules.economy.payload as any).vendors[0].inventoryEntries.push({
      itemKey: 'item.rust-sword', stockPolicy: 'unlimited', initialQuantity: null,
    })
    expect(() => parseTextOpenWorldModulesV1(unlimitedUnique)).toThrow('唯一物品不能无限供应')

    const arbitrage = createTextOpenWorldVNextFixture()
    const vendor = (arbitrage.modules.economy.payload as any).vendors[0]
    vendor.buyPriceMultiplierBasisPoints = 1_000
    vendor.sellPriceMultiplierBasisPoints = 20_000
    expect(() => parseTextOpenWorldModulesV1(arbitrage)).toThrow('无风险套利')
  })

  it('商店投影给出关系价格解释、有限库存、最大数量和装备不可出售原因', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const actors = runtimePackage.modules.actors.payload as any
    actors.player.build.startingCurrency = 100
    const tonic = (runtimePackage.modules.items.payload as any).items.find((item: any) => item.key === 'item.brine-tonic')
    tonic.baseValue = 20
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    const economy = createTextOpenWorldEconomyCatalogV1(runtimePackage)
    const neutral = economy.project({ state, vendorKey: 'vendor.caretaker' })[0]
    expect(neutral).toMatchObject({
      available: true, attitude: 'neutral', playerCurrency: 100,
      priceExplanation: { buyRelationshipMultiplierBasisPoints: 10_000, sellRelationshipMultiplierBasisPoints: 10_000 },
    })
    expect(neutral.buy.find(entry => entry.item.key === 'item.brine-tonic')).toMatchObject({ unitPrice: 20, vendorStockQuantity: null, maximumQuantity: 5, available: true })
    expect(neutral.buy.find(entry => entry.item.key === 'item.salt-crystal')).toMatchObject({ unitPrice: 2, vendorStockQuantity: 3, maximumQuantity: 3, available: true })
    expect(neutral.sell.find(entry => entry.item.key === 'item.rust-sword')).toMatchObject({ unitPrice: 5, playerItemQuantity: 1, maximumQuantity: 1, available: true })

    state.relationships.morality = 100
    state.relationships.factionAffinityByKey['faction.canal-keepers'] = 100
    const good = economy.project({ state, vendorKey: 'vendor.caretaker' })[0]
    expect(good).toMatchObject({ attitude: 'good', priceExplanation: { buyRelationshipMultiplierBasisPoints: 9_000, sellRelationshipMultiplierBasisPoints: 11_000 } })
    expect(good.buy.find(entry => entry.item.key === 'item.brine-tonic')?.unitPrice).toBe(18)

    const swordInstance = Object.keys(state.inventory.itemInstances).find(instanceId => state.inventory.itemInstances[instanceId].itemKey === 'item.rust-sword')!
    state.inventory.equippedItemInstanceIdBySlot.weapon = swordInstance
    expect(economy.project({ state, vendorKey: 'vendor.caretaker' })[0].sell.find(entry => entry.item.key === 'item.rust-sword')).toMatchObject({
      available: false, maximumQuantity: 0, unavailableReasons: ['item-equipped'],
    })
  })

  it('购买和出售在一个EffectPlan中原子改变货币、背包与有限库存，并拒绝越界或篡改', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    const economy = createTextOpenWorldEconomyCatalogV1(runtimePackage)
    const effects = createTextOpenWorldEffectCatalogV1(runtimePackage)

    const buyAuthorization = economy.prepare({ state, transactionKind: 'buy', vendorKey: 'vendor.caretaker', itemKey: 'item.salt-crystal', quantity: 2 })
    expect(buyAuthorization).toMatchObject({
      transactionKind: 'buy', quantity: 2, price: { unitPrice: 2, totalPrice: 4, rounding: 'ceil' },
      before: { currency: 20, playerItemQuantity: 0, vendorStockQuantity: 3 },
      after: { currency: 16, playerItemQuantity: 2, vendorStockQuantity: 1 },
    })
    const buyPlan = await effects.plan({ effectKeys: ['effect.buy-caretaker'], claimKey: 'claim.buy.salt', state, authorization: buyAuthorization })
    expect(buyPlan.impactDomains).toEqual(['inventory', 'economy'])
    const bought = await effects.apply({ plan: buyPlan, state })
    expect(bought.state.inventory).toMatchObject({ currency: 16, stackQuantities: { 'item.salt-crystal': 2 } })
    expect(bought.state.economy.limitedStockQuantitiesByVendorKey['vendor.caretaker']['item.salt-crystal']).toBe(1)
    expect(state.inventory.currency).toBe(20)

    const sellAuthorization = economy.prepare({ state: bought.state, transactionKind: 'sell', vendorKey: 'vendor.caretaker', itemKey: 'item.salt-crystal', quantity: 1 })
    expect(sellAuthorization).toMatchObject({
      price: { unitPrice: 1, totalPrice: 1, rounding: 'floor' },
      before: { currency: 16, playerItemQuantity: 2, vendorStockQuantity: 1 },
      after: { currency: 17, playerItemQuantity: 1, vendorStockQuantity: 2 },
    })
    const sold = await effects.apply({
      plan: await effects.plan({ effectKeys: ['effect.sell-caretaker'], claimKey: 'claim.sell.salt', state: bought.state, authorization: sellAuthorization }),
      state: bought.state,
    })
    expect(sold.state.inventory).toMatchObject({ currency: 17, stackQuantities: { 'item.salt-crystal': 1 } })
    expect(sold.state.economy.limitedStockQuantitiesByVendorKey['vendor.caretaker']['item.salt-crystal']).toBe(2)

    expect(() => economy.prepare({ state, transactionKind: 'buy', vendorKey: 'vendor.caretaker', itemKey: 'item.salt-crystal', quantity: 4 })).toThrow('交易当前不可执行')
    expect(() => economy.assertAuthorization({ state, authorization: { ...buyAuthorization, attitude: 'good' } })).toThrow('授权与当前状态')
    expect(() => economy.prepare({ state, transactionKind: 'sell', vendorKey: 'vendor.caretaker', itemKey: 'item.canal-seal', quantity: 1 })).toThrow('商店不支持该交易')
  })

  it('真实买卖Action携带商品与数量，支持幂等重试、事件重放并拒绝交易授权篡改', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD 经济-${crypto.randomUUID()}`,
      textOpenWorldVNext: runtimePackage,
      title: '经济Session',
      seed: 'economy-seed',
    })
    const sessionId = created.session.id!
    const bought = await executeTextOpenWorldActionV1({
      sessionId, actionKey: 'action.buy-caretaker', targetKey: 'vendor.caretaker', itemKey: 'item.salt-crystal', quantity: 2,
      commandId: 'command.economy.buy', requestedAt: 1,
    })
    expect(bought).toMatchObject({ phase: 'terminal', status: 'succeeded' })
    const sold = await executeTextOpenWorldActionV1({
      sessionId, actionKey: 'action.sell-caretaker', targetKey: 'vendor.caretaker', itemKey: 'item.salt-crystal', quantity: 1,
      commandId: 'command.economy.sell', requestedAt: 2,
    })
    expect(sold).toMatchObject({ phase: 'terminal', status: 'succeeded' })
    const after = await readProductRuntimeState(sessionId)
    expect(after.textOpenWorld!.state.inventory).toMatchObject({ currency: 17, stackQuantities: { 'item.salt-crystal': 1 } })
    expect(after.textOpenWorld!.state.economy.limitedStockQuantitiesByVendorKey['vendor.caretaker']['item.salt-crystal']).toBe(2)

    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    expect(appliedAuthorizations(events).filter(authorization => authorization.kind === 'transaction')).toMatchObject([
      { transactionKind: 'buy', vendorKey: 'vendor.caretaker', itemKey: 'item.salt-crystal', quantity: 2 },
      { transactionKind: 'sell', vendorKey: 'vendor.caretaker', itemKey: 'item.salt-crystal', quantity: 1 },
    ])
    await executeTextOpenWorldActionV1({
      sessionId, actionKey: 'action.sell-caretaker', targetKey: 'vendor.caretaker', itemKey: 'item.salt-crystal', quantity: 1,
      commandId: 'command.economy.sell', requestedAt: 3,
    })
    expect(await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()).toBe(events.length)

    await db.productRuntimeSessions.update(sessionId, { runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null })
    expect((await readProductRuntimeState(sessionId)).textOpenWorld).toEqual(after.textOpenWorld)

    const tampered = structuredClone(events)
    const appliedEvent = tampered.find(event => event.type === 'text-open-world.effects.applied'
      && JSON.parse(event.payloadJson).plan.authorization?.transactionKind === 'buy')!
    const payload = JSON.parse(appliedEvent.payloadJson)
    payload.plan.authorization.itemKey = 'item.brine-tonic'
    appliedEvent.payloadJson = JSON.stringify(payload)
    expect(() => replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), tampered)).toThrow('交易授权与命令或Action不一致')
  }, 30_000)
})

import { describe, expect, it } from 'vitest'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import {
  createTextOpenWorldInventoryCatalogV1,
} from '../../src/lib/open-world/inventory'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import type { TextOpenWorldEffectDefinitionV1 } from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function fixtureWithEffects(effects: TextOpenWorldEffectDefinitionV1[]) {
  const fixture = createTextOpenWorldVNextFixture()
  ;(fixture.modules.actions.payload as { effects: TextOpenWorldEffectDefinitionV1[] }).effects.push(...effects)
  return fixture
}

describe('Text Open World vNext · governed item definitions and inventory ledger', () => {
  it('初始堆叠物与独立实例分账保存，并保留实例获得来源', () => {
    const fixture = createTextOpenWorldVNextFixture()
    const player = (fixture.modules.actors.payload as any).player
    player.build.startingItemKeys.push('item.salt-crystal')
    const state = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    const catalog = createTextOpenWorldInventoryCatalogV1(fixture)

    expect(state.inventory).toMatchObject({
      stackQuantities: { 'item.salt-crystal': 1 },
      itemInstances: {
        'instance.initial.1.item.rust-sword': {
          itemKey: 'item.rust-sword', acquiredByClaimKey: 'initial-build', stateTags: ['new'],
        },
      },
    })
    expect(catalog.quantity(state.inventory, 'item.rust-sword')).toBe(1)
    expect(catalog.project(state.inventory)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'item.rust-sword', quantity: 1, instances: [expect.objectContaining({ acquiredByClaimKey: 'initial-build' })] }),
      expect.objectContaining({ key: 'item.salt-crystal', quantity: 1, instances: [] }),
    ]))
  })

  it('消耗与丢弃在一个EffectPlan中原子扣减库存，并与物品权限一致', async () => {
    const fixture = createTextOpenWorldVNextFixture()
    const catalog = createTextOpenWorldEffectCatalogV1(fixture)
    const state = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    state.player.health = 27
    state.inventory.stackQuantities['item.brine-tonic'] = 1
    state.inventory.stackQuantities['item.salt-crystal'] = 2

    const usePlan = await catalog.plan({
      effectKeys: ['effect.consume-brine-tonic', 'effect.restore-health'], claimKey: 'claim.use-tonic', state,
    })
    const used = await catalog.apply({ plan: usePlan, state })
    expect(used.state.player.health).toBe(37)
    expect(used.state.inventory.stackQuantities['item.brine-tonic']).toBeUndefined()

    const dropPlan = await catalog.plan({
      effectKeys: ['effect.drop-salt-crystal'], claimKey: 'claim.drop-salt', state: used.state,
    })
    const dropped = await catalog.apply({ plan: dropPlan, state: used.state })
    expect(dropped.state.inventory.stackQuantities['item.salt-crystal']).toBe(1)
  })

  it('恢复物品只在对应资源未满时进入可用Action闭集', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
    projection.state.inventory.stackQuantities['item.brine-tonic'] = 1
    expect(deriveTextOpenWorldContextsV1(projection).action.conditionResults['condition.health-not-full'])
      .toEqual({ satisfied: false, publicReason: '生命已经满了。' })
    projection.state.player.health -= 1
    expect(deriveTextOpenWorldContextsV1(projection).action.conditionResults['condition.health-not-full'])
      .toEqual({ satisfied: true, publicReason: null })
  })

  it('实例授予使用确定性ID与claim来源，唯一物品不能重复领取', async () => {
    const fixture = fixtureWithEffects([
      { key: 'effect.grant-sword', operation: 'grant-item', payload: { itemKey: 'item.rust-sword', quantity: 1 } },
      { key: 'effect.grant-canal-seal', operation: 'grant-item', payload: { itemKey: 'item.canal-seal', quantity: 1 } },
      { key: 'effect.grant-canal-seal-again', operation: 'grant-item', payload: { itemKey: 'item.canal-seal', quantity: 1 } },
    ])
    const catalog = createTextOpenWorldEffectCatalogV1(fixture)
    const state = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    const swordPlan = await catalog.plan({ effectKeys: ['effect.grant-sword'], claimKey: 'claim.loot-sword', state })
    const sword = await catalog.apply({ plan: swordPlan, state })
    expect(sword.state.inventory.itemInstances['instance.1.effect.grant-sword.1'])
      .toEqual({ itemKey: 'item.rust-sword', acquiredByClaimKey: 'claim.loot-sword', stateTags: ['new'] })

    const sealPlan = await catalog.plan({ effectKeys: ['effect.grant-canal-seal'], claimKey: 'claim.seal', state: sword.state })
    const seal = await catalog.apply({ plan: sealPlan, state: sword.state })
    await expect(catalog.plan({
      effectKeys: ['effect.grant-canal-seal-again'], claimKey: 'claim.seal-again', state: seal.state,
    })).rejects.toThrow('重复授予唯一物品')
  })

  it('堆叠上限、关键物品保护和账本分区均为fail-closed', async () => {
    const fixture = fixtureWithEffects([
      { key: 'effect.grant-salt-overflow', operation: 'grant-item', payload: { itemKey: 'item.salt-crystal', quantity: 1 } },
      { key: 'effect.drop-canal-seal', operation: 'remove-item', payload: { itemKey: 'item.canal-seal', quantity: 1, reason: 'drop' } },
    ])
    const catalog = createTextOpenWorldEffectCatalogV1(fixture)
    const state = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    state.inventory.stackQuantities['item.salt-crystal'] = 999
    await expect(catalog.plan({ effectKeys: ['effect.grant-salt-overflow'], claimKey: 'claim.overflow', state }))
      .rejects.toThrow('物品堆叠数量无效')

    const critical = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    critical.inventory.itemInstances['instance.test.canal-seal'] = {
      itemKey: 'item.canal-seal', acquiredByClaimKey: 'initial-build', stateTags: [],
    }
    await expect(catalog.plan({ effectKeys: ['effect.drop-canal-seal'], claimKey: 'claim.drop-critical', state: critical }))
      .rejects.toThrow('不能移除关键物品')

    const wrongPartition = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    wrongPartition.inventory.stackQuantities['item.rust-sword'] = 1
    await expect(catalog.plan({ effectKeys: [], claimKey: 'claim.bad-ledger', state: wrongPartition }))
      .rejects.toThrow('实例物品不能进入stackQuantities')

    const badProvenance = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    badProvenance.inventory.itemInstances['instance.bad'] = {
      itemKey: 'item.rust-sword', acquiredByClaimKey: '含空格的来源', stateTags: [],
    }
    await expect(catalog.plan({ effectKeys: [], claimKey: 'claim.bad-provenance', state: badProvenance }))
      .rejects.toThrow('acquiredByClaimKey无效')

    const missingClaim = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    missingClaim.inventory.itemInstances['instance.missing-claim'] = {
      itemKey: 'item.rust-sword', acquiredByClaimKey: 'claim.not-applied', stateTags: [],
    }
    await expect(catalog.plan({ effectKeys: [], claimKey: 'claim.missing-provenance', state: missingClaim }))
      .rejects.toThrow('获得来源没有正式claim证据')
  })

  it('发布时拒绝互相矛盾的物品定义', () => {
    const fixture = createTextOpenWorldVNextFixture()
    const critical = (fixture.modules.items.payload as any).items.find((item: any) => item.key === 'item.canal-seal')
    critical.droppable = true
    expect(() => createTextOpenWorldInventoryCatalogV1(fixture)).toThrow('关键物品保护策略无效')
  })
})

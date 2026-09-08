import { describe, expect, it } from 'vitest'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import {
  createTextOpenWorldInventoryCatalogV1,
  deriveTextOpenWorldRemovableInventoryQuantitiesV1,
} from '../../src/lib/open-world/inventory'
import {
  compileTextOpenWorldQuestFinalizeItemRuntimeContractV1,
} from '../../src/lib/open-world/quest-finalize-production'
import {
  applyTextOpenWorldSessionEventV1,
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import type {
  ProductRuntimeEvent,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldSessionProjectionV1,
} from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

function addEffects(
  runtimePackage: TextOpenWorldRuntimePackageV1,
  effects: TextOpenWorldEffectDefinitionV1[],
): void {
  ;(runtimePackage.modules.actions.payload as { effects: TextOpenWorldEffectDefinitionV1[] }).effects.push(...effects)
}

function commandEvent(input: {
  commandId: string
  actionKey: string
  actorKey: 'player' | 'system'
  targetKey: string
}): ProductRuntimeEvent {
  return {
    projectId: 1, worldGroupId: null, sessionId: 1, sequence: 1,
    type: 'text-open-world.command.committed', actorKey: input.actorKey, targetKey: input.targetKey,
    commandId: input.commandId, baseSequence: 0, baseStateHash: HASH_A, createdAt: 1,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.command-event', version: 1,
      envelope: {
        schema: 'storyforge.text-open-world.command', version: 1,
        commandId: input.commandId, sessionId: 1, actorKey: input.actorKey,
        actionKey: input.actionKey, payload: { targetKey: input.targetKey },
        baseSequence: 0, baseStateHash: HASH_A, source: 'system-action', requestedAt: 1,
      },
      requestFingerprint: HASH_B, resultingSequence: 1, resultingStateHash: HASH_C,
    }),
  }
}

async function terminalEvent(input: {
  projection: TextOpenWorldSessionProjectionV1
  commandId: string
  effectKeys: string[]
}): Promise<ProductRuntimeEvent> {
  const catalog = createTextOpenWorldEffectCatalogV1(input.projection.runtimePackage)
  const plan = await catalog.plan({
    effectKeys: input.effectKeys,
    claimKey: `claim.${input.commandId}`,
    state: input.projection.state,
  })
  const { receipt } = await catalog.apply({ plan, state: input.projection.state })
  return {
    projectId: 1, worldGroupId: null, sessionId: 1, sequence: 2,
    type: 'text-open-world.effects.applied', actorKey: 'player', targetKey: null,
    commandId: null, baseSequence: null, baseStateHash: null, createdAt: 2,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.effects-applied-event', version: 1,
      commandId: input.commandId, commandSequence: 1, ruleset: input.projection.ruleset,
      randomEventSequences: [], outcome: 'success', reason: null, degradation: null,
      plan, receipt, outcomeFingerprint: HASH_C,
    }),
  }
}

describe('R-OPEN-WORLD4 · inventory runtime contract closure', () => {
  it('P8F为消耗品、装备和可丢弃物品生成完整确定性Condition/Action/Effect', () => {
    const consumable = compileTextOpenWorldQuestFinalizeItemRuntimeContractV1({
      key: 'item.runtime-tonic', title: '验收药剂', description: '恢复生命。',
      kind: 'consumable', consumable: true, critical: false, droppable: true,
    })
    expect(consumable.conditions).toContainEqual({
      key: 'condition.use.item.runtime-tonic.health-below-maximum',
      expression: { op: 'player-resource-below-maximum', resource: 'health' },
      failureMessage: '生命已经满了。',
    })
    expect(consumable.actions.find(action => action.category === 'use')).toMatchObject({
      targetScope: 'item',
      requirementConditionKeys: ['condition.use.item.runtime-tonic.health-below-maximum'],
      costEffectKeys: ['effect.use.item.runtime-tonic.consume'],
      successEffectKeys: ['effect.use.item.runtime-tonic.restore'],
    })
    expect(consumable.actions.find(action => action.category === 'combat-item')).toMatchObject({
      requirementConditionKeys: ['condition.use.item.runtime-tonic.health-below-maximum'],
    })
    expect(consumable.actions.find(action => action.category === 'drop')).toMatchObject({
      key: 'action.drop.item.runtime-tonic', targetScope: 'item', confirmationPolicy: 'always',
      costEffectKeys: ['effect.drop.item.runtime-tonic.remove'],
    })
    expect(consumable.effects).toContainEqual({
      key: 'effect.drop.item.runtime-tonic.remove', operation: 'remove-item',
      payload: { itemKey: 'item.runtime-tonic', quantity: 1, reason: 'drop' },
    })

    const equipment = compileTextOpenWorldQuestFinalizeItemRuntimeContractV1({
      key: 'item.runtime-sword', title: '验收剑', description: '用于验收。',
      kind: 'equipment', consumable: false, critical: false, droppable: true,
    })
    expect(equipment.binding.equipConditionKeys).toEqual(['condition.equip.item.runtime-sword.not-equipped'])
    expect(equipment.actions.find(action => action.category === 'equip')).toMatchObject({
      requirementConditionKeys: ['condition.equip.item.runtime-sword.not-equipped'],
    })
    expect(equipment.actions.find(action => action.category === 'unequip')).toMatchObject({
      requirementConditionKeys: ['condition.unequip.item.runtime-sword.equipped'],
    })
    expect(equipment.conditions.map(condition => condition.expression)).toEqual(expect.arrayContaining([
      { op: 'inventory-equipped', itemKey: 'item.runtime-sword', equipped: false },
      { op: 'inventory-equipped', itemKey: 'item.runtime-sword', equipped: true },
    ]))

    const critical = compileTextOpenWorldQuestFinalizeItemRuntimeContractV1({
      key: 'item.runtime-key', title: '关键信物', description: '不可丢弃。',
      kind: 'quest', consumable: false, critical: true, droppable: false,
    })
    expect(critical.actions.some(action => action.category === 'drop')).toBe(false)
  })

  it('RuntimePackage在发布解析阶段拒绝丢弃Action的操作者、数量、确认与唯一Effect漂移', () => {
    const systemActor = createTextOpenWorldVNextFixture()
    const systemDrop = systemActor.modules.actions.payload.actions
      .find(action => action.key === 'action.drop-salt-crystal')!
    systemDrop.actorScope = 'system'
    expect(() => parseTextOpenWorldModulesV1(systemActor))
      .toThrow('丢弃Action必须由玩家固定移除一件并二次确认')

    const multipleQuantity = createTextOpenWorldVNextFixture()
    const quantityEffect = multipleQuantity.modules.actions.payload.effects
      .find(effect => effect.key === 'effect.drop-salt-crystal')
    if (!quantityEffect || quantityEffect.operation !== 'remove-item') throw new Error('fixture缺少丢弃Effect')
    quantityEffect.payload.quantity = 2
    expect(() => parseTextOpenWorldModulesV1(multipleQuantity))
      .toThrow('丢弃Action必须由玩家固定移除一件并二次确认')

    const noConfirmation = createTextOpenWorldVNextFixture()
    const unconfirmedDrop = noConfirmation.modules.actions.payload.actions
      .find(action => action.key === 'action.drop-salt-crystal')!
    unconfirmedDrop.confirmationPolicy = 'never'
    expect(() => parseTextOpenWorldModulesV1(noConfirmation))
      .toThrow('丢弃Action必须由玩家固定移除一件并二次确认')

    const duplicateRemoval = createTextOpenWorldVNextFixture()
    duplicateRemoval.modules.actions.payload.effects.push({
      key: 'effect.drop-salt-crystal-again',
      operation: 'remove-item',
      payload: { itemKey: 'item.salt-crystal', quantity: 1, reason: 'drop' },
    })
    const duplicateDrop = duplicateRemoval.modules.actions.payload.actions
      .find(action => action.key === 'action.drop-salt-crystal')!
    duplicateDrop.successEffectKeys.push('effect.drop-salt-crystal-again')
    expect(() => parseTextOpenWorldModulesV1(duplicateRemoval))
      .toThrow('物品Action没有唯一drop移除Effect')
  })

  it('正向资源变化按上限确定性clamp，负向越过零仍然fail-closed', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.player.health = projection.state.player.maximumHealth - 3
    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await catalog.plan({
      effectKeys: ['effect.restore-health'], claimKey: 'claim.partial-overflow', state: projection.state,
    })
    const applied = await catalog.apply({ plan, state: projection.state })
    expect(applied.state.player.health).toBe(projection.state.player.maximumHealth)
    expect(applied.receipt.changes).toContainEqual(expect.objectContaining({
      effectKey: 'effect.restore-health', before: projection.state.player.maximumHealth - 3,
      after: projection.state.player.maximumHealth,
      summary: expect.stringContaining('变化3（已按上限封顶）'),
    }))

    const underflowPackage = createTextOpenWorldVNextFixture()
    addEffects(underflowPackage, [{
      key: 'effect.health-underflow', operation: 'change-player-resource', payload: { resource: 'health', amount: -1_000 },
    }])
    const underflow = createInitialTextOpenWorldSessionProjectionV1(underflowPackage)
    await expect(createTextOpenWorldEffectCatalogV1(underflowPackage).plan({
      effectKeys: ['effect.health-underflow'], claimKey: 'claim.health-underflow', state: underflow.state,
    })).rejects.toThrow('会让health越界')
  })

  it('统一可移除数量让已装备的唯一实例退出丢弃和再次装备闭集', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const sword = runtimePackage.modules.items.payload.items.find(item => item.key === 'item.rust-sword')
    if (!sword) throw new Error('fixture缺少装备物品')
    sword.unique = true
    const dropEffect = runtimePackage.modules.actions.payload.effects
      .find(effect => effect.key === 'effect.drop-salt-crystal')
    if (!dropEffect || dropEffect.operation !== 'remove-item') throw new Error('fixture缺少丢弃Effect')
    dropEffect.payload.itemKey = 'item.rust-sword'
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    expect(deriveTextOpenWorldRemovableInventoryQuantitiesV1(modules, projection.state.inventory))
      .toMatchObject({ 'item.rust-sword': 1 })
    expect(createTextOpenWorldActionRegistryV1(runtimePackage)
      .project(deriveTextOpenWorldContextsV1(projection).action)
      .find(action => action.action.key === 'action.drop-salt-crystal')).toMatchObject({
        available: true, validTargetKeys: ['item.rust-sword'], confirmationRequired: true,
      })

    projection.state.inventory.equippedItemInstanceIdBySlot.weapon = 'instance.initial.1.item.rust-sword'
    const derived = deriveTextOpenWorldContextsV1(projection)
    expect(derived.action.inventoryQuantities).toMatchObject({ 'item.rust-sword': 1 })
    expect(derived.action.removableInventoryQuantities).not.toHaveProperty('item.rust-sword')
    expect(createTextOpenWorldInventoryCatalogV1(runtimePackage).project(projection.state.inventory)
      .find(item => item.key === 'item.rust-sword')).toMatchObject({
        quantity: 1, removableQuantity: 0,
        actions: { droppable: false, sellable: false, equipable: false },
      })
    expect(createTextOpenWorldActionRegistryV1(runtimePackage).project(derived.action)
      .find(action => action.action.key === 'action.drop-salt-crystal')).toMatchObject({
        available: false, validTargetKeys: [],
        unavailableReasons: expect.arrayContaining([expect.objectContaining({ code: 'item-unavailable' })]),
      })
  })

  it.each([
    { actorKey: 'player' as const, targetKey: 'item.brine-tonic', label: '伪造物品目标' },
    { actorKey: 'system' as const, targetKey: 'item.salt-crystal', label: '伪造系统操作者' },
  ])('replay拒绝$label', async ({ actorKey, targetKey }) => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const initial = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    initial.state.inventory.stackQuantities['item.salt-crystal'] = 1
    const commandId = `command.replay-binding.${actorKey}`
    const afterCommand = applyTextOpenWorldSessionEventV1(initial, commandEvent({
      commandId,
      actionKey: 'action.drop-salt-crystal',
      actorKey,
      targetKey,
    }))
    const terminal = await terminalEvent({
      projection: afterCommand,
      commandId,
      effectKeys: ['effect.drop-salt-crystal'],
    })
    expect(() => applyTextOpenWorldSessionEventV1(afterCommand, terminal))
      .toThrow('物品Action与命令操作者或目标不一致')
  })
})

import { describe, expect, it } from 'vitest'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1 } from '../../src/lib/types'
import {
  createTextOpenWorldPlayerJourneyFixtureV1,
  TEXT_OPEN_WORLD_PLAYER_JOURNEY_KEYS_V1,
} from '../helpers/text-open-world-player-journey-fixture'

describe('Text Open World G4 · parser-verified player journey fixture', () => {
  it('使用当前 fresh 运行合同，并为每个模块和完整包生成真实内容 Hash', async () => {
    const fixture = await createTextOpenWorldPlayerJourneyFixtureV1()

    expect(fixture.parsedModules).toMatchObject({
      narrative: { version: 2 },
      actions: { version: 18 },
      progression: { version: 2, sourceVersion: 2 },
      combat: { version: 4, sourceVersion: 4 },
      director: { version: 3, sourceVersion: 3 },
    })
    for (const moduleKey of TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1) {
      const module = fixture.runtimePackage.modules[moduleKey]
      expect(module.schemaVersion).toBe(Number((module.payload as { version: number }).version))
      expect(module.contentHash).toBe(await hashProductProductionValueV2(module.payload))
    }
    expect(fixture.packageHash).toBe(await hashProductProductionValueV2(fixture.runtimePackage))
  })

  it('把最终任务奖励和两套独立结局绑定到唯一收束场景与真实 Action Hash', async () => {
    const fixture = await createTextOpenWorldPlayerJourneyFixtureV1()
    const { actions, narrative, combat, director, economy, crafting } = fixture.parsedModules
    const keys = TEXT_OPEN_WORLD_PLAYER_JOURNEY_KEYS_V1
    const endingActions = actions.actions.filter(action => keys.endingActionKeys.includes(
      action.key as typeof keys.endingActionKeys[number],
    ))
    const endingScenes = narrative.scenes.filter(scene => (
      scene.sourceKind === 'quest-resolution'
        && scene.actionKeys.some(actionKey => keys.endingActionKeys.includes(
          actionKey as typeof keys.endingActionKeys[number],
        ))
    ))

    expect(endingActions).toHaveLength(2)
    expect(endingActions.map(action => action.successEffectKeys.map(effectKey => (
      actions.effects.find(effect => effect.key === effectKey)?.operation
    )))).toEqual([
      ['set-world-flag', 'unlock-ending', 'reach-ending'],
      ['set-world-flag', 'unlock-ending', 'reach-ending'],
    ])
    expect(endingActions.every(action => (
      action.confirmationPolicy === 'always'
        && action.repeatPolicy === 'once'
        && action.requirementConditionKeys.join(',') === 'condition.system.ending-selection-ready'
    ))).toBe(true)
    expect(endingScenes).toHaveLength(1)
    expect(endingScenes[0]).toMatchObject({
      key: keys.finalResolutionSceneKey,
      questKey: keys.finalQuestKey,
      actionKeys: [keys.claimActionKey, ...keys.endingActionKeys],
      fixedChoiceKeys: expect.arrayContaining([...keys.endingChoiceKeys]),
    })

    const objectiveScene = narrative.scenes.find(scene => scene.key === keys.finalObjectiveSceneKey)
    expect(objectiveScene).toMatchObject({
      questKey: keys.finalQuestKey,
      actionKeys: expect.arrayContaining([keys.completeMainObjectiveActionKey]),
      fixedChoiceKeys: expect.arrayContaining([keys.completeMainObjectiveChoiceKey]),
    })
    expect(narrative.fixedChoices.find(choice => choice.key === keys.completeMainObjectiveChoiceKey))
      .toMatchObject({
        sceneKey: keys.finalObjectiveSceneKey,
        actionKey: keys.completeMainObjectiveActionKey,
      })
    expect(actions.inputBindings.actions.find(binding => (
      binding.actionKey === keys.completeMainObjectiveActionKey
    ))).toMatchObject({
      fixedChoiceKeys: expect.arrayContaining([keys.completeMainObjectiveChoiceKey]),
    })

    for (const action of endingActions) {
      const binding = actions.inputBindings.actions.find(candidate => candidate.actionKey === action.key)
      expect(binding).toMatchObject({
        actionKey: action.key,
        actionDefinitionHash: await hashProductProductionValueV2(action),
        fixedChoiceKeys: [expect.stringContaining('choice.ending.')],
        naturalLanguage: { mode: 'existing-action-candidate', exampleUtterances: expect.any(Array) },
      })
      expect(binding?.naturalLanguage.exampleUtterances).toHaveLength(2)
      expect(binding?.resultAuthority.actionDefinitionHash).toBe(binding?.actionDefinitionHash)
    }

    expect(combat.enemies.find(enemy => enemy.key === keys.enemyKey)?.maximumHealth).toBe(1)
    expect(director.randomEvents.every(event => event.locationKeys.length === 1)).toBe(true)
    expect(economy.vendors.find(vendor => vendor.key === keys.vendorKey)?.inventoryEntries)
      .toContainEqual(expect.objectContaining({ itemKey: keys.craftMaterialKey }))
    expect(crafting.recipes.find(recipe => recipe.key === keys.recipeKey)?.ingredients)
      .toContainEqual(expect.objectContaining({ itemKey: keys.craftMaterialKey, quantity: 2 }))
  })

  it('结局前先领取最终奖励，抵达任一结局后不再投影第二次玩家变更', async () => {
    const fixture = await createTextOpenWorldPlayerJourneyFixtureV1()
    const projection = createInitialTextOpenWorldSessionProjectionV1(fixture.runtimePackage)
    const context = deriveTextOpenWorldContextsV1(projection).action
    const finalInstance = Object.entries(context.questDefinitionKeyByInstanceKey)
      .find(([, definitionKey]) => definitionKey === fixture.keys.finalQuestKey)?.[0]
    if (!finalInstance) throw new Error('纵向验收夹具缺少最终主线任务实例')

    context.questStatusByInstanceKey[finalInstance] = 'completed'
    context.questStageKeyByInstanceKey[finalInstance] = 'quest-stage.main.1'
    context.conditionResults['condition.system.ending-selection-ready'] = {
      satisfied: true,
      publicReason: null,
    }
    const registry = createTextOpenWorldActionRegistryV1(fixture.runtimePackage)
    const beforeClaim = registry.project(context)
    for (const endingActionKey of fixture.keys.endingActionKeys) {
      expect(beforeClaim.find(item => item.action.key === endingActionKey)).toMatchObject({
        available: false,
        unavailableReasons: expect.arrayContaining([expect.objectContaining({ code: 'reward-unclaimed' })]),
      })
    }
    expect(beforeClaim.find(item => item.action.key === fixture.keys.claimActionKey)).toMatchObject({
      available: true,
      validTargetKeys: [finalInstance],
    })

    context.questRewardClaimKeyByInstanceKey[finalInstance] = 'claim.quest-main.player-journey'
    const beforeEnding = registry.project(context)
    for (const endingActionKey of fixture.keys.endingActionKeys) {
      expect(beforeEnding.find(item => item.action.key === endingActionKey)).toMatchObject({ available: true })
    }

    context.reachedEndingKey = fixture.keys.endingKeys[0]
    const afterEnding = registry.project(context)
    const everyPlayerAction = afterEnding.filter(item => item.action.actorScope === 'player')
    expect(everyPlayerAction.length).toBeGreaterThan(0)
    expect(everyPlayerAction.every(item => item.unavailableReasons.some(reason => (
      reason.code === 'ending-reached'
    )))).toBe(true)
    expect(afterEnding.find(item => item.action.key === fixture.keys.endingActionKeys[1])).toMatchObject({
      available: false,
      unavailableReasons: expect.arrayContaining([expect.objectContaining({ code: 'ending-reached' })]),
    })
  })
})

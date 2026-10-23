import { describe, expect, it } from 'vitest'
import { compileTextOpenWorldItemAcquisitionsV1, parseTextOpenWorldItemAcquisitionsV1 } from '../../src/lib/open-world/item-acquisition-production'
import type { TextOpenWorldQuestFinalizeInputContextV1 } from '../../src/lib/open-world/quest-finalize-production'
import type { TextOpenWorldQuestFulfillmentSelectionsV1 } from '../../src/lib/types'
import { createTextOpenWorldConditionCatalogV1 } from '../../src/lib/open-world/condition-dsl'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import { createActionEvidenceV20Fixture } from '../helpers/text-open-world-action-evidence-fixture'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function setup(explicitSources = false) {
  const pkg = createTextOpenWorldVNextFixture()
  const actions = pkg.modules.actions.payload as any
  const items = pkg.modules.items.payload as any
  const seal = items.items.find((item: any) => item.key === 'item.canal-seal')
  const salt = items.items.find((item: any) => item.key === 'item.salt-crystal')
  const interactionKey = 'interaction.fixture.pickup'
  const action = structuredClone(actions.actions.find((item: any) => item.key === 'action.investigate-channel'))
  Object.assign(action, {
    key: `action.interaction.${interactionKey}`, requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.fixture.pickup-proof'], failureEffectKeys: [], timeCostMinutes: 0,
  })
  actions.actions.push(action)
  actions.effects.push({ key: 'effect.fixture.pickup-proof', operation: 'set-world-flag',
    payload: { flagKey: `flag.fulfillment.interaction.${interactionKey}`, value: true } })
  const context = {
    questSkeletons: {
      quests: [{ key: 'quest.main.1', type: 'mainline' }],
      objectives: [{ key: 'objective.main.1', questKey: 'quest.main.1', stageKey: 'quest-stage.main.1',
        order: 1, optional: false, playerIntent: 'collect', requirementKeys: ['requirement.pickup'] }],
    },
    itemRewardCatalog: { items: [seal, salt].map(item => ({ ...item, fulfilledRequirementKeys: ['requirement.pickup'] })) },
    craftingEconomyCatalog: { recipes: [] },
    mapInteractionCatalog: { interactions: [{ key: interactionKey, locationKey: 'location.salt-port',
      questConsumerKeys: ['quest.main.1'], fulfilledRequirementKeys: ['requirement.pickup'] }] },
  } as unknown as TextOpenWorldQuestFinalizeInputContextV1
  const fulfillment: TextOpenWorldQuestFulfillmentSelectionsV1 = {
    version: 1, objectives: [{ objectiveNumber: 1, anyActionGroups: [[1]],
      items: [{ itemNumber: 1, quantity: 1, consume: false }, { itemNumber: 2, quantity: 1, consume: false }] }],
    interactions: [{ interactionNumber: 1, consumedItems: [] }], endings: [],
  }
  if (explicitSources) {
    context.itemRewardCatalog.itemSourceContract = 'explicit-producers-v1'
    context.itemRewardCatalog.itemSourcePlans = [
      { itemKey: seal.key, sources: [{ kind: 'acquisition', sourceKey: 'objective.main.1' }] },
      { itemKey: salt.key, sources: [{ kind: 'initial', sourceKey: salt.key }] },
    ]
  }
  const selections = [{ objectiveNumber: 1, interactionNumber: 1, items: [{ itemNumber: 1, quantity: 1 }] }]
  return { pkg, actions, action, context, fulfillment, selections, interactionKey }
}

function ordinaryReplacement() {
  const fixture = setup(true)
  const { context, fulfillment, action, interactionKey } = fixture
  const pkg = createActionEvidenceV20Fixture(), actions = pkg.modules.actions.payload as any
  const parcel = (pkg.modules.items.payload as any).items.find((item: any) => item.key === 'item.canal-seal')
  Object.assign(parcel, { unique: false, critical: false, droppable: true, sellable: false, stackPolicy: 'stacked', maximumStack: 1 })
  context.itemRewardCatalog.items[0] = { ...context.itemRewardCatalog.items[0]!, ...parcel }
  context.objectiveEvidenceContract = 'action-paths-v2'
  context.npcRuntimeCatalog = { actors: [] } as any
  context.progressionCatalogs = { skills: [] } as any
  context.questSkeletons.quests[0]!.type = 'ordinary'
  context.questSkeletons.stages = [{ key: 'quest-stage.main.1', questKey: 'quest.main.1', order: 1 }] as any
  context.questSkeletons.objectives.push({ ...context.questSkeletons.objectives[0]!, key: 'objective.delivery', order: 2, playerIntent: 'interact', requirementKeys: [] })
  fulfillment.version = 2
  fulfillment.objectives[0]!.items = [{ itemNumber: 1, quantity: 1, consume: false }]
  fulfillment.objectives[0]!.groupItems = [[]]
  fulfillment.objectives.push({ objectiveNumber: 2, anyActionGroups: [], groupItems: [], items: [{ itemNumber: 1, quantity: 1, consume: true }] })
  const choices = fixture.selections.map(selection => ({ ...selection, replacementPolicy: 'missing-ordinary' as const }))
  const completion = structuredClone(actions.actions.find((item: any) => item.key === 'action.complete-main-objective'))
  Object.assign(completion, { key: 'action.delivery', successEffectKeys: ['effect.delivery'] })
  actions.actions.push(action, completion)
  for (const [added, originalKey] of [[action, 'action.investigate-channel'], [completion, 'action.complete-main-objective']] as const) {
    const binding = structuredClone(actions.inputBindings.actions.find((item: any) => item.actionKey === originalKey))
    Object.assign(binding, { key: `binding.${added.key}`, order: actions.inputBindings.actions.length + 1, actionKey: added.key, fixedChoiceKeys: [] })
    binding.resultAuthority.actionKey = added.key
    binding.naturalLanguage.exampleUtterances = [`执行${added.key}`, `选择${added.key}`]
    actions.inputBindings.actions.push(binding)
  }
  const proof = fixture.actions.effects.find((item: any) => item.key === 'effect.fixture.pickup-proof')
  proof.key = `effect.fulfillment.interaction.${interactionKey}`
  action.successEffectKeys = [proof.key]
  actions.effects.push(proof,
    { key: 'effect.delivery', operation: 'complete-objective', payload: { objectiveKey: 'objective.delivery' } },
    { key: 'effect.lose-parcel', operation: 'remove-item', payload: { itemKey: parcel.key, quantity: 1, reason: 'drop' } })
  const quests = pkg.modules.quests.payload as any
  quests.objectives.push({ ...quests.objectives[0], key: 'objective.delivery', actionKeys: [completion.key] })
  quests.stages[0].objectiveKeys.push('objective.delivery')
  const narrative = pkg.modules.narrative.payload as any
  const scene = structuredClone(narrative.scenes.find((item: any) => item.objectiveKey === 'objective.main.1'))
  Object.assign(scene, { key: 'scene.objective.delivery', order: narrative.scenes.length + 1, sourceKey: 'objective.delivery', objectiveKey: 'objective.delivery', actionKeys: [completion.key], fixedChoiceKeys: ['choice.delivery'] })
  narrative.scenes.push(scene)
  narrative.fixedChoices.push({ key: 'choice.delivery', sceneKey: scene.key, label: '交付包件', description: '完成普通包件交付。', actionKey: completion.key })
  actions.inputBindings.actions.find((item: any) => item.actionKey === completion.key).fixedChoiceKeys = ['choice.delivery']
  return { ...fixture, pkg, actions, choices, parcel }
}

describe('fixed objective item acquisition', () => {
  it.each([false, true])('requires the active stage and permit, grants evidence atomically without farming (explicit sources: %s)', async explicitSources => {
    const { pkg, actions, action, context, fulfillment, selections, interactionKey } = setup(explicitSources)
    const accepted = parseTextOpenWorldItemAcquisitionsV1(selections, context, fulfillment)
    compileTextOpenWorldItemAcquisitionsV1({ context, selections: accepted, fulfillment,
      conditions: actions.conditions, effects: actions.effects, actions: actions.actions,
      interactions: [{ interactionKey, actionKey: action.key, conditionKeys: [], effectKeys: [], questKeys: ['quest.main.1'] }],
    })
    const projection = createInitialTextOpenWorldSessionProjectionV1(pkg)
    const conditions = createTextOpenWorldConditionCatalogV1(pkg)
    const effects = createTextOpenWorldEffectCatalogV1(pkg)
    const conditionKey = action.requirementConditionKeys[0]
    const state = deriveTextOpenWorldContextsV1(projection).condition
    const available = () => conditions.evaluate(conditionKey, state).satisfied
    expect(available()).toBe(false)
    state.quests.statusByQuestKey['quest.main.1'] = 'active'
    state.quests.stageByQuestKey['quest.main.1'] = 'quest-stage.main.1'
    expect(available()).toBe(false)
    state.inventory.itemQuantities['item.salt-crystal'] = 1
    expect(available()).toBe(true)
    const plan = await effects.plan({ effectKeys: action.successEffectKeys, state: projection.state, claimKey: 'claim.pickup' })
    const result = await effects.apply({ plan, state: projection.state })
    expect(Object.values(result.state.inventory.itemInstances).filter(item => item.itemKey === 'item.canal-seal')).toHaveLength(1)
    expect(result.state.world.flags[`flag.fulfillment.interaction.${interactionKey}`]).toBe(true)
    state.world.flags[`flag.fulfillment.interaction.${interactionKey}`] = true
    expect(available()).toBe(false)
    await expect(effects.apply({ plan, state: result.state })).rejects.toThrow('基线状态已变化')
    const existing = Object.values(result.state.inventory.itemInstances).find(item => item.itemKey === 'item.canal-seal')!
    const repeat = await effects.plan({ effectKeys: action.successEffectKeys.slice(1), state: result.state, claimKey: 'claim.existing-evidence' })
    const kept = await effects.apply({ plan: repeat, state: result.state })
    expect(Object.values(kept.state.inventory.itemInstances).filter(item => item.itemKey === 'item.canal-seal')).toEqual([existing])
  })

  it('rejects an unplanned pickup even when the item and objective references are otherwise valid', () => {
    const { context, fulfillment, selections } = setup(true)
    expect(parseTextOpenWorldItemAcquisitionsV1(selections, context, fulfillment)).toEqual(selections)
    context.itemRewardCatalog.itemSourcePlans![0]!.sources = [{ kind: 'reward', sourceKey: 'reward.prior' }]
    expect(() => parseTextOpenWorldItemAcquisitionsV1(selections, context, fulfillment)).toThrow(/未计划|未选择|来源/)
    context.itemRewardCatalog.itemSourcePlans![0]!.sources = [{ kind: 'acquisition', sourceKey: 'objective.other' }]
    expect(() => parseTextOpenWorldItemAcquisitionsV1(selections, context, fulfillment)).toThrow(/未计划|未选择|来源/)
  })

  it('does not leak pickups before prior required objectives, and preserves all state when a grant fails', async () => {
    const { pkg, actions, action, context, fulfillment, selections, interactionKey } = setup()
    const quests = pkg.modules.quests.payload as any
    const pickupObjective = 'objective.fixture.pickup'
    const completion = structuredClone(actions.actions.find((item: any) => item.key === 'action.complete-main-objective'))
    completion.key = 'action.complete-fixture-pickup'
    completion.successEffectKeys = ['effect.complete-fixture-pickup']
    actions.actions.push(completion)
    actions.effects.push({ key: 'effect.complete-fixture-pickup', operation: 'complete-objective', payload: { objectiveKey: pickupObjective } })
    quests.objectives.push({ ...quests.objectives[0], key: pickupObjective, actionKeys: [action.key, completion.key] })
    quests.stages[0].objectiveKeys.push(pickupObjective)
    context.questSkeletons.objectives[0]!.key = pickupObjective
    context.questSkeletons.objectives[0]!.order = 2
    context.questSkeletons.objectives.push({ ...context.questSkeletons.objectives[0]!, key: 'objective.main.1', order: 1, requirementKeys: [] })
    compileTextOpenWorldItemAcquisitionsV1({ context, selections, fulfillment,
      conditions: actions.conditions, effects: actions.effects, actions: actions.actions,
      interactions: [{ interactionKey, actionKey: action.key, conditionKeys: [], effectKeys: [], questKeys: ['quest.main.1'] }],
    })
    const projection = createInitialTextOpenWorldSessionProjectionV1(pkg)
    const conditions = createTextOpenWorldConditionCatalogV1(pkg)
    const state = deriveTextOpenWorldContextsV1(projection).condition
    state.quests.statusByQuestKey['quest.main.1'] = 'active'
    state.quests.stageByQuestKey['quest.main.1'] = 'quest-stage.main.1'
    state.inventory.itemQuantities['item.salt-crystal'] = 1
    expect(conditions.evaluate(action.requirementConditionKeys[0], state).satisfied).toBe(false)
    state.quests.objectiveStatusByKey['objective.main.1'] = 'completed'
    expect(conditions.evaluate(action.requirementConditionKeys[0], state).satisfied).toBe(true)
    // The preceding proof must not survive a failed later inventory operation.
    const effects = createTextOpenWorldEffectCatalogV1(pkg)
    const before = structuredClone(projection.state)
    await expect(effects.plan({ effectKeys: [...action.successEffectKeys, 'effect.drop-salt-crystal'],
      state: projection.state, claimKey: 'claim.failed-pickup' })).rejects.toThrow(/物品|不足|数量/)
    expect(projection.state).toEqual(before)
  })

  it('rejects shared/template/foreign pickups, materials, repeated selections and consumptive repairs', () => {
    const { context, fulfillment, selections } = setup()
    expect(parseTextOpenWorldItemAcquisitionsV1(selections, context, fulfillment)).toEqual(selections)
    const reject = (mutate: (copy: typeof context, choices: typeof selections, bindings: typeof fulfillment) => void) => {
      const copy = structuredClone(context), choices = structuredClone(selections), bindings = structuredClone(fulfillment)
      mutate(copy, choices, bindings)
      expect(() => parseTextOpenWorldItemAcquisitionsV1(choices, copy, bindings)).toThrow(/领取/)
    }
    reject(copy => { copy.questSkeletons.quests[0]!.type = 'template' })
    reject(copy => { copy.mapInteractionCatalog.interactions[0]!.questConsumerKeys.push('quest.other') })
    reject(copy => { copy.itemRewardCatalog.items[0]!.fulfilledRequirementKeys = ['requirement.other'] })
    reject((_copy, choices) => { choices[0]!.items[0]!.itemNumber = 2 })
    reject((_copy, choices) => { choices.push(structuredClone(choices[0]!)) })
    reject((_copy, _choices, bindings) => { bindings.interactions[0]!.consumedItems = [{ itemNumber: 2, quantity: 1 }] })
  })
  it('allows a missing ordinary parcel before delivery, never duplicates it or permits resale/finished-task farming', async () => {
    const { pkg, actions, action, context, fulfillment, choices, interactionKey, parcel } = ordinaryReplacement()
    const selections = parseTextOpenWorldItemAcquisitionsV1(choices, context, fulfillment)
    compileTextOpenWorldItemAcquisitionsV1({ context, selections, fulfillment,
      conditions: actions.conditions, effects: actions.effects, actions: actions.actions,
      interactions: [{ interactionKey, actionKey: action.key, conditionKeys: [], effectKeys: [], questKeys: ['quest.main.1'] }],
    })
    const projection = createInitialTextOpenWorldSessionProjectionV1(pkg)
    const conditions = createTextOpenWorldConditionCatalogV1(pkg), effects = createTextOpenWorldEffectCatalogV1(pkg)
    const available = (status = 'active', delivered = false) => {
      const state = deriveTextOpenWorldContextsV1(projection).condition
      state.quests.statusByQuestKey['quest.main.1'] = status as 'active'
      state.quests.stageByQuestKey['quest.main.1'] = 'quest-stage.main.1'
      state.quests.objectiveStatusByKey['objective.delivery'] = delivered ? 'completed' : 'active'
      return conditions.evaluate(action.requirementConditionKeys[0], state).satisfied
    }
    const apply = async (keys: string[], claimKey: string) => {
      const plan = await effects.plan({ state: projection.state, effectKeys: keys, claimKey })
      projection.state = (await effects.apply({ state: projection.state, plan })).state
    }
    expect(available('abandoned')).toBe(false)
    expect(available()).toBe(true)
    await apply(action.successEffectKeys, 'parcel.first')
    expect(available()).toBe(false)
    expect(deriveTextOpenWorldContextsV1(projection).condition.inventory.itemQuantities[parcel.key]).toBe(1)
    await apply(['effect.lose-parcel'], 'parcel.lost')
    expect(projection.state.world.flags[`flag.fulfillment.interaction.${interactionKey}`]).toBe(true)
    expect(available()).toBe(true)
    expect(available('abandoned')).toBe(false)
    expect(available('active', true)).toBe(false)
    // The next accepted ordinary run still cannot farm a held parcel; a lost
    // parcel can be replaced while its delivery remains outstanding.
    await apply(action.successEffectKeys, 'parcel.replaced')
    expect(deriveTextOpenWorldContextsV1(projection).condition.inventory.itemQuantities[parcel.key]).toBe(1)
    expect(available()).toBe(false)
    expect(parcel.sellable).toBe(false)
  })

  it('rejects replacement for protected/sellable items and missing, preceding, duplicate or foreign deliveries', () => {
    const base = ordinaryReplacement()
    const reject = (change: (value: ReturnType<typeof ordinaryReplacement>) => void) => {
      const copy = structuredClone(base); change(copy)
      expect(() => parseTextOpenWorldItemAcquisitionsV1(copy.choices, copy.context, copy.fulfillment)).toThrow(/补领/)
    }
    expect(parseTextOpenWorldItemAcquisitionsV1(base.choices, base.context, base.fulfillment)).toEqual(base.choices)
    reject(value => { value.context.itemRewardCatalog.items[0]!.critical = true })
    reject(value => { value.context.itemRewardCatalog.items[0]!.unique = true })
    reject(value => { value.context.itemRewardCatalog.items[0]!.sellable = true })
    reject(value => { value.context.questSkeletons.quests[0]!.type = 'mainline' })
    reject(value => { value.fulfillment.objectives[1]!.items = [] })
    reject(value => { value.context.questSkeletons.objectives[1]!.order = 0 })
    reject(value => { value.fulfillment.objectives.push(structuredClone(value.fulfillment.objectives[1]!)) })
    reject(value => { value.context.questSkeletons.quests.push({ ...value.context.questSkeletons.quests[0]!, key: 'quest.foreign' }); value.context.questSkeletons.objectives[1]!.questKey = 'quest.foreign' })
    const legacy = structuredClone(base.context); delete legacy.objectiveEvidenceContract
    expect(() => parseTextOpenWorldItemAcquisitionsV1(base.choices, legacy, base.fulfillment)).toThrow('字段不精确')
  })

})

import { expect } from 'vitest'
import type { TextOpenWorldEffectPlanV1, TextOpenWorldItemRewardCatalogV1, TextOpenWorldQuestDesignDocumentsV1, TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { createTextOpenWorldEconomyCatalogV1 } from '../../src/lib/open-world/economy'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createTextOpenWorldObjectiveCatalogV1 } from '../../src/lib/open-world/objective-state'
import { createTextOpenWorldQuestTransitionCatalogV1 } from '../../src/lib/open-world/quest-state-machine'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'

/** Production-fixture evidence through the actual P8 -> P8F -> P9 -> P10
 * package. Only unrelated starting prerequisites are fixture state. Every
 * pickup, loss, delivery and recognition below uses the compiled Action batch.
 * This is not a model response, human playthrough or production Release. */
export async function assertTextOpenWorldDeliveryRecognitionRuntimeV1(pkg: TextOpenWorldRuntimePackageV1,
  items: TextOpenWorldItemRewardCatalogV1, quests: TextOpenWorldQuestDesignDocumentsV1): Promise<Record<string, number>> {
  const modules = parseTextOpenWorldModulesV1(pkg)
  expect(modules.actions.version).toBe(21)
  const rejectTamper = (mutate: (copy: TextOpenWorldRuntimePackageV1) => void) => {
    const copy = structuredClone(pkg)
    mutate(copy)
    expect(() => parseTextOpenWorldModulesV1(copy)).toThrow()
  }
  rejectTamper(copy => {
    copy.modules.actions.schemaVersion = 20
    ;(copy.modules.actions.payload as any).version = 20
  })
  rejectTamper(copy => {
    const actionModule = copy.modules.actions.payload as any
    actionModule.effects.find((effect: any) => effect.key.startsWith('effect.recognition.')).payload.amount = 99
  })
  rejectTamper(copy => {
    const actionModule = copy.modules.actions.payload as any
    const grant = actionModule.effects.find((effect: any) => effect.key.startsWith('effect.recognition.'))
    ;(copy.modules.items.payload as any).rewardContracts[0].effectKeys.push(grant.key)
  })
  const registry = createTextOpenWorldActionRegistryV1(pkg)
  const effects = createTextOpenWorldEffectCatalogV1(pkg)
  const objectives = createTextOpenWorldObjectiveCatalogV1(pkg)
  const transitions = createTextOpenWorldQuestTransitionCatalogV1(pkg)
  const economy = createTextOpenWorldEconomyCatalogV1(pkg)
  type Projection = ReturnType<typeof createInitialTextOpenWorldSessionProjectionV1>
  const instanceFor = (projection: Projection, questKey: string) => Object.values(projection.state.quests.instancesByKey).find(row => row.definitionKey === questKey)!
  const locate = (projection: Projection, locationKey: string) => {
    projection.state.map.currentLocationKey = locationKey
    projection.state.map.locationKnowledgeByKey[locationKey] = 'visited'
    projection.state.map.regionKnowledgeByKey[modules.world.locations.find(row => row.key === locationKey)!.regionKey] = 'visited'
    if (!projection.state.map.revealedLocationKeys.includes(locationKey)) projection.state.map.revealedLocationKeys.push(locationKey)
  }
  const active = (projection: Projection, objectiveKey: string) => {
    const objective = quests.objectives.find(row => row.key === objectiveKey)!
    const instance = instanceFor(projection, objective.questKey)
    Object.assign(instance, { status: 'active', currentStageKey: objective.stageKey,
      offeredAtWorldMinute: projection.state.time.worldMinute, acceptedAtWorldMinute: projection.state.time.worldMinute })
    for (const row of quests.objectives.filter(row => row.questKey === objective.questKey)) instance.objectiveStatusByKey[row.key] = 'active'
    if (quests.quests.find(row => row.key === objective.questKey)!.type === 'ordinary') {
      projection.state.director.activeQuestInstanceKeys = [instance.instanceKey]
      projection.state.director.revealedQuestInstanceKeys = [instance.instanceKey]
      projection.director = structuredClone(projection.state.director)
    }
    return instance.instanceKey
  }
  const entry = (projection: Projection, actionKey: string) => registry.project(deriveTextOpenWorldContextsV1(projection).action).find(row => row.action.key === actionKey)!
  const prepare = async (projection: Projection, actionKey: string, claimKey: string) => {
    const available = entry(projection, actionKey)
    expect(available.available, JSON.stringify({ actionKey, reasons: available.unavailableReasons })).toBe(true)
    const targetKey = available.validTargetKeys[0] ?? null
    const action = registry.resolve({ actionKey, targetKey, context: deriveTextOpenWorldContextsV1(projection).action }).entry.action
    const definitions = action.successEffectKeys.map(key => modules.actions.effects.find(row => row.key === key)!)
    const completed = definitions.find(row => row.operation === 'complete-objective')
    const changed = definitions.filter(row => row.operation === 'transition-quest')
    const authorization: TextOpenWorldEffectPlanV1['authorization'] | undefined = completed?.operation === 'complete-objective'
      ? objectives.prepare({ instanceKey: targetKey!, objectiveKey: completed.payload.objectiveKey, state: projection.state })
      : changed.length ? transitions.prepare({ instanceKey: targetKey!, state: projection.state,
        transitions: changed.map(row => ({ toStatus: row.payload.status, stageKey: row.payload.stageKey })) }) : undefined
    return effects.plan({ effectKeys: [...action.costEffectKeys, ...action.successEffectKeys], state: projection.state, claimKey, authorization })
  }
  const perform = async (projection: Projection, actionKey: string, claimKey: string) => {
    const plan = await prepare(projection, actionKey, claimKey)
    projection.state = (await effects.apply({ plan, state: projection.state })).state
    projection.director = structuredClone(projection.state.director)
    return plan
  }

  expect(items.ordinaryDeliveryPlans).toHaveLength(2)
  for (const delivery of items.ordinaryDeliveryPlans!) {
    const projection = createInitialTextOpenWorldSessionProjectionV1(pkg)
    const parcel = modules.items.items.find(row => row.key === delivery.itemKey)!
    expect(parcel).toMatchObject({ kind: 'misc', critical: false, unique: false, droppable: true, sellable: false, baseValue: 0 })
    const pickup = modules.actions.actions.find(action => action.successEffectKeys.some(key => {
      const effect = modules.actions.effects.find(row => row.key === key)
      return effect?.operation === 'grant-item' && effect.payload.itemKey === parcel.key
    }))!
    expect(pickup.key).toMatch(/^action.interaction\./)
    locate(projection, pickup.locationKeys[0]!)
    expect(entry(projection, pickup.key).available).toBe(false)
    const instanceKey = active(projection, delivery.pickupObjectiveKey)
    const questKey = projection.state.quests.instancesByKey[instanceKey]!.definitionKey
    const originalCurrency = projection.state.inventory.currency
    const first = await perform(projection, pickup.key, `claim.first.${parcel.key}`)
    expect(projection.state.inventory.stackQuantities[parcel.key]).toBe(1)
    expect(entry(projection, pickup.key).available).toBe(false)
    await expect(effects.apply({ plan: first, state: projection.state })).rejects.toThrow()
    const sell = economy.project({ state: projection.state }).flatMap(row => row.sell).filter(row => row.item.key === parcel.key)
    expect(sell.length).toBeGreaterThan(0)
    expect(sell.every(row => !row.available && row.unavailableReasons.includes('item-protected'))).toBe(true)
    for (const vendor of modules.economy.vendors) expect(() => economy.prepare({ state: projection.state,
      vendorKey: vendor.key, transactionKind: 'sell', itemKey: parcel.key, quantity: 1 })).toThrow()
    expect(projection.state.inventory.currency).toBe(originalCurrency)
    const pickupObjective = quests.objectives.find(row => row.key === delivery.pickupObjectiveKey)!
    await perform(projection, pickupObjective.completionActionKey, `claim.picked.${parcel.key}`)
    await perform(projection, `action.drop.${parcel.key}`, `claim.lost.${parcel.key}`)
    expect(projection.state.inventory.stackQuantities[parcel.key] ?? 0).toBe(0)
    expect(entry(projection, pickup.key).available).toBe(true)
    const abandon = quests.quests.find(row => row.key === questKey)!.abandonActionKey!
    await perform(projection, abandon, `claim.abandon.${parcel.key}`)
    expect(entry(projection, pickup.key).available).toBe(false)
    const offer = modules.narrative.scenes.find(row => 'sourceKind' in row && row.sourceKind === 'quest-offer'
      && 'questKey' in row && row.questKey === questKey)!
    locate(projection, offer.locationKey)
    await perform(projection, `action.restart.${questKey}`, `claim.restart.${parcel.key}`)
    locate(projection, pickup.locationKeys[0]!)
    await perform(projection, pickup.key, `claim.replaced.${parcel.key}`)
    expect(projection.state.inventory.stackQuantities[parcel.key]).toBe(1)
    expect(entry(projection, pickup.key).available).toBe(false)
    await perform(projection, pickupObjective.completionActionKey, `claim.repicked.${parcel.key}`)
    const handover = quests.objectives.find(row => row.key === delivery.deliveryObjectiveKey)!
    locate(projection, modules.actions.actions.find(row => row.key === handover.completionActionKey)!.locationKeys[0]!)
    const ready = await prepare(projection, handover.completionActionKey, `claim.deliver.${parcel.key}`)
    const before = structuredClone(projection.state)
    // The final inventory failure must roll back both removal and completion.
    await expect(effects.plan({ state: projection.state, claimKey: `claim.failed.${parcel.key}`, authorization: ready.authorization,
      effectKeys: [...modules.actions.actions.find(row => row.key === handover.completionActionKey)!.costEffectKeys,
        ...modules.actions.actions.find(row => row.key === handover.completionActionKey)!.successEffectKeys,
        `effect.drop.${parcel.key}.remove`] })).rejects.toThrow()
    expect(projection.state).toEqual(before)
    projection.state = (await effects.apply({ plan: ready, state: projection.state })).state
    projection.director = structuredClone(projection.state.director)
    expect(projection.state.inventory.stackQuantities[parcel.key] ?? 0).toBe(0)
    expect(projection.state.quests.instancesByKey[instanceKey]!.objectiveStatusByKey[handover.key]).toBe('completed')
    expect(entry(projection, pickup.key).available).toBe(false)
    expect(entry(projection, handover.completionActionKey).available).toBe(false)
    expect(projection.state.inventory.currency).toBe(originalCurrency)
  }

  const projection = createInitialTextOpenWorldSessionProjectionV1(pkg)
  expect(quests.mainlineRecognitionSelections).toHaveLength(2)
  for (const selection of quests.mainlineRecognitionSelections!) {
    const objective = quests.objectives[selection.objectiveNumber - 1]!
    const owner = modules.actions.actions.find(row => row.key === objective.completionActionKey)!
    const proof = modules.actions.actions.find(row => row.key.startsWith(`action.dialogue.${objective.key}.`))!
    expect(proof).toBeDefined()
    expect(entry(projection, owner.key).available).toBe(false)
    const instanceKey = active(projection, objective.key)
    locate(projection, proof.locationKeys[0]!)
    const before = structuredClone(projection.state.relationships.factionAffinityByKey)
    expect(entry(projection, owner.key).available).toBe(false)
    await perform(projection, proof.key, `claim.public-proof.${objective.key}`)
    expect(projection.state.relationships.factionAffinityByKey).toEqual(before)
    const locationKey = projection.state.map.currentLocationKey
    locate(projection, modules.world.locations.find(row => !owner.locationKeys.includes(row.key))!.key)
    expect(entry(projection, owner.key).available).toBe(false)
    locate(projection, locationKey)
    const grants = owner.successEffectKeys.map(key => modules.actions.effects.find(row => row.key === key)!).filter(row => row.operation === 'change-faction-affinity')
    // A later recognition-capacity failure cannot commit the preceding target
    // completion. This is an isolated boundary state, not earned reputation.
    const fullState = structuredClone(projection.state)
    for (const grant of grants) fullState.relationships.factionAffinityByKey[grant.payload.factionKey] = modules.relationships.factionAffinity.maximum
    const unchanged = structuredClone(fullState)
    const authorization = objectives.prepare({ instanceKey, objectiveKey: objective.key, state: fullState })
    await expect(effects.plan({ state: fullState, effectKeys: [...owner.costEffectKeys, ...owner.successEffectKeys],
      claimKey: `claim.failed-recognition.${objective.key}`, authorization })).rejects.toThrow()
    expect(fullState).toEqual(unchanged)
    expect(fullState.quests.instancesByKey[instanceKey]!.objectiveStatusByKey[objective.key]).toBe('active')
    const plan = await perform(projection, owner.key, `claim.recognition.${objective.key}`)
    expect(projection.state.quests.instancesByKey[instanceKey]!.objectiveStatusByKey[objective.key]).toBe('completed')
    expect(grants).toHaveLength(selection.factionNumbers.length)
    for (const grant of grants) expect(projection.state.relationships.factionAffinityByKey[grant.payload.factionKey])
      .toBe((before[grant.payload.factionKey] ?? 0) + 10)
    expect(entry(projection, owner.key).available).toBe(false)
    const after = structuredClone(projection.state)
    await expect(effects.apply({ plan, state: projection.state })).rejects.toThrow()
    expect(projection.state).toEqual(after)
  }
  expect(Object.values(projection.state.quests.instancesByKey).filter(instance => instance.status === 'completed'
    && quests.quests.some(quest => quest.key === instance.definitionKey && quest.type === 'significant'))).toEqual([])
  return structuredClone(projection.state.relationships.factionAffinityByKey)
}

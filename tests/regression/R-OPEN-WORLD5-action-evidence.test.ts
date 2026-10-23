import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { createTextOpenWorldConditionCatalogV1 } from '../../src/lib/open-world/condition-dsl'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { buildTextOpenWorldObjectiveFulfillmentDemandsV1, compileTextOpenWorldObjectiveFulfillmentV1, parseTextOpenWorldQuestFulfillmentSelectionsV1 } from '../../src/lib/open-world/objective-fulfillment-production'
import { projectTextOpenWorldPlayerCraftingEconomyReceiptV1 } from '../../src/lib/open-world/player-crafting-economy'
import type { TextOpenWorldQuestFinalizeInputContextV1 } from '../../src/lib/open-world/quest-finalize-production'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { createActionEvidenceV19Fixture, createActionEvidenceV20Fixture } from '../helpers/text-open-world-action-evidence-fixture'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'

function paths() {
  const pkg = createActionEvidenceV20Fixture()
  const source = pkg.modules.actions.payload as any
  const items = (pkg.modules.items.payload as any).items.filter((item: any) => ['item.salt-crystal', 'item.brine-tonic', 'item.rust-sword'].includes(item.key))
  const context = {
    objectiveEvidenceContract: 'action-paths-v2',
    questSkeletons: { quests: [{ key: 'quest.main.1', type: 'mainline' }], objectives: [{ key: 'objective.main.1', questKey: 'quest.main.1', stageKey: 'quest-stage.main.1', playerIntent: 'interact', requirementKeys: ['requirement.path', 'requirement.material'] }] },
    itemRewardCatalog: { items: items.map((item: any) => ({ ...item, fulfilledRequirementKeys: ['requirement.material'] })) },
    craftingEconomyCatalog: { recipes: [], vendors: [] }, npcRuntimeCatalog: { actors: [] }, progressionCatalogs: { skills: [] },
    mapInteractionCatalog: { interactions: [1, 2].map(number => ({ key: `interaction.path.${number}`, playerPrompt: `安装路径${number}`, locationKey: 'location.salt-port', questConsumerKeys: ['quest.main.1'], fulfilledRequirementKeys: ['requirement.path'] })) },
    mainlineThread: { endingRoutes: [], thread: { endingKeys: [] } },
  } as unknown as TextOpenWorldQuestFinalizeInputContextV1
  const salt = context.itemRewardCatalog.items.findIndex(item => item.key === 'item.salt-crystal') + 1
  const tonic = context.itemRewardCatalog.items.findIndex(item => item.key === 'item.brine-tonic') + 1
  const choices = { version: 2, objectives: [{ objectiveNumber: 1, anyActionGroups: [[1], [2]], groupItems: [[{ itemNumber: salt, quantity: 1 }], [{ itemNumber: tonic, quantity: 2 }]], items: [] }], interactions: [1, 2].map(interactionNumber => ({ interactionNumber, consumedItems: [] })), endings: [] }
  const actions = [structuredClone(source.actions.find((action: any) => action.key === 'action.complete-main-objective'))]
  context.mapInteractionCatalog.interactions.forEach(interaction => actions.push({ ...structuredClone(actions[0]), key: `action.interaction.${interaction.key}`, successEffectKeys: [], costEffectKeys: [], requirementConditionKeys: [] }))
  const compiled = { context, selections: parseTextOpenWorldQuestFulfillmentSelectionsV1(choices, context), conditions: [] as any[], effects: [] as any[], actions,
    objectives: [{ key: 'objective.main.1', completionActionKey: actions[0].key, supportActionKeys: [] }] as any,
    interactions: context.mapInteractionCatalog.interactions.map(interaction => ({ interactionKey: interaction.key, conditionKeys: [], effectKeys: [] })) as any,
    endings: [] as any, actors: [] as any[] }
  return { pkg, context, choices, compiled, salt, tonic }
}

describe('P8F v6 actual action evidence', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('binds held quantities separately to each alternative and keeps old selections unchanged', () => {
    const { pkg, context, choices, compiled } = paths()
    compileTextOpenWorldObjectiveFulfillmentV1(compiled)
    const condition = compiled.conditions.find(condition => condition.key.endsWith('.operations'))
    ;(pkg.modules.actions.payload as any).conditions.push(condition)
    const catalog = createTextOpenWorldConditionCatalogV1(pkg)
    const state = deriveTextOpenWorldContextsV1(createInitialTextOpenWorldSessionProjectionV1(pkg)).condition
    const available = () => catalog.evaluate(condition.key, state).satisfied
    state.world.flags['flag.fulfillment.interaction.interaction.path.2'] = true
    state.inventory.itemQuantities['item.brine-tonic'] = 1
    expect(available()).toBe(false)
    state.inventory.itemQuantities['item.brine-tonic'] = 2
    expect(available()).toBe(true)
    state.inventory.itemQuantities['item.brine-tonic'] = 0
    state.inventory.itemQuantities['item.salt-crystal'] = 1
    expect(available()).toBe(false)
    state.world.flags['flag.fulfillment.interaction.interaction.path.1'] = true
    expect(available()).toBe(true)
    expect(compiled.actions[0].costEffectKeys).toEqual([])
    const legacy = structuredClone(context); delete legacy.objectiveEvidenceContract
    const old = structuredClone(choices) as any; old.version = 1; delete old.objectives[0].groupItems
    expect(parseTextOpenWorldQuestFulfillmentSelectionsV1(old, legacy)).toEqual(old)
    expect(() => parseTextOpenWorldQuestFulfillmentSelectionsV1(old, context)).toThrow('version')
    const missing = structuredClone(choices); missing.objectives[0].groupItems.pop()
    expect(() => parseTextOpenWorldQuestFulfillmentSelectionsV1(missing, context)).toThrow('逐组')
  })

  it('rejects material requirements after installation has already consumed the same item', () => {
    const { context, choices, salt } = paths()
    choices.interactions[0]!.consumedItems = [{ itemNumber: salt, quantity: 1 }] as never[]
    expect(() => parseTextOpenWorldQuestFulfillmentSelectionsV1(choices, context)).toThrow('重复交付')
    choices.objectives[0]!.groupItems = [[], []]
    expect(() => parseTextOpenWorldQuestFulfillmentSelectionsV1(choices, context)).not.toThrow()
    context.itemRewardCatalog.items[salt - 1]!.fulfilledRequirementKeys = ['requirement.unrelated']
    expect(() => parseTextOpenWorldQuestFulfillmentSelectionsV1(choices, context)).toThrow('冻结物品需求')
  })

  it('compiles explicit teaching and rejects a dialogue-only path for a skill lesson', () => {
    const { context, choices, compiled } = paths()
    context.questSkeletons.objectives[0]!.playerIntent = 'dialogue'
    context.mapInteractionCatalog.interactions = []
    context.progressionCatalogs.skills = [{ key: 'skill.power-strike', title: '调息', fulfilledRequirementKeys: ['requirement.path'] }] as any
    context.npcRuntimeCatalog.actors = [{ key: 'actor.caretaker', name: '分水人', homeLocationKey: 'location.salt-port', fulfilledRequirementKeys: ['requirement.path'] }] as any
    const candidates = buildTextOpenWorldObjectiveFulfillmentDemandsV1(context)[0]!.candidates
    expect(candidates.map(item => item.kind)).toEqual(['teaching'])
    choices.objectives[0].anyActionGroups = [[1]]; choices.objectives[0].groupItems = [[]]; choices.interactions = []
    compiled.selections = parseTextOpenWorldQuestFulfillmentSelectionsV1(choices, context)
    compiled.actors = [{ actorKey: 'actor.caretaker', actionKeys: [] }]
    compileTextOpenWorldObjectiveFulfillmentV1(compiled)
    expect(compiled.effects).toContainEqual(expect.objectContaining({ operation: 'learn-skill', payload: { skillKey: 'skill.power-strike', ifUnknown: true } }))
    expect(compiled.actors[0].actionKeys).toContain(candidates[0]!.actionKey)
    expect(compiled.objectives[0].supportActionKeys).toContain(candidates[0]!.actionKey)
    choices.objectives[0].anyActionGroups = []; choices.objectives[0].groupItems = []
    expect(() => parseTextOpenWorldQuestFulfillmentSelectionsV1(choices, context)).toThrow(/跳过/)
  })

  it('checks actual learned state and keeps teaching/reward learning idempotent only in the new contract', async () => {
    const pkg = createActionEvidenceV20Fixture(); const actions = pkg.modules.actions.payload as any
    actions.effects.push({ key: 'effect.teach.fixture', operation: 'learn-skill', payload: { skillKey: 'skill.power-strike', ifUnknown: true } })
    actions.conditions.push({ key: 'condition.learned.fixture', expression: { op: 'player-skill', skillKey: 'skill.power-strike', known: true }, failureMessage: '请先学会技能' })
    const projection = createInitialTextOpenWorldSessionProjectionV1(pkg)
    projection.state.player.learnedSkillKeys = projection.state.player.learnedSkillKeys.filter(key => key !== 'skill.power-strike')
    const effects = createTextOpenWorldEffectCatalogV1(pkg), conditions = createTextOpenWorldConditionCatalogV1(pkg)
    expect(conditions.evaluate('condition.learned.fixture', deriveTextOpenWorldContextsV1(projection).condition).satisfied).toBe(false)
    for (const claimKey of ['lesson.first', 'lesson.reward']) {
      const plan = await effects.plan({ state: projection.state, effectKeys: ['effect.teach.fixture'], claimKey })
      projection.state = (await effects.apply({ state: projection.state, plan })).state
    }
    expect(projection.state.player.learnedSkillKeys.filter(key => key === 'skill.power-strike')).toHaveLength(1)
    expect(conditions.evaluate('condition.learned.fixture', deriveTextOpenWorldContextsV1(projection).condition).satisfied).toBe(true)
    const legacy = createActionEvidenceV19Fixture(); (legacy.modules.actions.payload as any).effects.push(actions.effects.find((effect: any) => effect.key === 'effect.teach.fixture'))
    expect(() => createTextOpenWorldEffectCatalogV1(legacy)).toThrow('新版合同')
  })

  it('commits proof only for the purchased item, replays atomically and rejects receipt/proof tampering', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({ name: `Purchase evidence ${crypto.randomUUID()}`, textOpenWorldVNext: createActionEvidenceV20Fixture(), runtimeShape: 'vnext-only', title: 'Purchase proof', seed: 'purchase-proof' })
    const sessionId = created.session.id!
    const before = await readProductRuntimeState(sessionId)
    const input = { sessionId, actionKey: 'action.buy-caretaker', targetKey: 'vendor.caretaker', itemKey: 'item.salt-crystal', quantity: 1, commandId: 'command.purchase.proof', requestedAt: 1 }
    const receipt = await executeTextOpenWorldActionV1(input)
    expect(receipt).toMatchObject({ phase: 'terminal', status: 'succeeded', outcomeCommitted: true })
    const after = await readProductRuntimeState(sessionId)
    expect(after.textOpenWorld!.state.world.flags['flag.fulfillment.purchase.vendor.caretaker.item.salt-crystal']).toBe(true)
    expect(after.textOpenWorld!.state.world.flags['flag.fulfillment.purchase.vendor.caretaker.item.brine-tonic']).toBeUndefined()
    const publicInput = { projection: before.textOpenWorld!, runtimeEventSequence: before.lastSequence, request: { ...input, kind: 'buy' as const, expectedBaseSequence: before.lastSequence }, receipt }
    expect(projectTextOpenWorldPlayerCraftingEconomyReceiptV1(publicInput).message).toContain('已购买')
    for (const mutation of ['missing', 'reversed', 'before', 'after', 'domain']) {
      const changed = structuredClone(receipt)
      if (mutation === 'missing') changed.changes.pop()
      if (mutation === 'reversed') changed.changes.reverse()
      if (mutation === 'before') changed.changes[1]!.before = true
      if (mutation === 'after') changed.changes[1]!.after = false
      if (mutation === 'domain') changed.changes[1]!.domain = 'inventory'
      expect(() => projectTextOpenWorldPlayerCraftingEconomyReceiptV1({ ...publicInput, receipt: changed })).toThrow()
    }
    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    expect(replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), events).textOpenWorld).toEqual(after.textOpenWorld)
    await executeTextOpenWorldActionV1(input)
    expect(await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()).toBe(events.length)
    const effects = createTextOpenWorldEffectCatalogV1(after.textOpenWorld!.runtimePackage)
    await expect(effects.plan({ state: after.textOpenWorld!.state, effectKeys: ['effect.fulfillment.purchase.vendor.caretaker'], claimKey: 'fake.purchase' })).rejects.toThrow('不能脱离')
    await expect(executeTextOpenWorldActionV1({ ...input, quantity: 999, commandId: 'command.purchase.failed', requestedAt: 2 })).rejects.toThrow('交易数量')
    expect((await readProductRuntimeState(sessionId)).textOpenWorld!.state.inventory).toEqual(after.textOpenWorld!.state.inventory)
    const forged = createActionEvidenceV20Fixture(); const actions = forged.modules.actions.payload as any
    actions.effects.push({ key: 'effect.forge.purchase', operation: 'set-world-flag', payload: { flagKey: 'flag.fulfillment.purchase.vendor.caretaker.item.brine-tonic', value: true } })
    expect(() => parseTextOpenWorldModulesV1(forged)).toThrow('伪造购买')
    const old = createActionEvidenceV19Fixture(); (old.modules.actions.payload as any).effects.push({ key: 'effect.proof', operation: 'prove-purchase', payload: { vendorKey: 'vendor.caretaker' } })
    expect(() => parseTextOpenWorldModulesV1(old)).toThrow('旧Action')
  }, 60_000)

  it('hands over only an unequipped noncritical equipment instance and preserves inventory on failure', async () => {
    const pkg = createActionEvidenceV20Fixture(); const actions = pkg.modules.actions.payload as any
    const owner = actions.actions.find((item: any) => item.key === 'action.complete-main-objective')
    const conditionKey = 'condition.handover.sword', effectKey = 'effect.handover.sword'
    actions.conditions.push({ key: conditionKey, expression: { op: 'inventory-quantity', itemKey: 'item.rust-sword', comparator: 'gte', value: 1 }, failureMessage: '需要未装备的旧盐刀' })
    actions.effects.push({ key: effectKey, operation: 'remove-item', payload: { itemKey: 'item.rust-sword', quantity: 1, reason: 'fulfillment' } })
    owner.costEffectKeys.push(effectKey); owner.requirementConditionKeys.push(conditionKey)
    const projection = createInitialTextOpenWorldSessionProjectionV1(pkg)
    const effects = createTextOpenWorldEffectCatalogV1(pkg)
    const before = structuredClone(projection.state)
    const equip = await effects.plan({ state: before, effectKeys: ['effect.equip-rust-sword'], claimKey: 'equip.before-handover' })
    const equipped = (await effects.apply({ plan: equip, state: before })).state
    await expect(effects.plan({ state: equipped, effectKeys: [effectKey], claimKey: 'equipped.handover' })).rejects.toThrow()
    projection.state = equipped
    const availability = createTextOpenWorldActionRegistryV1(pkg).project(deriveTextOpenWorldContextsV1(projection).action).find(item => item.action.key === owner.key)
    expect(availability?.unavailableReasons.some(reason => reason.code === 'item-unavailable')).toBe(true)
    const plan = await effects.plan({ state: before, effectKeys: [effectKey], claimKey: 'unequipped.handover' })
    const handed = (await effects.apply({ plan, state: before })).state
    expect(Object.values(handed.inventory.itemInstances).some(item => item.itemKey === 'item.rust-sword')).toBe(false)
    await expect(effects.plan({ state: before, effectKeys: [effectKey, 'effect.drop-salt-crystal'], claimKey: 'atomic.failed' })).rejects.toThrow()
    expect(before.inventory).toEqual(createInitialTextOpenWorldSessionProjectionV1(pkg).state.inventory)
    const old = structuredClone(pkg); old.modules.actions.schemaVersion = 19; (old.modules.actions.payload as any).version = 19
    expect(() => parseTextOpenWorldModulesV1(old)).toThrow()
  })
})

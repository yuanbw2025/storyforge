import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { commitTextOpenWorldOutcomeBatchV1 } from '../../src/lib/open-world/events'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
  parseTextOpenWorldSessionProjectionV1,
} from '../../src/lib/open-world/session-projection'
import {
  hashProductRuntimeStateV1,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from '../../src/lib/product/runtime-core'
import type {
  ProductRuntimeState,
  ProductRuntimeSession,
  TextOpenWorldCommandEnvelopeV1,
  TextOpenWorldRuntimePackageV1,
} from '../../src/lib/types'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function createSession(runtimePackage: TextOpenWorldRuntimePackageV1): Promise<ProductRuntimeSession> {
  const now = Date.now(); const projectId = await db.projects.add({
    name: 'TEXTWORLD vNext投影测试', genre: 'open-world', genres: ['open-world'], status: 'drafting',
    description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const initial: ProductRuntimeState = { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: createInitialTextOpenWorldSessionProjectionV1(runtimePackage) }
  const initialStateJson = JSON.stringify(initial); const runtimeHeadStateHash = await hashProductRuntimeStateV1(initial)
  const session: ProductRuntimeSession = {
    projectId, worldGroupId: null, worldId: projectId, workId: projectId,
    productReleaseId: null, productBuildId: 1, runtimeSourceHash: runtimePackage.sourceManifest.contentHash,
    kind: 'text-open-world', title: '投影Session', status: 'active', rulesetVersion: runtimePackage.metadata.rulesetVersion, seed: 'projection-seed',
    canonSnapshotJson: '{}', initialStateJson, runtimeHeadSequence: 0, runtimeHeadStateJson: initialStateJson, runtimeHeadStateHash,
    parentSessionId: null, parentThroughSequence: null, createdAt: now, updatedAt: now,
  }
  session.id = await db.productRuntimeSessions.add(session) as number; return session
}

async function command(sessionId: number): Promise<TextOpenWorldCommandEnvelopeV1> {
  const base = await readProductRuntimeStateVersion(sessionId)
  return {
    schema: 'storyforge.text-open-world.command', version: 1, commandId: 'command.projection.1', sessionId,
    actorKey: 'player', actionKey: 'action.investigate-channel', payload: { targetKey: 'location.salt-port' },
    baseSequence: base.sequence, baseStateHash: base.stateHash, source: 'fixed-choice', requestedAt: Date.now(),
  }
}

describe('TEXTWORLD-2 · authoritative Session Projection', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('从RuntimePackage建立覆盖全部核心域的确定性初始状态', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
    expect(projection).toMatchObject({
      ruleset: { key: 'storyforge.standard', version: 1 },
      state: {
        player: { level: 1, experience: 0, health: 37, maximumHealth: 37, skillResource: 4, maximumSkillResource: 4, attributes: { power: 3, vitality: 3, agility: 3 } },
        inventory: { itemQuantities: { 'item.rust-sword': 1 }, currency: 20, knownRecipeKeys: ['recipe.brine-tonic'] },
        quests: { statusByQuestKey: { 'quest.main.1': 'available', 'quest.template.supplies': 'locked' } },
        map: { currentLocationKey: 'location.salt-port', revealedLocationKeys: ['location.salt-port'], regionKnowledgeByKey: { 'region.salt-port': 'visited', 'region.ridge': 'heard' }, openEdgeKeys: ['edge.port-ridge'] },
        time: { worldMinute: 480, currentWeatherByRegionKey: { 'region.salt-port': 'weather.clear', 'region.ridge': 'weather.clear' } },
        relationships: { morality: 0, factionAffinityByKey: { 'faction.canal-keepers': 0 } },
        actors: { 'actor.caretaker': { alive: true, present: true, locationKey: 'location.salt-port', scheduleState: '检查内渠' } },
        world: { regionPressureByKey: { 'region.salt-port': 0, 'region.ridge': 0 }, factionStateByKey: { 'faction.canal-keepers': 'neutral' } },
        knowledge: { visibilityByKey: { 'knowledge.caretaker': 'known' } }, endings: { unlockedKeys: [], reachedKey: null },
      },
      director: { drawCount: 0, generatedQuestInstanceCount: 0, revealedQuestInstanceKeys: [], activeQuestInstanceKeys: [] },
      protocol: { pendingCommandId: null, lastCompletedCommandId: null }, lastEventSequence: 0,
    })
  })

  it('同一事件日志可重建中间态与最终态，Effect真正更新权威投影', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture(); const session = await createSession(runtimePackage)
    const envelope = await command(session.id!); await commitTextOpenWorldCommandV1(envelope)
    const afterCommand = await readProductRuntimeState(session.id!, 1)
    expect(afterCommand.textOpenWorld).toMatchObject({
      state: { inventory: { currency: 20 } }, protocol: { pendingCommandId: envelope.commandId, pendingActionKey: envelope.actionKey }, lastEventSequence: 1,
    })
    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await catalog.plan({ effectKeys: ['effect.reward-currency'], claimKey: 'claim.projection.1', state: afterCommand.textOpenWorld!.state })
    const { receipt } = await catalog.apply({ plan, state: afterCommand.textOpenWorld!.state })
    await commitTextOpenWorldOutcomeBatchV1({ sessionId: session.id!, commandId: envelope.commandId, ruleset: { key: 'storyforge.standard', version: 1 }, randomRequests: [], plan, receipt })

    const final = await readProductRuntimeState(session.id!); const projection = final.textOpenWorld!
    expect(final.lastSequence).toBe(2); expect(projection.lastEventSequence).toBe(2)
    expect(projection.state.inventory.currency).toBe(30)
    expect(projection.state.appliedClaimKeys).toEqual(['claim.projection.1'])
    expect(projection.protocol).toMatchObject({ pendingCommandId: null, lastCompletedCommandId: envelope.commandId })
    expect((await readProductRuntimeState(session.id!, 1)).textOpenWorld!.state.inventory.currency).toBe(20)
  })

  it('Condition与Action上下文只从权威投影派生', () => {
    const runtimePackage = createTextOpenWorldVNextFixture(); const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const contexts = deriveTextOpenWorldContextsV1(projection)
    expect(contexts.condition).toMatchObject({
      player: { morality: 0 }, map: { currentLocationKey: 'location.salt-port' }, time: { timePeriodKey: 'time.day', weatherKey: 'weather.clear' },
      relations: { attitudeByActorKey: { 'actor.caretaker': 'neutral' } },
    })
    expect(contexts.action.conditionResults['condition.always']).toEqual({ satisfied: true, publicReason: null })
    expect(contexts.action.validTargetKeysByScope).toMatchObject({
      actor: ['actor.caretaker'], location: ['location.salt-port'], vendor: ['vendor.caretaker'], quest: ['quest.main.1'],
    })
    expect(createTextOpenWorldActionRegistryV1(runtimePackage).project(contexts.action)[0]).toMatchObject({ available: true, validTargetKeys: ['location.salt-port'] })

    projection.state.relationships.morality = 100
    expect(deriveTextOpenWorldContextsV1(projection).condition.relations.attitudeByActorKey['actor.caretaker']).toBe('good')
  })

  it('once/cooldown运行约束在Effect终态后写入同一投影', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture(); const action = (runtimePackage.modules.actions.payload as any).actions[0]
    action.repeatPolicy = 'cooldown'; action.cooldownMinutes = 60
    const session = await createSession(runtimePackage); const envelope = await command(session.id!); await commitTextOpenWorldCommandV1(envelope)
    const pending = (await readProductRuntimeState(session.id!)).textOpenWorld!; const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await catalog.plan({ effectKeys: [], claimKey: 'claim.cooldown.1', state: pending.state }); const { receipt } = await catalog.apply({ plan, state: pending.state })
    await commitTextOpenWorldOutcomeBatchV1({ sessionId: session.id!, commandId: envelope.commandId, ruleset: { key: 'storyforge.standard', version: 1 }, randomRequests: [], plan, receipt })
    const projection = (await readProductRuntimeState(session.id!)).textOpenWorld!
    expect(projection.actions.cooldownUntilWorldMinuteByActionKey[action.key]).toBe(540)
    expect(createTextOpenWorldActionRegistryV1(runtimePackage).project(deriveTextOpenWorldContextsV1(projection).action)[0])
      .toMatchObject({ available: false, cooldownRemainingMinutes: 60, unavailableReasons: [{ code: 'cooldown' }] })
  })

  it('拒绝装备悬空、Actor缺失、ruleset漂移和不连续投影', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
    const missingItem = structuredClone(projection); missingItem.state.inventory.equippedItemKeyBySlot.weapon = 'item.rust-sword'; delete missingItem.state.inventory.itemQuantities['item.rust-sword']
    expect(() => parseTextOpenWorldSessionProjectionV1(missingItem)).toThrow('装备状态无效')
    const missingActor = structuredClone(projection); delete missingActor.state.actors['actor.caretaker']
    expect(() => parseTextOpenWorldSessionProjectionV1(missingActor)).toThrow('Actor运行状态缺失')
    expect(() => parseTextOpenWorldSessionProjectionV1({ ...projection, ruleset: { ...projection.ruleset, version: 2 } })).toThrow('ruleset与RuntimePackage不一致')
    expect(() => parseTextOpenWorldSessionProjectionV1({ ...projection, lastEventSequence: -1 })).toThrow('lastEventSequence无效')
  })
})

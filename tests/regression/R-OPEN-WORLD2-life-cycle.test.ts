import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import {
  executeTextOpenWorldActionV1,
  executeTextOpenWorldSystemCombatTransitionV1,
} from '../../src/lib/open-world/action-executor'
import {
  ensureTextOpenWorldCombatRetryCheckpointV1,
  inspectTextOpenWorldCheckpointV1,
  retryDefeatedTextOpenWorldCombatV1,
} from '../../src/lib/open-world/checkpoints'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { createTextOpenWorldCombatStateMachineV1 } from '../../src/lib/open-world/combat-state-machine'
import { deriveTextOpenWorldLifeProjectionV1 } from '../../src/lib/open-world/life-cycle'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import {
  readProductRuntimeState,
} from '../../src/lib/product/runtime-core'
import type {
  ProductRuntimeSession,
  TextOpenWorldEffectStateV1,
  TextOpenWorldRuntimePackageV1,
} from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function withHarmfulStatus() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  ;(runtimePackage.modules.progression.payload as any).statuses.push({
    key: 'status.wounded', title: '负伤', description: '需要休息或复活才能清除的伤势。', polarity: 'harmful',
  })
  return runtimePackage
}

function withDefeatAction() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const world = runtimePackage.modules.world.payload as any
  const combat = runtimePackage.modules.combat.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  combat.encounters[0].locationKey = 'location.salt-port'
  actions.actions.find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = ['location.salt-port']
  world.fastTravelPoints[0].canRespawn = true
  return runtimePackage
}

function placeCombatAtActionResolved(
  runtimePackage: TextOpenWorldRuntimePackageV1,
  state: TextOpenWorldEffectStateV1,
  instanceKey: string,
) {
  const combatState = createTextOpenWorldCombatStateMachineV1(runtimePackage)
  state.combat = combatState.initialize({ state, encounterKey: 'encounter.ridge-jackal', instanceKey })
  for (const intent of ['begin-round', 'begin-turn', 'complete-turn'] as const) {
    state.combat = combatState.applyAuthorization({
      state, authorization: combatState.prepare({ state, intent }),
    })
  }
  return combatState
}

function placeDefeatedCombat(
  runtimePackage: TextOpenWorldRuntimePackageV1,
  state: TextOpenWorldEffectStateV1,
  instanceKey: string,
) {
  const combatState = placeCombatAtActionResolved(runtimePackage, state, instanceKey)
  state.combat = combatState.applyAuthorization({
    state, authorization: combatState.prepare({ state, intent: 'finish-defeat' }),
  })
  state.player.health = 0
}

async function createSession(runtimePackage: TextOpenWorldRuntimePackageV1): Promise<ProductRuntimeSession> {
  return (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 失败恢复验收-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    title: '失败恢复Session',
    seed: 'failure-recovery-seed',
  })).session
}

describe('Text Open World vNext · life, rest, defeat and recovery', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('休息以一个原子EffectPlan恢复资源、清除有害状态并推进世界时间', async () => {
    const runtimePackage = withHarmfulStatus()
    const initial = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    initial.player.health = 7
    initial.player.skillResource = 0
    initial.player.statusKeys = ['status.rested', 'status.wounded']
    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await catalog.plan({
      effectKeys: ['effect.rest-full', 'effect.rest-time'], claimKey: 'claim.rest.1', state: initial,
    })
    const applied = await catalog.apply({ plan, state: initial })
    expect(applied.state.player).toMatchObject({
      health: initial.player.maximumHealth, skillResource: initial.player.maximumSkillResource,
      statusKeys: ['status.rested'],
    })
    expect(applied.state.time.worldMinute).toBe(960)
    expect(plan.impactDomains).toEqual(['player', 'time'])

    const activeCombat = structuredClone(initial)
    activeCombat.combat = createTextOpenWorldCombatStateMachineV1(runtimePackage).initialize({
      state: activeCombat, encounterKey: 'encounter.ridge-jackal', instanceKey: 'combat.rest-guard',
    })
    await expect(catalog.plan({ effectKeys: ['effect.rest-full'], claimKey: 'claim.rest.in-combat', state: activeCombat }))
      .rejects.toThrow('当前不能休息')
  })

  it('战败把生命归零并屏蔽普通行动；复活恢复安全状态但不回滚任务、物品和时间', async () => {
    const runtimePackage = withHarmfulStatus()
    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const initialProjection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    initialProjection.state.player.health = 7
    initialProjection.state.player.skillResource = 0
    initialProjection.state.player.statusKeys = ['status.wounded']
    const combatState = placeCombatAtActionResolved(runtimePackage, initialProjection.state, 'combat.defeat-effect')
    const defeatAuthorization = combatState.prepare({ state: initialProjection.state, intent: 'finish-defeat' })
    const defeatPlan = await catalog.plan({
      effectKeys: ['effect.settle-combat-state'], claimKey: 'claim.defeat', state: initialProjection.state,
      authorization: defeatAuthorization,
    })
    const defeated = (await catalog.apply({ plan: defeatPlan, state: initialProjection.state })).state
    expect(defeated).toMatchObject({ player: { health: 0 }, combat: { status: 'defeat' } })

    initialProjection.state = defeated
    const available = createTextOpenWorldActionRegistryV1(runtimePackage)
      .project(deriveTextOpenWorldContextsV1(initialProjection).action).filter(action => action.available)
    expect(available.map(action => action.action.key)).toEqual(['action.respawn'])
    const life = deriveTextOpenWorldLifeProjectionV1({ runtimePackage, state: defeated })
    expect(life).toMatchObject({ phase: 'defeated', rest: { available: false }, respawnPoints: [{ fastTravelPointKey: 'fast-travel.salt-port' }] })

    const preserved = {
      inventory: structuredClone(defeated.inventory), quests: structuredClone(defeated.quests), time: structuredClone(defeated.time),
    }
    const respawnPlan = await catalog.plan({ effectKeys: ['effect.respawn-salt-port'], claimKey: 'claim.respawn', state: defeated })
    const respawned = (await catalog.apply({ plan: respawnPlan, state: defeated })).state
    expect(respawned).toMatchObject({
      player: { health: defeated.player.maximumHealth, skillResource: defeated.player.maximumSkillResource, statusKeys: [] },
      map: { currentLocationKey: 'location.salt-port' }, combat: null,
      inventory: preserved.inventory, quests: preserved.quests, time: preserved.time,
    })
  })

  it('复活Effect只能引用已声明、可复活且已经解锁的快速旅行点', async () => {
    const noDefault = createTextOpenWorldVNextFixture()
    ;(noDefault.modules.world.payload as any).fastTravelPoints.forEach((point: any) => { point.canRespawn = false })
    expect(() => createInitialTextOpenWorldSessionProjectionV1(noDefault)).toThrow('至少需要一个默认解锁的复活点')

    const runtimePackage = createTextOpenWorldVNextFixture()
    const actions = runtimePackage.modules.actions.payload as any
    actions.effects.push({ key: 'effect.respawn-ridge', operation: 'respawn', payload: { fastTravelPointKey: 'fast-travel.ridge', healthRatio: 1 } })
    const initial = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    placeDefeatedCombat(runtimePackage, initial, 'combat.locked-respawn')
    await expect(createTextOpenWorldEffectCatalogV1(runtimePackage).plan({
      effectKeys: ['effect.respawn-ridge'], claimKey: 'claim.locked-respawn', state: initial,
    })).rejects.toThrow('复活点尚未解锁')

    const invalidAction = createTextOpenWorldVNextFixture()
    ;(invalidAction.modules.actions.payload as any).actions.find((action: any) => action.category === 'respawn').costEffectKeys = ['effect.reward-currency']
    expect(() => createInitialTextOpenWorldSessionProjectionV1(invalidAction)).toThrow('复活Action不符合无代价契约')
  })

  it('开始战斗自动建立幂等战前点；失败后重试创建子分支并保留父分支失败史', async () => {
    const runtimePackage = withDefeatAction()
    const session = await createSession(runtimePackage)
    const preCombatSequence = (await readProductRuntimeState(session.id!)).lastSequence
    await ensureTextOpenWorldCombatRetryCheckpointV1({
      sessionId: session.id!, encounterKey: 'encounter.ridge-jackal', throughSequence: preCombatSequence,
    })
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal',
      commandId: 'command.combat.start', requestedAt: 1,
    })
    const checkpoints = await db.productRuntimeCheckpoints.where('sessionId').equals(session.id!).toArray()
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]).toMatchObject({ purpose: 'combat-retry', subjectKey: 'encounter.ridge-jackal', throughSequence: preCombatSequence })
    await expect(inspectTextOpenWorldCheckpointV1(checkpoints[0].id!)).resolves.toMatchObject({ valid: true, code: 'valid' })
    const { id: _id, ...invalidCheckpoint } = checkpoints[0]
    const invalidId = await db.productRuntimeCheckpoints.add({ ...invalidCheckpoint, subjectKey: 'encounter.missing' }) as number
    await expect(inspectTextOpenWorldCheckpointV1(invalidId)).resolves.toMatchObject({ valid: false, code: 'checkpoint-purpose-invalid' })

    await executeTextOpenWorldSystemCombatTransitionV1({
      sessionId: session.id!, actionKey: 'action.settle-combat-state', targetKey: 'encounter.ridge-jackal',
      combatTransitionIntent: 'complete-turn', commandId: 'command.combat.complete-turn', requestedAt: 2,
    })
    await executeTextOpenWorldSystemCombatTransitionV1({
      sessionId: session.id!, actionKey: 'action.settle-combat-state', targetKey: 'encounter.ridge-jackal',
      combatTransitionIntent: 'finish-defeat', commandId: 'command.combat.defeat', requestedAt: 3,
    })
    const parentBeforeRetry = await readProductRuntimeState(session.id!)
    expect(parentBeforeRetry.textOpenWorld).toMatchObject({ state: { player: { health: 0 }, combat: { status: 'defeat' } } })

    const child = await retryDefeatedTextOpenWorldCombatV1({ sessionId: session.id!, seed: 'retry-seed' })
    expect(child).toMatchObject({ parentSessionId: session.id, parentThroughSequence: preCombatSequence })
    expect(await readProductRuntimeState(child.id!)).toMatchObject({
      lastSequence: 0, textOpenWorld: { lastEventSequence: 0, state: { combat: null, player: { health: 37 } } },
    })
    expect(await readProductRuntimeState(session.id!)).toEqual(parentBeforeRetry)

    const respawn = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.respawn', commandId: 'command.combat.respawn', requestedAt: 3,
    })
    expect(respawn).toMatchObject({ status: 'succeeded', outcomeCommitted: true })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld).toMatchObject({ state: { combat: null, player: { health: 37 } } })
  }, 20_000)
})

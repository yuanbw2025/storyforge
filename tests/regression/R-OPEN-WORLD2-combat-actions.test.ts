import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { createTextOpenWorldCombatStateMachineV1 } from '../../src/lib/open-world/combat-state-machine'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent, TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCombatActionsV1,
} from '../helpers/text-open-world-vnext-fixture'

function makeEncounterLocal(runtimePackage: TextOpenWorldRuntimePackageV1) {
  const combat = runtimePackage.modules.combat.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  combat.encounters[0].locationKey = 'location.salt-port'
  actions.actions.find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = ['location.salt-port']
  return runtimePackage
}

async function createCombatSession(runtimePackage = createTextOpenWorldVNextFixture(), seed = 'combat-action-seed') {
  return (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 战斗行动-${crypto.randomUUID()}`,
    textOpenWorldVNext: makeEncounterLocal(runtimePackage),
    title: '战斗行动Session',
    seed,
  })).session
}

async function startCombat(sessionId: number, suffix: string) {
  const feedback = await executeTextOpenWorldActionV1({
    sessionId,
    actionKey: 'action.start-ridge-jackal',
    targetKey: 'encounter.ridge-jackal',
    commandId: `command.combat-action.${suffix}.start`,
    requestedAt: 1,
  })
  expect(feedback).toMatchObject({ phase: 'terminal', status: 'succeeded' })
}

function combatAuthorizations(events: ProductRuntimeEvent[]) {
  return events
    .filter(event => event.type === 'text-open-world.effects.applied')
    .map(event => JSON.parse(event.payloadJson).plan.authorization)
    .filter(authorization => authorization?.kind === 'combat-action')
}

describe('Text Open World vNext · governed player and enemy combat actions', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('Action v11冻结普通攻击、技能、战斗道具、逃跑、敌方技能与胜利奖励的表驱动双向合同', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    expect(modules.actions.version).toBe(14)
    expect(modules.actions.actions.filter(action => action.category.startsWith('combat-') || action.category === 'escape')
      .map(action => action.category)).toEqual([
      'combat-state-action', 'combat-reward-action', 'combat-basic-attack', 'combat-skill', 'combat-item', 'escape', 'combat-enemy-skill',
    ])

    const missingBasic = createTextOpenWorldVNextFixture()
    const missingActions = (missingBasic.modules.actions.payload as any).actions
    ;(missingBasic.modules.actions.payload as any).actions = missingActions.filter((action: any) => action.key !== 'action.combat-basic-attack')
    expect(() => parseTextOpenWorldModulesV1(missingBasic)).toThrow('perform-combat-action Effect没有唯一战斗Action owner')

    const mismatchedCost = createTextOpenWorldVNextFixture()
    ;(mismatchedCost.modules.actions.payload as any).effects
      .find((effect: any) => effect.key === 'effect.combat-power-strike-cost').payload.amount = -1
    expect(() => parseTextOpenWorldModulesV1(mismatchedCost)).toThrow('战斗技能资源cost不匹配')

    const actionV9 = downgradeTextOpenWorldFixtureCombatActionsV1(createTextOpenWorldVNextFixture())
    const legacyModules = parseTextOpenWorldModulesV1(actionV9)
    expect(legacyModules.actions.version).toBe(9)
    expect(legacyModules.actions.effects.some(effect => effect.operation === 'perform-combat-action')).toBe(false)
  })

  it('只在玩家actor-turn投影当前可用的技能、敌人目标和已持有战斗道具', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const machine = createTextOpenWorldCombatStateMachineV1(runtimePackage)
    projection.state.combat = machine.initialize({
      state: projection.state,
      encounterKey: 'encounter.ridge-jackal',
      instanceKey: 'combat.registry',
    })
    for (const intent of ['begin-round', 'begin-turn'] as const) {
      projection.state.combat = machine.applyAuthorization({
        state: projection.state,
        authorization: machine.prepare({ state: projection.state, intent }),
      })
    }
    const registry = createTextOpenWorldActionRegistryV1(runtimePackage)
    const availability = registry.project(deriveTextOpenWorldContextsV1(projection).action)
    const byKey = new Map(availability.map(item => [item.action.key, item]))
    expect(byKey.get('action.combat-basic-attack')).toMatchObject({ available: true, validTargetKeys: ['enemy.1.1'] })
    expect(byKey.get('action.combat-power-strike')).toMatchObject({ available: true, validTargetKeys: ['enemy.1.1'] })
    expect(byKey.get('action.combat-escape')).toMatchObject({ available: true, validTargetKeys: [] })
    expect(byKey.get('action.combat-brine-tonic')).toMatchObject({
      available: false,
      validTargetKeys: [],
      unavailableReasons: expect.arrayContaining([expect.objectContaining({ code: 'item-unavailable' })]),
    })

    projection.state.combat.cooldownUntilRoundBySkillKey!['skill.power-strike'] = 3
    projection.state.player.skillResource = 1
    const blocked = registry.project(deriveTextOpenWorldContextsV1(projection).action)
      .find(item => item.action.key === 'action.combat-power-strike')!
    expect(blocked).toMatchObject({
      available: false,
      unavailableReasons: expect.arrayContaining([expect.objectContaining({ code: 'skill-unavailable' })]),
    })
    expect(blocked.unavailableReasons.find(reason => reason.code === 'skill-unavailable')?.message)
      .toContain('resource-insufficient、cooldown-active')
  })

  it('普通攻击和敌方冻结策略均通过正式命令与Effect事件执行，清空Head后仍可重放', async () => {
    const session = await createCombatSession()
    await startCombat(session.id!, 'basic')
    const before = await readProductRuntimeState(session.id!)
    const beforeCombat = before.textOpenWorld!.state.combat!
    const enemyHealth = 'version' in beforeCombat ? beforeCombat.enemies[0].currentHealth : -1
    const playerHealth = before.textOpenWorld!.state.player.health

    const feedback = await executeTextOpenWorldActionV1({
      sessionId: session.id!,
      actionKey: 'action.combat-basic-attack',
      targetKey: 'enemy.1.1',
      commandId: 'command.combat-action.basic.attack',
      requestedAt: 2,
    })
    expect(feedback).toMatchObject({ phase: 'terminal', status: 'succeeded', outcomeCommitted: true })
    const settled = await readProductRuntimeState(session.id!)
    expect(settled.textOpenWorld!.state.combat).toMatchObject({
      status: 'active', phase: 'actor-turn', round: 2, turnIndex: 0, activeCombatantKey: 'player',
      lastAction: {
        actionKey: 'action.combat-enemy-basic-attack', actorCombatantKey: 'enemy.1.1',
        kind: 'enemy-skill', targetCombatantKeys: ['player'], round: 1, turnIndex: 1,
      },
    })
    const settledCombat = settled.textOpenWorld!.state.combat!
    expect('version' in settledCombat ? settledCombat.enemies[0].currentHealth : -2).toBeLessThan(enemyHealth)
    expect(settled.textOpenWorld!.state.player.health).toBeLessThan(playerHealth)

    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(combatAuthorizations(events)).toMatchObject([
      { actorKey: 'player', actionKind: 'basic-attack', skillKey: 'skill.basic-attack', targetCombatantKeys: ['enemy.1.1'] },
      { actorKey: 'system', actionKind: 'enemy-skill', skillKey: 'skill.basic-attack', targetCombatantKeys: ['player'] },
    ])
    await db.productRuntimeSessions.update(session.id!, {
      runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null,
    })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld).toEqual(settled.textOpenWorld)

    const tampered = structuredClone(events) as ProductRuntimeEvent[]
    const playerEffect = tampered.find(event => event.type === 'text-open-world.effects.applied'
      && JSON.parse(event.payloadJson).plan.authorization?.actorKey === 'player')!
    const payload = JSON.parse(playerEffect.payloadJson)
    payload.plan.authorization.actionKind = 'escape'
    playerEffect.payloadJson = JSON.stringify(payload)
    expect(() => replayProductRuntimeEvents(JSON.parse(session.initialStateJson), tampered))
      .toThrow('战斗行动授权与当前状态不一致')
  }, 30_000)

  it('技能行动原子消耗技能资源并按战斗回合锁定冷却', async () => {
    const session = await createCombatSession(createTextOpenWorldVNextFixture(), 'combat-skill-seed')
    await startCombat(session.id!, 'skill')
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-power-strike', targetKey: 'enemy.1.1',
      commandId: 'command.combat-action.skill.use', requestedAt: 2,
    })
    const settled = await readProductRuntimeState(session.id!)
    expect(settled.textOpenWorld!.state.player.skillResource).toBe(2)
    expect(settled.textOpenWorld!.state.combat).toMatchObject({
      round: 2,
      cooldownUntilRoundBySkillKey: { 'skill.power-strike': 3 },
    })
    expect(deriveTextOpenWorldContextsV1(settled.textOpenWorld!).action.combatSkillCooldownRemainingTurnsBySkillKey)
      .toMatchObject({ 'skill.power-strike': 1 })

    const eventCount = await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()
    const blocked = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-power-strike', targetKey: 'enemy.1.1',
      commandId: 'command.combat-action.skill.cooldown', requestedAt: 3,
    })
    expect(blocked).toMatchObject({
      phase: 'preflight', status: 'rejected', outcomeCommitted: false,
      reason: { code: 'skill-unavailable' },
    })
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(eventCount)
  }, 30_000)

  it('战斗道具复用物品消耗与恢复Effect，不由战斗代码直接改背包', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const actors = runtimePackage.modules.actors.payload as any
    actors.player.build.startingItemKeys.push('item.brine-tonic')
    const actions = runtimePackage.modules.actions.payload as any
    actions.effects.push({
      key: 'effect.test-combat-harm', operation: 'change-player-resource',
      payload: { resource: 'health', amount: -10 },
    })
    actions.actions.push({
      key: 'action.test-combat-harm', category: 'investigate', label: '验收受伤', description: '战斗道具验收前降低生命。',
      actorScope: 'player', targetScope: 'none', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
      successEffectKeys: ['effect.test-combat-harm'], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'once', cooldownMinutes: null,
    })
    const session = await createCombatSession(runtimePackage, 'combat-item-seed')
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.test-combat-harm',
      commandId: 'command.combat-action.item.harm', requestedAt: 1,
    })
    await startCombat(session.id!, 'item')
    const before = await readProductRuntimeState(session.id!)
    const maximumHealth = before.textOpenWorld!.state.player.maximumHealth
    expect(before.textOpenWorld!.state.player.health).toBe(maximumHealth - 10)

    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-brine-tonic', targetKey: 'item.brine-tonic',
      commandId: 'command.combat-action.item.use', requestedAt: 3,
    })
    const settled = await readProductRuntimeState(session.id!)
    expect(settled.textOpenWorld!.state.player.health).toBeLessThan(maximumHealth)
    expect(settled.textOpenWorld!.state.inventory.stackQuantities['item.brine-tonic']).toBeUndefined()
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(combatAuthorizations(events).find(authorization => authorization.actorKey === 'player')).toMatchObject({
      actionKind: 'item', itemKey: 'item.brine-tonic', targetCombatantKeys: ['player'],
    })
  }, 45_000)

  it('逃跑是玩家正式战斗行动，成功后立即进入escaped终态且不执行敌方回合', async () => {
    const session = await createCombatSession(createTextOpenWorldVNextFixture(), 'combat-escape-seed')
    await startCombat(session.id!, 'escape')
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-escape',
      commandId: 'command.combat-action.escape.use', requestedAt: 2,
    })
    const settled = await readProductRuntimeState(session.id!)
    expect(settled.textOpenWorld!.state.combat).toMatchObject({
      status: 'escaped', phase: 'terminal', round: 1, turnIndex: null, activeCombatantKey: null,
      lastAction: { actionKey: 'action.combat-escape', kind: 'escape', targetCombatantKeys: [] },
    })
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(combatAuthorizations(events)).toMatchObject([
      { actorKey: 'player', actionKind: 'escape', targetCombatantKeys: [] },
    ])
    const rejected = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.1',
      commandId: 'command.combat-action.escape.after', requestedAt: 3,
    })
    expect(rejected).toMatchObject({ phase: 'preflight', status: 'rejected', outcomeCommitted: false })
  }, 30_000)
})

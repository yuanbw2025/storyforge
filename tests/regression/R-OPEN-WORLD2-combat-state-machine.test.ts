import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  executeTextOpenWorldActionV1,
  executeTextOpenWorldSystemCombatTransitionV1,
} from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldCombatStateMachineV1 } from '../../src/lib/open-world/combat-state-machine'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { replayTextOpenWorldEventProtocolV1 } from '../../src/lib/open-world/event-contract'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import type {
  ProductRuntimeEvent,
  TextOpenWorldRuntimePackageV1,
} from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCombatV1,
} from '../helpers/text-open-world-vnext-fixture'

function actionResolvedState(runtimePackage: TextOpenWorldRuntimePackageV1, instanceKey: string) {
  const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
  const machine = createTextOpenWorldCombatStateMachineV1(runtimePackage)
  state.combat = machine.initialize({ state, encounterKey: 'encounter.ridge-jackal', instanceKey })
  for (const intent of ['begin-round', 'begin-turn', 'complete-turn'] as const) {
    state.combat = machine.applyAuthorization({ state, authorization: machine.prepare({ state, intent }) })
  }
  return { state, machine }
}

function makeEncounterLocal(runtimePackage: TextOpenWorldRuntimePackageV1) {
  const combat = runtimePackage.modules.combat.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  combat.encounters[0].locationKey = 'location.salt-port'
  actions.actions.find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = ['location.salt-port']
  return runtimePackage
}

async function createCombatSession(runtimePackage: TextOpenWorldRuntimePackageV1, seed = 'combat-state-seed') {
  return (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 战斗阶段机-${crypto.randomUUID()}`,
    textOpenWorldVNext: makeEncounterLocal(runtimePackage),
    title: '战斗阶段机Session',
    seed,
  })).session
}

describe('Text Open World vNext · governed combat phase state machine', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('按冻结遭遇展开稳定敌人实例，并严格执行started到下一回合的阶段顺序', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    ;(runtimePackage.modules.combat.payload as any).encounters[0].enemyGroups[0].count = 2
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    const machine = createTextOpenWorldCombatStateMachineV1(runtimePackage)
    state.combat = machine.initialize({ state, encounterKey: 'encounter.ridge-jackal', instanceKey: 'combat.order' })

    expect(state.combat).toMatchObject({
      version: 1, status: 'active', phase: 'started', round: 0,
      turnOrder: ['player', 'enemy.1.1', 'enemy.1.2'],
      enemies: [
        { combatantKey: 'enemy.1.1', groupKey: 'group.ridge-jackal.1', currentHealth: 16, defeated: false },
        { combatantKey: 'enemy.1.2', groupKey: 'group.ridge-jackal.1', currentHealth: 16, defeated: false },
      ],
    })
    expect(() => machine.prepare({ state, intent: 'begin-turn' })).toThrow('只有round-start可以开始行动者回合')

    const transition = (intent: Parameters<typeof machine.prepare>[0]['intent']) => {
      state.combat = machine.applyAuthorization({ state, authorization: machine.prepare({ state, intent }) })
    }
    transition('begin-round')
    transition('begin-turn')
    expect(state.combat).toMatchObject({ phase: 'actor-turn', round: 1, turnIndex: 0, activeCombatantKey: 'player' })
    transition('complete-turn'); transition('advance-turn')
    expect(state.combat).toMatchObject({ phase: 'actor-turn', turnIndex: 1, activeCombatantKey: 'enemy.1.1' })
    transition('complete-turn'); transition('advance-turn'); transition('complete-turn'); transition('advance-turn')
    expect(state.combat).toMatchObject({ phase: 'round-end', round: 1, turnIndex: null, activeCombatantKey: null })
    expect(machine.nextSystemIntent(state)).toBe('begin-round')
    transition('begin-round'); transition('begin-turn')
    expect(state.combat).toMatchObject({ phase: 'actor-turn', round: 2, turnIndex: 0, activeCombatantKey: 'player' })
  })

  it('只允许从action-resolved进入胜利、战败或逃跑，并拒绝伪造授权与禁逃遭遇', async () => {
    for (const [intent, status] of [
      ['finish-victory', 'victory'], ['finish-defeat', 'defeat'], ['finish-escaped', 'escaped'],
    ] as const) {
      const runtimePackage = createTextOpenWorldVNextFixture()
      const { state, machine } = actionResolvedState(runtimePackage, `combat.${status}`)
      const authorization = machine.prepare({ state, intent })
      const result = machine.applyAuthorization({ state, authorization })
      expect(result).toMatchObject({ status, phase: 'terminal', round: 1, turnIndex: null, activeCombatantKey: null })
    }

    const runtimePackage = createTextOpenWorldVNextFixture()
    const { state, machine } = actionResolvedState(runtimePackage, 'combat.authorization')
    const authorization = machine.prepare({ state, intent: 'finish-victory' })
    await expect(createTextOpenWorldEffectCatalogV1(runtimePackage).plan({
      effectKeys: ['effect.settle-combat-state'], claimKey: 'claim.combat.forged', state,
      authorization: { ...authorization, afterStatus: 'defeat' },
    })).rejects.toThrow('战斗阶段授权与当前状态不一致')

    const noEscape = createTextOpenWorldVNextFixture()
    ;(noEscape.modules.combat.payload as any).encounters[0].escapePolicy.allowed = false
    const forbidden = actionResolvedState(noEscape, 'combat.no-escape')
    expect(() => forbidden.machine.prepare({ state: forbidden.state, intent: 'finish-escaped' })).toThrow('该遭遇不允许逃跑')
  })

  it('开始战斗后用正式系统命令自动推进到首个行动者，并可清空Head后逐事件重放', async () => {
    const session = await createCombatSession(createTextOpenWorldVNextFixture())
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal',
      commandId: 'command.combat.initialize', requestedAt: 1,
    })
    const beforeReplay = await readProductRuntimeState(session.id!)
    expect(beforeReplay.textOpenWorld).toMatchObject({
      lastEventSequence: 8,
      state: { combat: { status: 'active', phase: 'actor-turn', round: 1, turnIndex: 0, activeCombatantKey: 'player' } },
      protocol: { pendingCommandId: null, pendingCombatTransitionIntent: null },
    })
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events.slice(2).map(event => event.type)).toEqual([
      'text-open-world.command.committed', 'text-open-world.effects.applied',
      'text-open-world.command.committed', 'text-open-world.effects.applied',
      'text-open-world.command.committed', 'text-open-world.effects.applied',
    ])
    expect(events.slice(2).map(event => event.actorKey)).toEqual(['player', 'player', 'system', 'system', 'system', 'system'])
    const protocol = await replayTextOpenWorldEventProtocolV1(events, session.seed)
    expect(protocol).toMatchObject({ lastSequence: 8, pendingCommandId: null })
    expect(protocol.batches).toHaveLength(3)

    await db.productRuntimeSessions.update(session.id!, {
      runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null,
    })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld).toEqual(beforeReplay.textOpenWorld)

    const tampered = structuredClone(events) as ProductRuntimeEvent[]
    const command = JSON.parse(tampered[4].payloadJson)
    command.envelope.payload.combatTransitionIntent = 'begin-turn'
    tampered[4].payloadJson = JSON.stringify(command)
    expect(() => replayProductRuntimeEvents(JSON.parse(session.initialStateJson), tampered))
      .toThrow('战斗阶段授权与系统命令不一致')
  }, 20_000)

  it('显式系统迁移命令可把首个行动回合确定性结算为可重放终态', async () => {
    const session = await createCombatSession(createTextOpenWorldVNextFixture(), 'combat-terminal-seed')
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal',
      commandId: 'command.combat.terminal.initialize', requestedAt: 1,
    })
    await executeTextOpenWorldSystemCombatTransitionV1({
      sessionId: session.id!, actionKey: 'action.settle-combat-state', targetKey: 'encounter.ridge-jackal',
      combatTransitionIntent: 'complete-turn', commandId: 'command.combat.terminal.complete', requestedAt: 2,
    })
    await executeTextOpenWorldSystemCombatTransitionV1({
      sessionId: session.id!, actionKey: 'action.settle-combat-state', targetKey: 'encounter.ridge-jackal',
      combatTransitionIntent: 'finish-victory', commandId: 'command.combat.terminal.victory', requestedAt: 3,
    })
    const terminal = await readProductRuntimeState(session.id!)
    expect(terminal.textOpenWorld).toMatchObject({
      state: { combat: { status: 'victory', phase: 'terminal', round: 1, turnIndex: null, activeCombatantKey: null } },
    })
    await db.productRuntimeSessions.update(session.id!, {
      runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null,
    })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld).toEqual(terminal.textOpenWorld)
  }, 20_000)

  it('玩家入口不能夹带战斗阶段intent，失败时不会留下悬空命令', async () => {
    const session = await createCombatSession(createTextOpenWorldVNextFixture(), 'combat-intent-boundary-seed')
    const beforeCount = await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()
    await expect(executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.investigate-channel',
      combatTransitionIntent: 'begin-round', commandId: 'command.combat.forged-player', requestedAt: 1,
    } as any)).rejects.toThrow('战斗阶段intent只能由战斗系统Action提交')
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(beforeCount)
  })

  it('旧Combat v1与Action v8仍按旧投影执行并在旧Release内完整重放', async () => {
    const runtimePackage = downgradeTextOpenWorldFixtureCombatV1(createTextOpenWorldVNextFixture())
    makeEncounterLocal(runtimePackage)
    const actions = runtimePackage.modules.actions.payload as any
    actions.effects.push({
      key: 'effect.legacy-victory', operation: 'resolve-combat',
      payload: { encounterKey: 'encounter.ridge-jackal', outcome: 'victory' },
    })
    actions.actions.push({
      key: 'action.legacy-victory', category: 'continue-combat', label: '旧版胜利', description: '兼容旧Release的战斗结算。',
      actorScope: 'player', targetScope: 'none', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
      successEffectKeys: ['effect.legacy-victory'], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    })
    const session = await createCombatSession(runtimePackage, 'legacy-combat-seed')
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal',
      commandId: 'command.legacy-combat.start', requestedAt: 1,
    })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld!.state.combat)
      .toEqual({ encounterKey: 'encounter.ridge-jackal', status: 'active' })
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.legacy-victory',
      commandId: 'command.legacy-combat.victory', requestedAt: 2,
    })
    const terminal = await readProductRuntimeState(session.id!)
    expect(terminal.textOpenWorld!.state.combat).toEqual({ encounterKey: 'encounter.ridge-jackal', status: 'victory' })
    await db.productRuntimeSessions.update(session.id!, {
      runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null,
    })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld).toEqual(terminal.textOpenWorld)
  }, 20_000)
})

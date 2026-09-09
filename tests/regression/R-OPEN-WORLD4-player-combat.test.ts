import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  branchTextOpenWorldSessionFromCheckpointV1,
  createTextOpenWorldCheckpointV1,
} from '../../src/lib/open-world/checkpoints'
import { createTextOpenWorldCombatStateMachineV1 } from '../../src/lib/open-world/combat-state-machine'
import { projectTextOpenWorldPlayerCombatV1 } from '../../src/lib/open-world/player-combat'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type {
  ProductRuntimeEvent,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldSessionProjectionV1,
} from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCombatV1,
} from '../helpers/text-open-world-vnext-fixture'

function makeEncounterLocal(runtimePackage: TextOpenWorldRuntimePackageV1, enemyCount = 1) {
  const combat = runtimePackage.modules.combat.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  combat.encounters[0].locationKey = 'location.salt-port'
  combat.encounters[0].enemyGroups[0].count = enemyCount
  actions.actions.find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = ['location.salt-port']
  return runtimePackage
}

function projectedActions(projection: TextOpenWorldSessionProjectionV1) {
  return createTextOpenWorldActionRegistryV1(projection.runtimePackage)
    .project(deriveTextOpenWorldContextsV1(projection).action)
}

function activeProjection(runtimePackage: TextOpenWorldRuntimePackageV1, enemyCount = 2) {
  makeEncounterLocal(runtimePackage, enemyCount)
  const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const machine = createTextOpenWorldCombatStateMachineV1(runtimePackage)
  projection.state.combat = machine.initialize({
    state: projection.state,
    encounterKey: 'encounter.ridge-jackal',
    instanceKey: 'combat.player-projection',
  })
  for (const intent of ['begin-round', 'begin-turn'] as const) {
    projection.state.combat = machine.applyAuthorization({
      state: projection.state,
      authorization: machine.prepare({ state: projection.state, intent }),
    })
  }
  return projection
}

async function createCombatSession(runtimePackage: TextOpenWorldRuntimePackageV1, enemyCount = 1) {
  return (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 玩家战斗-${crypto.randomUUID()}`,
    textOpenWorldVNext: makeEncounterLocal(runtimePackage, enemyCount),
    title: '玩家战斗Session',
    seed: `player-combat-${crypto.randomUUID()}`,
  })).session
}

async function currentProjection(sessionId: number) {
  const runtime = await readProductRuntimeState(sessionId)
  const projection = runtime.textOpenWorld!
  const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
  return { projection, events, actions: projectedActions(projection) }
}

describe('Text Open World vNext · disclosure-safe player combat projection', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('投影完整四类操作、显式多敌目标、资源冷却和公开不可用原因', () => {
    const projection = activeProjection(createTextOpenWorldVNextFixture())
    projection.state.player.skillResource = 1
    if (!projection.state.combat || !('version' in projection.state.combat)) throw new Error('测试需要新版战斗')
    projection.state.combat.cooldownUntilRoundBySkillKey!['skill.power-strike'] = 3
    const actions = projectedActions(projection)
    const result = projectTextOpenWorldPlayerCombatV1({
      sessionId: 1,
      projection,
      events: [],
      projectedActions: actions,
    })!

    expect(result.mode).toBe('active')
    expect(result.phase).toMatchObject({ round: 1, actorLabel: '来客', playerTurn: true })
    expect(result.player).toMatchObject({ level: 1, currentHealth: 37, maximumHealth: 37, activeActor: true })
    expect(result.enemies.map(enemy => ({ label: enemy.label, level: enemy.level, active: enemy.activeActor }))).toEqual([
      { label: '盐鬣犬 1', level: 1, active: false },
      { label: '盐鬣犬 2', level: 1, active: false },
    ])
    expect(result.actions.map(action => action.group)).toEqual(['attack', 'skill', 'item', 'escape'])
    expect(result.actions.find(action => action.group === 'attack')).toMatchObject({
      available: true,
      targetMode: 'single-enemy',
      validEnemyTargetKeys: ['enemy.1.1', 'enemy.1.2'],
    })
    const skill = result.actions.find(action => action.group === 'skill')!
    expect(skill).toMatchObject({ available: false, resourceCost: 2, cooldownTurns: 2, cooldownRemainingTurns: 2 })
    expect(skill.unavailableReasons.join(' ')).toContain('技能资源不足')
    expect(skill.unavailableReasons.join(' ')).toContain('还需 2 回合')
    expect(skill.unavailableReasons.join(' ')).not.toMatch(/resource-insufficient|cooldown-active|skill\.|condition\./)
    const item = result.actions.find(action => action.group === 'item')!
    expect(item).toMatchObject({ available: false, quantity: 0, targetMode: 'fixed-item' })
    expect(item.unavailableReasons.join(' ')).not.toContain('item.brine-tonic')
  })

  it('拒绝不完整Action投影，并对跨Session、乱序和悬空命令fail-closed', () => {
    const projection = activeProjection(createTextOpenWorldVNextFixture(), 1)
    const actions = projectedActions(projection)
    expect(() => projectTextOpenWorldPlayerCombatV1({
      sessionId: 2, projection, events: [], projectedActions: actions.slice(1),
    })).toThrow('完整正式结果')

    const pending = structuredClone(projection)
    pending.lastEventSequence = 1
    pending.protocol.pendingCommandId = 'command.pending'
    pending.protocol.pendingCommandSequence = 1
    pending.protocol.pendingActionKey = 'action.combat-basic-attack'
    pending.protocol.pendingActorKey = 'player'
    pending.protocol.pendingTargetKey = 'enemy.1.1'
    const command: ProductRuntimeEvent = {
      projectId: 1, worldGroupId: null, sessionId: 2, sequence: 1,
      type: 'text-open-world.command.committed', actorKey: 'player', targetKey: null,
      commandId: 'command.pending', baseSequence: 0, baseStateHash: 'a'.repeat(64), payloadJson: JSON.stringify({
        schema: 'storyforge.text-open-world.command-event', version: 1,
        envelope: {
          schema: 'storyforge.text-open-world.command', version: 1,
          commandId: 'command.pending', sessionId: 2, actorKey: 'player',
          actionKey: 'action.combat-basic-attack', payload: { targetKey: 'enemy.1.1' },
          baseSequence: 0, baseStateHash: 'a'.repeat(64), source: 'system-action', requestedAt: 1,
        },
        requestFingerprint: 'b'.repeat(64), resultingSequence: 1, resultingStateHash: 'c'.repeat(64),
      }),
      createdAt: 1,
    }
    const pendingActions = projectedActions(pending)
    expect(projectTextOpenWorldPlayerCombatV1({
      sessionId: 2, projection: pending, events: [command], projectedActions: pendingActions,
    })?.mode).toBe('settling')
    expect(() => projectTextOpenWorldPlayerCombatV1({
      sessionId: 3, projection: pending, events: [{ ...command, sessionId: 99 }], projectedActions: pendingActions,
    })).toThrow('混入其他Session')
    expect(() => projectTextOpenWorldPlayerCombatV1({
      sessionId: 2, projection: pending, events: [{ ...command, sequence: 2 }], projectedActions: pendingActions,
    })).toThrow('事件序号不连续')
  })

  it('只从当前战斗实例的canonical终态事件生成行动日志，且忽略Projection头之后的数据', async () => {
    const session = await createCombatSession(createTextOpenWorldVNextFixture(), 2)
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal',
      commandId: 'command.player-combat.start', requestedAt: 1,
    })
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.2',
      commandId: 'command.player-combat.attack', requestedAt: 2,
    })
    const current = await currentProjection(session.id!)
    const futureGarbage: ProductRuntimeEvent = {
      projectId: 1, worldGroupId: null, sessionId: 999, sequence: 999,
      type: 'text-open-world.effects.applied', payloadJson: '{broken', createdAt: 999,
    }
    const result = projectTextOpenWorldPlayerCombatV1({
      sessionId: session.id!,
      projection: current.projection,
      events: [...current.events, futureGarbage],
      projectedActions: current.actions,
    })!
    const playerEntry = result.log.find(entry => entry.tone === 'player')!
    expect(playerEntry.summary).toContain('盐鬣犬 2')
    expect(playerEntry.summary).toContain('点伤害')
    expect(playerEntry.details.join(' ')).toMatch(/生命 16 → \d+/)
    expect(result.log.filter(entry => entry.tone === 'enemy')).toHaveLength(2)
    const visibleText = result.log.flatMap(entry => [entry.summary, ...entry.details]).join(' ')
    expect(visibleText).not.toMatch(/enemy\.1\.|action\.|effect\.|command\.|criticalDrawValue|sourceRefs/)
  }, 30_000)

  it('胜利奖励只展示当前实例已经落盘的实际Effect，失败或逃跑不会预告奖励', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const combat = runtimePackage.modules.combat.payload as any
    const actions = runtimePackage.modules.actions.payload as any
    combat.enemies[0].maximumHealth = 1
    actions.effects.find((effect: any) => effect.key === 'effect.reward-experience').payload.amount = 100_000
    const session = await createCombatSession(runtimePackage)
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal',
      commandId: 'command.player-combat.reward.start', requestedAt: 1,
    })
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.1',
      commandId: 'command.player-combat.reward.attack', requestedAt: 2,
    })
    const current = await currentProjection(session.id!)
    const result = projectTextOpenWorldPlayerCombatV1({
      sessionId: session.id!, projection: current.projection, events: current.events, projectedActions: current.actions,
    })!
    expect(result.result.status).toBe('victory')
    expect(result.reward).toMatchObject({ status: 'granted', title: '渠口伏兽奖励' })
    expect(result.reward.items.some(item => item.label === '经验 +36100')).toBe(true)
    expect(result.reward.items.some(item => item.label === '经验 +100000')).toBe(false)
    expect(result.reward.items.some(item => item.label.startsWith('盐晶 × '))).toBe(true)
    expect(result.log.filter(entry => entry.tone === 'reward')).toHaveLength(1)

    const checkpoint = await createTextOpenWorldCheckpointV1({
      sessionId: session.id!,
      name: '已结算战斗后的分支点',
    })
    const child = await branchTextOpenWorldSessionFromCheckpointV1({
      checkpointId: checkpoint.id!,
      title: '已结算战斗分支',
    })
    const childCurrent = await currentProjection(child.id!)
    const childResult = projectTextOpenWorldPlayerCombatV1({
      sessionId: child.id!,
      projection: childCurrent.projection,
      events: childCurrent.events,
      projectedActions: childCurrent.actions,
    })!
    expect(childCurrent.events).toEqual([])
    expect(childResult.result.status).toBe('victory')
    expect(childResult.reward).toMatchObject({
      status: 'granted',
      title: '渠口伏兽奖励',
      items: [],
      eventSequence: null,
    })
    expect(childResult.log).toEqual([])
  }, 30_000)

  it('旧Combat投影不伪造敌人生命、回合、操作或日志', () => {
    const runtimePackage = downgradeTextOpenWorldFixtureCombatV1(makeEncounterLocal(createTextOpenWorldVNextFixture()))
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.combat = { encounterKey: 'encounter.ridge-jackal', status: 'active' }
    const result = projectTextOpenWorldPlayerCombatV1({
      sessionId: 8, projection, events: [], projectedActions: projectedActions(projection),
    })!
    expect(result.mode).toBe('legacy')
    expect(result.compatibility).toMatchObject({ readOnly: true, turnState: false, formalActions: false, numericResolution: false })
    expect(result.phase).toMatchObject({ round: null, actorLabel: null })
    expect(result.enemies).toEqual([])
    expect(result.actions).toEqual([])
    expect(result.log).toEqual([])
    expect(result.compatibility.notice).toContain('不会伪造生命、回合或行动记录')
  })
})

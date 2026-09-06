import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldCombatActionCatalogV1 } from '../../src/lib/open-world/combat-actions'
import { createTextOpenWorldCombatStateMachineV1 } from '../../src/lib/open-world/combat-state-machine'
import { resolveTextOpenWorldRandomEvidenceV1 } from '../../src/lib/open-world/event-contract'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent, TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCombatResolutionV1,
} from '../helpers/text-open-world-vnext-fixture'

function makeEncounterLocal(runtimePackage: TextOpenWorldRuntimePackageV1) {
  const combat = runtimePackage.modules.combat.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  combat.encounters[0].locationKey = 'location.salt-port'
  actions.actions.find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = ['location.salt-port']
  return runtimePackage
}

async function createCombatSession(runtimePackage: TextOpenWorldRuntimePackageV1, seed: string) {
  return (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 战斗结算-${crypto.randomUUID()}`,
    textOpenWorldVNext: makeEncounterLocal(runtimePackage),
    title: '战斗结算Session',
    seed,
  })).session
}

async function startCombat(sessionId: number, commandId: string) {
  await executeTextOpenWorldActionV1({
    sessionId,
    actionKey: 'action.start-ridge-jackal',
    targetKey: 'encounter.ridge-jackal',
    commandId,
    requestedAt: 1,
  })
}

function appliedAuthorizations(events: ProductRuntimeEvent[]) {
  return events
    .filter(event => event.type === 'text-open-world.effects.applied')
    .map(event => JSON.parse(event.payloadJson).plan.authorization)
    .filter(Boolean)
}

describe('Text Open World vNext · deterministic combat outcomes and rewards', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('Combat v3冻结伤害算法、暴击上限与每个主动攻击技能的整数倍率，旧v2不被静默升级', () => {
    const modern = createTextOpenWorldVNextFixture()
    const parsed = parseTextOpenWorldModulesV1(modern)
    expect(parsed.actions.version).toBe(13)
    expect(parsed.combat).toMatchObject({
      version: 3,
      sourceVersion: 3,
      resolution: {
        algorithm: 'bounded-physical-v1', criticalRollMaximum: 10_000,
        criticalChanceCapBasisPoints: 5_000, criticalMultiplierNumerator: 3,
        criticalMultiplierDenominator: 2, minimumDamage: 1,
      },
      skillResolutions: [
        { skillKey: 'skill.basic-attack', powerNumerator: 1, powerDenominator: 1 },
        { skillKey: 'skill.power-strike', powerNumerator: 3, powerDenominator: 2 },
      ],
    })

    const missingFormula = createTextOpenWorldVNextFixture()
    ;(missingFormula.modules.combat.payload as any).skillResolutions.pop()
    expect(() => parseTextOpenWorldModulesV1(missingFormula)).toThrow('主动攻击技能伤害公式覆盖 双向引用不一致')

    const changedAlgorithm = createTextOpenWorldVNextFixture()
    ;(changedAlgorithm.modules.combat.payload as any).resolution.algorithm = 'floating-damage-latest'
    expect(() => parseTextOpenWorldModulesV1(changedAlgorithm)).toThrow('算法或随机精度无效')

    const old = downgradeTextOpenWorldFixtureCombatResolutionV1(createTextOpenWorldVNextFixture())
    expect(parseTextOpenWorldModulesV1(old)).toMatchObject({ actions: { version: 10 }, combat: { version: 2, sourceVersion: 2 } })
  })

  it('同一seed、命令与状态生成相同暴击证据和有界伤害，并拒绝篡改抽样结果', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const machine = createTextOpenWorldCombatStateMachineV1(runtimePackage)
    projection.state.combat = machine.initialize({ state: projection.state, encounterKey: 'encounter.ridge-jackal', instanceKey: 'combat.deterministic' })
    for (const intent of ['begin-round', 'begin-turn'] as const) {
      projection.state.combat = machine.applyAuthorization({ state: projection.state, authorization: machine.prepare({ state: projection.state, intent }) })
    }
    const catalog = createTextOpenWorldCombatActionCatalogV1(runtimePackage)
    const input = {
      state: projection.state, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.1', actorKey: 'player' as const,
      conditionResults: Object.fromEntries(parseTextOpenWorldModulesV1(runtimePackage).actions.conditions.map(item => [item.key, true])),
    }
    const requests = catalog.randomRequestsFor(input)
    expect(requests).toHaveLength(1)
    const resolve = () => Promise.all(requests.map((request, drawIndex) => resolveTextOpenWorldRandomEvidenceV1({
      seed: 'fixed-combat-seed', commandId: 'command.combat.deterministic', commandSequence: 9, drawIndex, request,
    })))
    const firstEvidence = await resolve()
    const secondEvidence = await resolve()
    expect(secondEvidence).toEqual(firstEvidence)
    const authorization = catalog.prepare({ ...input, evidence: firstEvidence })
    expect(authorization.targetResolutions).toEqual([
      expect.objectContaining({
        targetCombatantKey: 'enemy.1.1', attack: 6, defense: 1,
        damageBeforeDefense: 6, damageAfterDefense: 5,
        beforeHealth: 16, afterHealth: expect.any(Number),
      }),
    ])
    const resolution = authorization.targetResolutions![0]
    expect(resolution.appliedDamage).toBeGreaterThanOrEqual(1)
    expect(resolution.afterHealth).toBeGreaterThanOrEqual(0)
    expect(resolution.afterHealth).toBe(resolution.beforeHealth - resolution.appliedDamage)
    expect(() => catalog.assertAuthorization({
      state: projection.state,
      authorization: { ...authorization, targetResolutions: [{ ...resolution, criticalDrawValue: resolution.criticalDrawValue === 10_000 ? 9_999 : resolution.criticalDrawValue + 1 }] },
      evidence: firstEvidence,
      conditionResults: input.conditionResults,
    })).toThrow('战斗行动授权与当前状态不一致')
  })

  it('真实胜利自动进入终态并用独立系统命令只结算一次经验与掉落', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    ;(runtimePackage.modules.combat.payload as any).enemies[0].maximumHealth = 1
    const session = await createCombatSession(runtimePackage, 'combat-victory-seed')
    await startCombat(session.id!, 'command.combat.reward.start')
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.1',
      commandId: 'command.combat.reward.attack', requestedAt: 2,
    })
    const won = await readProductRuntimeState(session.id!)
    const combat = won.textOpenWorld!.state.combat!
    expect(combat).toMatchObject({
      status: 'victory', phase: 'terminal',
      enemies: [{ currentHealth: 0, defeated: true }],
      lastAction: { targetResolutions: [{ beforeHealth: 1, afterHealth: 0, appliedDamage: 1, defeated: true }] },
    })
    const claimKey = `claim.reward.reward.ridge-jackal.${'version' in combat ? combat.instanceKey : ''}`
    expect(won.textOpenWorld!.state.appliedClaimKeys).toContain(claimKey)
    expect(won.textOpenWorld!.state.player.experience).toBe(100)
    expect(won.textOpenWorld!.state.inventory.stackQuantities['item.salt-crystal']).toBeGreaterThanOrEqual(1)

    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    const authorizations = appliedAuthorizations(events)
    expect(authorizations.filter(item => item?.kind === 'reward')).toHaveLength(1)
    expect(authorizations.find(item => item?.kind === 'reward')).toMatchObject({
      rewardKey: 'reward.ridge-jackal', sourceInstanceKey: 'version' in combat ? combat.instanceKey : null,
    })
    expect(events.filter(event => event.type === 'text-open-world.random.resolved').length).toBe(3)

    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.1',
      commandId: 'command.combat.reward.attack', requestedAt: 2,
    })
    const repeated = await readProductRuntimeState(session.id!)
    expect(repeated.textOpenWorld!.state.player.experience).toBe(100)
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(events.length)

    await db.productRuntimeSessions.update(session.id!, { runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld).toEqual(repeated.textOpenWorld)
  }, 30_000)

  it('敌人伤害可把玩家降至零并自动进入失败终态，失败不发放胜利奖励', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    ;(runtimePackage.modules.combat.payload as any).enemies[0].attack = 100
    const session = await createCombatSession(runtimePackage, 'combat-defeat-seed')
    await startCombat(session.id!, 'command.combat.defeat.start')
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.1',
      commandId: 'command.combat.defeat.attack', requestedAt: 2,
    })

    const defeated = await readProductRuntimeState(session.id!)
    expect(defeated.textOpenWorld!.state.player.health).toBe(0)
    expect(defeated.textOpenWorld!.state.combat).toMatchObject({
      status: 'defeat', phase: 'terminal',
      lastAction: { actorCombatantKey: 'enemy.1.1', targetResolutions: [{ targetCombatantKey: 'player', afterHealth: 0, defeated: true }] },
    })
    expect(defeated.textOpenWorld!.state.player.experience).toBe(0)
    expect(defeated.textOpenWorld!.state.appliedClaimKeys.some(key => key.startsWith('claim.reward.'))).toBe(false)
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(appliedAuthorizations(events).filter(item => item?.kind === 'reward')).toHaveLength(0)

    await db.productRuntimeSessions.update(session.id!, { runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld).toEqual(defeated.textOpenWorld)
  }, 30_000)

  it('战斗技能的预制状态Effect与伤害同走一个计划，临时状态在逃跑终态清除', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const actions = runtimePackage.modules.actions.payload as any
    const progression = runtimePackage.modules.progression.payload as any
    const combat = runtimePackage.modules.combat.payload as any
    progression.statuses.push({ key: 'status.guarded', title: '防守姿态', description: '本场战斗采用谨慎防守姿态。', polarity: 'beneficial' })
    const skill = progression.skills.find((item: any) => item.key === 'skill.power-strike')
    Object.assign(skill, { kind: 'status', target: 'self', scalingAttribute: null, effectKeys: ['effect.apply-guarded'] })
    actions.effects.push({ key: 'effect.apply-guarded', operation: 'apply-status', payload: { statusKey: 'status.guarded' } })
    const skillAction = actions.actions.find((item: any) => item.key === 'action.combat-power-strike')
    skillAction.targetScope = 'none'
    skillAction.successEffectKeys = ['effect.apply-guarded', 'effect.combat-power-strike']
    combat.skillResolutions = combat.skillResolutions.filter((item: any) => item.skillKey !== 'skill.power-strike')
    combat.transientPlayerStatusKeys = ['status.guarded']

    const session = await createCombatSession(runtimePackage, 'combat-status-seed')
    await startCombat(session.id!, 'command.combat.status.start')
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-power-strike',
      commandId: 'command.combat.status.guard', requestedAt: 2,
    })
    const active = await readProductRuntimeState(session.id!)
    expect(active.textOpenWorld!.state.player.statusKeys).toContain('status.guarded')
    const activeEvents = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(appliedAuthorizations(activeEvents).find(item => item?.actionKey === 'action.combat-power-strike')).toMatchObject({
      resolutionVersion: 1, randomRequests: [], targetResolutions: [], statusEffectKeys: ['effect.apply-guarded'],
    })

    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-escape',
      commandId: 'command.combat.status.escape', requestedAt: 3,
    })
    const escaped = await readProductRuntimeState(session.id!)
    expect(escaped.textOpenWorld!.state.player.statusKeys).not.toContain('status.guarded')
    expect(escaped.textOpenWorld!.state.combat).toMatchObject({ status: 'escaped', phase: 'terminal' })
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(appliedAuthorizations(events).find(item => item?.intent === 'finish-escaped')).toMatchObject({
      removedPlayerStatusKeys: ['status.guarded'],
    })

    const tampered = structuredClone(events) as ProductRuntimeEvent[]
    const transition = tampered.find(event => event.type === 'text-open-world.effects.applied'
      && JSON.parse(event.payloadJson).plan.authorization?.intent === 'finish-escaped')!
    const payload = JSON.parse(transition.payloadJson)
    payload.plan.authorization.removedPlayerStatusKeys = []
    transition.payloadJson = JSON.stringify(payload)
    expect(() => replayProductRuntimeEvents(JSON.parse(session.initialStateJson), tampered)).toThrow('战斗阶段授权与当前状态不一致')
  }, 30_000)
})

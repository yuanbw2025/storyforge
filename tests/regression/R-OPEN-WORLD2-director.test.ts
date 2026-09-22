import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldDirectorCatalogV1 } from '../../src/lib/open-world/director'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { hashProductRuntimeStateV1, readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureDirectorV1,
} from '../helpers/text-open-world-vnext-fixture'

function appliedDirectorAuthorization(events: ProductRuntimeEvent[]) {
  return events.filter(event => event.type === 'text-open-world.effects.applied')
    .map(event => JSON.parse(event.payloadJson).plan.authorization)
    .find(authorization => authorization?.kind === 'director-settlement')
}

describe('Text Open World vNext · bounded regional Director and knowledge history', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('Director v2冻结地区演化、触发牌组、权重、冷却、强度和唯一系统Action；旧v1只读兼容', () => {
    const modern = createTextOpenWorldVNextFixture()
    const parsed = parseTextOpenWorldModulesV1(modern)
    expect(parsed).toMatchObject({
      actions: { version: 14 },
      director: {
        version: 2, sourceVersion: 2,
        rules: { systemActionKey: 'action.settle-director', historyLimit: 64, maximumSettlementIntervals: 32 },
        templates: [{ key: 'template.supplies', levelBand: { minimum: 1, maximum: 5 }, category: 'resource', weight: 10 }],
        randomEvents: [{ key: 'event.channel-rumor', kind: 'clue', rumorKey: 'rumor.channel', weight: 10 }],
      },
    })
    expect(parsed.director.decks.find(deck => deck.regionKey === 'region.salt-port')).toMatchObject({ triggerKinds: ['talk'] })

    const legacy = downgradeTextOpenWorldFixtureDirectorV1(createTextOpenWorldVNextFixture())
    expect(parseTextOpenWorldModulesV1(legacy)).toMatchObject({ actions: { version: 13 }, director: { version: 2, sourceVersion: 1 } })

    const missingSystemAction = createTextOpenWorldVNextFixture()
    ;(missingSystemAction.modules.actions.payload as any).actions = (missingSystemAction.modules.actions.payload as any).actions
      .filter((action: any) => action.category !== 'director-action')
    expect(() => parseTextOpenWorldModulesV1(missingSystemAction)).toThrow('director system Action 引用不存在')

    const nested = createTextOpenWorldVNextFixture()
    ;(nested.modules.director.payload as any).randomEvents[0].effectKeys = ['effect.settle-director']
    expect(() => parseTextOpenWorldModulesV1(nested)).toThrow('随机事件不能嵌套Director结算')
  })

  it('跨过多个地区结算周期时有界推进压力和地区状态，并在同一原子Effect中留下知识与成就历程', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.time.worldMinute = 3_360
    const conditionResults = { 'condition.always': true, 'condition.level-two': false }
    const director = createTextOpenWorldDirectorCatalogV1(runtimePackage)
    const authorization = director.resolve({ state: projection.state, trigger: 'activity', conditionResults, evidence: [] })

    expect(authorization).toMatchObject({
      randomRequests: [], selection: { outcomeKind: 'blank', reason: 'deck-not-ready' },
      regionChanges: [
        { regionKey: 'region.salt-port', settledIntervals: 2, fromPressure: 10, toPressure: 20, fromState: 'stable', toState: 'stable' },
        { regionKey: 'region.ridge', settledIntervals: 2, fromPressure: 20, toPressure: 26, fromState: 'stable', toState: 'stable' },
      ],
      earnedAchievementKeys: ['achievement.first-clue'],
    })
    const effects = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await effects.plan({
      effectKeys: ['effect.settle-director'], claimKey: 'claim.director.time-batch', state: projection.state, authorization,
    })
    const applied = await effects.apply({ plan, state: projection.state })
    expect(applied.state).toMatchObject({
      world: { regionPressureByKey: { 'region.salt-port': 20, 'region.ridge': 26 } },
      director: { drawCount: 0, lastRegionSettlementWorldMinuteByRegionKey: { 'region.salt-port': 3_360, 'region.ridge': 3_360 } },
      knowledge: { earnedAchievementKeys: ['achievement.first-clue'], history: [{ kind: 'achievement-earned', targetKey: 'achievement.first-clue' }] },
    })

    const tampered = structuredClone(authorization)
    tampered.regionChanges[0].toPressure += 1
    await expect(effects.plan({
      effectKeys: ['effect.settle-director'], claimKey: 'claim.director.tampered', state: projection.state, authorization: tampered,
    })).rejects.toThrow('Director授权时间、地区或演化结果不一致')
  })

  it('玩家交谈后自动执行一次可重放的地区发牌，生成任务或线索且幂等重试不重复抽牌', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD Director-${crypto.randomUUID()}`,
      textOpenWorldVNext: createTextOpenWorldVNextFixture(),
      title: 'Director Session',
      seed: 'director-deterministic-seed',
    })
    const input = {
      sessionId: created.session.id!, actionKey: 'action.talk-caretaker', targetKey: 'actor.caretaker',
      commandId: 'command.player.talk-director', requestedAt: 1,
    }
    const feedback = await executeTextOpenWorldActionV1(input)
    expect(feedback).toMatchObject({ phase: 'terminal', status: 'succeeded' })

    const events = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    const authorization = appliedDirectorAuthorization(events)
    expect(authorization).toMatchObject({ kind: 'director-settlement', trigger: 'talk', regionKey: 'region.salt-port' })
    expect(authorization.randomRequests).toHaveLength(2)
    const final = await readProductRuntimeState(created.session.id!)
    expect(final.textOpenWorld).toMatchObject({
      state: { director: { drawCount: 1 }, knowledge: { earnedAchievementKeys: ['achievement.first-clue'] } },
      director: { drawCount: 1 },
    })
    const history = final.textOpenWorld!.state.director.history[0]
    expect(history).toMatchObject({ drawNumber: 1, trigger: 'talk', regionKey: 'region.salt-port' })
    if (history.outcomeKind === 'template-quest') {
      expect(final.textOpenWorld!.state.director.generatedQuestInstanceCount).toBe(1)
      expect(final.textOpenWorld!.state.quests.instancesByKey[history.questInstanceKey!]).toMatchObject({ sourceKind: 'director', status: 'revealed' })
    } else if (history.outcomeKind === 'random-event') {
      expect(final.textOpenWorld!.state.knowledge.seenRandomEventKeys).toContain('event.channel-rumor')
      expect(final.textOpenWorld!.state.knowledge.readRumorKeys).toContain('rumor.channel')
    } else {
      expect(history.outcomeKind).toBe('blank')
    }
    expect(replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), events)).toEqual(final)

    const beforeRetryCount = events.length
    await executeTextOpenWorldActionV1({ ...input, requestedAt: 2 })
    expect(await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()).toBe(beforeRetryCount)

    const tamperedEvents = structuredClone(events)
    const appliedIndex = tamperedEvents.findIndex(event => event.type === 'text-open-world.effects.applied'
      && JSON.parse(event.payloadJson).plan.authorization?.kind === 'director-settlement')
    const payload = JSON.parse(tamperedEvents[appliedIndex].payloadJson)
    payload.plan.authorization.selection.reason = 'forged-selection'
    tamperedEvents[appliedIndex].payloadJson = JSON.stringify(payload)
    expect(() => replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), tamperedEvents)).toThrow()
  })

  it('中断在Director命令已提交但Effect未落地时，会在下一次玩家行动前恢复同一命令', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD Director Recovery-${crypto.randomUUID()}`,
      textOpenWorldVNext: createTextOpenWorldVNextFixture(),
      title: 'Director Recovery Session',
      seed: 'director-recovery-seed',
    })
    const before = await readProductRuntimeState(created.session.id!)
    await commitTextOpenWorldCommandV1({
      schema: 'storyforge.text-open-world.command', version: 1,
      commandId: 'command.system-director.interrupted', sessionId: created.session.id!,
      actorKey: 'system', actionKey: 'action.settle-director', payload: { directorTrigger: 'talk' },
      baseSequence: before.lastSequence, baseStateHash: await hashProductRuntimeStateV1(before),
      source: 'system-action', requestedAt: 1,
    })
    expect((await readProductRuntimeState(created.session.id!)).textOpenWorld?.protocol)
      .toMatchObject({ pendingCommandId: 'command.system-director.interrupted', pendingDirectorTrigger: 'talk' })

    const playerFeedback = await executeTextOpenWorldActionV1({
      sessionId: created.session.id!, actionKey: 'action.investigate-channel', targetKey: 'location.salt-port',
      commandId: 'command.player.after-director-recovery', requestedAt: 2,
    })
    expect(playerFeedback).toMatchObject({ commandId: 'command.player.after-director-recovery', phase: 'terminal', status: 'succeeded' })
    const final = await readProductRuntimeState(created.session.id!)
    expect(final.textOpenWorld).toMatchObject({ protocol: { pendingCommandId: null }, state: { director: { drawCount: 1 } } })
    const commandEvents = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    expect(commandEvents.filter(event => event.commandId === 'command.system-director.interrupted')).toHaveLength(1)
    expect(appliedDirectorAuthorization(commandEvents)).toMatchObject({ kind: 'director-settlement', trigger: 'talk' })
    expect(replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), commandEvents)).toEqual(final)
  })

  it('资源随机事件由Director选择后把预制Effect并入同一原子计划，不允许模型或UI直接发奖励', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const director = runtimePackage.modules.director.payload as any
    director.decks[0].templateKeys = []
    director.decks[0].blankWeight = 0
    director.randomEvents[0] = {
      ...director.randomEvents[0],
      kind: 'resource', effectKeys: ['effect.reward-currency'], rumorKey: null, weight: 1,
    }
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD Director Resource-${crypto.randomUUID()}`,
      textOpenWorldVNext: runtimePackage,
      title: 'Director Resource Session',
      seed: 'director-resource-seed',
    })
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!, actionKey: 'action.talk-caretaker', targetKey: 'actor.caretaker',
      commandId: 'command.player.talk-resource-director', requestedAt: 1,
    })
    const final = await readProductRuntimeState(created.session.id!)
    expect(final.textOpenWorld).toMatchObject({
      state: {
        inventory: { currency: 30 },
        director: { drawCount: 1, history: [{ outcomeKind: 'random-event', sourceKey: 'event.channel-rumor' }] },
        knowledge: { seenRandomEventKeys: ['event.channel-rumor'] },
      },
    })
    const events = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    const authorization = appliedDirectorAuthorization(events)
    expect(authorization.selection.effectKeys).toEqual(['effect.reward-currency'])
    const applied = events.find(event => event.type === 'text-open-world.effects.applied'
      && JSON.parse(event.payloadJson).plan.authorization?.kind === 'director-settlement')!
    expect(JSON.parse(applied.payloadJson).plan.effectKeys).toEqual(['effect.settle-director', 'effect.reward-currency'])
  })

  it('任务升级事件只能引用冻结模板，并创建独立稳定任务实例而不改写任务定义', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const director = runtimePackage.modules.director.payload as any
    director.decks[0].templateKeys = []
    director.decks[0].blankWeight = 0
    director.randomEvents[0] = {
      ...director.randomEvents[0],
      kind: 'quest-upgrade', effectKeys: [], rumorKey: null, upgradeTemplateKey: 'template.supplies', weight: 1,
    }
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD Director Upgrade-${crypto.randomUUID()}`,
      textOpenWorldVNext: runtimePackage,
      title: 'Director Upgrade Session',
      seed: 'director-upgrade-seed',
    })
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!, actionKey: 'action.talk-caretaker', targetKey: 'actor.caretaker',
      commandId: 'command.player.talk-upgrade-director', requestedAt: 1,
    })
    const final = (await readProductRuntimeState(created.session.id!)).textOpenWorld!
    const history = final.state.director.history[0]
    expect(history).toMatchObject({ outcomeKind: 'random-event', sourceKey: 'event.channel-rumor' })
    expect(final.state.quests.instancesByKey[history.questInstanceKey!]).toMatchObject({
      definitionKey: 'quest.template.supplies', sourceKind: 'director', sourceInstanceKey: 'draw.1', status: 'revealed',
    })
    expect(final.state.director).toMatchObject({
      generatedQuestInstanceCount: 1,
      lastResolvedWorldMinuteBySourceKey: { 'event.channel-rumor': 480, 'template.supplies': 480 },
    })
    expect((runtimePackage.modules.quests.payload as any).quests.find((quest: any) => quest.key === 'quest.template.supplies').initialStatus).toBe('locked')
  })
})

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import {
  parseTextOpenWorldRandomResolvedEventPayloadV1,
  replayTextOpenWorldEventProtocolV1,
  resolveTextOpenWorldRandomEvidenceV1,
} from '../../src/lib/open-world/event-contract'
import { commitTextOpenWorldOutcomeBatchV1 } from '../../src/lib/open-world/events'
import {
  appendProductRuntimeEvent,
  hashProductRuntimeStateV1,
  readProductRuntimeStateVersion,
} from '../../src/lib/product/runtime-core'
import type {
  ProductRuntimeEvent,
  ProductRuntimeSession,
  TextOpenWorldCommandEnvelopeV1,
  TextOpenWorldEffectStateV1,
} from '../../src/lib/types'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

const RULESET = { key: 'storyforge.standard', version: 1 } as const

function effectState(): TextOpenWorldEffectStateV1 {
  return {
    version: 1,
    player: { level: 1, experience: 0, health: 35, maximumHealth: 35, skillResource: 3, maximumSkillResource: 3, attributes: { power: 3, vitality: 3, agility: 3 }, statusKeys: [], learnedSkillKeys: ['skill.basic-attack'] },
    inventory: { itemQuantities: { 'item.rust-sword': 1 }, equippedItemKeyBySlot: { weapon: null, armor: null, accessory: null }, knownRecipeKeys: ['recipe.brine-tonic'], currency: 20 },
    quests: { statusByQuestKey: { 'quest.main.1': 'available' }, stageByQuestKey: { 'quest.main.1': null }, objectiveStatusByKey: { 'objective.main.1': 'inactive' }, resultTags: [] },
    map: { currentLocationKey: 'location.salt-port', revealedLocationKeys: ['location.salt-port'], regionKnowledgeByKey: { 'region.salt-port': 'visited', 'region.ridge': 'heard' }, unlockedFastTravelPointKeys: ['fast-travel.salt-port'], openEdgeKeys: ['edge.port-ridge'], travel: null },
    time: { worldMinute: 480, currentWeatherByRegionKey: { 'region.salt-port': 'weather.clear', 'region.ridge': 'weather.clear' }, deadlineWorldMinuteByKey: {} }, relationships: { morality: 0, factionAffinityByKey: {}, storyModifierByActorKey: {} }, combat: null,
    actors: { 'actor.caretaker': { alive: true, present: true, locationKey: 'location.salt-port', scheduleState: '检查内渠' } },
    world: { regionStateByKey: {}, regionPressureByKey: {}, factionStateByKey: {}, endingEligibleByKey: {}, flags: {} }, knowledge: { visibilityByKey: { 'knowledge.caretaker': 'known' }, readRumorKeys: [], earnedAchievementKeys: [] },
    endings: { unlockedKeys: [], reachedKey: null }, appliedClaimKeys: [],
  }
}

async function createSession(): Promise<ProductRuntimeSession> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'TEXTWORLD vNext事件测试', genre: 'open-world', genres: ['open-world'], status: 'drafting',
    description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const initialStateJson = JSON.stringify(EMPTY_PRODUCT_RUNTIME_STATE)
  const runtimeHeadStateHash = await hashProductRuntimeStateV1(EMPTY_PRODUCT_RUNTIME_STATE)
  const session: ProductRuntimeSession = {
    projectId, worldGroupId: null, worldId: projectId, workId: projectId,
    productReleaseId: null, productBuildId: 1, runtimeSourceHash: 'a'.repeat(64),
    kind: 'text-open-world', title: '事件协议Session', status: 'active', rulesetVersion: 1, seed: 'event-protocol-seed',
    canonSnapshotJson: '{}', initialStateJson, runtimeHeadSequence: 0, runtimeHeadStateJson: initialStateJson,
    runtimeHeadStateHash, parentSessionId: null, parentThroughSequence: null, createdAt: now, updatedAt: now,
  }
  session.id = await db.productRuntimeSessions.add(session) as number
  return session
}

async function command(sessionId: number, commandId = 'command.event.1'): Promise<TextOpenWorldCommandEnvelopeV1> {
  const base = await readProductRuntimeStateVersion(sessionId)
  return {
    schema: 'storyforge.text-open-world.command', version: 1, commandId, sessionId,
    actorKey: 'player', actionKey: 'action.investigate-channel', payload: { targetKey: 'location.salt-port' },
    baseSequence: base.sequence, baseStateHash: base.stateHash, source: 'system-action', requestedAt: Date.now(),
  }
}

async function outcome(claimKey = 'claim.event.1') {
  const catalog = createTextOpenWorldEffectCatalogV1(createTextOpenWorldVNextFixture())
  const before = effectState()
  const plan = await catalog.plan({ effectKeys: ['effect.reward-currency'], claimKey, state: before })
  const { receipt } = await catalog.apply({ plan, state: before })
  return { plan, receipt }
}

describe('TEXTWORLD-2 · vNext Simulation Event protocol', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('原子追加命令随机证据和Effect终态，并可从seed完整重放', async () => {
    const session = await createSession(); const envelope = await command(session.id!); await commitTextOpenWorldCommandV1(envelope)
    const result = await outcome()
    const receipt = await commitTextOpenWorldOutcomeBatchV1({
      sessionId: session.id!, commandId: envelope.commandId, ruleset: RULESET,
      randomRequests: [
        { drawKey: 'draw.encounter', minimumInclusive: 1, maximumInclusive: 6 },
        { drawKey: 'draw.loot', minimumInclusive: 0, maximumInclusive: 99 },
      ], ...result,
    })
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events.map(event => event.type)).toEqual(['textworld.command.committed', 'textworld.random.resolved', 'textworld.random.resolved', 'textworld.effects.applied'])
    expect(receipt).toMatchObject({ status: 'committed', commandSequence: 1, randomEventSequences: [2, 3], effectsEventSequence: 4, resultingSequence: 4, replayed: false })
    expect(await readProductRuntimeStateVersion(session.id!)).toMatchObject({ sequence: 4 })

    const projection = await replayTextOpenWorldEventProtocolV1(events, session.seed)
    expect(projection).toMatchObject({ lastSequence: 4, pendingCommandId: null, batches: [{ commandId: envelope.commandId, commandSequence: 1, randomEventSequences: [2, 3], effectsEventSequence: 4 }] })
    const random = parseTextOpenWorldRandomResolvedEventPayloadV1(JSON.parse(events[1].payloadJson))
    expect(random.evidence).toEqual(await resolveTextOpenWorldRandomEvidenceV1({
      seed: session.seed, commandId: envelope.commandId, commandSequence: 1, drawIndex: 0,
      request: { drawKey: 'draw.encounter', minimumInclusive: 1, maximumInclusive: 6 },
    }))
  })

  it('同一结果批次重试返回原事件，不同内容不能复用commandId', async () => {
    const session = await createSession(); const envelope = await command(session.id!); await commitTextOpenWorldCommandV1(envelope)
    const result = await outcome()
    const input = { sessionId: session.id!, commandId: envelope.commandId, ruleset: RULESET, randomRequests: [{ drawKey: 'draw.encounter', minimumInclusive: 1, maximumInclusive: 6 }], ...result }
    const first = await commitTextOpenWorldOutcomeBatchV1(input)
    const retry = await commitTextOpenWorldOutcomeBatchV1(input)
    expect(retry).toMatchObject({ replayed: true, effectsEventId: first.effectsEventId, randomEventIds: first.randomEventIds })
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(3)
    await expect(commitTextOpenWorldOutcomeBatchV1({ ...input, randomRequests: [{ drawKey: 'draw.changed', minimumInclusive: 1, maximumInclusive: 6 }] }))
      .rejects.toThrow('结果批次内容不同')
  })

  it('上一命令必须先写入Effect终态，之后才能接收下一命令', async () => {
    const session = await createSession(); const first = await command(session.id!); await commitTextOpenWorldCommandV1(first)
    await expect(commitTextOpenWorldCommandV1(await command(session.id!, 'command.event.2')))
      .rejects.toThrow('上一命令尚未生成结果批次')
    await commitTextOpenWorldOutcomeBatchV1({ sessionId: session.id!, commandId: first.commandId, ruleset: RULESET, randomRequests: [], ...await outcome() })
    await expect(commitTextOpenWorldCommandV1(await command(session.id!, 'command.event.2'))).resolves.toMatchObject({ eventSequence: 3 })
  })

  it('篡改随机证据、打乱序号或伪造规则版本都会被重放拒绝', async () => {
    const session = await createSession(); const envelope = await command(session.id!); await commitTextOpenWorldCommandV1(envelope)
    await commitTextOpenWorldOutcomeBatchV1({
      sessionId: session.id!, commandId: envelope.commandId, ruleset: RULESET,
      randomRequests: [{ drawKey: 'draw.encounter', minimumInclusive: 1, maximumInclusive: 6 }], ...await outcome(),
    })
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    await expect(replayTextOpenWorldEventProtocolV1([events[1], events[0], events[2]], session.seed)).rejects.toThrow('事件序号不连续')
    const tampered = structuredClone(events) as ProductRuntimeEvent[]
    const payload = JSON.parse(tampered[1].payloadJson); payload.evidence.value = payload.evidence.value === 1 ? 2 : 1; tampered[1].payloadJson = JSON.stringify(payload)
    await expect(replayTextOpenWorldEventProtocolV1(tampered, session.seed)).rejects.toThrow('随机证据无法由Session seed重放')
    await expect(commitTextOpenWorldOutcomeBatchV1({ sessionId: session.id!, commandId: envelope.commandId, ruleset: { ...RULESET, version: 2 }, randomRequests: [], ...await outcome() }))
      .rejects.toThrow('结果批次内容不同')
  })

  it('无效Effect回执不会留下半批次，治理事件也不能绕过专用入口', async () => {
    const session = await createSession(); const envelope = await command(session.id!); await commitTextOpenWorldCommandV1(envelope)
    const result = await outcome(); const invalidReceipt = { ...result.receipt, resultingStateHash: 'f'.repeat(64) }
    await expect(commitTextOpenWorldOutcomeBatchV1({ sessionId: session.id!, commandId: envelope.commandId, ruleset: RULESET, randomRequests: [{ drawKey: 'draw.encounter', minimumInclusive: 1, maximumInclusive: 6 }], plan: result.plan, receipt: invalidReceipt }))
      .rejects.toThrow('plan与receipt不一致')
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(1)
    await expect(appendProductRuntimeEvent({ sessionId: session.id!, type: 'textworld.effects.applied', payload: {} }))
      .rejects.toThrow('vNext事件只能通过对应的专用命令API')
  })
})

import { describe, expect, it } from 'vitest'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { projectTextOpenWorldPlayerNotificationsV1 } from '../../src/lib/open-world/player-notifications'
import { projectTextOpenWorldPlayerWorldRecordV1 } from '../../src/lib/open-world/player-world-record'
import {
  applyTextOpenWorldSessionEventV1,
  createInitialTextOpenWorldSessionProjectionV1,
} from '../../src/lib/open-world/session-projection'
import type { ProductRuntimeEvent, TextOpenWorldParsedModulesV1 } from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function enrichedFixture() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const actors = runtimePackage.modules.actors.payload as TextOpenWorldParsedModulesV1['actors']
  const relationships = runtimePackage.modules.relationships.payload as TextOpenWorldParsedModulesV1['relationships']
  const knowledge = runtimePackage.modules.knowledge.payload as TextOpenWorldParsedModulesV1['knowledge']
  actors.factions.push({
    key: 'faction.hidden-watch',
    title: '绝不能出现的隐藏势力',
    description: '绝不能出现的隐藏势力详情',
  })
  actors.actors.push({
    key: 'actor.hidden-watch',
    tier: 'resident',
    name: '绝不能出现的隐藏人物',
    biography: '绝不能出现的隐藏人物小传',
    portrayal: '绝不能出现的隐藏人物表演说明',
    factionKey: 'faction.hidden-watch',
    homeLocationKey: 'location.ridge-channel',
    protected: false,
    mortalityPolicy: 'mortal',
    serviceKeys: [],
    scheduleKey: null,
  })
  relationships.factionMorality.push({ factionKey: 'faction.hidden-watch', moralityMultiplier: -1 })
  knowledge.entries.push({
    key: 'knowledge.secret-channel',
    kind: 'quest-clue',
    title: '绝不能提前出现的正式事实',
    content: '绝不能提前出现的事实正文',
    sourceRefs: ['world-release:secret-canary'],
    initialPlayerVisibility: 'rumor',
    actorKeys: ['actor.hidden-watch'],
  }, {
    key: 'knowledge.hidden-lore',
    kind: 'lore',
    title: '绝不能出现的隐藏知识',
    content: '绝不能出现的隐藏知识正文',
    sourceRefs: ['world-release:hidden-lore'],
    initialPlayerVisibility: 'hidden',
    actorKeys: [],
  })
  knowledge.rumors.push({
    key: 'rumor.secret-channel.one',
    knowledgeKey: 'knowledge.secret-channel',
    text: '有人说旧渠门会在盐雾中发出钟声。',
    reliability: 'uncertain',
  }, {
    key: 'rumor.secret-channel.two',
    knowledgeKey: 'knowledge.secret-channel',
    text: '这条没有读过的传闻绝不能出现。',
    reliability: 'confirmed',
  })
  knowledge.achievements.push({
    key: 'achievement.hidden-future',
    title: '绝不能出现的隐藏成就',
    description: '绝不能出现的隐藏成就条件描述',
    conditionKeys: ['condition.always'],
  })
  return runtimePackage
}

function ignoredEvent(sessionId: number, sequence: number): ProductRuntimeEvent {
  return {
    projectId: 1,
    worldGroupId: null,
    sessionId,
    sequence,
    type: 'time.advanced',
    actorKey: null,
    targetKey: null,
    commandId: null,
    baseSequence: null,
    baseStateHash: null,
    payloadJson: '{}',
    createdAt: sequence,
  }
}

async function rumorEffectBatch() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const actions = runtimePackage.modules.actions.payload as TextOpenWorldParsedModulesV1['actions']
  const knowledge = runtimePackage.modules.knowledge.payload as TextOpenWorldParsedModulesV1['knowledge']
  knowledge.entries.push({
    key: 'knowledge.notification-secret', kind: 'quest-clue',
    title: '通知中绝不能出现的事实标题', content: '通知中绝不能出现的事实正文',
    sourceRefs: [], initialPlayerVisibility: 'hidden', actorKeys: [],
  })
  actions.effects.push({
    key: 'effect.reveal-notification-rumor', operation: 'reveal-knowledge',
    payload: { knowledgeKey: 'knowledge.notification-secret', visibility: 'rumor' },
  })
  const investigate = actions.actions.find(action => action.key === 'action.investigate-channel')!
  investigate.successEffectKeys.push('effect.reveal-notification-rumor')
  const sessionId = 77
  const commandId = 'command.world-record-rumor.1'
  let projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const command: ProductRuntimeEvent = {
    projectId: 1, worldGroupId: null, sessionId, sequence: 1,
    type: 'text-open-world.command.committed', actorKey: 'player', targetKey: 'location.salt-port',
    commandId, baseSequence: 0, baseStateHash: 'a'.repeat(64), createdAt: 1,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.command-event', version: 1,
      envelope: {
        schema: 'storyforge.text-open-world.command', version: 1, commandId, sessionId,
        actorKey: 'player', actionKey: 'action.investigate-channel', payload: { targetKey: 'location.salt-port' },
        baseSequence: 0, baseStateHash: 'a'.repeat(64), source: 'system-action', requestedAt: 1,
      },
      requestFingerprint: 'b'.repeat(64), resultingSequence: 1, resultingStateHash: 'c'.repeat(64),
    }),
  }
  projection = applyTextOpenWorldSessionEventV1(projection, command)
  const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
  const plan = await catalog.plan({
    effectKeys: investigate.successEffectKeys,
    claimKey: 'claim.world-record-rumor.1',
    state: projection.state,
  })
  const { receipt } = await catalog.apply({ plan, state: projection.state })
  const terminal: ProductRuntimeEvent = {
    projectId: 1, worldGroupId: null, sessionId, sequence: 2,
    type: 'text-open-world.effects.applied', actorKey: 'player', targetKey: null,
    commandId: null, baseSequence: null, baseStateHash: null, createdAt: 2,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.effects-applied-event', version: 1,
      commandId, commandSequence: 1, ruleset: projection.ruleset, randomEventSequences: [],
      outcome: 'success', reason: null, degradation: null, plan, receipt,
      outcomeFingerprint: 'd'.repeat(64),
    }),
  }
  projection = applyTextOpenWorldSessionEventV1(projection, terminal)
  return { sessionId, projection, events: [command, terminal] }
}

describe('Text Open World vNext · player world record projection', () => {
  it('只投影当前位置或已揭示任务联系人，并移除人物小传、评分、权重与内容键', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(enrichedFixture())
    projection.state.actors['actor.caretaker'].present = false
    projection.state.actors['actor.caretaker'].locationKey = 'location.ridge-channel'
    projection.state.relationships.morality = 20
    projection.state.relationships.factionAffinityByKey['faction.canal-keepers'] = 10
    const record = projectTextOpenWorldPlayerWorldRecordV1({ sessionId: 71, projection, events: [] })

    expect(record.relationships.actors).toEqual([expect.objectContaining({
      name: '岑阿婆',
      contextLabels: ['已揭示任务联系人', '当前不在场'],
      knownReasonLabels: ['当前道德评价', '守渠会亲合度'],
      optionalInteractionSummary: '需要等待或寻找该角色后互动',
      tradeSummary: null,
    })])
    expect(record.relationships.factions).toEqual([
      expect.objectContaining({ title: '守渠会', affinity: 10 }),
    ])
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain('绝不能出现的隐藏人物')
    expect(serialized).not.toContain('绝不能出现的隐藏势力')
    expect(serialized).not.toContain('盐港最后一位老守渠人')
    expect(serialized).not.toContain('说话简短，重视可验证的行动')
    expect(serialized).not.toContain('actor.caretaker')
    expect(serialized).not.toContain('faction.canal-keepers')
    expect(serialized).not.toContain('world-release:')
    expect(serialized).not.toContain('moralityMultiplier')
    expect(serialized).not.toContain('buyPriceMultiplier')
    expect(serialized).not.toContain('score')
  })

  it('已揭示任务联系人按当前生命周期说明能否互动，不把死亡或异地角色伪装成在场', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(enrichedFixture())
    projection.state.actors['actor.caretaker'].present = true
    projection.state.actors['actor.caretaker'].locationKey = 'location.ridge-channel'
    let record = projectTextOpenWorldPlayerWorldRecordV1({ sessionId: 71, projection, events: [] })
    expect(record.relationships.actors[0]).toEqual(expect.objectContaining({
      contextLabels: ['已揭示任务联系人', '不在当前位置'],
      optionalInteractionSummary: '需要前往角色所在地点后互动',
      tradeSummary: null,
    }))

    projection.state.actors['actor.caretaker'].alive = false
    projection.state.actors['actor.caretaker'].present = false
    record = projectTextOpenWorldPlayerWorldRecordV1({ sessionId: 71, projection, events: [] })
    expect(record.relationships.actors[0]).toEqual(expect.objectContaining({
      contextLabels: ['已揭示任务联系人', '已经死亡'],
      optionalInteractionSummary: '该角色已经死亡，无法互动',
      tradeSummary: null,
    }))
  })

  it('当前地点商人只有在日程已追平且当前时段开放服务时才显示可交易', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(enrichedFixture())
    let record = projectTextOpenWorldPlayerWorldRecordV1({ sessionId: 71, projection, events: [] })
    expect(record.relationships.actors[0]?.tradeSummary).toBe('当前位置可提供交易服务')

    projection.state.time.worldMinute = 1_100
    record = projectTextOpenWorldPlayerWorldRecordV1({ sessionId: 71, projection, events: [] })
    expect(record.relationships.actors[0]).toEqual(expect.objectContaining({
      contextLabels: ['当前位置人物', '已揭示任务联系人'],
      tradeSummary: null,
    }))

    projection.state.time.lastActorScheduleSettlementWorldMinute = 1_080
    projection.state.actors['actor.caretaker'].scheduleState = '整理渠图'
    record = projectTextOpenWorldPlayerWorldRecordV1({ sessionId: 71, projection, events: [] })
    expect(record.relationships.actors[0]?.tradeSummary).toBeNull()
  })

  it('势力直接发布的已揭示任务即使没有可见成员，也会进入势力关系记录', () => {
    const runtimePackage = enrichedFixture()
    const quests = runtimePackage.modules.quests.payload as TextOpenWorldParsedModulesV1['quests']
    const disclosedQuest = quests.quests.find(quest => quest.key === 'quest.main.1')!
    disclosedQuest.ownerKind = 'faction'
    disclosedQuest.ownerKey = 'faction.canal-keepers'
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.actors['actor.caretaker'].present = false
    projection.state.actors['actor.caretaker'].locationKey = 'location.ridge-channel'

    const record = projectTextOpenWorldPlayerWorldRecordV1({ sessionId: 71, projection, events: [] })
    expect(record.relationships.actors).toEqual([])
    expect(record.relationships.factions).toEqual([
      expect.objectContaining({ title: '守渠会', affinity: 0 }),
    ])
  })

  it('百科只显示安全地图层级、当前持有物品和正式已知知识', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(enrichedFixture())
    const record = projectTextOpenWorldPlayerWorldRecordV1({ sessionId: 72, projection, events: [] })
    const serialized = JSON.stringify(record.encyclopedia)

    expect(serialized).toContain('盐港广场')
    expect(serialized).toContain('盐商和守渠人汇集之处')
    expect(serialized).toContain('断脊渠口')
    expect(serialized).not.toContain('被碎石阻塞的上游渠口')
    expect(serialized).not.toContain('荒野危险与断流真相')
    expect(serialized).toContain('旧盐刀')
    expect(serialized).not.toContain('盐晶')
    expect(serialized).toContain('老守渠人')
    expect(serialized).toContain('岑阿婆知道盐渠的旧路线')
    expect(serialized).not.toContain('绝不能提前出现的正式事实')
    expect(serialized).not.toContain('绝不能出现的隐藏知识')
  })

  it('只有亲自读过的传闻进入记录，且在正式确认前不泄露关联事实', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(enrichedFixture())
    projection.state.knowledge.readRumorKeys.push('rumor.secret-channel.one')
    projection.state.knowledge.history.push({
      kind: 'rumor-read',
      targetKey: 'rumor.secret-channel.one',
      sourceKey: 'event.channel-rumor',
      regionKey: 'region.salt-port',
      worldMinute: 480,
    }, {
      kind: 'knowledge-revealed',
      targetKey: 'knowledge.secret-channel',
      sourceKey: 'event.channel-rumor',
      regionKey: 'region.salt-port',
      worldMinute: 480,
    }, {
      kind: 'knowledge-revealed',
      targetKey: 'knowledge.not-real',
      sourceKey: 'effect.not-real',
      regionKey: 'region.salt-port',
      worldMinute: 480,
    })
    const rumorRecord = projectTextOpenWorldPlayerWorldRecordV1({ sessionId: 73, projection, events: [] })
    const serializedRumor = JSON.stringify(rumorRecord)
    expect(serializedRumor).toContain('有人说旧渠门会在盐雾中发出钟声')
    expect(serializedRumor).toContain('关联事实尚待核实')
    expect(serializedRumor).not.toContain('这条没有读过的传闻绝不能出现')
    expect(serializedRumor).not.toContain('绝不能提前出现的正式事实')
    expect(serializedRumor).not.toContain('绝不能提前出现的事实正文')
    expect(serializedRumor).not.toContain('knowledge.not-real')
    expect(rumorRecord.history.knowledgeEntries).toHaveLength(1)
    expect(rumorRecord.history.knowledgeEntries[0]).toEqual(expect.objectContaining({
      headline: '听闻一则传闻',
      details: ['有人说旧渠门会在盐雾中发出钟声。'],
    }))

    projection.state.knowledge.visibilityByKey['knowledge.secret-channel'] = 'known'
    projection.state.time.worldMinute = 960
    projection.state.knowledge.history.push({
      kind: 'knowledge-revealed',
      targetKey: 'knowledge.secret-channel',
      sourceKey: 'effect.confirm-secret-channel',
      regionKey: 'region.salt-port',
      worldMinute: 960,
    })
    const knownRecord = projectTextOpenWorldPlayerWorldRecordV1({ sessionId: 73, projection, events: [] })
    expect(JSON.stringify(knownRecord.encyclopedia)).toContain('绝不能提前出现的正式事实')
    expect(knownRecord.rumors.entries[0]).toEqual(expect.objectContaining({
      relatedFactKnown: true,
      relatedFactStatusLabel: '关联事实已有正式条目',
    }))
    expect(knownRecord.history.knowledgeEntries).toHaveLength(2)
    expect(knownRecord.history.knowledgeEntries[0]).toEqual(expect.objectContaining({
      headline: '知识已确认：绝不能提前出现的正式事实',
      details: ['绝不能提前出现的事实正文'],
    }))
    expect(knownRecord.history.knowledgeEntries[1]).toEqual(expect.objectContaining({
      headline: '听闻一则传闻',
      details: ['有人说旧渠门会在盐雾中发出钟声。'],
    }))
  })

  it('成就只公开已获得条目，未解锁内容只保留匿名数量', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(enrichedFixture())
    projection.state.knowledge.earnedAchievementKeys.push('achievement.first-clue')
    projection.state.knowledge.history.push({
      kind: 'achievement-earned',
      targetKey: 'achievement.first-clue',
      sourceKey: 'effect.earn-first-clue',
      regionKey: 'region.salt-port',
      worldMinute: 480,
    })
    const record = projectTextOpenWorldPlayerWorldRecordV1({ sessionId: 74, projection, events: [] })

    expect(record.achievements).toEqual(expect.objectContaining({
      earnedCount: 1,
      totalCount: 2,
      lockedCount: 1,
      earned: [expect.objectContaining({ title: '第一道水痕', earnedAtLabel: '第 1 天 · 白天' })],
    }))
    const serialized = JSON.stringify(record.achievements)
    expect(serialized).not.toContain('绝不能出现的隐藏成就')
    expect(serialized).not.toContain('绝不能出现的隐藏成就条件描述')
    expect(serialized).not.toContain('condition.always')
    expect(serialized).not.toContain('achievement.first-clue')
  })

  it('事件快照未追上时明确等待，并拒绝跨Session或不连续事件前缀', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(enrichedFixture())
    projection.lastEventSequence = 1
    expect(projectTextOpenWorldPlayerWorldRecordV1({
      sessionId: 75,
      projection,
      events: [],
    }).history).toEqual(expect.objectContaining({ status: 'awaiting-events', eventEntries: [] }))

    expect(() => projectTextOpenWorldPlayerWorldRecordV1({
      sessionId: 75,
      projection,
      events: [ignoredEvent(76, 1)],
    })).toThrow('混入其他Session')
    expect(() => projectTextOpenWorldPlayerWorldRecordV1({
      sessionId: 75,
      projection,
      events: [ignoredEvent(75, 2)],
    })).toThrow('事件序号不连续')
  })

  it('rumor 可见性的 reveal-knowledge 通知只给泛化提示，不泄露正式事实标题', async () => {
    const fixture = await rumorEffectBatch()
    const notifications = projectTextOpenWorldPlayerNotificationsV1(fixture)
    expect(notifications).toHaveLength(1)
    expect(notifications[0].details).toContain('获得一条新线索')
    expect(JSON.stringify(notifications)).not.toContain('通知中绝不能出现的事实标题')
    expect(JSON.stringify(notifications)).not.toContain('通知中绝不能出现的事实正文')

    const record = projectTextOpenWorldPlayerWorldRecordV1(fixture)
    expect(record.history.status).toBe('ready')
    expect(JSON.stringify(record.history)).not.toContain('通知中绝不能出现的事实标题')
  })
})

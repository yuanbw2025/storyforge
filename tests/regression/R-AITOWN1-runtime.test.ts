import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AI_TOWN_DAY_SLOTS,
  type AiTownRuntimeContentV1,
  type ProductRuntimePackageV1,
} from '../../src/lib/types'
import {
  createInitialAiTownStateV1,
  parseAiTownRuntimeContentV1,
  parseAiTownStateV1,
} from '../../src/lib/ai-town/runtime'
import {
  moveAiTownPlayerV1,
  performAiTownActionV1,
  proposeAiTownMajorChangeV1,
  recordAiTownConversationV1,
  resolveAiTownEventSeedV1,
  resolveAiTownMajorChangeV1,
  runAiTownOfflineBatchV1,
} from '../../src/lib/ai-town/runtime-api'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-api'
import { commitInteractionPlayerMessage, startInteractionScene } from '../../src/lib/character-interaction/runtime-api'
import {
  adoptInteractionRuntimeCandidateV1,
  generateInteractionRuntimeCandidateV1,
} from '../../src/lib/character-interaction/harness'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import {
  currentProductSelection,
  loadCurrentProductWorldSourceCatalogV1,
  seedCurrentProductWorld,
} from '../helpers/current-product-world'

function content(): AiTownRuntimeContentV1 {
  const locations = Array.from({ length: 4 }, (_, index) => ({
    key: `town.location.${index + 1}`,
    title: ['住区', '广场', '工坊', '茶屋'][index],
    description: `后日谈地点 ${index + 1}`,
    parentKey: null,
    x: 15 + (index % 2) * 60,
    y: 20 + Math.floor(index / 2) * 60,
    capacity: 8,
    openSlots: [...AI_TOWN_DAY_SLOTS],
    tags: index === 0 ? ['home'] : ['public'],
  }))
  const residents = Array.from({ length: 4 }, (_, index) => ({
    residentKey: `town.resident.${index + 1}`,
    sourceCharacterResourceKey: `world-release:character:${index + 1}`,
    name: ['林舟', '陆遥', '南星', '周砚'][index],
    summary: `居民 ${index + 1} 的冻结原作身份。`,
    migrationReason: '原作结局后选择在这里继续生活。',
    identityLocks: [`不能否定居民 ${index + 1} 的原作经历。`],
    voiceRules: '保留独立意志，只谈论自己知道的事实。',
    homeLocationKey: locations[index].key,
    workLocationKey: locations[(index + 1) % locations.length].key,
    schedule: AI_TOWN_DAY_SLOTS.map((slot, slotIndex) => ({
      slot,
      locationKey: locations[(index + slotIndex) % locations.length].key,
      activity: `${slot} 的自主生活安排`,
    })),
    startingKnowledge: [{
      factKey: `town.fact.private.${index + 1}`,
      statement: `只有居民 ${index + 1} 知道的旧事。`,
      visibility: 'private' as const,
    }],
    goals: ['建立新的日常'],
  }))
  return {
    schema: 'storyforge.ai-town-runtime-content',
    version: 1,
    title: '灯塔余生镇',
    premise: '原作结束九十天后，旧友在海边共同修复一座茶屋。',
    elapsedCanonDays: 90,
    player: { role: 'new-resident', name: '阿晴', homeConcept: '海边的旧屋' },
    canonLocks: [{ key: 'town.canon.ending', statement: '失踪船队已经获救。', evidenceRefs: ['world-release:story-core:1'] }],
    residents,
    relationships: residents.map((resident, index) => ({
      key: `town.relationship.player.${index + 1}`,
      fromResidentKey: resident.residentKey,
      toResidentKey: 'player',
      trust: 40,
      intimacy: 15,
      wariness: 25,
      reason: '玩家刚加入共同体。',
      evidenceRefs: [],
    })),
    map: {
      locations,
      routes: locations.slice(1).map((location, index) => ({
        key: `town.route.${index + 1}`,
        fromLocationKey: locations[0].key,
        toLocationKey: location.key,
        bidirectional: true,
        travelSlots: 1,
      })),
      playerHomeLocationKey: locations[0].key,
    },
    lifeThreads: residents.map((resident, index) => ({
      key: `town.thread.${index + 1}`,
      ownerResidentKey: resident.residentKey,
      title: `${resident.name}的新生活`,
      description: '在不否定过去的前提下继续成长。',
      initialStage: index < 2 ? 'active' as const : 'dormant' as const,
      locationKeys: [resident.homeLocationKey],
      participantKeys: [resident.residentKey],
    })),
    eventSeeds: Array.from({ length: 3 }, (_, index) => ({
      key: `town.event.${index + 1}`,
      category: index === 0 ? 'ambient' as const : index === 1 ? 'community' as const : 'resident-friction' as const,
      title: `生活事件 ${index + 1}`,
      summary: '由人物日程、地点和关系共同触发的可观察事件。',
      intensity: index + 1,
      minimumDay: 1,
      cooldownDays: 1,
      eligibleSlots: ['morning' as const],
      locationKeys: [locations[0].key],
      participantKeys: [residents[index].residentKey],
      lifeThreadKeys: [ `town.thread.${index + 1}` ],
    })),
    clock: { slots: [...AI_TOWN_DAY_SLOTS], actionsPerDay: 4 },
    offline: { enabled: true, maximumDays: 2 },
    economy: {
      resources: [{ key: 'materials', title: '材料', initial: 3, maximum: 99 }],
      startingMoney: 120,
      startingEnergy: 80,
      maximumEnergy: 100,
      sharedProject: { key: 'town.project.tea-house', title: '修复旧茶屋', description: '共同建设的长期目标。', targetProgress: 100, milestoneLocationKey: locations[2].key },
    },
    cadence: { dailyIntensityBudget: 6, highIntensityStreakLimit: 2, rareCrisisCooldownDays: 14 },
    safety: {
      boundaries: ['不替玩家决定行动'],
      majorChangeKinds: ['death-or-permanent-incapacity', 'marriage-or-family', 'permanent-departure', 'major-facility-change', 'world-rule-change'],
      romance: 'opt-in',
    },
  }
}

async function runtimeFixture() {
  const owned = await seedCurrentProductWorld('AI-TOWN-1')
  const catalog = await loadCurrentProductWorldSourceCatalogV1({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
    productType: 'ai-town',
  })
  const town = content()
  const profiles = town.residents.map((resident, index) => ({
    participantKey: `participant.${index + 1}`,
    characterKey: resident.sourceCharacterResourceKey,
    name: resident.name,
    roleLabel: '小镇居民',
    voiceRules: resident.voiceRules,
    initialKnowledge: [],
    relationshipDimensions: [],
    maxMemoryEntries: 40,
  }))
  const runtimePackage: ProductRuntimePackageV1 = {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'ai-town',
    definition: {
      productKey: 'ai-town.runtime.fixture', title: town.title, description: town.premise,
      enabledCapabilities: ['narrative', 'interaction', 'town'], rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: {
      contentHash: owned.release.contentHash,
      selection: currentProductSelection('ai-town', {
        residents: catalog.characters.map(item => item.resourceKey),
      }, catalog.worldReference.referenceHash),
    },
    narrative: {
      moduleKind: 'main', moduleTitle: '抵达小镇', entryNodeKey: 'town.arrival',
      nodes: [
        { key: 'town.arrival', kind: 'scene', title: '抵达小镇', summary: town.premise, conditionJson: '{}', effectsJson: '[]', successorKeys: ['town.afterstory'] },
        { key: 'town.afterstory', kind: 'ending', title: '生活继续', summary: '产品叙事模块结束，但小镇生活不结束。', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
      ],
      beats: [],
      choices: [{
        choiceKey: 'town.enter', sourceNodeKey: 'town.arrival', targetNodeKey: 'town.afterstory',
        text: '开始新的日常', description: '', unavailableReason: '',
        displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0,
      }],
    },
    interaction: {
      playerKey: 'player', profiles,
      sceneTemplates: [{
        sceneKey: 'town.arrival', title: '小镇当下', purpose: '与在场居民交谈', location: '语义地图', timeLabel: '当前时段',
        participantKeys: profiles.map(item => item.participantKey), publicKnowledgeKeys: [], goals: ['回应玩家'], endingConditions: ['玩家离开'],
        safetyBoundaries: ['不替玩家行动'], relationshipRules: [], openingNodeKey: 'town.arrival', endingNodeKey: 'town.afterstory',
        maxTurns: 80, directorBudget: 100, order: 0,
      }],
    },
    town,
  }
  return {
    ...owned,
    ...(await seedCurrentProductBuild({
      scope: owned.scope,
      worldRelease: owned.release as typeof owned.release & { id: number },
      runtimePackage,
      title: town.title,
    })),
  }
}

describe('R-AITOWN1 · 后日谈 AI 小镇产品闭环', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('严格验证 4..8 居民、六时段和从住所可达的语义地图', () => {
    const valid = parseAiTownRuntimeContentV1(content())
    expect(valid.residents).toHaveLength(4)
    expect(createInitialAiTownStateV1(valid, 'a'.repeat(64)).actionsRemaining).toBe(4)

    const island = content()
    island.map.routes = island.map.routes.filter(route => route.toLocationKey !== 'town.location.4')
    expect(() => parseAiTownRuntimeContentV1(island)).toThrow(/不可达/)

    const closedSchedule = content()
    closedSchedule.map.locations[0].openSlots = ['morning']
    expect(() => parseAiTownRuntimeContentV1(closedSchedule)).toThrow(/未开放地点/)

    const state = createInitialAiTownStateV1(valid, 'a'.repeat(64))
    expect(parseAiTownStateV1(state)?.residents['town.resident.1'].residencyStatus).toBe('resident')
    const corrupted = structuredClone(state) as unknown as Record<string, unknown>
    const corruptedResidents = corrupted.residents as Record<string, Record<string, unknown>>
    corruptedResidents['town.resident.1'].locationKey = 'town.location.outside'
    expect(() => parseAiTownStateV1(corrupted)).toThrow(/居民状态地点无效/)
    const injected = structuredClone(state) as unknown as Record<string, unknown>
    injected.unregisteredRuntimeField = true
    expect(() => parseAiTownStateV1(injected)).toThrow(/字段不符合合同/)
  })

  it('从冻结 Build 启动并幂等推进移动、行动、关系和轻经营', async () => {
    const seeded = await runtimeFixture()
    let version = await readProductRuntimeStateVersion(seeded.session.id!)
    const moved = await moveAiTownPlayerV1({
      sessionId: seeded.session.id!, commandId: 'town:move:1', baseSequence: version.sequence,
      baseStateHash: version.stateHash, locationKey: 'town.location.2',
    })
    const replayed = await moveAiTownPlayerV1({
      sessionId: seeded.session.id!, commandId: 'town:move:1', baseSequence: version.sequence,
      baseStateHash: version.stateHash, locationKey: 'town.location.2',
    })
    expect(replayed.id).toBe(moved.id)

    version = await readProductRuntimeStateVersion(seeded.session.id!)
    await performAiTownActionV1({
      sessionId: seeded.session.id!, commandId: 'town:help:1', baseSequence: version.sequence,
      baseStateHash: version.stateHash, kind: 'help', targetResidentKey: 'town.resident.2', note: '先修好漏雨的屋顶。',
    })
    const state = await readProductRuntimeState(seeded.session.id!)
    expect(state.town).toMatchObject({ slot: 'late-morning', actionsRemaining: 3 })
    expect(state.town?.player.locationKey).toBe('town.location.2')
    expect(state.town?.sharedProject.progress).toBe(3)
    expect(state.town?.player.resources.materials).toBe(4)
    expect(state.town?.relationships['town.relationship.player.2'].trust).toBe(42)
    expect(state.town?.memories[0]).toMatchObject({ ownerResidentKey: 'town.resident.2', visibility: 'shared' })
  })

  it('行动次数耗尽后观察也不能无限推进时间或刷取资源', async () => {
    const seeded = await runtimeFixture()
    for (let index = 0; index < 4; index += 1) {
      const version = await readProductRuntimeStateVersion(seeded.session.id!)
      await performAiTownActionV1({
        sessionId: seeded.session.id!, commandId: `town:observe:${index}`,
        baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'observe',
      })
    }
    const exhausted = await readProductRuntimeState(seeded.session.id!)
    expect(exhausted.town).toMatchObject({ actionsRemaining: 0, slot: 'evening' })
    const version = await readProductRuntimeStateVersion(seeded.session.id!)
    await expect(performAiTownActionV1({
      sessionId: seeded.session.id!, commandId: 'town:observe:unbounded',
      baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'observe',
    })).rejects.toThrow(/行动次数已用完/)
    expect((await readProductRuntimeStateVersion(seeded.session.id!)).sequence).toBe(version.sequence)
  })

  it('离线演化遵守产品冻结上限，不执行重大变化', async () => {
    const seeded = await runtimeFixture()
    const version = await readProductRuntimeStateVersion(seeded.session.id!)
    await expect(runAiTownOfflineBatchV1({
      sessionId: seeded.session.id!, commandId: 'town:offline:too-long', baseSequence: version.sequence,
      baseStateHash: version.stateHash, days: 3,
    })).rejects.toThrow(/1\.\.2/)
    await runAiTownOfflineBatchV1({
      sessionId: seeded.session.id!, commandId: 'town:offline:2', baseSequence: version.sequence,
      baseStateHash: version.stateHash, days: 2,
    })
    const state = await readProductRuntimeState(seeded.session.id!)
    expect(state.town).toMatchObject({ day: 3, slot: 'morning', offlineDaysSimulated: 2 })
    expect(state.town?.pendingMajorChanges).toEqual([])
    expect(Object.values(state.town?.lifeThreads ?? {}).some(thread => thread.progress > 0)).toBe(true)
  })

  it('事件只在冻结时空条件内触发，并写入冷却、生活线和可追溯记忆', async () => {
    const seeded = await runtimeFixture()
    let version = await readProductRuntimeStateVersion(seeded.session.id!)
    await resolveAiTownEventSeedV1({
      sessionId: seeded.session.id!, commandId: 'town:event:1', baseSequence: version.sequence,
      baseStateHash: version.stateHash, seedKey: 'town.event.1',
    })
    const state = await readProductRuntimeState(seeded.session.id!)
    expect(state.town?.cadence.seedLastTriggeredDay['town.event.1']).toBe(1)
    expect(state.town?.lifeThreads['town.thread.1'].progress).toBeGreaterThan(0)
    expect(state.town?.memories.some(memory => memory.memoryKey.includes('town.memory.event.'))).toBe(true)

    version = await readProductRuntimeStateVersion(seeded.session.id!)
    await expect(resolveAiTownEventSeedV1({
      sessionId: seeded.session.id!, commandId: 'town:event:cooldown', baseSequence: version.sequence,
      baseStateHash: version.stateHash, seedKey: 'town.event.1',
    })).rejects.toThrow(/冷却/)
  })

  it('专属 AI 小镇 Skill 只装配当前居民可见知识，并通过 durable Harness 采用回复', async () => {
    const seeded = await runtimeFixture()
    let version = await readProductRuntimeStateVersion(seeded.session.id!)
    await startInteractionScene({
      sessionId: seeded.session.id!, commandId: 'town:scene:1', baseSequence: version.sequence,
      baseStateHash: version.stateHash, sceneId: 'town:scene:runtime:1', sceneKey: 'town.arrival',
    })
    version = await readProductRuntimeStateVersion(seeded.session.id!)
    const player = await commitInteractionPlayerMessage({
      sessionId: seeded.session.id!, commandId: 'town:message:1', baseSequence: version.sequence,
      baseStateHash: version.stateHash, messageId: 'town:message:player:1', text: '你今天准备去哪里？',
      audienceKeys: ['participant.1'],
    })
    const generated = await generateInteractionRuntimeCandidateV1({
      scope: seeded.scope,
      productRuntimeSessionId: seeded.session.id!,
      participantKey: 'participant.1',
      skillId: 'character.ai-town-reply',
      objective: '依据小镇当下回应玩家',
      replyToSequence: player.sequence,
      runAI: async messages => {
        const context = messages.map(message => message.content).join('\n')
        expect(context).toContain('后日谈 AI 小镇专属运行上下文')
        expect(context).toContain('只有居民 1 知道的旧事')
        expect(context).not.toContain('只有居民 2 知道的旧事')
        return JSON.stringify({
          kind: 'character-reply', text: '上午我要去广场处理自己的计划，你可以同行，但不必迁就我。',
          replyToSequence: player.sequence, audienceKeys: ['player'], budgetCost: 1, disclosures: [],
        })
      },
    })
    const adopted = await adoptInteractionRuntimeCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect((await readProductRuntimeState(seeded.session.id!)).interaction?.messages.at(-1)?.text)
      .toContain('你可以同行')
    version = await readProductRuntimeStateVersion(seeded.session.id!)
    await recordAiTownConversationV1({
      sessionId: seeded.session.id!, commandId: 'town:conversation:1', baseSequence: version.sequence,
      baseStateHash: version.stateHash, residentKey: 'town.resident.1', participantKey: 'participant.1',
      sourceSequences: [player.sequence, adopted.event!.sequence],
    })
    const integrated = await readProductRuntimeState(seeded.session.id!)
    expect(integrated.town?.memories.at(-1)).toMatchObject({
      ownerResidentKey: 'town.resident.1',
      sourceSequences: [player.sequence, adopted.event!.sequence],
      visibility: 'shared',
    })
    expect(integrated.town?.relationships['town.relationship.player.1'].trust).toBe(41)
    version = await readProductRuntimeStateVersion(seeded.session.id!)
    const secondPlayer = await commitInteractionPlayerMessage({
      sessionId: seeded.session.id!, commandId: 'town:message:2', baseSequence: version.sequence,
      baseStateHash: version.stateHash, messageId: 'town:message:player:2', text: '晚些时候再见。',
      audienceKeys: ['participant.1'],
    })
    version = await readProductRuntimeStateVersion(seeded.session.id!)
    await recordAiTownConversationV1({
      sessionId: seeded.session.id!, commandId: 'town:conversation:2', baseSequence: version.sequence,
      baseStateHash: version.stateHash, residentKey: 'town.resident.1', participantKey: 'participant.1',
      sourceSequences: [secondPlayer.sequence],
    })
    const boundedRelationship = await readProductRuntimeState(seeded.session.id!)
    expect(boundedRelationship.town?.relationships['town.relationship.player.1'].trust).toBe(41)
    expect(boundedRelationship.town?.memories.filter(memory => memory.ownerResidentKey === 'town.resident.1')).toHaveLength(2)
  })

  it('重大变化只能先形成待确认候选，再由显式命令接受或拒绝', async () => {
    const seeded = await runtimeFixture()
    let version = await readProductRuntimeStateVersion(seeded.session.id!)
    await expect(proposeAiTownMajorChangeV1({
      sessionId: seeded.session.id!, commandId: 'town:major:too-early', baseSequence: version.sequence,
      baseStateHash: version.stateHash, candidateKey: 'town.major.too-early', kind: 'permanent-departure',
      title: '过早的远行', summary: '第一日就提出永久离场。', residentKeys: ['town.resident.2'],
    })).rejects.toThrow(/第 7 个游戏日/)
    for (const commandId of ['town:major:prepare:1', 'town:major:prepare:2', 'town:major:prepare:3']) {
      version = await readProductRuntimeStateVersion(seeded.session.id!)
      await runAiTownOfflineBatchV1({
        sessionId: seeded.session.id!, commandId, baseSequence: version.sequence,
        baseStateHash: version.stateHash, days: 2,
      })
    }
    version = await readProductRuntimeStateVersion(seeded.session.id!)
    await proposeAiTownMajorChangeV1({
      sessionId: seeded.session.id!, commandId: 'town:major:propose:1', baseSequence: version.sequence,
      baseStateHash: version.stateHash, candidateKey: 'town.major.departure.1', kind: 'permanent-departure',
      title: '陆遥计划远行', summary: '陆遥提出离开小镇去完成旧日承诺；此变化尚未生效。',
      residentKeys: ['town.resident.2'],
    })
    let state = await readProductRuntimeState(seeded.session.id!)
    expect(state.town?.pendingMajorChanges[0]).toMatchObject({ status: 'pending', kind: 'permanent-departure' })
    expect(state.town?.residents['town.resident.2']).toBeDefined()

    version = await readProductRuntimeStateVersion(seeded.session.id!)
    await resolveAiTownMajorChangeV1({
      sessionId: seeded.session.id!, commandId: 'town:major:reject:1', baseSequence: version.sequence,
      baseStateHash: version.stateHash, candidateKey: 'town.major.departure.1', resolution: 'rejected',
    })
    state = await readProductRuntimeState(seeded.session.id!)
    expect(state.town?.pendingMajorChanges[0].status).toBe('rejected')
    expect(state.town?.residents['town.resident.2'].residencyStatus).toBe('resident')

    version = await readProductRuntimeStateVersion(seeded.session.id!)
    await proposeAiTownMajorChangeV1({
      sessionId: seeded.session.id!, commandId: 'town:major:propose:2', baseSequence: version.sequence,
      baseStateHash: version.stateHash, candidateKey: 'town.major.departure.2', kind: 'permanent-departure',
      title: '顾川决定远行', summary: '顾川完成手头事务后，决定离开小镇。', residentKeys: ['town.resident.3'],
    })
    version = await readProductRuntimeStateVersion(seeded.session.id!)
    await resolveAiTownMajorChangeV1({
      sessionId: seeded.session.id!, commandId: 'town:major:accept:2', baseSequence: version.sequence,
      baseStateHash: version.stateHash, candidateKey: 'town.major.departure.2', resolution: 'accepted',
    })
    state = await readProductRuntimeState(seeded.session.id!)
    expect(state.town?.pendingMajorChanges[1].status).toBe('accepted')
    expect(state.town?.residents['town.resident.3'].residencyStatus).toBe('departed')
  })
})

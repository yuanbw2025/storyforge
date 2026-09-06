import { AI_TOWN_DAY_SLOTS, type AiTownRuntimeContentV1, type ProductRuntimePackageV1 } from '../../src/lib/types'
import { startAiTownInitialSceneV1 } from '../../src/lib/ai-town/runtime-api'
import { seedCurrentProductBuild } from './current-product-build'
import {
  currentProductSelection,
  loadCurrentProductWorldSourceCatalogV1,
  seedCurrentProductWorld,
} from './current-product-world'

export function aiTownRuntimeContent(): AiTownRuntimeContentV1 {
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
    relationships: [
      ...residents.map((resident, index) => ({
        key: `town.relationship.player.${index + 1}`,
        fromResidentKey: resident.residentKey,
        toResidentKey: 'player',
        trust: 40,
        intimacy: 15,
        wariness: 25,
        reason: '玩家刚加入共同体。',
        evidenceRefs: [],
      })),
      ...residents.map((resident, index) => ({
        key: `town.relationship.resident.${index + 1}`,
        fromResidentKey: resident.residentKey,
        toResidentKey: residents[(index + 1) % residents.length].residentKey,
        trust: 45,
        intimacy: 25,
        wariness: 20,
        reason: '居民在原作结局后重新建立日常联系。',
        evidenceRefs: [],
      })),
    ],
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
      participantKeys: [resident.residentKey, residents[(index + 1) % residents.length].residentKey],
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
      lifeThreadKeys: [`town.thread.${index + 1}`],
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

export async function seedAiTownRuntimeFixture(options: { reverseInteractionProfiles?: boolean } = {}) {
  const owned = await seedCurrentProductWorld('AI-TOWN-2', { minimumCharacters: 4 })
  const catalog = await loadCurrentProductWorldSourceCatalogV1({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
    productType: 'ai-town',
  })
  const town = aiTownRuntimeContent()
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
  const interactionProfiles = options.reverseInteractionProfiles ? [...profiles].reverse() : profiles
  const runtimePackage: ProductRuntimePackageV1 = {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'ai-town',
    definition: {
      productKey: 'ai-town.runtime.fixture', title: town.title, description: town.premise,
      enabledCapabilities: ['narrative', 'interaction', 'town'], rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: {
      contentHash: owned.release.contentHash,
      selection: currentProductSelection('ai-town', { residents: catalog.characters.map(item => item.resourceKey) }, catalog.worldReference.referenceHash),
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
      playerKey: 'player', profiles: interactionProfiles,
      sceneTemplates: [{
        sceneKey: 'town.arrival', title: '小镇当下', purpose: '与在场居民交谈', location: '语义地图', timeLabel: '当前时段',
        participantKeys: interactionProfiles.map(item => item.participantKey), publicKnowledgeKeys: [], goals: ['回应玩家'], endingConditions: ['玩家离开'],
        safetyBoundaries: ['不替玩家行动'], relationshipRules: [], openingNodeKey: 'town.arrival', endingNodeKey: 'town.afterstory',
        maxTurns: 80, directorBudget: 100, order: 0,
      }],
    },
    town,
  }
  const built = await seedCurrentProductBuild({
    scope: owned.scope,
    worldRelease: owned.release as typeof owned.release & { id: number },
    runtimePackage,
    title: town.title,
  })
  await startAiTownInitialSceneV1({
    sessionId: built.session.id!,
    commandId: `fixture:ai-town-scene:${built.session.id}`,
  })
  return { ...owned, ...built }
}

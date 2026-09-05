import { DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1 } from '../../src/lib/open-world/product-config'
import {
  TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1,
  type TextOpenWorldParsedModulesV1,
  type TextOpenWorldRuntimeModuleKeyV1,
  type TextOpenWorldRuntimePackageV1,
} from '../../src/lib/types'

const SOURCE_HASH = 'a'.repeat(64)
const SELECTION_HASH = 'b'.repeat(64)

const MODULE_DEPENDENCIES: Partial<Record<TextOpenWorldRuntimeModuleKeyV1, TextOpenWorldRuntimeModuleKeyV1[]>> = {
  world: ['narrative'],
  actors: ['world'],
  actions: ['world'],
  quests: ['narrative', 'actors', 'actions'],
  progression: ['actions'],
  items: ['actions'],
  combat: ['progression', 'items'],
  crafting: ['items'],
  relationships: ['actors', 'quests'],
  economy: ['actors', 'items', 'relationships'],
  'time-weather': ['world'],
  director: ['quests', 'time-weather'],
  knowledge: ['narrative', 'actors'],
  presentation: ['director', 'knowledge'],
}

function levels(): TextOpenWorldParsedModulesV1['progression']['levels'] {
  return Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    cumulativeExperience: index * index * 100,
    attributeGrowth: index === 0
      ? { power: 0, vitality: 0, agility: 0 }
      : { power: 1, vitality: 1, agility: index % 2 },
    unlockedSkillKeys: index === 0 ? ['skill.basic-attack'] : [],
  }))
}

export function createTextOpenWorldVNextFixture(): TextOpenWorldRuntimePackageV1 {
  const payloads: TextOpenWorldParsedModulesV1 = {
    narrative: {
      version: 1,
      storylines: [{
        key: 'story.main', kind: 'mainline', ownerKind: 'core', ownerKey: null,
        title: '盐脊断流', summary: '寻找断流原因并决定两地供水方案。',
        stageKeys: ['story-stage.main.1'], endingKeys: ['ending.cooperate', 'ending.control'],
      }],
      stages: [{
        key: 'story-stage.main.1', storylineKey: 'story.main', order: 1, title: '港口求援',
        summary: '从守渠人处了解断流。', questKeys: ['quest.main.1'], sceneKeys: ['scene.opening'], safeWaitPoint: true,
      }],
      endings: [
        { key: 'ending.cooperate', title: '共管盐渠', summary: '两地共同维护盐渠。', conditionKeys: ['condition.always'] },
        { key: 'ending.control', title: '港口控渠', summary: '港口接管盐渠。', conditionKeys: ['condition.always'] },
      ],
      scenes: [{
        key: 'scene.opening', title: '港口求援', purpose: '交代盐渠断流和主线目标。',
        locationKey: 'location.salt-port', participantKeys: ['actor.caretaker'],
        actionKeys: ['action.investigate-channel'], fixedChoiceKeys: ['choice.investigate-channel'],
      }],
      fixedChoices: [{
        key: 'choice.investigate-channel', sceneKey: 'scene.opening', label: '检查盐渠',
        description: '沿港口内渠寻找断流迹象。', actionKey: 'action.investigate-channel',
      }],
    },
    world: {
      version: 1,
      initialLocationKey: 'location.salt-port',
      regions: [
        {
          key: 'region.salt-port', title: '盐港', description: '依靠盐渠生存的海港聚落。',
          locationKeys: ['location.salt-port'], initialKnowledge: 'visited',
        },
        {
          key: 'region.ridge', title: '断脊', description: '盐渠上游的荒凉山脊。',
          locationKeys: ['location.ridge-channel'], initialKnowledge: 'heard',
        },
      ],
      locations: [
        { key: 'location.salt-port', regionKey: 'region.salt-port', title: '盐港广场', description: '盐商和守渠人汇集之处。', kind: 'settlement', tags: ['港口', '商店'] },
        { key: 'location.ridge-channel', regionKey: 'region.ridge', title: '断脊渠口', description: '被碎石阻塞的上游渠口。', kind: 'wilderness', tags: ['盐渠', '危险'] },
      ],
      edges: [{
        key: 'edge.port-ridge', fromLocationKey: 'location.salt-port', toLocationKey: 'location.ridge-channel',
        bidirectional: true, travelMinutes: 60, conditionKeys: [],
      }],
      fastTravelPoints: [
        { key: 'fast-travel.salt-port', locationKey: 'location.salt-port', unlockedByDefault: true },
        { key: 'fast-travel.ridge', locationKey: 'location.ridge-channel', unlockedByDefault: false },
      ],
    },
    actors: {
      version: 1,
      player: {
        key: 'player',
        identity: {
          name: '来客', pronouns: '他们', appearance: '', background: '', personality: '',
          publicKnowledge: '', privateKnowledge: '', shortGoal: '查明盐渠断流原因', longGoal: '决定两地供水未来', portrayal: '',
          sourceRefs: ['world-release:character:player'],
        },
        build: {
          progressionProfileKey: 'progression.default',
          initialLevel: 1, attributes: { power: 3, vitality: 3, agility: 3 },
          learnedSkillKeys: ['skill.basic-attack'], startingItemKeys: ['item.rust-sword'], startingCurrency: 20,
        },
      },
      factions: [{ key: 'faction.canal-keepers', title: '守渠会', description: '负责维护盐渠的民间组织。' }],
      actors: [{
        key: 'actor.caretaker', tier: 'mainline', name: '岑阿婆', biography: '盐港最后一位老守渠人。',
        portrayal: '说话简短，重视可验证的行动。', factionKey: 'faction.canal-keepers',
        homeLocationKey: 'location.salt-port', protected: true, serviceKeys: ['vendor.caretaker'], scheduleKey: 'schedule.caretaker',
      }],
      schedules: [{
        key: 'schedule.caretaker', actorKey: 'actor.caretaker',
        entries: [
          { timePeriodKey: 'time.day', locationKey: 'location.salt-port', activity: '检查内渠' },
          { timePeriodKey: 'time.night', locationKey: 'location.salt-port', activity: '整理渠图' },
        ],
      }],
    },
    quests: {
      version: 1,
      quests: [
        {
          key: 'quest.main.1', type: 'mainline', ownerKey: 'actor.caretaker', title: '断流的盐渠',
          description: '检查盐港内渠并追查上游。', storylineKey: 'story.main', stageKeys: ['quest-stage.main.1'],
          prerequisiteConditionKeys: [], rewardEffectKeys: ['effect.reward-experience'], lifecyclePolicy: 'protected-wait',
          expirationMinutes: null, repeatable: false,
        },
        {
          key: 'quest.template.supplies', type: 'template', ownerKey: 'region.salt-port', title: '短缺物资',
          description: '为当地居民寻找临时短缺的物资。', storylineKey: null, stageKeys: ['quest-stage.template.supplies'],
          prerequisiteConditionKeys: [], rewardEffectKeys: ['effect.reward-currency'], lifecyclePolicy: 'abandon-terminal',
          expirationMinutes: 1440, repeatable: true,
        },
      ],
      stages: [
        { key: 'quest-stage.main.1', questKey: 'quest.main.1', order: 1, title: '检查内渠', objectiveKeys: ['objective.main.1'], completionConditionKeys: ['condition.always'] },
        { key: 'quest-stage.template.supplies', questKey: 'quest.template.supplies', order: 1, title: '搜集物资', objectiveKeys: ['objective.template.supplies'], completionConditionKeys: ['condition.always'] },
      ],
      objectives: [
        { key: 'objective.main.1', stageKey: 'quest-stage.main.1', title: '检查盐港内渠', optional: false, actionKeys: ['action.investigate-channel'] },
        { key: 'objective.template.supplies', stageKey: 'quest-stage.template.supplies', title: '寻找盐晶', optional: false, actionKeys: ['action.investigate-channel'] },
      ],
    },
    actions: {
      version: 1,
      conditions: [{ key: 'condition.always', expression: { op: 'all', conditions: [{ op: 'player-number', field: 'level', comparator: 'gte', value: 1 }] }, failureMessage: '角色尚未进入可行动状态。' }],
      effects: [
        { key: 'effect.restore-health', operation: 'change-player-resource', payload: { resource: 'health', amount: 10 } },
        { key: 'effect.reward-experience', operation: 'grant-experience', payload: { amount: 100 } },
        { key: 'effect.reward-currency', operation: 'change-currency', payload: { amount: 10 } },
      ],
      actions: [{
        key: 'action.investigate-channel', category: 'investigate', label: '检查盐渠',
        description: '检查当前位置的盐渠痕迹。', actorScope: 'player', targetScope: 'location',
        locationKeys: ['location.salt-port', 'location.ridge-channel'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: [], failureEffectKeys: [], timeCostMinutes: 15,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }],
    },
    progression: {
      version: 1,
      rules: {
        maximumLevel: 20, automaticAttributeGrowth: true,
        levelUp: { resourcePolicy: 'increase-by-cap-delta', maximumLevelExperiencePolicy: 'cap-at-threshold' },
        attributes: { power: { label: '力量' }, vitality: { label: '体质' }, agility: { label: '敏捷' } },
        formulas: {
          baseHealth: 20, healthPerVitality: 5, healthPerLevel: 2, attackPerPower: 2, defensePerVitality: 1,
          baseCriticalChance: 0.05, criticalChancePerAgility: 0.005, criticalChanceCap: 0.5,
          initiativePerAgility: 1, baseSkillResource: 3, skillResourcePerLevel: 1,
        },
      },
      levels: levels(),
      skills: [{
        key: 'skill.basic-attack', title: '挥击', description: '一次稳定的武器攻击。', kind: 'attack',
        resourceCost: 0, cooldownTurns: 0, effectKeys: [],
      }],
    },
    combat: {
      version: 1,
      rules: {
        difficulty: 'standard', defaultAttackHits: true, playerPartyLimit: 1,
        allowFriendlyNpcCombatants: false, allowElements: false, allowEscape: true,
      },
      enemies: [{
        key: 'enemy.salt-jackal', familyKey: 'enemy-family.jackal', title: '盐鬣犬', level: 1,
        maximumHealth: 16, attack: 4, defense: 1, criticalChance: 0.05, initiative: 3,
        skillKeys: ['skill.basic-attack'], dropTableKey: 'drop.salt-jackal',
      }],
      encounters: [{
        key: 'encounter.ridge-jackal', title: '渠口伏兽', locationKey: 'location.ridge-channel',
        enemyKeys: ['enemy.salt-jackal'], recommendedLevel: 1, intensity: 'ordinary', escapeAllowed: true,
        victoryEffectKeys: ['effect.reward-experience'],
      }],
    },
    items: {
      version: 1,
      equipmentSlots: [
        { key: 'weapon', label: '武器' }, { key: 'armor', label: '防具' }, { key: 'accessory', label: '饰品' },
      ],
      items: [
        {
          key: 'item.rust-sword', title: '旧盐刀', description: '守渠人常用的短刀。', kind: 'equipment',
          stackable: false, consumable: false, critical: false, baseValue: 10, equipmentSlotKey: 'weapon',
          statModifiers: { attack: 2 }, effectKeys: [],
        },
        {
          key: 'item.salt-crystal', title: '盐晶', description: '可以制作药剂的粗盐晶。', kind: 'material',
          stackable: true, consumable: false, critical: false, baseValue: 2, equipmentSlotKey: null,
          statModifiers: {}, effectKeys: [],
        },
        {
          key: 'item.brine-tonic', title: '盐露药剂', description: '恢复少量生命。', kind: 'consumable',
          stackable: true, consumable: true, critical: false, baseValue: 8, equipmentSlotKey: null,
          statModifiers: {}, effectKeys: ['effect.restore-health'],
        },
      ],
      dropTables: [{ key: 'drop.salt-jackal', entries: [{ itemKey: 'item.salt-crystal', minimum: 1, maximum: 2, weight: 1 }] }],
    },
    crafting: {
      version: 1,
      recipes: [{
        key: 'recipe.brine-tonic', title: '盐露药剂', description: '将盐晶加工成简易药剂。', learnedByDefault: true,
        stationLocationKeys: ['location.salt-port'], ingredients: [{ itemKey: 'item.salt-crystal', quantity: 2 }],
        outputs: [{ itemKey: 'item.brine-tonic', quantity: 1 }], timeCostMinutes: 15,
      }],
    },
    economy: {
      version: 1,
      currency: { key: 'currency', label: '盐票' },
      vendors: [{
        key: 'vendor.caretaker', title: '守渠补给', actorKey: 'actor.caretaker', locationKey: 'location.salt-port',
        factionKey: 'faction.canal-keepers', buyPriceMultiplier: 1, sellPriceMultiplier: 0.5,
        stock: [{ itemKey: 'item.brine-tonic', quantity: null }],
      }],
    },
    relationships: {
      version: 1,
      morality: { minimum: -100, maximum: 100, initial: 0 },
      factionAffinity: { minimum: -100, maximum: 100, initial: 0 },
      attitude: { badMaximum: -25, goodMinimum: 25, moralityWeight: 0.4, factionWeight: 0.6, explicitStoryModifierCap: 20 },
      storyModifiers: [{ key: 'story-modifier.caretaker-trust', actorKey: 'actor.caretaker', value: 10, sourceQuestKey: 'quest.main.1' }],
    },
    'time-weather': {
      version: 1,
      initialWorldMinute: 480, minutesPerDay: 1440,
      timePeriods: [
        { key: 'time.dawn', label: '清晨', startMinute: 0, endMinute: 360 },
        { key: 'time.day', label: '白天', startMinute: 360, endMinute: 1080 },
        { key: 'time.night', label: '夜晚', startMinute: 1080, endMinute: 1440 },
      ],
      weather: [{ key: 'weather.clear', label: '晴朗', description: '干燥而明亮。' }],
      regionWeatherTables: [
        { regionKey: 'region.salt-port', entries: [{ weatherKey: 'weather.clear', weight: 1 }] },
        { regionKey: 'region.ridge', entries: [{ weatherKey: 'weather.clear', weight: 1 }] },
      ],
    },
    director: {
      version: 1,
      rules: { globalMaximumRevealed: 4, globalMaximumActive: 8, maximumQuestInstances: 20, highIntensityStreakLimit: 2 },
      decks: [{
        regionKey: 'region.salt-port', questKeys: [], templateKeys: ['template.supplies'], randomEventKeys: ['event.channel-rumor'],
        maximumRevealed: 3, maximumActive: 2, cooldownMinutes: 180, blankWeight: 1,
      }, {
        regionKey: 'region.ridge', questKeys: [], templateKeys: [], randomEventKeys: [],
        maximumRevealed: 2, maximumActive: 1, cooldownMinutes: 180, blankWeight: 2,
      }],
      templates: [{
        key: 'template.supplies', questKey: 'quest.template.supplies', regionKeys: ['region.salt-port'],
        variantTextKeys: ['task-text.supplies.1', 'task-text.supplies.2', 'task-text.supplies.3'],
        fingerprint: 'fingerprint.supplies', cooldownMinutes: 720,
      }],
      randomEvents: [{
        key: 'event.channel-rumor', title: '渠边传闻', regionKeys: ['region.salt-port'],
        actionKeys: ['action.investigate-channel'], effectKeys: [], intensity: 1, cooldownMinutes: 240,
      }],
    },
    knowledge: {
      version: 1,
      entries: [{
        key: 'knowledge.caretaker', kind: 'actor', title: '老守渠人', content: '岑阿婆知道盐渠的旧路线。',
        sourceRefs: ['world-release:character:caretaker'], initialPlayerVisibility: 'known', actorKeys: ['actor.caretaker'],
      }],
      rumors: [{ key: 'rumor.channel', knowledgeKey: 'knowledge.caretaker', text: '有人看见断脊渠口附近有野兽。', reliability: 'likely' }],
      achievements: [{ key: 'achievement.first-clue', title: '第一道水痕', description: '完成第一次渠线调查。', conditionKeys: ['condition.always'] }],
    },
    presentation: {
      version: 1,
      textStyle: { narrationTone: '克制而有地域感', dialogueStyle: '简短、符合人物身份', systemReceiptStyle: '明确列出确定性结果' },
      mediaSlots: [{
        key: 'map.world', kind: 'map', consumerRef: 'world', required: true, assetKey: null,
        fallbackText: '盐港与断脊的程序地图', altText: '盐港通往断脊渠口的地图',
      }],
      taskTextVariants: [{
        key: 'task-text.supplies.1', templateKey: 'template.supplies', title: '盐晶短缺', description: '守渠人需要两块粗盐晶。',
      }, {
        key: 'task-text.supplies.2', templateKey: 'template.supplies', title: '渠砖缺料', description: '修补渠墙还缺两块盐晶。',
      }, {
        key: 'task-text.supplies.3', templateKey: 'template.supplies', title: '药坊求购', description: '药坊临时收购用于制剂的盐晶。',
      }],
      tutorials: [{ key: 'tutorial.investigate', triggerActionKey: 'action.investigate-channel', targetUiKey: 'ui.action-panel', title: '调查', body: '选择调查会推进世界时间，并可能更新任务。' }],
    },
  }

  return {
    schema: 'storyforge.text-open-world.runtime-package',
    version: 1,
    metadata: {
      packageKey: 'salt-ridge.v1', title: '盐脊', description: '首个纵向验收世界。', contentLanguage: 'zh-CN',
      rulesetKey: 'storyforge.standard', rulesetVersion: 1,
    },
    sourceManifest: {
      kind: 'world-release', sourceKey: 'salt-ridge-world.v1', sourceVersion: 1,
      contentHash: SOURCE_HASH, selectionHash: SELECTION_HASH,
      resourceHashes: [{ resourceId: `world-release:v1:${SOURCE_HASH}:characters:1`, contentHash: SELECTION_HASH }],
    },
    experienceContract: {
      corePromise: '从陌生来客成长为能决定两地未来的行动者。', coreGoal: '保障两地居民的可持续供水。',
      freedomBoundary: '可自由探索和搁置主线，但不能破坏核心目标的可达性。', mainlinePolicy: 'strict-sequence', endingCount: 2,
      requiredPlayMinutes: { minimum: 90, maximum: 120 }, optionalInventoryMinutes: { minimum: 180, maximum: 300 },
    },
    calibration: structuredClone(DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1),
    modules: Object.fromEntries(TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.map(moduleKey => [moduleKey, {
      moduleKey, schemaVersion: 1, contentHash: SOURCE_HASH,
      dependencies: MODULE_DEPENDENCIES[moduleKey] ?? [], payload: payloads[moduleKey],
    }])) as TextOpenWorldRuntimePackageV1['modules'],
    mediaManifest: { version: 1, slotKeys: ['map.world'], requiredSlotKeys: ['map.world'] },
    qualityManifest: {
      version: 1, hardGateIds: ['package.references'], softMetricIds: ['narrative.variety'], waivedMetricIds: [],
    },
    compatibility: {
      minimumReaderVersion: 1, compatiblePreviousPackageHashes: [],
      legacyInputKinds: ['open-world-v1', 'adventure-v1', 'open-world-evolution-v1'], migrationPolicy: 'old-release-pinned',
    },
  }
}

import { DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1 } from '../../lib/open-world/product-config'
import {
  TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1,
  type TextOpenWorldParsedModulesV1,
  type TextOpenWorldRuntimeModuleKeyV1,
  type TextOpenWorldRuntimePackageV1,
} from '../../lib/types'

const SOURCE_HASH = 'a'.repeat(64)
const SELECTION_HASH = 'b'.repeat(64)

const MODULE_DEPENDENCIES: Partial<Record<TextOpenWorldRuntimeModuleKeyV1, TextOpenWorldRuntimeModuleKeyV1[]>> = {
  world: ['narrative'],
  actors: ['world', 'time-weather'],
  actions: ['world'],
  quests: ['narrative', 'actors', 'actions'],
  progression: ['actions'],
  items: ['actions'],
  combat: ['progression', 'items'],
  crafting: ['actions', 'items', 'world'],
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
    unlockedSkillKeys: index === 0 ? ['skill.basic-attack', 'skill.power-strike'] : [],
  }))
}

export function createTextOpenWorldVNextFixture(): TextOpenWorldRuntimePackageV1 {
  // Authored payloads intentionally retain their source schema versions. The
  // production parser below upgrades and verifies them before any Release is
  // allowed to consume the package.
  const payloads: any = {
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
      version: 3,
      initialLocationKey: 'location.salt-port',
      regions: [
        {
          key: 'region.salt-port', title: '盐港', description: '依靠盐渠生存的海港聚落。',
          theme: '资源匮乏中的互助与控制', levelBand: { minimum: 1, maximum: 3 }, knowledgePolicy: 'always-visible',
          locationKeys: ['location.salt-port'], fastTravelPointKey: 'fast-travel.salt-port', initialKnowledge: 'visited',
          sourceRefs: ['world-release:region:salt-port'], presentationRefs: ['map.world'],
        },
        {
          key: 'region.ridge', title: '断脊', description: '盐渠上游的荒凉山脊。',
          theme: '荒野危险与断流真相', levelBand: { minimum: 2, maximum: 5 }, knowledgePolicy: 'title-on-heard',
          locationKeys: ['location.ridge-channel'], fastTravelPointKey: 'fast-travel.ridge', initialKnowledge: 'heard',
          sourceRefs: ['world-release:region:ridge'], presentationRefs: ['map.world'],
        },
      ],
      locations: [
        {
          key: 'location.salt-port', regionKey: 'region.salt-port', title: '盐港广场', description: '盐商和守渠人汇集之处。', kind: 'settlement', tags: ['港口', '商店'],
          purpose: '承载开场、主线委托、交易和安全复活。', functions: ['narrative', 'service', 'travel'],
          earlyArrivalDescription: '广场照常运转，守渠人只会谈论玩家当前已经获知的断流信息。',
          initialKnowledge: 'visited', sourceRefs: ['world-release:location:salt-port'], presentationRefs: ['map.world'],
        },
        {
          key: 'location.ridge-channel', regionKey: 'region.ridge', title: '断脊渠口', description: '被碎石阻塞的上游渠口。', kind: 'wilderness', tags: ['盐渠', '危险'],
          purpose: '承载上游探索、战斗和盐渠主线后续。', functions: ['narrative', 'exploration', 'combat', 'travel'],
          earlyArrivalDescription: '玩家可以检查荒废渠口和周边野兽痕迹，但主线真相场景仍等待对应任务阶段。',
          initialKnowledge: 'heard', sourceRefs: ['world-release:location:ridge-channel'], presentationRefs: ['map.world'],
        },
      ],
      edges: [{
        key: 'edge.port-ridge', fromLocationKey: 'location.salt-port', toLocationKey: 'location.ridge-channel',
        bidirectional: true, travelMinutes: 60, conditionKeys: [], description: '沿盐渠维护道连接港口与断脊渠口。',
        riskProfile: 'ordinary', sourceRefs: ['world-release:route:salt-channel'],
      }],
      fastTravelPoints: [
        { key: 'fast-travel.salt-port', locationKey: 'location.salt-port', unlockedByDefault: true, canRespawn: true },
        { key: 'fast-travel.ridge', locationKey: 'location.ridge-channel', unlockedByDefault: false, canRespawn: true },
      ],
    },
    actors: {
      version: 3,
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
          learnedSkillKeys: ['skill.basic-attack', 'skill.power-strike'], startingItemKeys: ['item.rust-sword'], startingCurrency: 20,
        },
      },
      factions: [{ key: 'faction.canal-keepers', title: '守渠会', description: '负责维护盐渠的民间组织。' }],
      actors: [{
        key: 'actor.caretaker', tier: 'mainline', name: '岑阿婆', biography: '盐港最后一位老守渠人。',
        portrayal: '说话简短，重视可验证的行动。', factionKey: 'faction.canal-keepers',
        homeLocationKey: 'location.salt-port', protected: true, mortalityPolicy: 'protected', serviceKeys: ['vendor.caretaker'], scheduleKey: 'schedule.caretaker',
      }],
      schedules: [{
        key: 'schedule.caretaker', actorKey: 'actor.caretaker',
        entries: [
          { timePeriodKey: 'time.dawn', locationKey: 'location.salt-port', activity: '准备守渠工具', availableServiceKeys: [] },
          { timePeriodKey: 'time.day', locationKey: 'location.salt-port', activity: '检查内渠', availableServiceKeys: ['vendor.caretaker'] },
          { timePeriodKey: 'time.night', locationKey: 'location.salt-port', activity: '整理渠图', availableServiceKeys: [] },
        ],
      }],
      serviceContinuity: [{
        key: 'service-continuity.caretaker', ownerActorKey: 'actor.caretaker', serviceKey: 'vendor.caretaker',
        policy: 'disappear-on-owner-death', replacementActorKey: null, replacementServiceKey: null,
      }],
    },
    quests: {
      version: 2,
      quests: [
        {
          key: 'quest.main.1', type: 'mainline', ownerKind: 'actor', ownerKey: 'actor.caretaker', title: '断流的盐渠',
          description: '检查盐港内渠并追查上游。', storylineKey: 'story.main', stageKeys: ['quest-stage.main.1'],
          regionKeys: ['region.salt-port', 'region.ridge'],
          prerequisiteConditionKeys: [], rewardEffectKeys: ['effect.claim-main-reward', 'effect.reward-experience'], rewardContractKey: 'reward.quest-main', claimActionKey: 'action.claim-main-reward', lifecyclePolicy: 'protected-wait',
          timePolicy: 'waits', expirationMinutes: null, repeatable: false,
          instantiationPolicy: 'session-start', initialStatus: 'revealed', estimatedMinutes: 30, tags: ['mainline', 'water-crisis'],
        },
        {
          key: 'quest.template.supplies', type: 'template', ownerKind: 'region', ownerKey: 'region.salt-port', title: '短缺物资',
          description: '为当地居民寻找临时短缺的物资。', storylineKey: null, stageKeys: ['quest-stage.template.supplies'],
          regionKeys: ['region.salt-port'],
          prerequisiteConditionKeys: [], rewardEffectKeys: ['effect.claim-supplies-reward', 'effect.reward-currency'], rewardContractKey: 'reward.quest-supplies', claimActionKey: 'action.claim-supplies-reward', lifecyclePolicy: 'abandon-terminal',
          timePolicy: 'timed', expirationMinutes: 1440, repeatable: true,
          instantiationPolicy: 'director', initialStatus: 'locked', estimatedMinutes: 10, tags: ['regional', 'supplies'],
        },
      ],
      stages: [
        { key: 'quest-stage.main.1', questKey: 'quest.main.1', order: 1, title: '检查内渠', objectiveKeys: ['objective.main.1'], completionConditionKeys: ['condition.always'], completionActionKey: 'action.complete-main-quest' },
        { key: 'quest-stage.template.supplies', questKey: 'quest.template.supplies', order: 1, title: '搜集物资', objectiveKeys: ['objective.template.supplies'], completionConditionKeys: ['condition.always'], completionActionKey: 'action.complete-supplies-quest' },
      ],
      objectives: [
        { key: 'objective.main.1', stageKey: 'quest-stage.main.1', title: '检查盐港内渠', optional: false, actionKeys: ['action.investigate-channel', 'action.complete-main-objective'] },
        { key: 'objective.template.supplies', stageKey: 'quest-stage.template.supplies', title: '寻找盐晶', optional: false, actionKeys: ['action.investigate-channel', 'action.complete-supplies-objective'] },
      ],
    },
    actions: {
      version: 14,
      conditions: [
        { key: 'condition.always', expression: { op: 'all', conditions: [{ op: 'player-number', field: 'level', comparator: 'gte', value: 1 }] }, failureMessage: '角色尚未进入可行动状态。' },
        { key: 'condition.level-two', expression: { op: 'player-number', field: 'level', comparator: 'gte', value: 2 }, failureMessage: '经验不足，无法让谎言自洽。' },
        { key: 'condition.health-not-full', expression: { op: 'player-resource-below-maximum', resource: 'health' }, failureMessage: '生命已经满了。' },
        { key: 'condition.rust-sword-not-equipped', expression: { op: 'inventory-equipped', itemKey: 'item.rust-sword', equipped: false }, failureMessage: '旧盐刀已经装备。' },
        { key: 'condition.rust-sword-equipped', expression: { op: 'inventory-equipped', itemKey: 'item.rust-sword', equipped: true }, failureMessage: '旧盐刀尚未装备。' },
      ],
      effects: [
        { key: 'effect.restore-health', operation: 'change-player-resource', payload: { resource: 'health', amount: 10 } },
        { key: 'effect.reward-experience', operation: 'grant-experience', payload: { amount: 100 } },
        { key: 'effect.reward-currency', operation: 'change-currency', payload: { amount: 10 } },
        { key: 'effect.rest-full', operation: 'rest', payload: { healthRatio: 1, skillResourceRatio: 1, clearHarmfulStatuses: true } },
        { key: 'effect.rest-time', operation: 'advance-time', payload: { minutes: 480 } },
        { key: 'effect.investigate-time', operation: 'advance-time', payload: { minutes: 15 } },
        { key: 'effect.settle-weather', operation: 'settle-weather', payload: {} },
        { key: 'effect.settle-actor-schedules', operation: 'settle-actor-schedules', payload: {} },
        { key: 'effect.respawn-salt-port', operation: 'respawn', payload: { fastTravelPointKey: 'fast-travel.salt-port', healthRatio: 1 } },
        { key: 'effect.start-ridge-jackal', operation: 'initialize-combat', payload: { encounterKey: 'encounter.ridge-jackal' } },
        { key: 'effect.settle-combat-state', operation: 'settle-combat-state', payload: {} },
        { key: 'effect.combat-basic-attack', operation: 'perform-combat-action', payload: { kind: 'basic-attack', skillKey: 'skill.basic-attack', itemKey: null } },
        { key: 'effect.combat-power-strike', operation: 'perform-combat-action', payload: { kind: 'skill', skillKey: 'skill.power-strike', itemKey: null } },
        { key: 'effect.combat-brine-tonic', operation: 'perform-combat-action', payload: { kind: 'item', skillKey: null, itemKey: 'item.brine-tonic' } },
        { key: 'effect.combat-escape', operation: 'perform-combat-action', payload: { kind: 'escape', skillKey: null, itemKey: null } },
        { key: 'effect.combat-enemy-basic-attack', operation: 'perform-combat-action', payload: { kind: 'enemy-skill', skillKey: 'skill.basic-attack', itemKey: null } },
        { key: 'effect.craft-brine-tonic', operation: 'perform-crafting', payload: { recipeKey: 'recipe.brine-tonic' } },
        { key: 'effect.buy-caretaker', operation: 'perform-transaction', payload: { kind: 'buy', vendorKey: 'vendor.caretaker' } },
        { key: 'effect.sell-caretaker', operation: 'perform-transaction', payload: { kind: 'sell', vendorKey: 'vendor.caretaker' } },
        { key: 'effect.settle-director', operation: 'settle-director', payload: {} },
        { key: 'effect.combat-power-strike-cost', operation: 'change-player-resource', payload: { resource: 'skill-resource', amount: -2 } },
        { key: 'effect.consume-brine-tonic', operation: 'remove-item', payload: { itemKey: 'item.brine-tonic', quantity: 1, reason: 'consume' } },
        { key: 'effect.drop-salt-crystal', operation: 'remove-item', payload: { itemKey: 'item.salt-crystal', quantity: 1, reason: 'drop' } },
        { key: 'effect.equip-rust-sword', operation: 'equip-item', payload: { itemKey: 'item.rust-sword' } },
        { key: 'effect.unequip-rust-sword', operation: 'unequip-item', payload: { itemKey: 'item.rust-sword' } },
        { key: 'effect.drop-salt-1', operation: 'grant-item', payload: { itemKey: 'item.salt-crystal', quantity: 1 } },
        { key: 'effect.drop-salt-2', operation: 'grant-item', payload: { itemKey: 'item.salt-crystal', quantity: 2 } },
        { key: 'effect.earn-first-clue', operation: 'earn-achievement', payload: { achievementKey: 'achievement.first-clue' } },
        { key: 'effect.accept-main', operation: 'transition-quest', payload: { questKey: 'quest.main.1', status: 'accepted', stageKey: null } },
        { key: 'effect.activate-main', operation: 'transition-quest', payload: { questKey: 'quest.main.1', status: 'active', stageKey: 'quest-stage.main.1' } },
        { key: 'effect.accept-supplies', operation: 'transition-quest', payload: { questKey: 'quest.template.supplies', status: 'accepted', stageKey: null } },
        { key: 'effect.activate-supplies', operation: 'transition-quest', payload: { questKey: 'quest.template.supplies', status: 'active', stageKey: 'quest-stage.template.supplies' } },
        { key: 'effect.abandon-supplies', operation: 'transition-quest', payload: { questKey: 'quest.template.supplies', status: 'abandoned', stageKey: 'quest-stage.template.supplies' } },
        { key: 'effect.complete-main-objective', operation: 'complete-objective', payload: { objectiveKey: 'objective.main.1' } },
        { key: 'effect.complete-supplies-objective', operation: 'complete-objective', payload: { objectiveKey: 'objective.template.supplies' } },
        { key: 'effect.complete-main-quest', operation: 'transition-quest', payload: { questKey: 'quest.main.1', status: 'completed', stageKey: 'quest-stage.main.1' } },
        { key: 'effect.complete-supplies-quest', operation: 'transition-quest', payload: { questKey: 'quest.template.supplies', status: 'completed', stageKey: 'quest-stage.template.supplies' } },
        { key: 'effect.expire-supplies-unstarted', operation: 'transition-quest', payload: { questKey: 'quest.template.supplies', status: 'expired', stageKey: null } },
        { key: 'effect.expire-supplies-active', operation: 'transition-quest', payload: { questKey: 'quest.template.supplies', status: 'expired', stageKey: 'quest-stage.template.supplies' } },
        { key: 'effect.claim-main-reward', operation: 'claim-quest-reward', payload: { questKey: 'quest.main.1', rewardKey: 'reward.quest-main' } },
        { key: 'effect.claim-supplies-reward', operation: 'claim-quest-reward', payload: { questKey: 'quest.template.supplies', rewardKey: 'reward.quest-supplies' } },
        { key: 'effect.track-quest-primary', operation: 'track-quest', payload: { slot: 'primary' } },
        { key: 'effect.track-quest-pinned', operation: 'track-quest', payload: { slot: 'pinned' } },
        { key: 'effect.untrack-quest-primary', operation: 'untrack-quest', payload: { slot: 'primary' } },
        { key: 'effect.untrack-quest-pinned', operation: 'untrack-quest', payload: { slot: 'pinned' } },
        { key: 'effect.travel-port-ridge-start', operation: 'start-travel', payload: { edgeKey: 'edge.port-ridge', destinationLocationKey: 'location.ridge-channel' } },
        { key: 'effect.travel-port-ridge-time', operation: 'advance-time', payload: { minutes: 60 } },
        { key: 'effect.travel-port-ridge-enter', operation: 'enter-location', payload: { locationKey: 'location.ridge-channel' } },
        { key: 'effect.travel-ridge-port-start', operation: 'start-travel', payload: { edgeKey: 'edge.port-ridge', destinationLocationKey: 'location.salt-port' } },
        { key: 'effect.travel-ridge-port-time', operation: 'advance-time', payload: { minutes: 60 } },
        { key: 'effect.travel-ridge-port-enter', operation: 'enter-location', payload: { locationKey: 'location.salt-port' } },
        { key: 'effect.fast-travel', operation: 'fast-travel', payload: { timeRatioNumerator: 1, timeRatioDenominator: 2, minimumMinutes: 15 } },
        { key: 'effect.steal-morality-success', operation: 'change-morality', payload: { amount: -5 } },
        { key: 'effect.steal-morality-failure', operation: 'change-morality', payload: { amount: -2 } },
        { key: 'effect.steal-item', operation: 'grant-item', payload: { itemKey: 'item.brine-tonic', quantity: 1 } },
        { key: 'effect.steal-witnessed-affinity', operation: 'change-faction-affinity', payload: { factionKey: 'faction.canal-keepers', amount: -10 } },
        { key: 'effect.deceive-morality-success', operation: 'change-morality', payload: { amount: -3 } },
        { key: 'effect.deceive-morality-failure', operation: 'change-morality', payload: { amount: -4 } },
        { key: 'effect.deceive-witnessed-affinity', operation: 'change-faction-affinity', payload: { factionKey: 'faction.canal-keepers', amount: -8 } },
      ],
      actions: [{
        key: 'action.investigate-channel', category: 'investigate', label: '检查盐渠',
        description: '检查当前位置的盐渠痕迹。', actorScope: 'player', targetScope: 'location',
        locationKeys: ['location.salt-port', 'location.ridge-channel'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.investigate-time'], failureEffectKeys: [], timeCostMinutes: 15,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.talk-caretaker', category: 'talk', label: '与岑阿婆交谈', description: '询问盐港近来的传闻和委托。',
        actorScope: 'player', targetScope: 'actor', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: [], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.travel-port-ridge', category: 'travel', label: '前往断脊渠口', description: '沿盐渠维护道前往断脊渠口。',
        actorScope: 'player', targetScope: 'location', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.travel-port-ridge-start', 'effect.travel-port-ridge-time', 'effect.travel-port-ridge-enter'], failureEffectKeys: [], timeCostMinutes: 60,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.travel-ridge-port', category: 'travel', label: '返回盐港广场', description: '沿盐渠维护道返回盐港广场。',
        actorScope: 'player', targetScope: 'location', locationKeys: ['location.ridge-channel'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.travel-ridge-port-start', 'effect.travel-ridge-port-time', 'effect.travel-ridge-port-enter'], failureEffectKeys: [], timeCostMinutes: 60,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.fast-travel', category: 'fast-travel', label: '快速旅行', description: '立即结算到已到访并解锁的快速旅行点，不触发途中事件。',
        actorScope: 'player', targetScope: 'location', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.fast-travel'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.settle-weather', category: 'weather-action', label: '结算天气', description: '按冻结的地区气候表结算当前天气周期。',
        actorScope: 'system', targetScope: 'none', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.settle-weather'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.settle-actor-schedules', category: 'actor-schedule-action', label: '结算角色日程', description: '按冻结日程把常驻角色投影到当前时间段。',
        actorScope: 'system', targetScope: 'none', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.settle-actor-schedules'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.settle-director', category: 'director-action', label: '结算地区叙事牌组', description: '按冻结地区规则推进世界状态并结算一次受限发牌。',
        actorScope: 'system', targetScope: 'none', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.settle-director'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.accept-main', category: 'accept-quest', label: '接受主线任务', description: '接受并开始调查断流的盐渠。',
        actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.accept-main', 'effect.activate-main'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.accept-supplies', category: 'accept-quest', label: '接受物资任务', description: '接受并开始处理当地物资短缺。',
        actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.accept-supplies', 'effect.activate-supplies'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.abandon-supplies', category: 'abandon-quest', label: '放弃物资任务', description: '放弃当前这一次物资委托。',
        actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.abandon-supplies'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'always', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.complete-main-objective', category: 'objective-action', label: '完成盐渠检查', description: '提交盐渠检查结果。',
        actorScope: 'player', targetScope: 'quest', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.complete-main-objective'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.complete-supplies-objective', category: 'objective-action', label: '交付短缺物资', description: '提交本次物资委托所需的盐晶。',
        actorScope: 'player', targetScope: 'quest', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.complete-supplies-objective'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.complete-main-quest', category: 'quest-action', label: '结算主线阶段', description: '在目标满足后由系统完成主线任务。',
        actorScope: 'system', targetScope: 'quest', locationKeys: [], requirementConditionKeys: ['condition.always'], costEffectKeys: [],
        successEffectKeys: ['effect.complete-main-quest'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.complete-supplies-quest', category: 'quest-action', label: '结算物资任务', description: '在目标满足后由系统完成物资任务。',
        actorScope: 'system', targetScope: 'quest', locationKeys: [], requirementConditionKeys: ['condition.always'], costEffectKeys: [],
        successEffectKeys: ['effect.complete-supplies-quest'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.expire-supplies-unstarted', category: 'quest-action', label: '过期未接物资任务', description: '到期后由系统关闭尚未开始的物资任务。',
        actorScope: 'system', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.expire-supplies-unstarted'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.expire-supplies-active', category: 'quest-action', label: '过期进行中物资任务', description: '到期后由系统关闭进行中的物资任务。',
        actorScope: 'system', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.expire-supplies-active'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.claim-main-reward', category: 'claim-reward', label: '领取主线奖励', description: '领取断流盐渠任务奖励。',
        actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: [], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.claim-supplies-reward', category: 'claim-reward', label: '领取物资奖励', description: '领取本次物资委托奖励。',
        actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: [], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.track-quest-primary', category: 'track', label: '设为主追踪', description: '将任务设为HUD主追踪任务。',
        actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.track-quest-primary'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.track-quest-pinned', category: 'track', label: '钉选到HUD', description: '将任务加入HUD钉选列表。',
        actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.track-quest-pinned'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.untrack-quest-primary', category: 'untrack', label: '取消主追踪', description: '取消任务的HUD主追踪，不会放弃任务。',
        actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.untrack-quest-primary'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.untrack-quest-pinned', category: 'untrack', label: '取消HUD钉选', description: '从HUD钉选列表移除任务，不会放弃任务。',
        actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.untrack-quest-pinned'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.rest', category: 'rest', label: '休息', description: '休息并恢复生命与技能资源。',
        actorScope: 'player', targetScope: 'none', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.rest-full', 'effect.rest-time'], failureEffectKeys: [], timeCostMinutes: 480,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.respawn', category: 'respawn', label: '在盐港复活', description: '保留既有进度，在安全复活点恢复。',
        actorScope: 'player', targetScope: 'none', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.respawn-salt-port'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.start-ridge-jackal', category: 'start-combat', label: '迎战盐鬣犬', description: '进入盐渠伏兽遭遇。',
        actorScope: 'player', targetScope: 'encounter', locationKeys: ['location.ridge-channel'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.start-ridge-jackal'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.settle-combat-state', category: 'combat-state-action', label: '结算战斗阶段', description: '按冻结回合规则推进战斗阶段。',
        actorScope: 'system', targetScope: 'encounter', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.settle-combat-state'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.claim-combat-reward', category: 'combat-reward-action', label: '结算战斗奖励', description: '胜利后由系统按冻结奖励合同结算一次。',
        actorScope: 'system', targetScope: 'encounter', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: [], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.combat-basic-attack', category: 'combat-basic-attack', label: '普通攻击', description: '对一名敌人发动稳定的普通攻击。',
        actorScope: 'player', targetScope: 'combatant', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.combat-basic-attack'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.combat-power-strike', category: 'combat-skill', label: '重击', description: '消耗技能资源，对一名敌人发动重击。',
        actorScope: 'player', targetScope: 'combatant', locationKeys: [], requirementConditionKeys: [], costEffectKeys: ['effect.combat-power-strike-cost'],
        successEffectKeys: ['effect.combat-power-strike'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.combat-brine-tonic', category: 'combat-item', label: '使用盐露药剂', description: '在战斗中消耗一瓶盐露药剂。',
        actorScope: 'player', targetScope: 'item', locationKeys: [], requirementConditionKeys: ['condition.health-not-full'], costEffectKeys: ['effect.consume-brine-tonic'],
        successEffectKeys: ['effect.restore-health', 'effect.combat-brine-tonic'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.combat-escape', category: 'escape', label: '逃跑', description: '尝试退出当前遭遇。',
        actorScope: 'player', targetScope: 'none', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.combat-escape'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.combat-enemy-basic-attack', category: 'combat-enemy-skill', label: '敌人普通攻击', description: '由冻结策略为当前敌人执行普通攻击。',
        actorScope: 'system', targetScope: 'none', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.combat-enemy-basic-attack'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.craft-brine-tonic', category: 'craft', label: '制作盐露药剂', description: '消耗盐晶，在盐港制作一瓶或多瓶盐露药剂。',
        actorScope: 'player', targetScope: 'recipe', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.craft-brine-tonic'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.buy-caretaker', category: 'buy', label: '购买商品', description: '从守渠补给选择商品和数量并原子结算。',
        actorScope: 'player', targetScope: 'vendor', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.buy-caretaker'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.sell-caretaker', category: 'sell', label: '出售物品', description: '向守渠补给选择可出售物品和数量并原子结算。',
        actorScope: 'player', targetScope: 'vendor', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.sell-caretaker'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.use-brine-tonic', category: 'use', label: '使用盐露药剂', description: '消耗一瓶盐露药剂并恢复生命。',
        actorScope: 'player', targetScope: 'item', locationKeys: [], requirementConditionKeys: ['condition.health-not-full'], costEffectKeys: ['effect.consume-brine-tonic'],
        successEffectKeys: ['effect.restore-health'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.drop-salt-crystal', category: 'drop', label: '丢弃盐晶', description: '从背包中丢弃一枚盐晶。',
        actorScope: 'player', targetScope: 'item', locationKeys: [], requirementConditionKeys: [], costEffectKeys: ['effect.drop-salt-crystal'],
        successEffectKeys: [], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'always', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.equip-rust-sword', category: 'equip', label: '装备旧盐刀', description: '将旧盐刀装备到武器位。',
        actorScope: 'player', targetScope: 'item', locationKeys: [], requirementConditionKeys: ['condition.rust-sword-not-equipped'], costEffectKeys: [],
        successEffectKeys: ['effect.equip-rust-sword'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.unequip-rust-sword', category: 'unequip', label: '卸下旧盐刀', description: '从武器位卸下旧盐刀。',
        actorScope: 'player', targetScope: 'item', locationKeys: [], requirementConditionKeys: ['condition.rust-sword-equipped'], costEffectKeys: [],
        successEffectKeys: ['effect.unequip-rust-sword'], failureEffectKeys: [], timeCostMinutes: 0,
        confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      }, {
        key: 'action.steal-tonic', category: 'steal', label: '偷取盐露药剂', description: '趁岑阿婆整理渠图时偷走一瓶盐露药剂。',
        actorScope: 'player', targetScope: 'actor', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.steal-morality-success', 'effect.steal-item'], failureEffectKeys: ['effect.steal-morality-failure'], timeCostMinutes: 0,
        confirmationPolicy: 'always', repeatPolicy: 'once', cooldownMinutes: null,
      }, {
        key: 'action.deceive-caretaker', category: 'deceive', label: '欺骗岑阿婆', description: '谎称自己已经查明盐渠故障，以换取她的信任。',
        actorScope: 'player', targetScope: 'actor', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.deceive-morality-success'], failureEffectKeys: ['effect.deceive-morality-failure'], timeCostMinutes: 0,
        confirmationPolicy: 'always', repeatPolicy: 'once', cooldownMinutes: null,
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
        key: 'skill.basic-attack', title: '挥击', description: '一次稳定的武器攻击。', tags: ['基础', '近战'],
        activation: 'active', kind: 'attack', target: 'single-enemy', scalingAttribute: 'power',
        unlockSources: [{ kind: 'initial', level: null, questKey: null }], useConditionKeys: [], priority: 100,
        resourceCost: 0, cooldownTurns: 0, effectKeys: [],
      }, {
        key: 'skill.power-strike', title: '重击', description: '蓄力后进行一次强力打击。', tags: ['技能', '近战'],
        activation: 'active', kind: 'attack', target: 'single-enemy', scalingAttribute: 'power',
        unlockSources: [{ kind: 'initial', level: null, questKey: null }], useConditionKeys: [], priority: 80,
        resourceCost: 2, cooldownTurns: 2, effectKeys: [],
      }],
      statuses: [{ key: 'status.rested', title: '休整完毕', description: '角色已经充分休息。', polarity: 'beneficial' }],
    },
    combat: {
      version: 3,
      rules: {
        difficulty: 'standard', defaultAttackHits: true, playerPartyLimit: 1,
        allowFriendlyNpcCombatants: false, allowElements: false, allowEscape: true,
      },
      difficultyProfiles: [{
        key: 'standard', label: '标准', enemyHealthMultiplier: 1, enemyDamageMultiplier: 1, rewardMultiplier: 1,
      }],
      resolution: {
        algorithm: 'bounded-physical-v1', criticalRollMaximum: 10_000,
        criticalChanceCapBasisPoints: 5_000,
        criticalMultiplierNumerator: 3, criticalMultiplierDenominator: 2,
        minimumDamage: 1, maximumDamage: 1_000_000_000,
      },
      skillResolutions: [
        { skillKey: 'skill.basic-attack', powerNumerator: 1, powerDenominator: 1, flatDamage: 0 },
        { skillKey: 'skill.power-strike', powerNumerator: 3, powerDenominator: 2, flatDamage: 0 },
      ],
      transientPlayerStatusKeys: [],
      strategyProfiles: [{
        key: 'strategy.salt-jackal', title: '盐鬣犬扑咬', selection: 'ordered-skill-priority',
        prioritySkillKeys: ['skill.basic-attack'], fallbackSkillKey: 'skill.basic-attack',
      }],
      enemies: [{
        key: 'enemy.salt-jackal', familyKey: 'enemy-family.jackal', title: '盐鬣犬',
        description: '盘踞在断流渠口、会结群扑咬来客的荒野兽类。', tags: ['野兽', '近战'], level: 1,
        maximumHealth: 16, attack: 4, defense: 1, criticalChance: 0.05, initiative: 3,
        skillKeys: ['skill.basic-attack'], strategyProfileKey: 'strategy.salt-jackal', dropTableKey: 'drop.salt-jackal',
        sourceRefs: ['world-release:creature:salt-jackal'], presentationRefs: [],
      }],
      encounters: [{
        key: 'encounter.ridge-jackal', title: '渠口伏兽', description: '盐鬣犬堵住了通往断流点的渠岸。',
        locationKey: 'location.ridge-channel', questKeys: [],
        enemyGroups: [{ key: 'group.ridge-jackal.1', enemyKey: 'enemy.salt-jackal', count: 1, order: 1 }],
        recommendedLevel: 1, levelBand: { minimum: 1, maximum: 2 }, difficultyProfileKey: 'standard', intensity: 'ordinary',
        escapePolicy: { allowed: true, failureConsumesTurn: true },
        defeatPolicy: { kind: 'retry-or-respawn', preservesWorldProgress: true },
        rewardContractKey: 'reward.ridge-jackal',
        openingText: '碎盐滚下渠坡，一只盐鬣犬从断墙后压低身体。',
        victoryText: '盐鬣犬倒在渠口，通向断流点的道路恢复安静。',
        defeatText: '你没能突破渠口，可以从战前重试，或返回盐港复活点。',
        sourceRefs: ['world-release:encounter:ridge-jackal'], presentationRefs: [],
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
          tags: ['武器'], stackPolicy: 'instanced', maximumStack: null, unique: false,
          consumable: false, critical: false, droppable: true, sellable: true, baseValue: 10,
          useActionKey: null, equipActionKey: 'action.equip-rust-sword', unequipActionKey: 'action.unequip-rust-sword', equipConditionKeys: [], equipmentSlotKey: 'weapon',
          statModifiers: { attack: 2 }, effectKeys: [], sourceRefs: [], presentationRefs: [],
        },
        {
          key: 'item.salt-crystal', title: '盐晶', description: '可以制作药剂的粗盐晶。', kind: 'material',
          tags: ['材料'], stackPolicy: 'stacked', maximumStack: 999, unique: false,
          consumable: false, critical: false, droppable: true, sellable: true, baseValue: 2,
          useActionKey: null, equipActionKey: null, unequipActionKey: null, equipConditionKeys: [], equipmentSlotKey: null,
          statModifiers: {}, effectKeys: [], sourceRefs: [], presentationRefs: [],
        },
        {
          key: 'item.brine-tonic', title: '盐露药剂', description: '恢复少量生命。', kind: 'consumable',
          tags: ['消耗品'], stackPolicy: 'stacked', maximumStack: 99, unique: false,
          consumable: true, critical: false, droppable: true, sellable: true, baseValue: 8,
          useActionKey: 'action.use-brine-tonic', equipActionKey: null, unequipActionKey: null, equipConditionKeys: [], equipmentSlotKey: null,
          statModifiers: {}, effectKeys: ['effect.restore-health'], sourceRefs: [], presentationRefs: [],
        },
        {
          key: 'item.canal-seal', title: '守渠印', description: '维系主线身份的关键印记。', kind: 'quest',
          tags: ['任务物品'], stackPolicy: 'instanced', maximumStack: null, unique: true,
          consumable: false, critical: true, droppable: false, sellable: false, baseValue: 0,
          useActionKey: null, equipActionKey: null, unequipActionKey: null, equipConditionKeys: [], equipmentSlotKey: null,
          statModifiers: {}, effectKeys: [], sourceRefs: ['world-release:canal-seal'], presentationRefs: [],
        },
      ],
      rewardContracts: [{
        key: 'reward.quest-main', title: '断流盐渠任务奖励', sourceKind: 'quest', claimPolicy: 'once-per-source',
        expectedMinutes: 30, budgetClass: 'standard', conditionKeys: [], effectKeys: ['effect.claim-main-reward', 'effect.reward-experience'], dropTableKeys: [],
      }, {
        key: 'reward.quest-supplies', title: '短缺物资任务奖励', sourceKind: 'quest', claimPolicy: 'once-per-source',
        expectedMinutes: 10, budgetClass: 'minor', conditionKeys: [], effectKeys: ['effect.claim-supplies-reward', 'effect.reward-currency'], dropTableKeys: [],
      }, {
        key: 'reward.ridge-jackal', title: '渠口伏兽奖励', sourceKind: 'combat', claimPolicy: 'once-per-source',
        expectedMinutes: 10, budgetClass: 'minor', conditionKeys: [], effectKeys: ['effect.reward-experience'], dropTableKeys: ['drop.salt-jackal'],
      }],
      dropTables: [{
        key: 'drop.salt-jackal', algorithm: 'weighted-item-then-quantity-v1', rolls: 1, conditionKeys: [],
        entries: [{
          itemKey: 'item.salt-crystal', minimum: 1, maximum: 2, weight: 1, uniquePolicy: 'reject',
          quantityEffects: [{ quantity: 1, effectKey: 'effect.drop-salt-1' }, { quantity: 2, effectKey: 'effect.drop-salt-2' }],
        }],
      }],
    },
    crafting: {
      version: 2,
      rules: { successPolicy: 'guaranteed', maximumBatchQuantity: 100, maximumTotalItemUnitsPerAction: 100_000 },
      recipes: [{
        key: 'recipe.brine-tonic', title: '盐露药剂', description: '将盐晶加工成简易药剂。', category: 'consumable', learnedByDefault: true,
        stationLocationKeys: ['location.salt-port'], requirementConditionKeys: [], ingredients: [{ itemKey: 'item.salt-crystal', quantity: 2 }],
        outputs: [{ itemKey: 'item.brine-tonic', quantity: 1 }], timeCostMinutes: 15, presentationRefs: [],
      }],
    },
    economy: {
      version: 2,
      currency: { key: 'currency', label: '盐票' },
      rules: { maximumTransactionQuantity: 100, maximumTransactionTotal: 1_000_000_000 },
      vendors: [{
        key: 'vendor.caretaker', title: '守渠补给', actorKey: 'actor.caretaker', locationKey: 'location.salt-port',
        factionKey: 'faction.canal-keepers', buyPriceMultiplierBasisPoints: 10_000, sellPriceMultiplierBasisPoints: 5_000,
        buyCategories: ['equipment', 'consumable', 'material'], sellCategories: ['equipment', 'consumable', 'material'],
        inventoryEntries: [
          { itemKey: 'item.brine-tonic', stockPolicy: 'unlimited', initialQuantity: null },
          { itemKey: 'item.salt-crystal', stockPolicy: 'limited', initialQuantity: 3 },
        ],
        availabilityConditionKeys: [], buyActionKey: 'action.buy-caretaker', sellActionKey: 'action.sell-caretaker',
      }],
    },
    relationships: {
      version: 3,
      morality: { minimum: -100, maximum: 100, initial: 0 },
      factionAffinity: { minimum: -100, maximum: 100, initial: 0 },
      attitude: { badMaximum: -25, goodMinimum: 25, moralityWeight: 0.4, factionWeight: 0.6, explicitStoryModifierCap: 20 },
      storyModifiers: [{ key: 'story-modifier.caretaker-trust', actorKey: 'actor.caretaker', value: 10, sourceQuestKey: 'quest.main.1' }],
      unaffiliatedMoralityMultiplier: 1,
      factionMorality: [{ factionKey: 'faction.canal-keepers', moralityMultiplier: 1 }],
      attitudeBands: [
        { attitude: 'bad', label: '差', greetingTone: '冷淡而克制', buyPriceMultiplier: 1.15, sellPriceMultiplier: 0.85, optionalInteractionPolicy: 'may-refuse' },
        { attitude: 'neutral', label: '一般', greetingTone: '礼貌而保留', buyPriceMultiplier: 1, sellPriceMultiplier: 1, optionalInteractionPolicy: 'available' },
        { attitude: 'good', label: '好', greetingTone: '友善且愿意帮助', buyPriceMultiplier: 0.9, sellPriceMultiplier: 1.1, optionalInteractionPolicy: 'available' },
      ],
      crimeActions: [
        {
          key: 'crime.steal-tonic', actionKey: 'action.steal-tonic', kind: 'steal', targetActorKey: 'actor.caretaker', locationKey: 'location.salt-port',
          successConditionKeys: ['condition.always'], witnessActorKeysOnSuccess: [], witnessActorKeysOnFailure: ['actor.caretaker'],
          witnessedEffectKeys: ['effect.steal-witnessed-affinity'], failureMessage: '岑阿婆及时按住了药剂箱。',
        },
        {
          key: 'crime.deceive-caretaker', actionKey: 'action.deceive-caretaker', kind: 'deceive', targetActorKey: 'actor.caretaker', locationKey: 'location.salt-port',
          successConditionKeys: ['condition.level-two'], witnessActorKeysOnSuccess: ['actor.caretaker'], witnessActorKeysOnFailure: ['actor.caretaker'],
          witnessedEffectKeys: ['effect.deceive-witnessed-affinity'], failureMessage: '谎言中的细节无法自洽，岑阿婆没有相信。',
        },
      ],
    },
    'time-weather': {
      version: 2,
      initialWorldMinute: 480, minutesPerDay: 1440, weatherUpdateIntervalMinutes: 360,
      timePeriods: [
        { key: 'time.dawn', label: '清晨', startMinute: 0, endMinute: 360 },
        { key: 'time.day', label: '白天', startMinute: 360, endMinute: 1080 },
        { key: 'time.night', label: '夜晚', startMinute: 1080, endMinute: 1440 },
      ],
      weather: [
        { key: 'weather.clear', label: '晴朗', description: '干燥而明亮。' },
        { key: 'weather.rain', label: '降雨', description: '云层压低，雨水冲刷道路。' },
        { key: 'weather.salt-fog', label: '盐雾', description: '咸白雾气从盐地漫过道路。' },
      ],
      regionWeatherTables: [
        { regionKey: 'region.salt-port', entries: [{ weatherKey: 'weather.clear', weight: 3 }, { weatherKey: 'weather.rain', weight: 1 }, { weatherKey: 'weather.salt-fog', weight: 2 }] },
        { regionKey: 'region.ridge', entries: [{ weatherKey: 'weather.clear', weight: 2 }, { weatherKey: 'weather.rain', weight: 2 }, { weatherKey: 'weather.salt-fog', weight: 1 }] },
      ],
    },
    director: {
      version: 2,
      rules: { globalMaximumRevealed: 8, globalMaximumActive: 4, maximumQuestInstances: 20, highIntensityStreakLimit: 2, historyLimit: 64, maximumSettlementIntervals: 32, systemActionKey: 'action.settle-director' },
      decks: [{
        regionKey: 'region.salt-port', questKeys: [], templateKeys: ['template.supplies'], randomEventKeys: ['event.channel-rumor'],
        triggerKinds: ['talk'], maximumRevealed: 3, maximumActive: 2, cooldownMinutes: 180, blankWeight: 1,
      }, {
        regionKey: 'region.ridge', questKeys: [], templateKeys: [], randomEventKeys: [],
        triggerKinds: ['talk'], maximumRevealed: 2, maximumActive: 1, cooldownMinutes: 180, blankWeight: 2,
      }],
      templates: [{
        key: 'template.supplies', questKey: 'quest.template.supplies', regionKeys: ['region.salt-port'],
        variantTextKeys: ['task-text.supplies.1', 'task-text.supplies.2', 'task-text.supplies.3'],
        fingerprint: 'fingerprint.supplies', cooldownMinutes: 720, conditionKeys: [], levelBand: { minimum: 1, maximum: 5 },
        category: 'resource', intensity: 2, weight: 10,
      }],
      randomEvents: [{
        key: 'event.channel-rumor', title: '渠边传闻', kind: 'clue', regionKeys: ['region.salt-port'],
        actionKeys: ['action.investigate-channel'], effectKeys: [], conditionKeys: [], fingerprint: 'fingerprint.channel-rumor',
        rumorKey: 'rumor.channel', upgradeTemplateKey: null, intensity: 1, weight: 10, cooldownMinutes: 240,
      }],
      regionRules: [{
        regionKey: 'region.salt-port', settlementIntervalMinutes: 1440, initialPressure: 10, minimumPressure: 0, maximumPressure: 100,
        driftPerInterval: 5, stateBands: [{ key: 'stable', minimumPressure: 0 }, { key: 'strained', minimumPressure: 30 }, { key: 'crisis', minimumPressure: 70 }],
      }, {
        regionKey: 'region.ridge', settlementIntervalMinutes: 1440, initialPressure: 20, minimumPressure: 0, maximumPressure: 100,
        driftPerInterval: 3, stateBands: [{ key: 'stable', minimumPressure: 0 }, { key: 'strained', minimumPressure: 30 }, { key: 'crisis', minimumPressure: 70 }],
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
      version: 2,
      textStyle: { narrationTone: '克制而有地域感', dialogueStyle: '简短、符合人物身份', systemReceiptStyle: '明确列出确定性结果' },
      mapLayout: {
        version: 1, coordinateSystem: 'normalized-1000', width: 1000, height: 700, source: 'authored',
        locationNodes: [
          { locationKey: 'location.salt-port', x: 220, y: 420 },
          { locationKey: 'location.ridge-channel', x: 760, y: 220 },
        ],
      },
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
      moduleKey, schemaVersion: payloads[moduleKey].version, contentHash: SOURCE_HASH,
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

/**
 * Upgrades the authored base package with the P9 narrative and Action v15
 * bindings consumed by the player scene surface. Historical export names stay
 * available so older-reader regression tests retain their value.
 */
export function createTextOpenWorldVNextP9Fixture(): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const narrative = runtimePackage.modules.narrative.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  const choices = [
    {
      key: 'choice.accept-main', sceneKey: 'scene.offer.main', label: '接下盐渠委托',
      description: '答应岑阿婆，从盐港内渠开始追查断流。', actionKey: 'action.accept-main',
    },
    {
      key: 'choice.inspect-channel', sceneKey: 'scene.objective.main.1', label: '俯身检查渠壁',
      description: '检查盐渍、裂缝与水痕，寻找断流的第一条线索。', actionKey: 'action.investigate-channel',
    },
    {
      key: 'choice.claim-main', sceneKey: 'scene.resolution.main', label: '收下守渠印',
      description: '领取已经结算完成的主线阶段奖励。', actionKey: 'action.claim-main-reward',
    },
    {
      key: 'choice.accept-supplies', sceneKey: 'scene.offer.supplies', label: '接下物资委托',
      description: '接受本轮由地区Director发放的物资任务。', actionKey: 'action.accept-supplies',
    },
    {
      key: 'choice.complete-supplies', sceneKey: 'scene.objective.supplies', label: '交付盐晶',
      description: '提交本次物资任务的目标。', actionKey: 'action.complete-supplies-objective',
    },
    {
      key: 'choice.claim-supplies', sceneKey: 'scene.resolution.supplies', label: '领取物资报酬',
      description: '领取已经结算完成的普通任务奖励。', actionKey: 'action.claim-supplies-reward',
    },
    {
      key: 'choice.talk-caretaker', sceneKey: 'scene.actor.caretaker', label: '询问昨夜的异响',
      description: '请岑阿婆只讲她亲眼所见、亲耳所闻的情况。', actionKey: 'action.talk-caretaker',
    },
    {
      key: 'choice.rest', sceneKey: 'scene.location.salt-port', label: '在守渠棚休整',
      description: '在安全地点休息，恢复生命与技能资源。', actionKey: 'action.rest',
    },
  ]
  narrative.version = 2
  narrative.stages[0].sceneKeys = ['scene.offer.main', 'scene.objective.main.1']
  narrative.scenes = [
    {
      key: 'scene.offer.main', order: 1, sourceKind: 'quest-offer', sourceKey: 'quest.main.1',
      title: '干涸的内渠', purpose: '由守渠人提出主线委托。',
      regionKey: 'region.salt-port', locationKey: 'location.salt-port', questKey: 'quest.main.1',
      stageKey: null, objectiveKey: null, actorKey: 'actor.caretaker', interactionKey: null, randomEventKey: null,
      participantKeys: ['actor.caretaker'],
      openingText: '潮声仍在堤外起伏，广场中央的内渠却只剩一层发白的盐壳。',
      bodyText: '岑阿婆把磨旧的渠图压在石栏上，请你先查清水为何没有抵达盐港。',
      successText: '岑阿婆把守渠印交到你手中，指向渠壁上最新的一道水痕。',
      failureText: '你暂时没有接下委托，岑阿婆仍守在渠图旁等候。', attitudeOpenings: null,
      allowedKnowledgeClaimKeys: [], forbiddenFutureObjectiveKeys: [],
      availabilityConditionKeys: [], actionKeys: ['action.accept-main'], fixedChoiceKeys: ['choice.accept-main'],
    },
    {
      key: 'scene.objective.main.1', order: 2, sourceKind: 'quest-objective', sourceKey: 'objective.main.1',
      title: '盐壳下的水痕', purpose: '让玩家执行当前主线目标。',
      regionKey: 'region.salt-port', locationKey: 'location.salt-port', questKey: 'quest.main.1',
      stageKey: 'quest-stage.main.1', objectiveKey: 'objective.main.1', actorKey: null,
      interactionKey: null, randomEventKey: null, participantKeys: [],
      openingText: '渠壁的盐壳在日光下泛白，几道颜色更深的水痕一路伸向北侧闸口。',
      bodyText: '你可以从水痕、渠砖和残留泥沙入手，先确认断流发生在港内还是更远的上游。',
      successText: '新旧水痕的差异暴露了断流的方向，调查可以继续推进。',
      failureText: '眼前的痕迹还不足以支撑结论，你需要换一种已登记的调查方式。', attitudeOpenings: null,
      allowedKnowledgeClaimKeys: [], forbiddenFutureObjectiveKeys: [],
      availabilityConditionKeys: [], actionKeys: ['action.investigate-channel'], fixedChoiceKeys: ['choice.inspect-channel'],
    },
    {
      key: 'scene.resolution.main', order: 3, sourceKind: 'quest-resolution', sourceKey: 'quest.main.1',
      title: '盐渠阶段收束', purpose: '在正式任务完成后提供奖励收束。',
      regionKey: 'region.salt-port', locationKey: 'location.salt-port', questKey: 'quest.main.1',
      stageKey: 'quest-stage.main.1', objectiveKey: null, actorKey: 'actor.caretaker', interactionKey: null, randomEventKey: null,
      participantKeys: ['actor.caretaker'], openingText: '岑阿婆把守渠印和报酬放在渠图旁。',
      bodyText: '只有任务正式进入完成状态后，这段收束才会向玩家显示。',
      successText: '本阶段的奖励已经写入正式状态。', failureText: null, attitudeOpenings: null,
      allowedKnowledgeClaimKeys: [], forbiddenFutureObjectiveKeys: [], availabilityConditionKeys: [],
      actionKeys: ['action.claim-main-reward'], fixedChoiceKeys: ['choice.claim-main'],
    },
    {
      key: 'scene.offer.supplies', order: 4, sourceKind: 'quest-offer', sourceKey: 'quest.template.supplies',
      title: '临时物资请求', purpose: '承接地区Director实际发出的普通任务。',
      regionKey: 'region.salt-port', locationKey: 'location.salt-port', questKey: 'quest.template.supplies',
      stageKey: null, objectiveKey: null, actorKey: 'actor.caretaker', interactionKey: null, randomEventKey: null,
      participantKeys: ['actor.caretaker'], openingText: '守渠棚外贴出了一张临时物资清单。',
      bodyText: '只有本轮任务实例已经由地区Director揭示时，玩家才能接下它。',
      successText: '物资请求已经加入任务列表。', failureText: null, attitudeOpenings: null,
      allowedKnowledgeClaimKeys: [], forbiddenFutureObjectiveKeys: [], availabilityConditionKeys: [],
      actionKeys: ['action.accept-supplies'], fixedChoiceKeys: ['choice.accept-supplies'],
    },
    {
      key: 'scene.objective.supplies', order: 5, sourceKind: 'quest-objective', sourceKey: 'objective.template.supplies',
      title: '交付短缺物资', purpose: '推进当前有效的普通任务目标。',
      regionKey: 'region.salt-port', locationKey: 'location.salt-port', questKey: 'quest.template.supplies',
      stageKey: 'quest-stage.template.supplies', objectiveKey: 'objective.template.supplies', actorKey: null,
      interactionKey: null, randomEventKey: null, participantKeys: [],
      openingText: '物资清单仍压在守渠棚的木桌上。', bodyText: '交付只会作用于当前这一轮普通任务实例。',
      successText: '物资目标已经提交给确定性任务状态机。', failureText: null, attitudeOpenings: null,
      allowedKnowledgeClaimKeys: [], forbiddenFutureObjectiveKeys: [], availabilityConditionKeys: [],
      actionKeys: ['action.complete-supplies-objective'], fixedChoiceKeys: ['choice.complete-supplies'],
    },
    {
      key: 'scene.resolution.supplies', order: 6, sourceKind: 'quest-resolution', sourceKey: 'quest.template.supplies',
      title: '物资请求收束', purpose: '在普通任务完成后领取报酬。',
      regionKey: 'region.salt-port', locationKey: 'location.salt-port', questKey: 'quest.template.supplies',
      stageKey: 'quest-stage.template.supplies', objectiveKey: null, actorKey: 'actor.caretaker',
      interactionKey: null, randomEventKey: null, participantKeys: ['actor.caretaker'],
      openingText: '清单上的缺口已经补齐，约定的报酬也准备好了。', bodyText: '领取报酬会走正式奖励合同。',
      successText: '本次物资任务已经完整收束。', failureText: null, attitudeOpenings: null,
      allowedKnowledgeClaimKeys: [], forbiddenFutureObjectiveKeys: [], availabilityConditionKeys: [],
      actionKeys: ['action.claim-supplies-reward'], fixedChoiceKeys: ['choice.claim-supplies'],
    },
    {
      key: 'scene.actor.caretaker', order: 7, sourceKind: 'actor-dialogue', sourceKey: 'actor.caretaker',
      title: '守渠人的话', purpose: '提供符合角色态度与知识边界的常驻对话。',
      regionKey: 'region.salt-port', locationKey: 'location.salt-port', questKey: null, stageKey: null,
      objectiveKey: null, actorKey: 'actor.caretaker', interactionKey: null, randomEventKey: null,
      participantKeys: ['actor.caretaker'], openingText: '岑阿婆停下手里的活，抬眼看向你。',
      bodyText: '她只谈盐港已经发生的异响、渠水和守渠事务，不替未知的上游真相下结论。',
      successText: '谈话在可验证的线索范围内继续。', failureText: '岑阿婆避开了她并不知道的事。',
      attitudeOpenings: {
        bad: '岑阿婆把渠图收近了些，只冷淡地问你还有什么正事。',
        neutral: '岑阿婆礼貌地点头，等你说明来意。',
        good: '岑阿婆给你让出石栏边的位置，愿意把记得的细节再讲一遍。',
      },
      allowedKnowledgeClaimKeys: [], forbiddenFutureObjectiveKeys: [],
      availabilityConditionKeys: [], actionKeys: ['action.talk-caretaker'], fixedChoiceKeys: ['choice.talk-caretaker'],
    },
    {
      key: 'scene.location.salt-port', order: 8, sourceKind: 'location-interaction',
      sourceKey: 'interaction.salt-port.rest', title: '守渠棚', purpose: '提供地点上的确定性休整交互。',
      regionKey: 'region.salt-port', locationKey: 'location.salt-port', questKey: null, stageKey: null,
      objectiveKey: null, actorKey: null, interactionKey: 'interaction.salt-port.rest', randomEventKey: null,
      participantKeys: [], openingText: '守渠棚里铺着干燥的草席，门外能听见广场上的脚步声。',
      bodyText: '这里是已经确认的安全地点，可以短暂休整，但时间仍会照常推进。',
      successText: '你收拾好行装，重新回到盐港广场。', failureText: null, attitudeOpenings: null,
      allowedKnowledgeClaimKeys: [], forbiddenFutureObjectiveKeys: [], availabilityConditionKeys: [],
      actionKeys: ['action.rest'], fixedChoiceKeys: ['choice.rest'],
    },
    {
      key: 'scene.random.channel-rumor', order: 9, sourceKind: 'random-event', sourceKey: 'event.channel-rumor',
      title: '渠边传闻', purpose: '只在Director提供正式发生证据时呈现随机事件。',
      regionKey: 'region.salt-port', locationKey: 'location.salt-port', questKey: null, stageKey: null,
      objectiveKey: null, actorKey: null, interactionKey: null, randomEventKey: 'event.channel-rumor',
      participantKeys: [], openingText: '有人压低声音谈起北侧闸口的怪响。',
      bodyText: '这条传闻只有在地区Director正式发出后才属于当前场景。',
      successText: '传闻已经作为不确定信息进入玩家所知范围。', failureText: null, attitudeOpenings: null,
      allowedKnowledgeClaimKeys: [], forbiddenFutureObjectiveKeys: [], availabilityConditionKeys: [],
      actionKeys: [], fixedChoiceKeys: [],
    },
  ]
  narrative.fixedChoices = choices
  narrative.randomEventPresentations = [{
    key: 'presentation.event.channel-rumor', order: 1, randomEventKey: 'event.channel-rumor',
    openingText: '渠边有人说昨夜北闸传来石块拖动的声音。',
    resolutionText: '传闻没有被当成事实，只作为可调查方向保留。',
    rumorKey: 'rumor.channel', rumorRequirementKey: 'requirement.rumor.channel',
    rumorText: '北闸昨夜可能有异常动静。', reliability: 'uncertain', sourceClaimKeys: ['source.claim.channel'],
  }]
  runtimePackage.modules.narrative.schemaVersion = 2

  const combatCategories = new Set([
    'start-combat', 'continue-combat', 'combat-state-action', 'combat-reward-action',
    'combat-basic-attack', 'combat-skill', 'combat-item', 'combat-enemy-skill', 'escape',
  ])
  const naturalExamples: Record<string, [string, string]> = {
    'action.accept-main': ['我接受这个任务', '接受盐渠委托'],
    'action.investigate-channel': ['检查一下盐渠', '看看盐渠的痕迹'],
    'action.talk-caretaker': ['和岑阿婆聊聊', '询问岑阿婆'],
    'action.rest': ['我想休息', '在盐港休息'],
  }
  actions.version = 15
  actions.inputBindings = {
    sourceActionBindingsHash: 'c'.repeat(64),
    actions: actions.actions.map((action: any, index: number) => {
      const actionDefinitionHash = (index + 1).toString(16).padStart(64, '0')
      const mode = action.actorScope === 'system'
        ? 'disabled-system-only'
        : combatCategories.has(action.category)
          ? 'disabled-combat-button-only'
          : 'existing-action-candidate'
      return {
        key: `binding.${action.key}`, order: index + 1, actionKey: action.key, actionDefinitionHash,
        actorScope: action.actorScope, category: action.category, targetScope: action.targetScope,
        systemAction: {
          enabled: action.actorScope === 'player', label: action.label,
          description: action.description, executionSource: 'system-action',
        },
        fixedChoiceKeys: choices.filter(choice => choice.actionKey === action.key).map(choice => choice.key),
        naturalLanguage: {
          mode,
          exampleUtterances: mode === 'existing-action-candidate'
            ? naturalExamples[action.key] ?? [`请执行 ${action.key}`, `我要进行 ${action.key}`]
            : [],
          candidateMayOnlySelectThisAction: true,
          targetResolution: 'current-projection-valid-targets-only',
          highConfidenceLowRisk: 'execute-after-runtime-validation',
          highRiskOrIrreversible: 'require-explicit-confirmation',
          lowConfidence: 'respond-and-recommend-formal-actions',
          mayCreateAction: false, mayCreateQuest: false, mayCreateMapContent: false, mayWriteState: false,
        },
        resultAuthority: {
          artifactKey: 'text-open-world.quest-design-documents', collection: 'actions',
          actionKey: action.key, actionDefinitionHash,
        },
      }
    }),
    unmatchedNaturalLanguage: {
      policy: 'natural-response-then-formal-action-redirect',
      impossibleActionPolicy: 'explicit-decline-with-in-world-alternative',
      customSolutionPolicy: 'future-extension-disabled', stateMutationAllowed: false,
    },
    thresholds: { directExecutionMinimumConfidence: 0.9, recommendationMinimumConfidence: 0.55 },
    governance: {
      singleResultSource: true, allThreeInputsUseActionRegistry: true, modelCannotCreateActionOrResult: true,
      combatFreeTextDisabled: true, lowConfidenceNeverExecutes: true,
      irreversibleActionsRequireConfirmation: true, runtimeProjectionValidationRequired: true,
    },
  }
  runtimePackage.modules.actions.schemaVersion = 15
  return runtimePackage
}

/** Mirrors production P9, where the general rest Action has no authored Scene row. */
export function createTextOpenWorldVNextP9UnboundRestFixture(): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const narrative = runtimePackage.modules.narrative.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  narrative.scenes = narrative.scenes.filter((scene: any) => scene.key !== 'scene.location.salt-port')
  narrative.fixedChoices = narrative.fixedChoices.filter((choice: any) => choice.key !== 'choice.rest')
  const restBinding = actions.inputBindings.actions
    .find((binding: any) => binding.actionKey === 'action.rest')
  restBinding.fixedChoiceKeys = restBinding.fixedChoiceKeys
    .filter((choiceKey: string) => choiceKey !== 'choice.rest')
  return runtimePackage
}

/** Removes Director v2 and its Action v14 settlement binding. */
export function downgradeTextOpenWorldFixtureDirectorV1(
  runtimePackage: TextOpenWorldRuntimePackageV1,
): TextOpenWorldRuntimePackageV1 {
  const actions = runtimePackage.modules.actions.payload as any
  const director = runtimePackage.modules.director.payload as any
  actions.effects = actions.effects.filter((effect: any) => effect.operation !== 'settle-director')
  actions.actions = actions.actions.filter((action: any) => action.category !== 'director-action')
  if (actions.version >= 14) {
    actions.version = 13
    runtimePackage.modules.actions.schemaVersion = 13
  }
  if (director.version >= 2) {
    director.rules = {
      globalMaximumRevealed: director.rules.globalMaximumRevealed,
      globalMaximumActive: director.rules.globalMaximumActive,
      maximumQuestInstances: director.rules.maximumQuestInstances,
      highIntensityStreakLimit: director.rules.highIntensityStreakLimit,
    }
    director.decks = director.decks.map(({ triggerKinds: _triggerKinds, ...deck }: any) => deck)
    director.templates = director.templates.map(({ conditionKeys: _conditionKeys, levelBand: _levelBand, category: _category, intensity: _intensity, weight: _weight, ...template }: any) => template)
    director.randomEvents = director.randomEvents.map((event: any) => ({
      key: event.key, title: event.title, regionKeys: event.regionKeys, actionKeys: event.actionKeys,
      effectKeys: event.effectKeys, intensity: event.intensity, cooldownMinutes: event.cooldownMinutes,
    }))
    delete director.regionRules
    director.version = 1
    runtimePackage.modules.director.schemaVersion = 1
  }
  return runtimePackage
}

/** Re-encodes Economy v2 and its Action v13 bindings as the legacy data-only v1 module. */
export function downgradeTextOpenWorldFixtureEconomyV1(
  runtimePackage: TextOpenWorldRuntimePackageV1,
): TextOpenWorldRuntimePackageV1 {
  downgradeTextOpenWorldFixtureDirectorV1(runtimePackage)
  const actions = runtimePackage.modules.actions.payload as any
  const economy = runtimePackage.modules.economy.payload as any
  actions.effects = actions.effects.filter((effect: any) => effect.operation !== 'perform-transaction')
  actions.actions = actions.actions.filter((action: any) => !['buy', 'sell'].includes(action.category) || action.targetScope !== 'vendor')
  if (actions.version >= 13) {
    actions.version = 12
    runtimePackage.modules.actions.schemaVersion = 12
  }
  if (economy.version >= 2) {
    economy.vendors = economy.vendors.map((vendor: any) => ({
      key: vendor.key,
      title: vendor.title,
      actorKey: vendor.actorKey,
      locationKey: vendor.locationKey,
      factionKey: vendor.factionKey,
      buyPriceMultiplier: vendor.buyPriceMultiplierBasisPoints / 10_000,
      sellPriceMultiplier: vendor.sellPriceMultiplierBasisPoints / 10_000,
      stock: vendor.inventoryEntries.map((entry: any) => ({
        itemKey: entry.itemKey,
        quantity: entry.stockPolicy === 'unlimited' ? null : entry.initialQuantity,
      })),
    }))
    economy.version = 1
    delete economy.rules
    runtimePackage.modules.economy.schemaVersion = 1
  }
  return runtimePackage
}

/** Re-encodes Crafting v2 and its Action v12 bindings as the legacy data-only v1 module. */
export function downgradeTextOpenWorldFixtureCraftingV1(
  runtimePackage: TextOpenWorldRuntimePackageV1,
): TextOpenWorldRuntimePackageV1 {
  downgradeTextOpenWorldFixtureEconomyV1(runtimePackage)
  const actions = runtimePackage.modules.actions.payload as any
  const crafting = runtimePackage.modules.crafting.payload as any
  actions.effects = actions.effects.filter((effect: any) => effect.operation !== 'perform-crafting')
  actions.actions = actions.actions.filter((action: any) => action.category !== 'craft' && action.targetScope !== 'recipe')
  if (actions.version >= 12) {
    actions.version = 11
    runtimePackage.modules.actions.schemaVersion = 11
  }
  if (crafting.version >= 2) {
    crafting.recipes = crafting.recipes.map((recipe: any) => ({
      key: recipe.key,
      title: recipe.title,
      description: recipe.description,
      learnedByDefault: recipe.learnedByDefault,
      stationLocationKeys: recipe.stationLocationKeys,
      ingredients: recipe.ingredients,
      outputs: recipe.outputs,
      timeCostMinutes: recipe.timeCostMinutes,
    }))
    crafting.version = 1
    delete crafting.rules
    runtimePackage.modules.crafting.schemaVersion = 1
  }
  return runtimePackage
}

/**
 * Removes the latest crime extension before a test intentionally downgrades an
 * older Action/Relationship module. Keeping this in one compatibility helper avoids
 * constructing impossible mixed-version Releases in compatibility tests.
 */
export function downgradeTextOpenWorldFixtureWithoutCrimeV1(
  runtimePackage: TextOpenWorldRuntimePackageV1,
): TextOpenWorldRuntimePackageV1 {
  if (runtimePackage.modules.combat.schemaVersion >= 2) downgradeTextOpenWorldFixtureCombatV1(runtimePackage)
  const actions = runtimePackage.modules.actions.payload as any
  const relationships = runtimePackage.modules.relationships.payload as any
  const crimeDefinitions = Array.isArray(relationships.crimeActions) ? relationships.crimeActions : []
  const crimeActionKeys = new Set(crimeDefinitions.map((definition: any) => definition.actionKey))
  const crimeActionRows = actions.actions.filter((action: any) => crimeActionKeys.has(action.key))
  const crimeEffectKeys = new Set([
    ...crimeActionRows.flatMap((action: any) => [
      ...action.costEffectKeys,
      ...action.successEffectKeys,
      ...action.failureEffectKeys,
    ]),
    ...crimeDefinitions.flatMap((definition: any) => definition.witnessedEffectKeys),
  ])
  actions.actions = actions.actions.filter((action: any) => !crimeActionKeys.has(action.key))
  actions.effects = actions.effects.filter((effect: any) => !crimeEffectKeys.has(effect.key))
  if (actions.version >= 8) {
    actions.version = 7
    runtimePackage.modules.actions.schemaVersion = 7
  }
  relationships.version = Math.min(Number(relationships.version), 2)
  runtimePackage.modules.relationships.schemaVersion = relationships.version
  delete relationships.crimeActions
  return runtimePackage
}

/** Re-encodes the modern combat package as the former v1 Release payload. */
export function downgradeTextOpenWorldFixtureCombatV1(
  runtimePackage: TextOpenWorldRuntimePackageV1,
): TextOpenWorldRuntimePackageV1 {
  downgradeTextOpenWorldFixtureCraftingV1(runtimePackage)
  const combat = runtimePackage.modules.combat.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  combat.version = 1
  combat.enemies = combat.enemies.map((enemy: any) => ({
    key: enemy.key,
    familyKey: enemy.familyKey,
    title: enemy.title,
    level: enemy.level,
    maximumHealth: enemy.maximumHealth,
    attack: enemy.attack,
    defense: enemy.defense,
    criticalChance: enemy.criticalChance,
    initiative: enemy.initiative,
    skillKeys: enemy.skillKeys,
    dropTableKey: enemy.dropTableKey,
  }))
  combat.encounters = combat.encounters.map((encounter: any) => ({
    key: encounter.key,
    title: encounter.title,
    locationKey: encounter.locationKey,
    enemyKeys: encounter.enemyGroups.map((group: any) => group.enemyKey),
    recommendedLevel: encounter.recommendedLevel,
    intensity: encounter.intensity,
    escapeAllowed: encounter.escapePolicy.allowed,
    victoryEffectKeys: ['effect.reward-experience'],
  }))
  delete combat.difficultyProfiles
  delete combat.strategyProfiles
  delete combat.resolution
  delete combat.skillResolutions
  delete combat.transientPlayerStatusKeys
  runtimePackage.modules.combat.schemaVersion = 1
  actions.effects = actions.effects.filter((effect: any) => !['settle-combat-state', 'perform-combat-action'].includes(effect.operation))
  actions.effects.forEach((effect: any) => {
    if (effect.operation === 'initialize-combat') effect.operation = 'start-combat'
  })
  actions.actions = actions.actions.filter((action: any) => ![
    'combat-state-action', 'combat-basic-attack', 'combat-skill', 'combat-item', 'combat-enemy-skill', 'combat-reward-action', 'escape',
  ].includes(action.category))
  if (actions.version >= 9) {
    actions.version = 8
    runtimePackage.modules.actions.schemaVersion = 8
  }
  return runtimePackage
}

/** Keeps Combat v2 but re-encodes Actions as the pre-combat-action v9 contract. */
export function downgradeTextOpenWorldFixtureCombatActionsV1(
  runtimePackage: TextOpenWorldRuntimePackageV1,
): TextOpenWorldRuntimePackageV1 {
  downgradeTextOpenWorldFixtureCraftingV1(runtimePackage)
  const actions = runtimePackage.modules.actions.payload as any
  const combat = runtimePackage.modules.combat.payload as any
  actions.effects = actions.effects.filter((effect: any) => effect.operation !== 'perform-combat-action')
  actions.actions = actions.actions.filter((action: any) => ![
    'combat-basic-attack', 'combat-skill', 'combat-item', 'combat-enemy-skill', 'combat-reward-action', 'escape',
  ].includes(action.category))
  if (combat.version >= 3) {
    combat.version = 2
    delete combat.resolution
    delete combat.skillResolutions
    delete combat.transientPlayerStatusKeys
    runtimePackage.modules.combat.schemaVersion = 2
  }
  actions.version = 9
  runtimePackage.modules.actions.schemaVersion = 9
  return runtimePackage
}

/** Keeps the G2-24 Action v10 / Combat v2 contract without numeric resolution. */
export function downgradeTextOpenWorldFixtureCombatResolutionV1(
  runtimePackage: TextOpenWorldRuntimePackageV1,
): TextOpenWorldRuntimePackageV1 {
  downgradeTextOpenWorldFixtureCraftingV1(runtimePackage)
  const actions = runtimePackage.modules.actions.payload as any
  const combat = runtimePackage.modules.combat.payload as any
  actions.actions = actions.actions.filter((action: any) => action.category !== 'combat-reward-action')
  actions.version = 10
  runtimePackage.modules.actions.schemaVersion = 10
  combat.version = 2
  delete combat.resolution
  delete combat.skillResolutions
  delete combat.transientPlayerStatusKeys
  runtimePackage.modules.combat.schemaVersion = 2
  return runtimePackage
}

/** Product-facing name; historical fixture exports remain for regression compatibility. */
export const createSaltRidgeShowcaseBasePackageV1 = createTextOpenWorldVNextP9Fixture

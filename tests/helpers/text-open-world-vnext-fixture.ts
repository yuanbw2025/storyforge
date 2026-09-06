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
  actors: ['world', 'time-weather'],
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
      version: 2,
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
          { timePeriodKey: 'time.dawn', locationKey: 'location.salt-port', activity: '准备守渠工具', availableServiceKeys: [] },
          { timePeriodKey: 'time.day', locationKey: 'location.salt-port', activity: '检查内渠', availableServiceKeys: ['vendor.caretaker'] },
          { timePeriodKey: 'time.night', locationKey: 'location.salt-port', activity: '整理渠图', availableServiceKeys: [] },
        ],
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
      version: 6,
      conditions: [
        { key: 'condition.always', expression: { op: 'all', conditions: [{ op: 'player-number', field: 'level', comparator: 'gte', value: 1 }] }, failureMessage: '角色尚未进入可行动状态。' },
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
        { key: 'effect.start-ridge-jackal', operation: 'start-combat', payload: { encounterKey: 'encounter.ridge-jackal' } },
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
      ],
      actions: [{
        key: 'action.investigate-channel', category: 'investigate', label: '检查盐渠',
        description: '检查当前位置的盐渠痕迹。', actorScope: 'player', targetScope: 'location',
        locationKeys: ['location.salt-port', 'location.ridge-channel'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: ['effect.investigate-time'], failureEffectKeys: [], timeCostMinutes: 15,
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
      }],
      statuses: [{ key: 'status.rested', title: '休整完毕', description: '角色已经充分休息。', polarity: 'beneficial' }],
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

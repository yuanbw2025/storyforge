import type { TextOpenWorldObjectiveStatusV1, TextOpenWorldQuestStatusV1 } from './text-open-world-condition'

export type TextOpenWorldEffectOperationV1 =
  | 'change-player-resource' | 'grant-experience' | 'apply-status' | 'remove-status'
  | 'grant-item' | 'remove-item' | 'equip-item' | 'unequip-item'
  | 'learn-skill' | 'learn-recipe' | 'change-currency'
  | 'transition-quest' | 'complete-objective' | 'claim-quest-reward' | 'track-quest' | 'untrack-quest'
  | 'change-morality' | 'change-faction-affinity' | 'set-story-modifier'
  | 'reveal-knowledge' | 'reveal-location' | 'unlock-fast-travel'
  | 'enter-location' | 'start-travel' | 'fast-travel' | 'advance-time' | 'settle-weather'
  | 'start-combat' | 'resolve-combat' | 'rest' | 'respawn'
  | 'change-actor-state' | 'change-region-state' | 'set-world-flag'
  | 'earn-achievement' | 'unlock-ending' | 'reach-ending'

export type TextOpenWorldEffectDefinitionV1 =
  | { key: string; operation: 'change-player-resource'; payload: { resource: 'health' | 'skill-resource'; amount: number } }
  | { key: string; operation: 'grant-experience'; payload: { amount: number } }
  | { key: string; operation: 'apply-status' | 'remove-status'; payload: { statusKey: string } }
  | { key: string; operation: 'grant-item'; payload: { itemKey: string; quantity: number } }
  | { key: string; operation: 'remove-item'; payload: { itemKey: string; quantity: number; reason: 'consume' | 'drop' | 'sell' | 'craft' } }
  | { key: string; operation: 'equip-item' | 'unequip-item'; payload: { itemKey: string } }
  | { key: string; operation: 'learn-skill'; payload: { skillKey: string } }
  | { key: string; operation: 'learn-recipe'; payload: { recipeKey: string } }
  | { key: string; operation: 'change-currency'; payload: { amount: number } }
  | { key: string; operation: 'transition-quest'; payload: { questKey: string; status: TextOpenWorldQuestStatusV1; stageKey: string | null } }
  | { key: string; operation: 'complete-objective'; payload: { objectiveKey: string } }
  | { key: string; operation: 'claim-quest-reward'; payload: { questKey: string; rewardKey: string } }
  | { key: string; operation: 'track-quest' | 'untrack-quest'; payload: { slot: 'primary' | 'pinned' } }
  | { key: string; operation: 'change-morality'; payload: { amount: number } }
  | { key: string; operation: 'change-faction-affinity'; payload: { factionKey: string; amount: number } }
  | { key: string; operation: 'set-story-modifier'; payload: { actorKey: string; value: number } }
  | { key: string; operation: 'reveal-knowledge'; payload: { knowledgeKey: string; visibility: 'rumor' | 'known' } }
  | { key: string; operation: 'reveal-location'; payload: { locationKey: string } }
  | { key: string; operation: 'unlock-fast-travel'; payload: { fastTravelPointKey: string } }
  | { key: string; operation: 'enter-location'; payload: { locationKey: string } }
  | { key: string; operation: 'start-travel'; payload: { edgeKey: string; destinationLocationKey: string } }
  | { key: string; operation: 'fast-travel'; payload: { timeRatioNumerator: number; timeRatioDenominator: number; minimumMinutes: number } }
  | { key: string; operation: 'advance-time'; payload: { minutes: number } }
  | { key: string; operation: 'settle-weather'; payload: Record<string, never> }
  | { key: string; operation: 'start-combat'; payload: { encounterKey: string } }
  | { key: string; operation: 'resolve-combat'; payload: { encounterKey: string; outcome: 'victory' | 'defeat' | 'escaped' } }
  | { key: string; operation: 'rest'; payload: { healthRatio: number; skillResourceRatio: number; clearHarmfulStatuses: boolean } }
  | { key: string; operation: 'respawn'; payload: { fastTravelPointKey: string; healthRatio: number } }
  | { key: string; operation: 'change-actor-state'; payload: { actorKey: string; alive: boolean | null; present: boolean | null; locationKey: string | null } }
  | { key: string; operation: 'change-region-state'; payload: { regionKey: string; state: string } }
  | { key: string; operation: 'set-world-flag'; payload: { flagKey: string; value: string | number | boolean | null } }
  | { key: string; operation: 'earn-achievement'; payload: { achievementKey: string } }
  | { key: string; operation: 'unlock-ending'; payload: { endingKey: string } }
  | { key: string; operation: 'reach-ending'; payload: { endingKey: string } }

export interface TextOpenWorldQuestInstanceV1 {
  instanceKey: string
  definitionKey: string
  sourceKind: 'release' | 'director'
  sourceInstanceKey: string
  sourceContentHash: string
  status: TextOpenWorldQuestStatusV1
  currentStageKey: string | null
  objectiveStatusByKey: Record<string, TextOpenWorldObjectiveStatusV1>
  createdAtWorldMinute: number
  offeredAtWorldMinute: number | null
  acceptedAtWorldMinute: number | null
  deadlineWorldMinute: number | null
  terminalAtWorldMinute: number | null
  rewardClaimKey: string | null
  resultTag: string | null
}

export interface TextOpenWorldEffectStateV1 {
  version: 1
  player: {
    level: number
    experience: number
    health: number
    maximumHealth: number
    skillResource: number
    maximumSkillResource: number
    attributes: { power: number; vitality: number; agility: number }
    statusKeys: string[]
    learnedSkillKeys: string[]
  }
  inventory: {
    stackQuantities: Record<string, number>
    itemInstances: Record<string, { itemKey: string; acquiredByClaimKey: string; stateTags: string[] }>
    equippedItemInstanceIdBySlot: { weapon: string | null; armor: string | null; accessory: string | null }
    knownRecipeKeys: string[]
    currency: number
  }
  quests: {
    instancesByKey: Record<string, TextOpenWorldQuestInstanceV1>
    resultTags: string[]
    tracking: {
      primaryInstanceKey: string | null
      pinnedInstanceKeys: string[]
    }
  }
  map: {
    currentLocationKey: string
    revealedLocationKeys: string[]
    regionKnowledgeByKey: Record<string, 'unknown' | 'heard' | 'visited' | 'familiar'>
    locationKnowledgeByKey: Record<string, 'unknown' | 'heard' | 'visited' | 'familiar'>
    unlockedFastTravelPointKeys: string[]
    openEdgeKeys: string[]
    travel: { edgeKey: string; destinationLocationKey: string } | null
  }
  time: {
    worldMinute: number
    lastWeatherSettlementEpoch: number
    currentWeatherByRegionKey: Record<string, string>
    deadlineWorldMinuteByKey: Record<string, number>
  }
  relationships: {
    morality: number
    factionAffinityByKey: Record<string, number>
    storyModifierByActorKey: Record<string, number>
  }
  combat: { encounterKey: string; status: 'active' | 'victory' | 'defeat' | 'escaped' } | null
  actors: Record<string, { alive: boolean; present: boolean; locationKey: string; scheduleState: string }>
  world: {
    regionStateByKey: Record<string, string>
    regionPressureByKey: Record<string, number>
    factionStateByKey: Record<string, string>
    endingEligibleByKey: Record<string, boolean>
    flags: Record<string, string | number | boolean | null>
  }
  knowledge: {
    visibilityByKey: Record<string, 'hidden' | 'rumor' | 'known'>
    readRumorKeys: string[]
    earnedAchievementKeys: string[]
  }
  endings: { unlockedKeys: string[]; reachedKey: string | null }
  appliedClaimKeys: string[]
}

export type TextOpenWorldEffectImpactDomainV1 =
  | 'player' | 'inventory' | 'quests' | 'map' | 'time' | 'relationships'
  | 'combat' | 'actors' | 'world' | 'knowledge' | 'endings'

export interface TextOpenWorldEffectChangeV1 {
  effectKey: string
  domain: TextOpenWorldEffectImpactDomainV1
  operation: TextOpenWorldEffectOperationV1
  summary: string
  before: unknown
  after: unknown
}

export interface TextOpenWorldRewardAuthorizationV1 {
  kind: 'reward'
  rewardKey: string
  sourceInstanceKey: string
  randomRequests: Array<{ drawKey: string; minimumInclusive: number; maximumInclusive: number }>
  drops: Array<{ dropTableKey: string; itemKey: string; quantity: number; effectKey: string }>
}

export type TextOpenWorldQuestTransitionIntentV1 =
  | 'unlock' | 'reveal' | 'accept' | 'activate' | 'suspend' | 'resume'
  | 'advance-stage' | 'complete' | 'fail' | 'abandon' | 'expire' | 'withdraw' | 'reoffer'

export interface TextOpenWorldQuestTransitionAuthorizationV1 {
  kind: 'quest-transition'
  instanceKey: string
  definitionKey: string
  worldMinute: number
  transitions: Array<{
    intent: TextOpenWorldQuestTransitionIntentV1
    actorKind: 'player' | 'system'
    fromStatus: TextOpenWorldQuestStatusV1
    toStatus: TextOpenWorldQuestStatusV1
    stageKey: string | null
  }>
}

export interface TextOpenWorldObjectiveAuthorizationV1 {
  kind: 'quest-objective'
  instanceKey: string
  definitionKey: string
  stageKey: string
  objectiveKey: string
  worldMinute: number
  fromStatus: 'active'
  toStatus: 'completed'
}

export interface TextOpenWorldQuestTrackingAuthorizationV1 {
  kind: 'quest-tracking'
  instanceKey: string
  definitionKey: string
  worldMinute: number
  operation: 'track' | 'untrack'
  slot: 'primary' | 'pinned'
  beforePrimaryInstanceKey: string | null
  beforePinnedInstanceKeys: string[]
}

export interface TextOpenWorldFastTravelAuthorizationV1 {
  kind: 'fast-travel'
  fastTravelPointKey: string
  originLocationKey: string
  destinationLocationKey: string
  routeEdgeKeys: string[]
  openEdgeKeys: string[]
  baseWorldMinute: number
  travelMinutes: number
}

export interface TextOpenWorldWeatherSettlementAuthorizationV1 {
  kind: 'weather-settlement'
  worldMinute: number
  weatherEpoch: number
  randomRequests: Array<{ drawKey: string; minimumInclusive: number; maximumInclusive: number }>
  changes: Array<{
    regionKey: string
    fromWeatherKey: string
    toWeatherKey: string
    drawKey: string
    drawValue: number
  }>
}

export interface TextOpenWorldEffectPlanV1 {
  schema: 'storyforge.text-open-world.effect-plan'
  version: 1
  claimKey: string
  baseStateHash: string
  resultingStateHash: string
  effectKeys: string[]
  effects: TextOpenWorldEffectDefinitionV1[]
  authorization: TextOpenWorldRewardAuthorizationV1 | TextOpenWorldQuestTransitionAuthorizationV1 | TextOpenWorldObjectiveAuthorizationV1 | TextOpenWorldQuestTrackingAuthorizationV1 | TextOpenWorldFastTravelAuthorizationV1 | TextOpenWorldWeatherSettlementAuthorizationV1 | null
  impactDomains: TextOpenWorldEffectImpactDomainV1[]
  previewChanges: TextOpenWorldEffectChangeV1[]
  planHash: string
}

export interface TextOpenWorldEffectReceiptV1 {
  schema: 'storyforge.text-open-world.effect-receipt'
  version: 1
  claimKey: string
  planHash: string
  baseStateHash: string
  resultingStateHash: string
  impactDomains: TextOpenWorldEffectImpactDomainV1[]
  changes: TextOpenWorldEffectChangeV1[]
}

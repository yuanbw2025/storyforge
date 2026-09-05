export type TextOpenWorldNumberComparatorV1 = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'
export type TextOpenWorldQuestStatusV1 = 'locked' | 'available' | 'active' | 'completed' | 'failed' | 'expired' | 'abandoned'
export type TextOpenWorldObjectiveStatusV1 = 'inactive' | 'active' | 'completed' | 'failed'
export type TextOpenWorldKnowledgeVisibilityV1 = 'hidden' | 'rumor' | 'known'

export type TextOpenWorldConditionExpressionV1 =
  | { op: 'all'; conditions: TextOpenWorldConditionExpressionV1[] }
  | { op: 'any'; conditions: TextOpenWorldConditionExpressionV1[] }
  | { op: 'not'; condition: TextOpenWorldConditionExpressionV1 }
  | {
      op: 'player-number'
      field: 'level' | 'experience' | 'health' | 'maximum-health' | 'morality' | 'power' | 'vitality' | 'agility'
      comparator: TextOpenWorldNumberComparatorV1
      value: number
    }
  | { op: 'player-status'; statusKey: string; present: boolean }
  | { op: 'player-resource-below-maximum'; resource: 'health' | 'skill-resource' }
  | { op: 'inventory-quantity'; itemKey: string; comparator: TextOpenWorldNumberComparatorV1; value: number }
  | { op: 'inventory-currency'; comparator: TextOpenWorldNumberComparatorV1; value: number }
  | { op: 'inventory-equipped'; itemKey: string; equipped: boolean }
  | { op: 'inventory-recipe-known'; recipeKey: string; known: boolean }
  | { op: 'quest-status'; questKey: string; statuses: TextOpenWorldQuestStatusV1[] }
  | { op: 'quest-stage'; questKey: string; stageKey: string }
  | { op: 'quest-objective'; objectiveKey: string; status: TextOpenWorldObjectiveStatusV1 }
  | { op: 'quest-result-tag'; tag: string; present: boolean }
  | { op: 'map-location'; locationKey: string }
  | { op: 'map-region-knowledge'; regionKey: string; minimum: 'unknown' | 'heard' | 'visited' | 'familiar' }
  | { op: 'map-fast-travel'; fastTravelPointKey: string; unlocked: boolean }
  | { op: 'map-edge'; edgeKey: string; open: boolean }
  | { op: 'time-number'; field: 'world-minute' | 'day'; comparator: TextOpenWorldNumberComparatorV1; value: number }
  | { op: 'time-period'; timePeriodKey: string }
  | { op: 'time-weather'; weatherKey: string }
  | { op: 'time-deadline'; deadlineKey: string; relation: 'before' | 'at-or-before' | 'after' | 'at-or-after' }
  | { op: 'relation-faction-affinity'; factionKey: string; comparator: TextOpenWorldNumberComparatorV1; value: number }
  | { op: 'relation-attitude'; actorKey: string; attitude: 'bad' | 'neutral' | 'good' }
  | { op: 'relation-story-modifier'; actorKey: string; comparator: TextOpenWorldNumberComparatorV1; value: number }
  | { op: 'actor-boolean'; actorKey: string; field: 'present' | 'alive' | 'protected'; value: boolean }
  | { op: 'actor-schedule'; actorKey: string; state: string }
  | { op: 'world-flag'; flagKey: string; value: string | number | boolean | null }
  | { op: 'world-region-pressure'; regionKey: string; comparator: TextOpenWorldNumberComparatorV1; value: number }
  | { op: 'world-faction-state'; factionKey: string; state: string }
  | { op: 'world-ending-eligible'; endingKey: string; eligible: boolean }
  | { op: 'knowledge-visibility'; knowledgeKey: string; minimum: TextOpenWorldKnowledgeVisibilityV1 }
  | { op: 'knowledge-rumor-read'; rumorKey: string; read: boolean }
  | { op: 'knowledge-achievement'; achievementKey: string; earned: boolean }

export interface TextOpenWorldConditionDefinitionV1 {
  key: string
  expression: TextOpenWorldConditionExpressionV1
  failureMessage: string
}

export interface TextOpenWorldConditionEvaluationContextV1 {
  player: {
    level: number
    experience: number
    health: number
    maximumHealth: number
    skillResource: number
    maximumSkillResource: number
    morality: number
    attributes: { power: number; vitality: number; agility: number }
    statusKeys: string[]
  }
  inventory: {
    itemQuantities: Record<string, number>
    currency: number
    equippedItemKeys: string[]
    knownRecipeKeys: string[]
  }
  quests: {
    statusByQuestKey: Record<string, TextOpenWorldQuestStatusV1>
    stageByQuestKey: Record<string, string>
    objectiveStatusByKey: Record<string, TextOpenWorldObjectiveStatusV1>
    resultTags: string[]
  }
  map: {
    currentLocationKey: string
    regionKnowledgeByKey: Record<string, 'unknown' | 'heard' | 'visited' | 'familiar'>
    unlockedFastTravelPointKeys: string[]
    openEdgeKeys: string[]
  }
  time: {
    worldMinute: number
    minutesPerDay: number
    timePeriodKey: string
    weatherKey: string
    deadlineWorldMinuteByKey: Record<string, number>
  }
  relations: {
    factionAffinityByKey: Record<string, number>
    attitudeByActorKey: Record<string, 'bad' | 'neutral' | 'good'>
    storyModifierByActorKey: Record<string, number>
  }
  actors: Record<string, { present: boolean; alive: boolean; protected: boolean; scheduleState: string }>
  world: {
    flags: Record<string, string | number | boolean | null>
    regionPressureByKey: Record<string, number>
    factionStateByKey: Record<string, string>
    endingEligibleByKey: Record<string, boolean>
  }
  knowledge: {
    visibilityByKey: Record<string, TextOpenWorldKnowledgeVisibilityV1>
    readRumorKeys: string[]
    earnedAchievementKeys: string[]
  }
}

export interface TextOpenWorldConditionEvaluationV1 {
  conditionKey: string
  satisfied: boolean
  publicReason: string | null
}

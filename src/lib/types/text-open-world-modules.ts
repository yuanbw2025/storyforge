import type { TextOpenWorldConditionExpressionV1 } from './text-open-world-condition'

export type TextOpenWorldStorylineKindV1 = 'mainline' | 'significant'
export type TextOpenWorldStorylineOwnerKindV1 = 'core' | 'character' | 'faction' | 'region'
export type TextOpenWorldQuestTypeV1 = 'mainline' | 'significant' | 'ordinary' | 'template'
export type TextOpenWorldQuestLifecyclePolicyV1 = 'protected-wait' | 'abandon-restart' | 'abandon-terminal'
export type TextOpenWorldActionCategoryV1 =
  | 'move' | 'travel' | 'fast-travel' | 'observe' | 'investigate' | 'talk'
  | 'take' | 'use' | 'equip' | 'unequip' | 'drop' | 'buy' | 'sell' | 'craft'
  | 'accept-quest' | 'abandon-quest' | 'quest-action'
  | 'start-combat' | 'continue-combat' | 'escape' | 'rest'
  | 'read' | 'track' | 'untrack' | 'save' | 'load-branch'

export interface TextOpenWorldNarrativeModuleV1 {
  version: 1
  storylines: Array<{
    key: string
    kind: TextOpenWorldStorylineKindV1
    ownerKind: TextOpenWorldStorylineOwnerKindV1
    ownerKey: string | null
    title: string
    summary: string
    stageKeys: string[]
    endingKeys: string[]
  }>
  stages: Array<{
    key: string
    storylineKey: string
    order: number
    title: string
    summary: string
    questKeys: string[]
    sceneKeys: string[]
    safeWaitPoint: boolean
  }>
  endings: Array<{
    key: string
    title: string
    summary: string
    conditionKeys: string[]
  }>
  scenes: Array<{
    key: string
    title: string
    purpose: string
    locationKey: string
    participantKeys: string[]
    actionKeys: string[]
    fixedChoiceKeys: string[]
  }>
  fixedChoices: Array<{
    key: string
    sceneKey: string
    label: string
    description: string
    actionKey: string
  }>
}

export interface TextOpenWorldWorldModuleV1 {
  version: 1
  initialLocationKey: string
  regions: Array<{
    key: string
    title: string
    description: string
    locationKeys: string[]
    initialKnowledge: 'unknown' | 'heard' | 'visited' | 'familiar'
  }>
  locations: Array<{
    key: string
    regionKey: string
    title: string
    description: string
    kind: 'settlement' | 'interior' | 'wilderness' | 'dungeon' | 'landmark'
    tags: string[]
  }>
  edges: Array<{
    key: string
    fromLocationKey: string
    toLocationKey: string
    bidirectional: boolean
    travelMinutes: number
    conditionKeys: string[]
  }>
  fastTravelPoints: Array<{
    key: string
    locationKey: string
    unlockedByDefault: boolean
  }>
}

export interface TextOpenWorldActorModuleV1 {
  version: 1
  player: {
    key: 'player'
    identity: {
      name: string
      pronouns: string
      appearance: string
      background: string
      personality: string
      portrayal: string
      sourceRefs: string[]
    }
    build: {
      initialLevel: number
      attributes: { power: number; vitality: number; agility: number }
      learnedSkillKeys: string[]
      startingItemKeys: string[]
      startingCurrency: number
    }
  }
  factions: Array<{
    key: string
    title: string
    description: string
  }>
  actors: Array<{
    key: string
    tier: 'mainline' | 'significant' | 'resident' | 'transient'
    name: string
    biography: string
    portrayal: string
    factionKey: string | null
    homeLocationKey: string
    protected: boolean
    serviceKeys: string[]
    scheduleKey: string | null
  }>
  schedules: Array<{
    key: string
    actorKey: string
    entries: Array<{ timePeriodKey: string; locationKey: string; activity: string }>
  }>
}

export interface TextOpenWorldQuestModuleV1 {
  version: 1
  quests: Array<{
    key: string
    type: TextOpenWorldQuestTypeV1
    ownerKey: string | null
    title: string
    description: string
    storylineKey: string | null
    stageKeys: string[]
    prerequisiteConditionKeys: string[]
    rewardEffectKeys: string[]
    lifecyclePolicy: TextOpenWorldQuestLifecyclePolicyV1
    expirationMinutes: number | null
    repeatable: boolean
  }>
  stages: Array<{
    key: string
    questKey: string
    order: number
    title: string
    objectiveKeys: string[]
    completionConditionKeys: string[]
  }>
  objectives: Array<{
    key: string
    stageKey: string
    title: string
    optional: boolean
    actionKeys: string[]
  }>
}

export interface TextOpenWorldActionModuleV1 {
  version: 1
  conditions: Array<{
    key: string
    expression: TextOpenWorldConditionExpressionV1
    failureMessage: string
  }>
  effects: Array<{
    key: string
    operation: string
    payload: unknown
  }>
  actions: Array<{
    key: string
    category: TextOpenWorldActionCategoryV1
    label: string
    description: string
    actorScope: 'player' | 'system'
    targetScope: 'none' | 'actor' | 'location' | 'item' | 'quest' | 'vendor' | 'encounter'
    locationKeys: string[]
    requirementConditionKeys: string[]
    costEffectKeys: string[]
    successEffectKeys: string[]
    failureEffectKeys: string[]
    timeCostMinutes: number
    confirmationPolicy: 'never' | 'high-risk' | 'always'
    repeatPolicy: 'once' | 'repeatable' | 'cooldown'
    cooldownMinutes: number | null
  }>
}

export interface TextOpenWorldProgressionModuleV1 {
  version: 1
  rules: {
    maximumLevel: number
    automaticAttributeGrowth: true
    attributes: {
      power: { label: string }
      vitality: { label: string }
      agility: { label: string }
    }
    formulas: {
      baseHealth: number
      healthPerVitality: number
      healthPerLevel: number
      attackPerPower: number
      defensePerVitality: number
      baseCriticalChance: number
      criticalChancePerAgility: number
      criticalChanceCap: number
      initiativePerAgility: number
      baseSkillResource: number
      skillResourcePerLevel: number
    }
  }
  levels: Array<{
    level: number
    cumulativeExperience: number
    attributeGrowth: { power: number; vitality: number; agility: number }
    unlockedSkillKeys: string[]
  }>
  skills: Array<{
    key: string
    title: string
    description: string
    kind: 'attack' | 'status' | 'resource' | 'recovery'
    resourceCost: number
    cooldownTurns: number
    effectKeys: string[]
  }>
}

export interface TextOpenWorldCombatModuleV1 {
  version: 1
  rules: {
    difficulty: 'standard'
    defaultAttackHits: true
    playerPartyLimit: 1
    allowFriendlyNpcCombatants: false
    allowElements: false
    allowEscape: true
  }
  enemies: Array<{
    key: string
    familyKey: string
    title: string
    level: number
    maximumHealth: number
    attack: number
    defense: number
    criticalChance: number
    initiative: number
    skillKeys: string[]
    dropTableKey: string | null
  }>
  encounters: Array<{
    key: string
    title: string
    locationKey: string
    enemyKeys: string[]
    recommendedLevel: number
    intensity: 'ordinary' | 'dangerous' | 'boss'
    escapeAllowed: boolean
    victoryEffectKeys: string[]
  }>
}

export interface TextOpenWorldItemModuleV1 {
  version: 1
  equipmentSlots: Array<{
    key: 'weapon' | 'armor' | 'accessory'
    label: string
  }>
  items: Array<{
    key: string
    title: string
    description: string
    kind: 'equipment' | 'consumable' | 'material' | 'quest' | 'misc'
    stackable: boolean
    consumable: boolean
    critical: boolean
    baseValue: number
    equipmentSlotKey: 'weapon' | 'armor' | 'accessory' | null
    statModifiers: Partial<Record<'maximumHealth' | 'attack' | 'defense' | 'criticalChance' | 'initiative' | 'skillPower' | 'skillResource', number>>
    effectKeys: string[]
  }>
  dropTables: Array<{
    key: string
    entries: Array<{ itemKey: string; minimum: number; maximum: number; weight: number }>
  }>
}

export interface TextOpenWorldCraftingModuleV1 {
  version: 1
  recipes: Array<{
    key: string
    title: string
    description: string
    learnedByDefault: boolean
    stationLocationKeys: string[]
    ingredients: Array<{ itemKey: string; quantity: number }>
    outputs: Array<{ itemKey: string; quantity: number }>
    timeCostMinutes: number
  }>
}

export interface TextOpenWorldEconomyModuleV1 {
  version: 1
  currency: { key: 'currency'; label: string }
  vendors: Array<{
    key: string
    title: string
    actorKey: string
    locationKey: string
    factionKey: string | null
    buyPriceMultiplier: number
    sellPriceMultiplier: number
    stock: Array<{ itemKey: string; quantity: number | null }>
  }>
}

export interface TextOpenWorldRelationshipModuleV1 {
  version: 1
  morality: { minimum: number; maximum: number; initial: number }
  factionAffinity: { minimum: number; maximum: number; initial: number }
  attitude: {
    badMaximum: number
    goodMinimum: number
    moralityWeight: number
    factionWeight: number
    explicitStoryModifierCap: number
  }
  storyModifiers: Array<{
    key: string
    actorKey: string
    value: number
    sourceQuestKey: string
  }>
}

export interface TextOpenWorldTimeWeatherModuleV1 {
  version: 1
  initialWorldMinute: number
  minutesPerDay: number
  timePeriods: Array<{
    key: string
    label: string
    startMinute: number
    endMinute: number
  }>
  weather: Array<{
    key: string
    label: string
    description: string
  }>
  regionWeatherTables: Array<{
    regionKey: string
    entries: Array<{ weatherKey: string; weight: number }>
  }>
}

export interface TextOpenWorldDirectorModuleV1 {
  version: 1
  rules: {
    globalMaximumRevealed: number
    globalMaximumActive: number
    maximumQuestInstances: number
    highIntensityStreakLimit: number
  }
  decks: Array<{
    regionKey: string
    questKeys: string[]
    templateKeys: string[]
    randomEventKeys: string[]
    maximumRevealed: number
    maximumActive: number
    cooldownMinutes: number
    blankWeight: number
  }>
  templates: Array<{
    key: string
    questKey: string
    regionKeys: string[]
    variantTextKeys: string[]
    fingerprint: string
    cooldownMinutes: number
  }>
  randomEvents: Array<{
    key: string
    title: string
    regionKeys: string[]
    actionKeys: string[]
    effectKeys: string[]
    intensity: number
    cooldownMinutes: number
  }>
}

export interface TextOpenWorldKnowledgeModuleV1 {
  version: 1
  entries: Array<{
    key: string
    kind: 'location' | 'actor' | 'faction' | 'enemy' | 'lore' | 'quest-clue'
    title: string
    content: string
    sourceRefs: string[]
    initialPlayerVisibility: 'hidden' | 'rumor' | 'known'
    actorKeys: string[]
  }>
  rumors: Array<{
    key: string
    knowledgeKey: string
    text: string
    reliability: 'uncertain' | 'likely' | 'confirmed'
  }>
  achievements: Array<{
    key: string
    title: string
    description: string
    conditionKeys: string[]
  }>
}

export interface TextOpenWorldPresentationModuleV1 {
  version: 1
  textStyle: {
    narrationTone: string
    dialogueStyle: string
    systemReceiptStyle: string
  }
  mediaSlots: Array<{
    key: string
    kind: 'map' | 'portrait' | 'background' | 'item-icon' | 'enemy-icon' | 'audio'
    consumerRef: string
    required: boolean
    assetKey: string | null
    fallbackText: string
    altText: string
  }>
  taskTextVariants: Array<{
    key: string
    templateKey: string
    title: string
    description: string
  }>
  tutorials: Array<{
    key: string
    triggerActionKey: string
    targetUiKey: string
    title: string
    body: string
  }>
}

export interface TextOpenWorldParsedModulesV1 {
  narrative: TextOpenWorldNarrativeModuleV1
  world: TextOpenWorldWorldModuleV1
  actors: TextOpenWorldActorModuleV1
  quests: TextOpenWorldQuestModuleV1
  actions: TextOpenWorldActionModuleV1
  progression: TextOpenWorldProgressionModuleV1
  combat: TextOpenWorldCombatModuleV1
  items: TextOpenWorldItemModuleV1
  crafting: TextOpenWorldCraftingModuleV1
  economy: TextOpenWorldEconomyModuleV1
  relationships: TextOpenWorldRelationshipModuleV1
  'time-weather': TextOpenWorldTimeWeatherModuleV1
  director: TextOpenWorldDirectorModuleV1
  knowledge: TextOpenWorldKnowledgeModuleV1
  presentation: TextOpenWorldPresentationModuleV1
}

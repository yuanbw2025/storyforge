import type { TextOpenWorldConditionExpressionV1 } from './text-open-world-condition'
import type { TextOpenWorldCombatStatModifierV2, TextOpenWorldEffectDefinitionV1 } from './text-open-world-effect'

export type TextOpenWorldStorylineKindV1 = 'mainline' | 'significant'
export type TextOpenWorldStorylineOwnerKindV1 = 'core' | 'character' | 'faction' | 'region'
export type TextOpenWorldQuestTypeV1 = 'mainline' | 'significant' | 'ordinary' | 'template'
export type TextOpenWorldQuestLifecyclePolicyV1 = 'protected-wait' | 'abandon-restart' | 'abandon-terminal'
export type TextOpenWorldQuestOwnerKindV1 = 'global' | 'actor' | 'faction' | 'region' | 'location'
export type TextOpenWorldQuestInstantiationPolicyV1 = 'session-start' | 'director'
export type TextOpenWorldQuestTimePolicyV1 = 'waits' | 'timed'
export type TextOpenWorldActorMortalityPolicyV1 = 'protected' | 'story-only' | 'mortal' | 'despawn-on-resolution'
export type TextOpenWorldServiceContinuityPolicyV1 = 'replace-on-owner-death' | 'disappear-on-owner-death'
export type TextOpenWorldActionCategoryV1 =
  | 'move' | 'travel' | 'fast-travel' | 'observe' | 'investigate' | 'talk'
  | 'take' | 'use' | 'equip' | 'unequip' | 'drop' | 'buy' | 'sell' | 'craft'
  | 'accept-quest' | 'restart-quest' | 'abandon-quest' | 'objective-action' | 'quest-action' | 'weather-action' | 'actor-schedule-action' | 'actor-state-action' | 'director-action' | 'claim-reward'
  | 'attack-actor' | 'steal' | 'deceive' | 'crime'
  | 'start-combat' | 'continue-combat' | 'combat-state-action' | 'combat-reward-action'
  | 'combat-basic-attack' | 'combat-skill' | 'combat-item' | 'combat-enemy-skill' | 'escape'
  | 'rest' | 'respawn'
  | 'read' | 'track' | 'untrack' | 'save' | 'load-branch'

/**
 * Product-owned protagonist definition frozen into a game Release.
 *
 * Story identity deliberately remains one cohesive biography-shaped object;
 * only the deterministic gameplay build is structured separately.
 */
export interface TextOpenWorldPlayerCharacterDefinitionV1 {
  key: 'player'
  identity: {
    name: string
    pronouns: string
    appearance: string
    background: string
    personality: string
    publicKnowledge: string
    privateKnowledge: string
    shortGoal: string
    longGoal: string
    portrayal: string
    sourceRefs: string[]
  }
  build: {
    progressionProfileKey: string
    initialLevel: number
    attributes: { power: number; vitality: number; agility: number }
    learnedSkillKeys: string[]
    startingItemKeys: string[]
    startingCurrency: number
  }
}

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

/**
 * Current playable narrative contract. Unlike the legacy v1 index, v2 freezes
 * the authored P9 prose and its knowledge/availability boundaries into the
 * ProductRelease instead of requiring runtime access to production artifacts.
 */
export interface TextOpenWorldNarrativeModuleV2 {
  version: 2
  storylines: TextOpenWorldNarrativeModuleV1['storylines']
  stages: TextOpenWorldNarrativeModuleV1['stages']
  endings: TextOpenWorldNarrativeModuleV1['endings']
  scenes: Array<{
    key: string
    order: number
    sourceKind:
      | 'quest-offer'
      | 'quest-objective'
      | 'quest-resolution'
      | 'actor-dialogue'
      | 'location-interaction'
      | 'random-event'
    sourceKey: string
    title: string
    purpose: string
    regionKey: string
    locationKey: string
    questKey: string | null
    stageKey: string | null
    objectiveKey: string | null
    actorKey: string | null
    interactionKey: string | null
    randomEventKey: string | null
    participantKeys: string[]
    openingText: string
    bodyText: string
    successText: string
    failureText: string | null
    attitudeOpenings: { bad: string; neutral: string; good: string } | null
    allowedKnowledgeClaimKeys: string[]
    forbiddenFutureObjectiveKeys: string[]
    availabilityConditionKeys: string[]
    actionKeys: string[]
    fixedChoiceKeys: string[]
  }>
  fixedChoices: TextOpenWorldNarrativeModuleV1['fixedChoices']
  randomEventPresentations: Array<{
    key: string
    order: number
    randomEventKey: string
    openingText: string
    resolutionText: string
    rumorKey: string | null
    rumorRequirementKey: string | null
    rumorText: string | null
    reliability: 'uncertain' | null
    sourceClaimKeys: string[]
  }>
}

export interface TextOpenWorldWorldModuleV1 {
  version: 3
  initialLocationKey: string
  regions: Array<{
    key: string
    title: string
    description: string
    theme: string
    levelBand: { minimum: number; maximum: number }
    knowledgePolicy: 'hidden-until-heard' | 'title-on-heard' | 'always-visible'
    locationKeys: string[]
    fastTravelPointKey: string | null
    initialKnowledge: 'unknown' | 'heard' | 'visited' | 'familiar'
    sourceRefs: string[]
    presentationRefs: string[]
  }>
  locations: Array<{
    key: string
    regionKey: string
    title: string
    description: string
    kind: 'settlement' | 'interior' | 'wilderness' | 'dungeon' | 'landmark'
    tags: string[]
    purpose: string
    functions: Array<'narrative' | 'service' | 'exploration' | 'combat' | 'crafting' | 'travel'>
    earlyArrivalDescription: string
    initialKnowledge: 'unknown' | 'heard' | 'visited' | 'familiar'
    sourceRefs: string[]
    presentationRefs: string[]
  }>
  edges: Array<{
    key: string
    fromLocationKey: string
    toLocationKey: string
    bidirectional: boolean
    travelMinutes: number
    conditionKeys: string[]
    description: string
    riskProfile: 'safe' | 'ordinary' | 'dangerous'
    sourceRefs: string[]
  }>
  fastTravelPoints: Array<{
    key: string
    locationKey: string
    unlockedByDefault: boolean
    canRespawn: boolean
  }>
}

export interface TextOpenWorldActorModuleV1 {
  version: 1 | 2 | 3
  player: TextOpenWorldPlayerCharacterDefinitionV1
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
    mortalityPolicy: TextOpenWorldActorMortalityPolicyV1
    serviceKeys: string[]
    scheduleKey: string | null
  }>
  schedules: Array<{
    key: string
    actorKey: string
    entries: Array<{ timePeriodKey: string; locationKey: string; activity: string; availableServiceKeys: string[] }>
  }>
  serviceContinuity: Array<{
    key: string
    ownerActorKey: string
    serviceKey: string
    policy: TextOpenWorldServiceContinuityPolicyV1
    replacementActorKey: string | null
    replacementServiceKey: string | null
  }>
}

export interface TextOpenWorldQuestModuleV1 {
  version: 2
  quests: Array<{
    key: string
    type: TextOpenWorldQuestTypeV1
    ownerKind: TextOpenWorldQuestOwnerKindV1
    ownerKey: string | null
    title: string
    description: string
    storylineKey: string | null
    regionKeys: string[]
    stageKeys: string[]
    prerequisiteConditionKeys: string[]
    rewardEffectKeys: string[]
    rewardContractKey: string | null
    claimActionKey: string | null
    lifecyclePolicy: TextOpenWorldQuestLifecyclePolicyV1
    timePolicy: TextOpenWorldQuestTimePolicyV1
    expirationMinutes: number | null
    repeatable: boolean
    instantiationPolicy: TextOpenWorldQuestInstantiationPolicyV1
    initialStatus: 'locked' | 'available' | 'revealed'
    estimatedMinutes: number
    tags: string[]
  }>
  stages: Array<{
    key: string
    questKey: string
    order: number
    title: string
    objectiveKeys: string[]
    completionConditionKeys: string[]
    completionActionKey: string | null
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
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14
  conditions: Array<{
    key: string
    expression: TextOpenWorldConditionExpressionV1
    failureMessage: string
  }>
  effects: TextOpenWorldEffectDefinitionV1[]
  actions: Array<{
    key: string
    category: TextOpenWorldActionCategoryV1
    label: string
    description: string
    actorScope: 'player' | 'system'
    targetScope: 'none' | 'actor' | 'location' | 'item' | 'quest' | 'vendor' | 'encounter' | 'combatant' | 'recipe'
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

export type TextOpenWorldRuntimeNaturalLanguageBindingModeV1 =
  | 'existing-action-candidate'
  | 'disabled-system-only'
  | 'disabled-combat-button-only'

export interface TextOpenWorldActionInputBindingsV1 {
  sourceActionBindingsHash: string
  actions: Array<{
    key: string
    order: number
    actionKey: string
    actionDefinitionHash: string
    actorScope: 'player' | 'system'
    category: TextOpenWorldActionCategoryV1
    targetScope: 'none' | 'actor' | 'location' | 'item' | 'quest' | 'vendor' | 'encounter' | 'combatant' | 'recipe'
    systemAction: {
      enabled: boolean
      label: string
      description: string
      executionSource: 'system-action'
    }
    fixedChoiceKeys: string[]
    naturalLanguage: {
      mode: TextOpenWorldRuntimeNaturalLanguageBindingModeV1
      exampleUtterances: string[]
      candidateMayOnlySelectThisAction: true
      targetResolution: 'current-projection-valid-targets-only'
      highConfidenceLowRisk: 'execute-after-runtime-validation'
      highRiskOrIrreversible: 'require-explicit-confirmation'
      lowConfidence: 'respond-and-recommend-formal-actions'
      mayCreateAction: false
      mayCreateQuest: false
      mayCreateMapContent: false
      mayWriteState: false
    }
    resultAuthority: {
      artifactKey: 'text-open-world.quest-design-documents'
      collection: 'actions'
      actionKey: string
      actionDefinitionHash: string
    }
  }>
  unmatchedNaturalLanguage: {
    policy: 'natural-response-then-formal-action-redirect'
    impossibleActionPolicy: 'explicit-decline-with-in-world-alternative'
    customSolutionPolicy: 'future-extension-disabled'
    stateMutationAllowed: false
  }
  thresholds: {
    directExecutionMinimumConfidence: 0.9
    recommendationMinimumConfidence: 0.55
  }
  governance: {
    singleResultSource: true
    allThreeInputsUseActionRegistry: true
    modelCannotCreateActionOrResult: true
    combatFreeTextDisabled: true
    lowConfidenceNeverExecutes: true
    irreversibleActionsRequireConfirmation: true
    runtimeProjectionValidationRequired: true
  }
}

/** Action v15 freezes P9 input routing beside the deterministic Action graph. */
export interface TextOpenWorldActionModuleV15 {
  version: 15
  conditions: TextOpenWorldActionModuleV1['conditions']
  effects: TextOpenWorldActionModuleV1['effects']
  actions: TextOpenWorldActionModuleV1['actions']
  inputBindings: TextOpenWorldActionInputBindingsV1
}

/** Action v16 adds governed restart Actions and complete abandon-stage coverage. */
export interface TextOpenWorldActionModuleV16 {
  version: 16
  conditions: TextOpenWorldActionModuleV1['conditions']
  effects: TextOpenWorldActionModuleV1['effects']
  actions: TextOpenWorldActionModuleV1['actions']
  inputBindings: TextOpenWorldActionInputBindingsV1
}

/**
 * Action v17 freezes post-cast cooldown turns and attribute-scaled skill
 * damage. It is valid only in the Action v17 + Progression v2 + Combat v4
 * release triplet.
 */
export interface TextOpenWorldActionModuleV17 {
  version: 17
  conditions: TextOpenWorldActionModuleV1['conditions']
  effects: TextOpenWorldActionModuleV1['effects']
  actions: TextOpenWorldActionModuleV1['actions']
  inputBindings: TextOpenWorldActionInputBindingsV1
}

export interface TextOpenWorldProgressionModuleV1 {
  version: 1
  rules: {
    maximumLevel: number
    automaticAttributeGrowth: true
    levelUp: {
      resourcePolicy: 'increase-by-cap-delta'
      maximumLevelExperiencePolicy: 'cap-at-threshold'
    }
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
    tags: string[]
    activation: 'active' | 'passive'
    kind: 'attack' | 'status' | 'resource' | 'recovery'
    target: 'self' | 'single-enemy' | 'all-enemies'
    scalingAttribute: 'power' | 'vitality' | 'agility' | null
    unlockSources: Array<{
      kind: 'initial' | 'level' | 'quest'
      level: number | null
      questKey: string | null
    }>
    useConditionKeys: string[]
    priority: number
    resourceCost: number
    cooldownTurns: number
    effectKeys: string[]
  }>
  statuses: Array<{
    key: string
    title: string
    description: string
    polarity: 'beneficial' | 'harmful' | 'neutral'
  }>
}

export type TextOpenWorldProgressionSkillMechanicV2 =
  | { kind: 'attack' }
  | {
      kind: 'recovery'
      baseAmount: number
      scalingNumerator: number
      scalingDenominator: number
    }
  | {
      kind: 'resource'
      baseAmount: number
      scalingNumerator: number
      scalingDenominator: number
    }
  | { kind: 'status'; statusKey: string }
  | { kind: 'passive-static'; modifiers: TextOpenWorldCombatStatModifierV2[] }

export interface TextOpenWorldProgressionStatusDefinitionV2 {
  key: string
  title: string
  description: string
  polarity: 'beneficial' | 'harmful' | 'neutral'
  duration: { clock: 'target-turns'; turns: number } | { clock: 'combat' }
  reapplyPolicy: 'reject' | 'refresh' | 'stack'
  maxStacks: number
  modifiers: TextOpenWorldCombatStatModifierV2[]
}

/**
 * Progression v2 payloads use mechanic as their only authored discriminator.
 * activation/kind below are parser-derived compatibility mirrors for existing
 * read-only consumers and are never accepted as payload fields.
 */
export interface TextOpenWorldProgressionModuleV2 {
  version: 2
  sourceVersion: 2
  rules: TextOpenWorldProgressionModuleV1['rules']
  levels: TextOpenWorldProgressionModuleV1['levels']
  skills: Array<Omit<TextOpenWorldProgressionModuleV1['skills'][number], 'activation' | 'kind'> & {
    mechanic: TextOpenWorldProgressionSkillMechanicV2
    activation: 'active' | 'passive'
    kind: 'attack' | 'status' | 'resource' | 'recovery'
  }>
  statuses: TextOpenWorldProgressionStatusDefinitionV2[]
}

export interface TextOpenWorldCombatModuleV1 {
  version: 2 | 3
  /** Parser-only provenance; omitted from the immutable payload itself. */
  sourceVersion?: 1 | 2 | 3
  rules: {
    difficulty: 'standard'
    defaultAttackHits: true
    playerPartyLimit: 1
    allowFriendlyNpcCombatants: false
    allowElements: false
    allowEscape: true
  }
  difficultyProfiles: Array<{
    key: 'standard'
    label: string
    enemyHealthMultiplier: 1
    enemyDamageMultiplier: 1
    rewardMultiplier: 1
  }>
  resolution: {
    algorithm: 'bounded-physical-v1'
    criticalRollMaximum: 10_000
    criticalChanceCapBasisPoints: number
    criticalMultiplierNumerator: number
    criticalMultiplierDenominator: number
    minimumDamage: number
    maximumDamage: number
  }
  skillResolutions: Array<{
    skillKey: string
    powerNumerator: number
    powerDenominator: number
    flatDamage: number
  }>
  transientPlayerStatusKeys: string[]
  strategyProfiles: Array<{
    key: string
    title: string
    selection: 'ordered-skill-priority'
    prioritySkillKeys: string[]
    fallbackSkillKey: string
  }>
  enemies: Array<{
    key: string
    familyKey: string
    title: string
    description: string
    tags: string[]
    level: number
    maximumHealth: number
    attack: number
    defense: number
    criticalChance: number
    initiative: number
    skillKeys: string[]
    strategyProfileKey: string
    dropTableKey: string | null
    sourceRefs: string[]
    presentationRefs: string[]
  }>
  encounters: Array<{
    key: string
    title: string
    description: string
    locationKey: string
    questKeys: string[]
    enemyGroups: Array<{
      key: string
      enemyKey: string
      count: number
      order: number
    }>
    recommendedLevel: number
    levelBand: { minimum: number; maximum: number }
    difficultyProfileKey: 'standard'
    intensity: 'ordinary' | 'dangerous' | 'boss'
    escapePolicy: {
      allowed: boolean
      failureConsumesTurn: true
    }
    defeatPolicy: {
      kind: 'retry-or-respawn'
      preservesWorldProgress: true
    }
    rewardContractKey: string | null
    openingText: string
    victoryText: string
    defeatText: string
    sourceRefs: string[]
    presentationRefs: string[]
  }>
}

/** Combat v4 is the structured-status member of the strict v17/v2/v4 triplet. */
export interface TextOpenWorldCombatModuleV4
  extends Omit<TextOpenWorldCombatModuleV1, 'version' | 'sourceVersion'> {
  version: 4
  sourceVersion: 4
  /** Parser-derived empty legacy facade; omitted from Combat v4 payloads. */
  transientPlayerStatusKeys: []
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
    tags: string[]
    kind: 'equipment' | 'consumable' | 'material' | 'quest' | 'misc'
    stackPolicy: 'stacked' | 'instanced'
    maximumStack: number | null
    unique: boolean
    consumable: boolean
    critical: boolean
    droppable: boolean
    sellable: boolean
    baseValue: number
    useActionKey: string | null
    equipActionKey: string | null
    unequipActionKey: string | null
    equipConditionKeys: string[]
    equipmentSlotKey: 'weapon' | 'armor' | 'accessory' | null
    statModifiers: Partial<Record<'maximumHealth' | 'attack' | 'defense' | 'criticalChance' | 'initiative' | 'skillPower' | 'skillResource', number>>
    effectKeys: string[]
    sourceRefs: string[]
    presentationRefs: string[]
  }>
  rewardContracts: Array<{
    key: string
    title: string
    sourceKind: 'quest' | 'combat' | 'exploration' | 'crafting' | 'system'
    claimPolicy: 'once-per-source'
    expectedMinutes: number
    budgetClass: 'minor' | 'standard' | 'major'
    conditionKeys: string[]
    effectKeys: string[]
    dropTableKeys: string[]
  }>
  dropTables: Array<{
    key: string
    algorithm: 'weighted-item-then-quantity-v1'
    rolls: 1
    conditionKeys: string[]
    entries: Array<{
      itemKey: string
      minimum: number
      maximum: number
      weight: number
      uniquePolicy: 'reject'
      quantityEffects: Array<{ quantity: number; effectKey: string }>
    }>
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

/** Current normalized crafting contract. Legacy v1 payloads are upgraded to this shape in memory. */
export interface TextOpenWorldCraftingModuleV2 {
  version: 2
  sourceVersion: 1 | 2
  rules: {
    successPolicy: 'guaranteed'
    maximumBatchQuantity: number
    maximumTotalItemUnitsPerAction: number
  }
  recipes: Array<{
    key: string
    title: string
    description: string
    category: 'consumable' | 'equipment' | 'tool' | 'material'
    learnedByDefault: boolean
    stationLocationKeys: string[]
    requirementConditionKeys: string[]
    ingredients: Array<{ itemKey: string; quantity: number }>
    outputs: Array<{ itemKey: string; quantity: number }>
    timeCostMinutes: number
    presentationRefs: string[]
  }>
}

/** Legacy data-only economy contract. */
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

/** Current normalized economy contract. Legacy v1 payloads are upgraded to this shape in memory. */
export interface TextOpenWorldEconomyModuleV2 {
  version: 2
  sourceVersion: 1 | 2
  currency: { key: 'currency'; label: string }
  rules: {
    maximumTransactionQuantity: number
    maximumTransactionTotal: number
  }
  vendors: Array<{
    key: string
    title: string
    actorKey: string
    locationKey: string
    factionKey: string | null
    buyPriceMultiplierBasisPoints: number
    sellPriceMultiplierBasisPoints: number
    buyCategories: Array<'equipment' | 'consumable' | 'material' | 'misc'>
    sellCategories: Array<'equipment' | 'consumable' | 'material' | 'misc'>
    inventoryEntries: Array<{
      itemKey: string
      stockPolicy: 'unlimited' | 'limited'
      initialQuantity: number | null
    }>
    availabilityConditionKeys: string[]
    buyActionKey: string | null
    sellActionKey: string | null
  }>
}

export interface TextOpenWorldRelationshipModuleV1 {
  version: 1 | 2 | 3
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
  unaffiliatedMoralityMultiplier: -1 | 0 | 1
  factionMorality: Array<{
    factionKey: string
    moralityMultiplier: -1 | 0 | 1
  }>
  attitudeBands: Array<{
    attitude: 'bad' | 'neutral' | 'good'
    label: string
    greetingTone: string
    buyPriceMultiplier: number
    sellPriceMultiplier: number
    optionalInteractionPolicy: 'available' | 'may-refuse'
  }>
  crimeActions: Array<{
    key: string
    actionKey: string
    kind: 'steal' | 'deceive' | 'crime'
    targetActorKey: string
    locationKey: string
    successConditionKeys: string[]
    witnessActorKeysOnSuccess: string[]
    witnessActorKeysOnFailure: string[]
    witnessedEffectKeys: string[]
    failureMessage: string
  }>
}

export interface TextOpenWorldTimeWeatherModuleV1 {
  version: 1 | 2
  initialWorldMinute: number
  minutesPerDay: number
  /** Normalized to minutesPerDay when reading a legacy v1 module. */
  weatherUpdateIntervalMinutes: number
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

export type TextOpenWorldDirectorTriggerV1 =
  | 'arrival' | 'explore' | 'talk' | 'rest' | 'quest-complete' | 'time-batch' | 'activity'

/**
 * ProductRelease-owned bounded world director. Runtime history, cooldowns and
 * regional pressure live only in the Session state.
 */
export interface TextOpenWorldDirectorModuleV2 {
  version: 2
  sourceVersion: 1 | 2
  rules: {
    globalMaximumRevealed: number
    globalMaximumActive: number
    maximumQuestInstances: number
    highIntensityStreakLimit: number
    historyLimit: number
    maximumSettlementIntervals: number
    systemActionKey: string | null
  }
  decks: Array<{
    regionKey: string
    questKeys: string[]
    templateKeys: string[]
    randomEventKeys: string[]
    triggerKinds: TextOpenWorldDirectorTriggerV1[]
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
    conditionKeys: string[]
    levelBand: { minimum: number; maximum: number }
    category: 'help' | 'resource' | 'exploration' | 'conflict' | 'mystery'
    intensity: number
    weight: number
  }>
  randomEvents: Array<{
    key: string
    title: string
    kind: 'atmosphere' | 'resource' | 'encounter' | 'clue' | 'quest-upgrade'
    regionKeys: string[]
    actionKeys: string[]
    effectKeys: string[]
    conditionKeys: string[]
    fingerprint: string
    rumorKey: string | null
    upgradeTemplateKey: string | null
    intensity: number
    weight: number
    cooldownMinutes: number
  }>
  regionRules: Array<{
    regionKey: string
    settlementIntervalMinutes: number
    initialPressure: number
    minimumPressure: number
    maximumPressure: number
    driftPerInterval: number
    stateBands: Array<{ key: string; minimumPressure: number }>
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
  version: 2
  textStyle: {
    narrationTone: string
    dialogueStyle: string
    systemReceiptStyle: string
  }
  mapLayout: {
    version: 1
    coordinateSystem: 'normalized-1000'
    width: 1000
    height: 700
    source: 'authored' | 'deterministic-fallback'
    locationNodes: Array<{
      locationKey: string
      x: number
      y: number
    }>
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
  narrative: TextOpenWorldNarrativeModuleV1 | TextOpenWorldNarrativeModuleV2
  world: TextOpenWorldWorldModuleV1
  actors: TextOpenWorldActorModuleV1
  quests: TextOpenWorldQuestModuleV1
  actions: TextOpenWorldActionModuleV1 | TextOpenWorldActionModuleV15 | TextOpenWorldActionModuleV16 | TextOpenWorldActionModuleV17
  progression: TextOpenWorldProgressionModuleV1 | TextOpenWorldProgressionModuleV2
  combat: TextOpenWorldCombatModuleV1 | TextOpenWorldCombatModuleV4
  items: TextOpenWorldItemModuleV1
  crafting: TextOpenWorldCraftingModuleV2
  economy: TextOpenWorldEconomyModuleV2
  relationships: TextOpenWorldRelationshipModuleV1
  'time-weather': TextOpenWorldTimeWeatherModuleV1
  director: TextOpenWorldDirectorModuleV2
  knowledge: TextOpenWorldKnowledgeModuleV1
  presentation: TextOpenWorldPresentationModuleV1
}

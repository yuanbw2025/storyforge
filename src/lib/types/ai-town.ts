/** AI Town owns this protocol. It is not an alias of character chat or text-open-world. */
export const AI_TOWN_DAY_SLOTS = [
  'morning',
  'late-morning',
  'noon',
  'afternoon',
  'evening',
  'midnight',
] as const

export type AiTownDaySlotV1 = typeof AI_TOWN_DAY_SLOTS[number]

export const AI_TOWN_EVENT_CATEGORIES = [
  'ambient',
  'resident-opportunity',
  'resident-friction',
  'community',
  'festival',
  'rare-crisis',
] as const

export type AiTownEventCategoryV1 = typeof AI_TOWN_EVENT_CATEGORIES[number]

export const AI_TOWN_MAJOR_CHANGE_KINDS = [
  'death-or-permanent-incapacity',
  'marriage-or-family',
  'permanent-departure',
  'major-facility-change',
  'world-rule-change',
] as const

export type AiTownMajorChangeKindV1 = typeof AI_TOWN_MAJOR_CHANGE_KINDS[number]

export interface AiTownWorldSourceCandidateV1 {
  resourceKey: string
  label: string
  summary: string
  kind: string
}

export interface AiTownWorldSourceCatalogV1 {
  schema: 'storyforge.ai-town-world-source-catalog'
  version: 1
  productType: 'ai-town'
  worldReleaseId: number
  worldReferenceHash: string
  worldContentHash: string
  sourceMappingVersion: 1
  endingCandidates: AiTownWorldSourceCandidateV1[]
  residentCandidates: AiTownWorldSourceCandidateV1[]
  relationEdges: Array<{
    resourceKey: string
    fromCharacterResourceKey: string
    toCharacterResourceKey: string
  }>
  locationCandidates: AiTownWorldSourceCandidateV1[]
  ruleAndLoreCandidates: AiTownWorldSourceCandidateV1[]
  artifactCandidates: AiTownWorldSourceCandidateV1[]
  catalogHash: string
}

export interface AiTownWorldSourceSelectionV1 {
  schema: 'storyforge.ai-town-world-source-selection'
  version: 1
  productType: 'ai-town'
  worldReleaseId: number
  worldReferenceHash: string
  worldContentHash: string
  sourceMappingVersion: 1
  endingResourceKeys: string[]
  residentResourceKeys: string[]
  relationSubgraphResourceKeys: string[]
  locationResourceKeys: string[]
  ruleAndLoreResourceKeys: string[]
  artifactResourceKeys: string[]
  dependencyClosureResourceKeys: string[]
  selectionHash: string
}

export interface AiTownProductionBriefV1 {
  schema: 'storyforge.ai-town-production-brief'
  version: 1
  sourceSelection: AiTownWorldSourceSelectionV1
  player: {
    role: 'new-resident' | 'caretaker'
    name: string
    homeConcept: string
  }
  continuity: {
    mode: 'strict-post-canon'
    elapsedDays: number
    romance: 'off' | 'canon-only' | 'opt-in'
  }
  town: {
    title: string
    premise: string
    majorLocationTarget: number
    residentTarget: number
  }
  clock: {
    slots: AiTownDaySlotV1[]
    actionsPerDay: number
  }
  autonomy: {
    level: 'observational-high'
    offlineEnabled: boolean
    offlineMaximumDays: number
  }
  management: {
    resourceKeys: string[]
    startingMoney: number
    sharedProjectConcept: string
  }
  safety: {
    boundaries: string[]
    majorChangeConfirmation: true
    privateMindPlayerAccess: 'none'
  }
  media: {
    portraits: boolean
    expressions: boolean
    locationCards: boolean
    map: true
    ambientAudio: boolean
  }
  authorConfirmed: boolean
}

/** Author-facing inputs compiled into the strict AI Town Brief; invariants remain non-overridable. */
export interface AiTownBriefSettingsV1 {
  playerRole: 'new-resident' | 'caretaker'
  playerName: string
  homeConcept: string
  townTitle: string
  elapsedDays: number
  romance: 'off' | 'canon-only' | 'opt-in'
  residentTarget: number
  majorLocationTarget: number
  actionsPerDay: number
  offlineEnabled: boolean
  offlineMaximumDays: number
  resourceKeys: string[]
  startingMoney: number
  sharedProjectConcept: string
  portraits: boolean
  expressions: boolean
  locationCards: boolean
  ambientAudio: boolean
}

export interface AiTownMapLocationV1 {
  key: string
  title: string
  description: string
  parentKey: string | null
  x: number
  y: number
  capacity: number
  openSlots: AiTownDaySlotV1[]
  tags: string[]
}

export interface AiTownMapRouteV1 {
  key: string
  fromLocationKey: string
  toLocationKey: string
  bidirectional: boolean
  travelSlots: number
}

export interface AiTownMapDefinitionV1 {
  locations: AiTownMapLocationV1[]
  routes: AiTownMapRouteV1[]
  playerHomeLocationKey: string
}

export interface AiTownScheduleEntryV1 {
  slot: AiTownDaySlotV1
  locationKey: string
  activity: string
}

export interface AiTownResidentDefinitionV1 {
  residentKey: string
  sourceCharacterResourceKey: string
  name: string
  summary: string
  migrationReason: string
  identityLocks: string[]
  voiceRules: string
  homeLocationKey: string
  workLocationKey: string | null
  schedule: AiTownScheduleEntryV1[]
  startingKnowledge: Array<{
    factKey: string
    statement: string
    visibility: 'public' | 'private' | 'secret'
  }>
  goals: string[]
}

export interface AiTownRelationshipDefinitionV1 {
  key: string
  fromResidentKey: string
  toResidentKey: string
  trust: number
  intimacy: number
  wariness: number
  reason: string
  evidenceRefs: string[]
}

export interface LifeThreadV1 {
  key: string
  ownerResidentKey: string
  title: string
  description: string
  initialStage: 'dormant' | 'active'
  locationKeys: string[]
  participantKeys: string[]
}

export interface TownEventSeedV1 {
  key: string
  category: AiTownEventCategoryV1
  title: string
  summary: string
  intensity: number
  minimumDay: number
  cooldownDays: number
  eligibleSlots: AiTownDaySlotV1[]
  locationKeys: string[]
  participantKeys: string[]
  lifeThreadKeys: string[]
}

export interface AiTownEconomyDefinitionV1 {
  resources: Array<{ key: string; title: string; initial: number; maximum: number }>
  startingMoney: number
  startingEnergy: number
  maximumEnergy: number
  sharedProject: {
    key: string
    title: string
    description: string
    targetProgress: number
    milestoneLocationKey: string
  }
}

export interface AiTownCadencePolicyV1 {
  dailyIntensityBudget: number
  highIntensityStreakLimit: number
  rareCrisisCooldownDays: number
}

export interface AiTownRuntimeContentV1 {
  schema: 'storyforge.ai-town-runtime-content'
  version: 1
  title: string
  premise: string
  elapsedCanonDays: number
  player: {
    role: 'new-resident' | 'caretaker'
    name: string
    homeConcept: string
  }
  canonLocks: Array<{ key: string; statement: string; evidenceRefs: string[] }>
  residents: AiTownResidentDefinitionV1[]
  relationships: AiTownRelationshipDefinitionV1[]
  map: AiTownMapDefinitionV1
  lifeThreads: LifeThreadV1[]
  eventSeeds: TownEventSeedV1[]
  clock: {
    slots: AiTownDaySlotV1[]
    actionsPerDay: number
  }
  offline: {
    enabled: boolean
    maximumDays: number
  }
  economy: AiTownEconomyDefinitionV1
  cadence: AiTownCadencePolicyV1
  safety: {
    boundaries: string[]
    majorChangeKinds: AiTownMajorChangeKindV1[]
    romance: 'off' | 'canon-only' | 'opt-in'
  }
}

export interface AiTownResidentStateV1 {
  residentKey: string
  residencyStatus: 'resident' | 'departed' | 'inactive'
  locationKey: string
  activity: string
  mood: 'calm' | 'bright' | 'tired' | 'uneasy' | 'upset'
  energy: number
  activeGoal: string
  lastSpokeDay: number
}

export interface AiTownRelationshipStateV1 {
  key: string
  fromResidentKey: string
  toResidentKey: string
  trust: number
  intimacy: number
  wariness: number
  evidenceSequences: number[]
}

export interface AiTownKnowledgeFactStateV1 {
  factKey: string
  statement: string
  visibility: 'public' | 'private' | 'secret'
  holders: Record<string, {
    status: 'heard' | 'believed' | 'witnessed' | 'disproved'
    evidenceSequence: number
  }>
}

export interface AiTownMemoryRecordV1 {
  memoryKey: string
  ownerResidentKey: string
  summary: string
  visibility: 'private' | 'shared' | 'public'
  sourceSequences: number[]
  salience: number
  createdDay: number
}

export interface LifeThreadRuntimeV1 {
  key: string
  stage: 'dormant' | 'active' | 'resting' | 'resolved'
  progress: number
  lastAdvancedDay: number
  evidenceSequences: number[]
}

export interface AiTownMajorChangeCandidateV1 {
  candidateKey: string
  kind: AiTownMajorChangeKindV1
  title: string
  summary: string
  residentKeys: string[]
  evidenceSequences: number[]
  status: 'pending' | 'accepted' | 'rejected'
}

export interface AiTownDailyDigestV1 {
  day: number
  publicSummary: string[]
  publicKnowledgeChanges: string[]
  observableRelationshipChanges: string[]
  tomorrowHints: string[]
  throughSequence: number
}

export interface AiTownRuntimeStateV1 {
  schema: 'storyforge.ai-town-runtime-state'
  version: 1
  contentHash: string
  /** Frozen executable rules copied from the immutable RuntimePackage for replay. */
  content: AiTownRuntimeContentV1
  day: number
  slot: AiTownDaySlotV1
  actionsRemaining: number
  weatherKey: 'clear' | 'cloudy' | 'rain'
  player: {
    name: string
    locationKey: string
    energy: number
    maximumEnergy: number
    money: number
    resources: Record<string, number>
  }
  residents: Record<string, AiTownResidentStateV1>
  relationships: Record<string, AiTownRelationshipStateV1>
  knowledge: Record<string, AiTownKnowledgeFactStateV1>
  memories: AiTownMemoryRecordV1[]
  lifeThreads: Record<string, LifeThreadRuntimeV1>
  sharedProject: {
    key: string
    title: string
    progress: number
    targetProgress: number
    completed: boolean
  }
  cadence: {
    remainingIntensity: number
    highIntensityStreak: number
    lastRareCrisisDay: number | null
    seedLastTriggeredDay: Record<string, number>
  }
  pendingMajorChanges: AiTownMajorChangeCandidateV1[]
  dailyDigests: AiTownDailyDigestV1[]
  latestPublicEvents: string[]
  offlineDaysSimulated: number
  lastSequence: number
}

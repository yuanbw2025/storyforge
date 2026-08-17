/** TEXTWORLD-1 authored regional rules, immutable release payload and replayed state. */

export type OpenWorldAttentionLevel = 'focus' | 'active' | 'background'
export type OpenWorldRegionKnowledge = 'unknown' | 'heard' | 'visited' | 'familiar'
export type OpenWorldQuestCategory = 'mainline' | 'issue' | 'character' | 'exploration' | 'growth' | 'resource' | 'crisis' | 'consequence'
export type OpenWorldDiscoveryTrigger = 'observe' | 'social' | 'explore' | 'rest' | 'travel' | 'combat'
export type OpenWorldDiscoveryChannelKind = 'conversation' | 'rumor' | 'notice' | 'letter' | 'broadcast' | 'encounter' | 'object' | 'dream'
export type OpenWorldQuestInstanceStatus = 'revealed' | 'active' | 'resolved' | 'failed' | 'declined' | 'expired' | 'superseded'

export interface OpenWorldRegionDefinition {
  key: string
  title: string
  description: string
  parentKey: string | null
  locationKey: string
  tags: string[]
  initialKnowledge: OpenWorldRegionKnowledge
  initialAttention: OpenWorldAttentionLevel
  residentParticipantKeys: string[]
  organizationKeys: string[]
  channelKeys: string[]
  initialResources: Record<string, number>
  initialMetrics: Record<string, number>
  initialIssuePressures: Record<string, number>
  initialOrganizationInfluence: Record<string, number>
  nextScheduledTick: number
}

export interface OpenWorldTravelEdgeDefinition {
  key: string
  fromRegionKey: string
  toRegionKey: string
  bidirectional: boolean
  travelTicks: number
  risk: number
  blockedByIssueKey: string | null
  blockedAtPressure: number | null
}

export interface OpenWorldDiscoveryChannelDefinition {
  key: string
  regionKey: string
  kind: OpenWorldDiscoveryChannelKind
  title: string
  participantKey: string | null
  triggers: OpenWorldDiscoveryTrigger[]
  textTemplate: string
}

export type OpenWorldCondition = {
  source: 'tick'
  operator: 'gte' | 'lte' | 'eq'
  value: number
} | {
  source: 'region-resource' | 'region-metric' | 'region-issue' | 'organization-influence'
  regionKey: string
  key: string
  operator: 'gte' | 'lte' | 'eq'
  value: number
} | {
  source: 'quest-status'
  questKey: string
  operator: 'eq'
  value: OpenWorldQuestInstanceStatus | 'unseen'
}

export type OpenWorldEffect = {
  op: 'change-region-value'
  target: 'resource' | 'metric' | 'issue'
  regionKey: string
  key: string
  delta: number
} | {
  op: 'change-organization-influence'
  regionKey: string
  organizationKey: string
  delta: number
}

export interface OpenWorldTaskFingerprintDefinition {
  family: string
  initiatorKey: string
  targetKey: string
  conflictKey: string
  solutionKey: string
  rewardType: string
}

export interface OpenWorldFixedTaskCardDefinition {
  key: string
  questKey: string
  regionKey: string
  category: OpenWorldQuestCategory
  sourceIssueKey: string | null
  title: string
  description: string
  participantKeys: string[]
  allowedSolutions: string[]
  rewardBudget: number
  intensity: number
  basePriority: number
  critical: boolean
  guaranteedByTick: number | null
  unique: boolean
  cooldownTicks: number
  expirationTicks: number | null
  allowedChannelKeys: string[]
  requirements: OpenWorldCondition[]
  declineEffects: OpenWorldEffect[]
  expirationEffects: OpenWorldEffect[]
  supersedeConditions: OpenWorldCondition[]
  fingerprint: OpenWorldTaskFingerprintDefinition
}

export interface OpenWorldTaskTemplateDefinition {
  key: string
  adventureQuestKey: string
  regionKeys: string[]
  category: OpenWorldQuestCategory
  sourceIssueKey: string
  titleTemplate: string
  descriptionTemplate: string
  participantKeys: string[]
  allowedSolutions: string[]
  rewardBudget: number
  intensity: number
  basePriority: number
  cooldownTicks: number
  expirationTicks: number | null
  allowedChannelKinds: OpenWorldDiscoveryChannelKind[]
  requirements: OpenWorldCondition[]
  declineEffects: OpenWorldEffect[]
  expirationEffects: OpenWorldEffect[]
  fingerprint: OpenWorldTaskFingerprintDefinition
}

export interface OpenWorldDeckDefinition {
  regionKey: string
  fixedCardKeys: string[]
  templateKeys: string[]
  categoryQuotas: Partial<Record<OpenWorldQuestCategory, number>>
  maxRevealed: number
  maxActive: number
  cooldownTicks: number
  recentWindow: number
  blankWeight: number
  highIntensityStreakLimit: number
}

export interface OpenWorldScheduledActorActionDefinition {
  key: string
  actorKey: string
  actorKind: 'participant' | 'organization'
  periodTicks: number
  offsetTicks: number
  regionCycle: string[]
  effects: OpenWorldEffect[]
  summary: string
}

export interface OpenWorldRegionalIssueRule {
  key: string
  issueKey: string
  regionKeys: string[]
  driftPerTick: number
  propagationThreshold: number
  propagationFraction: number
  propagationCap: number
  cooldownTicks: number
}

export interface OpenWorldMainlineProtection {
  questKeys: string[]
  protectedParticipantKeys: string[]
  protectedEdgeKeys: string[]
  latestRevealTick: number
  endingNodeKey: string
}

export interface OpenWorldDirectorRules {
  globalMaxRevealed: number
  globalMaxActive: number
  maxQuestInstances: number
  randomJitter: number
  criticalGuaranteeBonus: number
  backlogPenalty: number
  freshnessPenalty: number
}

export interface OpenWorldContentV1 {
  version: 1
  initialRegionKey: string
  tickLimit: number
  simulationCadenceTicks: number
  maxPropagationEdgesPerTick: number
  regions: OpenWorldRegionDefinition[]
  travelEdges: OpenWorldTravelEdgeDefinition[]
  discoveryChannels: OpenWorldDiscoveryChannelDefinition[]
  fixedTaskCards: OpenWorldFixedTaskCardDefinition[]
  taskTemplates: OpenWorldTaskTemplateDefinition[]
  decks: OpenWorldDeckDefinition[]
  actorSchedules: OpenWorldScheduledActorActionDefinition[]
  regionalIssueRules: OpenWorldRegionalIssueRule[]
  mainline: OpenWorldMainlineProtection
  director: OpenWorldDirectorRules
}

export interface OpenWorldModule {
  id?: number
  projectId: number
  worldId: number
  workId: number
  gameDefinitionId: number
  contentJson: string
  createdAt: number
  updatedAt: number
}

export interface OpenWorldRegionalProjection {
  regionKey: string
  resources: Record<string, number>
  metrics: Record<string, number>
  issuePressures: Record<string, number>
  organizationInfluence: Record<string, number>
  nextScheduledTick: number
  lastUpdatedSequence: number
}

export interface OpenWorldTravelState {
  edgeKey: string
  fromRegionKey: string
  toRegionKey: string
  totalTicks: number
  remainingTicks: number
  risk: number
  startedSequence: number
}

export interface OpenWorldFrozenQuestInstance {
  instanceKey: string
  sourceKind: 'fixed' | 'template'
  sourceKey: string
  sourceContentHash: string
  questKey: string
  regionKey: string
  sourceIssueKey: string | null
  category: OpenWorldQuestCategory
  title: string
  description: string
  participantKeys: string[]
  allowedSolutions: string[]
  rewardBudget: number
  intensity: number
  fingerprint: string
  channelKey: string
  status: OpenWorldQuestInstanceStatus
  createdTick: number
  revealedSequence: number
  acceptedSequence: number | null
  terminalSequence: number | null
  deadlineTick: number | null
}

export interface OpenWorldDirectorCandidateEvidence {
  sourceKind: 'fixed' | 'template'
  sourceKey: string
  questKey: string
  eligible: boolean
  reasons: string[]
  score: number | null
  scoreParts: Record<string, number>
  randomEvidence: number | null
  channelKey: string | null
  fingerprint: string
}

export interface OpenWorldDrawHistoryEntry {
  eventSequence: number
  tick: number
  trigger: OpenWorldDiscoveryTrigger
  regionKey: string
  candidates: OpenWorldDirectorCandidateEvidence[]
  selectedInstanceKey: string | null
  selectedSourceKey: string | null
  blank: boolean
  reason: string
}

export interface OpenWorldRemoteActionHistoryEntry {
  eventSequence: number
  tick: number
  actorKey: string
  actionKey: string
  fromRegionKey: string | null
  toRegionKey: string
  summary: string
}

export interface OpenWorldPropagationHistoryEntry {
  eventSequence: number
  tick: number
  ruleKey: string
  issueKey: string
  fromRegionKey: string
  toRegionKey: string
  amount: number
}

export interface SimulationOpenWorldState {
  schema: 'storyforge.open-world'
  version: 1
  contentHash: string
  /** Frozen mainline identity used to verify narrative projection during replay. */
  mainlineQuestKeys: string[]
  tick: number
  tickLimit: number
  currentRegionKey: string
  travel: OpenWorldTravelState | null
  regionKnowledge: Record<string, OpenWorldRegionKnowledge>
  attentionLevels: Record<string, OpenWorldAttentionLevel>
  regionalProjections: OpenWorldRegionalProjection[]
  actorLocations: Record<string, string>
  questInstances: OpenWorldFrozenQuestInstance[]
  drawHistory: OpenWorldDrawHistoryEntry[]
  remoteActionHistory: OpenWorldRemoteActionHistoryEntry[]
  propagationHistory: OpenWorldPropagationHistoryEntry[]
  recentFingerprints: Array<{ fingerprint: string; tick: number }>
  sourceCooldowns: Record<string, number>
  blankStreak: number
  highIntensityStreak: number
  lastTickEventSequences: number[]
  ended: boolean
}

export interface OpenWorldValidationReport {
  valid: boolean
  errors: string[]
  warnings: string[]
  duplicateKeys: string[]
  missingReferences: string[]
  unreachableRegionKeys: string[]
  unreachableMainlineQuestKeys: string[]
  taskFloodRegionKeys: string[]
  unboundedPropagationRuleKeys: string[]
  invalidProtectedReferenceKeys: string[]
  duplicateFingerprintKeys: string[]
}

export interface OpenWorldExpressionCandidateV1 {
  kind: 'quest-expression' | 'scene-narration'
  instanceKey: string | null
  title: string
  text: string
  dialogue: string
  evidenceEventSequences: number[]
  assertedReferences: Array<{
    kind: 'region' | 'participant' | 'organization' | 'quest' | 'issue' | 'channel'
    key: string
  }>
}

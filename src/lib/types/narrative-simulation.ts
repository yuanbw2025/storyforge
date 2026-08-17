/** TEXTSIM-1 authored rules, frozen release payload and replayed runtime state. */

export type NarrativeSimulationValueKind = 'resource' | 'metric'
export type NarrativeSimulationActorKind = 'actor' | 'organization'
export type NarrativeSimulationVisibility = 'player' | 'actor' | 'debug'

export interface NarrativeSimulationValueDefinition {
  key: string
  title: string
  description: string
  initial: number
  minimum: number
  maximum: number
  conserved: boolean
}

export interface NarrativeSimulationMetricLevel {
  key: string
  label: string
  minimum: number
}

export interface NarrativeSimulationMetricDefinition extends NarrativeSimulationValueDefinition {
  levels: NarrativeSimulationMetricLevel[]
}

export type NarrativeSimulationCondition = {
  source: 'turn'
  operator: 'eq' | 'gte' | 'lte'
  value: number
} | {
  source: 'resource' | 'metric'
  key: string
  operator: 'eq' | 'gte' | 'lte'
  value: number
} | {
  source: 'issue-stage' | 'decision-count' | 'modifier-active' | 'actor-stance'
  key: string
  operator: 'eq' | 'gte' | 'lte'
  value: string | number | boolean
}

export interface NarrativeSimulationValueDelta {
  op: 'change-value'
  target: NarrativeSimulationValueKind
  key: string
  delta: number
}

export interface NarrativeSimulationIssueDelta {
  op: 'change-issue-pressure'
  issueKey: string
  delta: number
}

export interface NarrativeSimulationReportEffect {
  op: 'create-report'
  reportKey: string
  observerKey: string
  visibility: NarrativeSimulationVisibility
  text: string
  confidence: number
  expiresAfterTurns: number | null
}

export type NarrativeSimulationAtomicEffect =
  | NarrativeSimulationValueDelta
  | NarrativeSimulationIssueDelta
  | NarrativeSimulationReportEffect

export type NarrativeSimulationEffect = NarrativeSimulationAtomicEffect | {
  op: 'apply-modifier'
  modifierKey: string
}

export interface NarrativeSimulationDelayedEffect {
  afterTurns: number
  effects: NarrativeSimulationAtomicEffect[]
}

export interface NarrativeSimulationModifierDefinition {
  key: string
  title: string
  description: string
  durationTurns: number
  stackMode: 'replace' | 'refresh' | 'stack'
  recurringEffects: NarrativeSimulationAtomicEffect[]
}

export interface NarrativeSimulationActionDefinition {
  key: string
  title: string
  description: string
  category: 'decision' | 'policy'
  requirements: NarrativeSimulationCondition[]
  costs: NarrativeSimulationValueDelta[]
  immediateEffects: NarrativeSimulationEffect[]
  delayedEffects: NarrativeSimulationDelayedEffect[]
  cooldownTurns: number
  conflictsWith: string[]
  tags: string[]
}

export interface NarrativeSimulationActorActionDefinition {
  key: string
  title: string
  requirements: NarrativeSimulationCondition[]
  effects: NarrativeSimulationAtomicEffect[]
  weight: number
}

export interface NarrativeSimulationActorDefinition {
  key: string
  title: string
  description: string
  kind: NarrativeSimulationActorKind
  stance: number
  capabilities: string[]
  observationKeys: string[]
  strategyActions: NarrativeSimulationActorActionDefinition[]
}

export interface NarrativeSimulationIssueStageDefinition {
  key: string
  title: string
  minimumPressure: number
  description: string
}

export interface NarrativeSimulationIssueDefinition {
  key: string
  title: string
  description: string
  initialPressure: number
  minimumPressure: number
  maximumPressure: number
  driftPerTurn: number
  stages: NarrativeSimulationIssueStageDefinition[]
  affectedActorKeys: string[]
  crisis: boolean
}

export interface NarrativeSimulationEndingDefinition {
  key: string
  title: string
  description: string
  narrativeNodeKey: string
  priority: number
  conditions: NarrativeSimulationCondition[]
}

export interface NarrativeSimulationThemeMapping {
  key: string
  title: string
  roleLabel: string
  resourceLabel: string
  issueLabel: string
}

export interface NarrativeSimulationContentV1 {
  version: 1
  turnLimit: number
  actionBudget: number
  resources: NarrativeSimulationValueDefinition[]
  metrics: NarrativeSimulationMetricDefinition[]
  actors: NarrativeSimulationActorDefinition[]
  actions: NarrativeSimulationActionDefinition[]
  modifiers: NarrativeSimulationModifierDefinition[]
  issues: NarrativeSimulationIssueDefinition[]
  endings: NarrativeSimulationEndingDefinition[]
  themes: NarrativeSimulationThemeMapping[]
}

export interface NarrativeSimulationModule {
  id?: number
  projectId: number
  worldId: number
  workId: number
  gameDefinitionId: number
  contentJson: string
  createdAt: number
  updatedAt: number
}

export interface NarrativeSimulationActiveModifier {
  instanceKey: string
  modifierKey: string
  sourceActionKey: string
  appliedTurn: number
  remainingTurns: number
  stacks: number
}

export interface NarrativeSimulationIssueState {
  issueKey: string
  pressure: number
  stageKey: string
  resolved: boolean
  lastChangedSequence: number
}

export interface NarrativeSimulationReport {
  reportId: string
  reportKey: string
  turn: number
  observerKey: string
  visibility: NarrativeSimulationVisibility
  text: string
  confidence: number
  sourceEventSequences: number[]
  expiresAtTurn: number | null
}

export interface NarrativeSimulationScheduledEffect {
  scheduleId: string
  sourceActionKey: string
  dueTurn: number
  effects: NarrativeSimulationAtomicEffect[]
  status: 'pending' | 'settled'
  createdSequence: number
  settledSequence: number | null
}

export interface NarrativeSimulationDecisionHistoryEntry {
  eventSequence: number
  turn: number
  actionKey: string
  actorKey: 'player'
}

export interface NarrativeSimulationActorActionHistoryEntry {
  eventSequence: number
  turn: number
  actorKey: string
  actionKey: string
}

export interface SimulationNarrativeSimulationState {
  schema: 'storyforge.narrative-simulation'
  version: 1
  contentHash: string
  turn: number
  turnLimit: number
  phase: 'planning' | 'resolving' | 'ended'
  actionBudget: number
  resources: Record<string, number>
  metrics: Record<string, number>
  actorStances: Record<string, number>
  activeModifiers: NarrativeSimulationActiveModifier[]
  issues: NarrativeSimulationIssueState[]
  reports: NarrativeSimulationReport[]
  schedules: NarrativeSimulationScheduledEffect[]
  cooldowns: Record<string, number>
  decisionHistory: NarrativeSimulationDecisionHistoryEntry[]
  actorActionHistory: NarrativeSimulationActorActionHistoryEntry[]
  qualifiedEndingKey: string | null
  lastTurnEventSequences: number[]
}

export interface NarrativeSimulationValidationReport {
  valid: boolean
  errors: string[]
  warnings: string[]
  duplicateKeys: string[]
  missingReferences: string[]
  dominatedActionKeys: string[]
  unboundedGrowthKeys: string[]
  conservedMutationKeys: string[]
  unsolvedCrisisKeys: string[]
  unreachableEndingKeys: string[]
}

export interface NarrativeSimulationPresentationCandidateV1 {
  kind: 'turn-briefing' | 'advisor-performance' | 'outcome-narration' | 'actor-action-suggestion'
  text: string
  evidenceEventSequences: number[]
  assertedFacts: Array<{
    source: 'resource' | 'metric' | 'issue-stage' | 'ending'
    key: string
    value: string | number | null
  }>
}

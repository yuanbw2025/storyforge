/** Text-open-world private evolution rules, frozen release payload and replayed runtime state. */

/** Text-open-world private evolution protocol; never a standalone product identity. */
export type OpenWorldEvolutionValueKind = 'resource' | 'metric'
export type OpenWorldEvolutionActorKind = 'actor' | 'organization'
export type OpenWorldEvolutionVisibility = 'player' | 'actor' | 'debug'

export interface OpenWorldEvolutionValueDefinition {
  key: string
  title: string
  description: string
  initial: number
  minimum: number
  maximum: number
  conserved: boolean
}

export interface OpenWorldEvolutionMetricLevel {
  key: string
  label: string
  minimum: number
}

export interface OpenWorldEvolutionMetricDefinition extends OpenWorldEvolutionValueDefinition {
  levels: OpenWorldEvolutionMetricLevel[]
}

export type OpenWorldEvolutionCondition = {
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

export interface OpenWorldEvolutionValueDelta {
  op: 'change-value'
  target: OpenWorldEvolutionValueKind
  key: string
  delta: number
}

export interface OpenWorldEvolutionIssueDelta {
  op: 'change-issue-pressure'
  issueKey: string
  delta: number
}

export interface OpenWorldEvolutionReportEffect {
  op: 'create-report'
  reportKey: string
  observerKey: string
  visibility: OpenWorldEvolutionVisibility
  text: string
  confidence: number
  expiresAfterTurns: number | null
}

export type OpenWorldEvolutionAtomicEffect =
  | OpenWorldEvolutionValueDelta
  | OpenWorldEvolutionIssueDelta
  | OpenWorldEvolutionReportEffect

export type OpenWorldEvolutionEffect = OpenWorldEvolutionAtomicEffect | {
  op: 'apply-modifier'
  modifierKey: string
}

export interface OpenWorldEvolutionDelayedEffect {
  afterTurns: number
  effects: OpenWorldEvolutionAtomicEffect[]
}

export interface OpenWorldEvolutionModifierDefinition {
  key: string
  title: string
  description: string
  durationTurns: number
  stackMode: 'replace' | 'refresh' | 'stack'
  recurringEffects: OpenWorldEvolutionAtomicEffect[]
}

export interface OpenWorldEvolutionActionDefinition {
  key: string
  title: string
  description: string
  category: 'decision' | 'policy'
  requirements: OpenWorldEvolutionCondition[]
  costs: OpenWorldEvolutionValueDelta[]
  immediateEffects: OpenWorldEvolutionEffect[]
  delayedEffects: OpenWorldEvolutionDelayedEffect[]
  cooldownTurns: number
  conflictsWith: string[]
  tags: string[]
}

export interface OpenWorldEvolutionActorActionDefinition {
  key: string
  title: string
  requirements: OpenWorldEvolutionCondition[]
  effects: OpenWorldEvolutionAtomicEffect[]
  weight: number
}

export interface OpenWorldEvolutionActorDefinition {
  key: string
  title: string
  description: string
  kind: OpenWorldEvolutionActorKind
  stance: number
  capabilities: string[]
  observationKeys: string[]
  strategyActions: OpenWorldEvolutionActorActionDefinition[]
}

export interface OpenWorldEvolutionIssueStageDefinition {
  key: string
  title: string
  minimumPressure: number
  description: string
}

export interface OpenWorldEvolutionIssueDefinition {
  key: string
  title: string
  description: string
  initialPressure: number
  minimumPressure: number
  maximumPressure: number
  driftPerTurn: number
  stages: OpenWorldEvolutionIssueStageDefinition[]
  affectedActorKeys: string[]
  crisis: boolean
}

export interface OpenWorldEvolutionEndingDefinition {
  key: string
  title: string
  description: string
  narrativeNodeKey: string
  priority: number
  conditions: OpenWorldEvolutionCondition[]
}

export interface OpenWorldEvolutionThemeMapping {
  key: string
  title: string
  roleLabel: string
  resourceLabel: string
  issueLabel: string
}

export interface OpenWorldEvolutionContentV1 {
  version: 1
  turnLimit: number
  actionBudget: number
  resources: OpenWorldEvolutionValueDefinition[]
  metrics: OpenWorldEvolutionMetricDefinition[]
  actors: OpenWorldEvolutionActorDefinition[]
  actions: OpenWorldEvolutionActionDefinition[]
  modifiers: OpenWorldEvolutionModifierDefinition[]
  issues: OpenWorldEvolutionIssueDefinition[]
  endings: OpenWorldEvolutionEndingDefinition[]
  themes: OpenWorldEvolutionThemeMapping[]
}

export interface OpenWorldEvolutionActiveModifier {
  instanceKey: string
  modifierKey: string
  sourceActionKey: string
  appliedTurn: number
  remainingTurns: number
  stacks: number
}

export interface OpenWorldEvolutionIssueState {
  issueKey: string
  pressure: number
  stageKey: string
  resolved: boolean
  lastChangedSequence: number
}

export interface OpenWorldEvolutionReport {
  reportId: string
  reportKey: string
  turn: number
  observerKey: string
  visibility: OpenWorldEvolutionVisibility
  text: string
  confidence: number
  sourceEventSequences: number[]
  expiresAtTurn: number | null
}

export interface OpenWorldEvolutionScheduledEffect {
  scheduleId: string
  sourceActionKey: string
  dueTurn: number
  effects: OpenWorldEvolutionAtomicEffect[]
  status: 'pending' | 'settled'
  createdSequence: number
  settledSequence: number | null
}

export interface OpenWorldEvolutionDecisionHistoryEntry {
  eventSequence: number
  turn: number
  actionKey: string
  actorKey: 'player'
}

export interface OpenWorldEvolutionActorActionHistoryEntry {
  eventSequence: number
  turn: number
  actorKey: string
  actionKey: string
}

export interface OpenWorldEvolutionState {
  schema: 'storyforge.text-open-world.evolution'
  version: 1
  contentHash: string
  turn: number
  turnLimit: number
  phase: 'planning' | 'resolving' | 'ended'
  actionBudget: number
  resources: Record<string, number>
  metrics: Record<string, number>
  actorStances: Record<string, number>
  activeModifiers: OpenWorldEvolutionActiveModifier[]
  issues: OpenWorldEvolutionIssueState[]
  reports: OpenWorldEvolutionReport[]
  schedules: OpenWorldEvolutionScheduledEffect[]
  cooldowns: Record<string, number>
  decisionHistory: OpenWorldEvolutionDecisionHistoryEntry[]
  actorActionHistory: OpenWorldEvolutionActorActionHistoryEntry[]
  qualifiedEndingKey: string | null
  lastTurnEventSequences: number[]
}

export interface OpenWorldEvolutionValidationReport {
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

export interface OpenWorldEvolutionPresentationCandidateV1 {
  kind: 'turn-briefing' | 'advisor-performance' | 'outcome-narration' | 'actor-action-suggestion'
  text: string
  evidenceEventSequences: number[]
  assertedFacts: Array<{
    source: 'resource' | 'metric' | 'issue-stage' | 'ending'
    key: string
    value: string | number | null
  }>
}

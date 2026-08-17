/** TEXTADV-1 authored content, immutable release payload and runtime state. */

export const ADVENTURE_ACTION_KINDS = [
  'look', 'move', 'talk', 'take', 'give', 'use', 'inspect', 'attempt', 'rest', 'quest-action',
] as const
export type AdventureActionKind = typeof ADVENTURE_ACTION_KINDS[number]

export type AdventureQuestStatus = 'locked' | 'available' | 'active' | 'completed' | 'failed'
export type AdventureCheckOutcome = 'success' | 'costly-success' | 'failure' | 'not-attempted'

export interface AdventureLocationDefinition {
  key: string
  title: string
  description: string
  tags: string[]
}

export interface AdventureObjectDefinition {
  key: string
  locationKey: string
  title: string
  description: string
  tags: string[]
}

export interface AdventureItemDefinition {
  key: string
  title: string
  description: string
  tags: string[]
  stackable: boolean
  consumable: boolean
}

export interface AdventureAbilityDefinition {
  key: string
  title: string
  description: string
  initial: number
  minimum: number
  maximum: number
}

export interface AdventureConditionDefinition {
  key: string
  title: string
  description: string
}

export interface AdventureResourceDefinition {
  key: string
  title: string
  initial: number
  minimum: number
  maximum: number
}

export interface AdventureRequirement {
  itemKey?: string
  itemQuantity?: number
  resourceKey?: string
  resourceMinimum?: number
  abilityKey?: string
  abilityMinimum?: number
  conditionKey?: string
  conditionPresent?: boolean
  questKey?: string
  questStatus?: AdventureQuestStatus
  narrativePath?: string
  narrativeEquals?: string | number | boolean | null
}

export type AdventureRule = {
  kind: 'automatic'
} | {
  kind: 'threshold'
  abilityKey: string
  difficulty: number
} | {
  kind: 'random'
  abilityKey: string
  expression: string
  difficulty: number
  costlySuccessFloor: number | null
} | {
  kind: 'resource-payment'
  resourceKey: string
  amount: number
}

export type AdventureEffect =
  | { op: 'enter-location'; locationKey: string }
  | { op: 'gain-item'; itemKey: string; quantity: number; claimKey: string }
  | { op: 'remove-item'; itemKey: string; quantity: number }
  | { op: 'transfer-item'; itemKey: string; quantity: number; toOwnerKey: string }
  | { op: 'change-item-state'; itemKey: string; state: 'carried' | 'equipped' }
  | { op: 'change-resource'; resourceKey: string; delta: number }
  | { op: 'change-ability'; abilityKey: string; delta: number }
  | { op: 'apply-condition'; conditionKey: string; duration: number | null }
  | { op: 'remove-condition'; conditionKey: string }
  | { op: 'accept-quest'; questKey: string }
  | { op: 'complete-objective'; questKey: string; objectiveKey: string }
  | { op: 'fail-quest'; questKey: string }

export interface AdventureActionDefinition {
  key: string
  kind: AdventureActionKind
  label: string
  description: string
  locationKey: string
  targetKey: string | null
  requirements: AdventureRequirement[]
  rule: AdventureRule
  successEffects: AdventureEffect[]
  costlySuccessEffects: AdventureEffect[]
  failureEffects: AdventureEffect[]
  successText: string
  costlySuccessText: string
  failureText: string
  unavailableText: string
  repeatable: boolean
  narrativeChoiceKey: string | null
  /**
   * Talk actions never mutate relationship state themselves. They reference a
   * frozen CHATGAME scene/rule and the authoritative adventure command emits
   * the shared interaction event protocol before applying adventure effects.
   */
  interaction?: {
    participantKey: string
    sceneKey: string
    ruleKey: string
  } | null
}

export interface AdventureQuestObjectiveDefinition {
  key: string
  title: string
  optional: boolean
  alternativeActionKeys: string[]
}

export interface AdventureQuestDefinition {
  key: string
  title: string
  description: string
  initialStatus: AdventureQuestStatus
  prerequisites: AdventureRequirement[]
  objectives: AdventureQuestObjectiveDefinition[]
  rewardEffects: AdventureEffect[]
  completionNodeKey: string | null
  failureNodeKey: string | null
}

export interface AdventureContentV1 {
  version: 1
  initialLocationKey: string
  playerKey: 'player'
  locations: AdventureLocationDefinition[]
  objects: AdventureObjectDefinition[]
  items: AdventureItemDefinition[]
  abilities: AdventureAbilityDefinition[]
  conditions: AdventureConditionDefinition[]
  resources: AdventureResourceDefinition[]
  quests: AdventureQuestDefinition[]
  actions: AdventureActionDefinition[]
  initialInventory: Array<{ itemKey: string; quantity: number }>
}

export interface AdventureModule {
  id?: number
  projectId: number
  worldId: number
  workId: number
  gameDefinitionId: number
  contentJson: string
  createdAt: number
  updatedAt: number
}

export interface AdventureInventoryEntry {
  itemKey: string
  ownerKey: string
  quantity: number
  state: 'carried' | 'equipped' | 'transferred'
  sourceEventSequence: number
}

export interface AdventureRuntimeCondition {
  conditionKey: string
  duration: number | null
  appliedSequence: number
}

export interface AdventureRuntimeQuestObjective {
  objectiveKey: string
  optional: boolean
  completed: boolean
  completedSequence: number | null
}

export interface AdventureRuntimeQuest {
  questKey: string
  status: AdventureQuestStatus
  objectives: AdventureRuntimeQuestObjective[]
  updatedSequence: number
}

export interface AdventureActionHistoryEntry {
  eventSequence: number
  commandId: string
  actionKey: string
  kind: AdventureActionKind
  outcome: AdventureCheckOutcome
  narrative: string
  resultingSequence: number
}

export interface AdventureCheckEvidence {
  eventSequence: number
  actionKey: string
  abilityKey: string | null
  mode: AdventureRule['kind']
  expression: string | null
  dice: number[]
  modifier: number
  total: number
  difficulty: number
  outcome: AdventureCheckOutcome
}

export interface SimulationAdventureState {
  schema: 'storyforge.text-adventure'
  version: 1
  contentHash: string
  playerKey: 'player'
  currentLocationKey: string
  visitedLocationKeys: string[]
  inventory: AdventureInventoryEntry[]
  resources: Record<string, number>
  abilities: Record<string, number>
  conditions: AdventureRuntimeCondition[]
  quests: AdventureRuntimeQuest[]
  completedActionKeys: string[]
  claimKeys: string[]
  actionHistory: AdventureActionHistoryEntry[]
  checks: AdventureCheckEvidence[]
}

export interface AdventureActionCandidateV1 {
  actionKey: string
  rationale: string
  requiresConfirmation: boolean
}

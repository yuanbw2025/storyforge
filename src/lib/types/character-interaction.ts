/** CHATGAME-2 authoring records and immutable release payloads. */

export const INTERACTION_RELATIONSHIP_DIMENSIONS = [
  'trust',
  'closeness',
  'wariness',
  'respect',
] as const
export type InteractionRelationshipDimensionKey = typeof INTERACTION_RELATIONSHIP_DIMENSIONS[number]

export interface InteractionKnowledgeSeed {
  key: string
  content: string
  visibility: 'public' | 'private'
  importance: number
}

export interface InteractionRelationshipDimension {
  key: InteractionRelationshipDimensionKey
  label: string
  minimum: number
  maximum: number
  initial: number
  /** An absolute delta above this limit needs an explicit significant event key. */
  largeChangeThreshold: number
}

export interface InteractionRelationshipRule {
  ruleKey: string
  label: string
  playerText: string
  fromParticipantKey: string
  toParticipantKey: string
  dimensionKey: InteractionRelationshipDimensionKey
  delta: number
  reason: string
  significantEventKey: string | null
}

export interface InteractionCharacterProfile {
  id?: number
  projectId: number
  worldId: number
  workId: number
  gameDefinitionId: number
  /** Live authoring character for ordinary games; immutable WorldRelease projections use sourceSnapshotJson instead. */
  characterId: number | null
  participantKey: string
  /** System-owned portable identity used when the game must not depend on a live Character row. */
  sourceSnapshotJson?: string
  roleLabel: string
  voiceRules: string
  initialKnowledgeJson: string
  relationshipDimensionsJson: string
  maxMemoryEntries: number
  createdAt: number
  updatedAt: number
}

export interface InteractionSourceCharacterSnapshotV1 {
  schema: 'storyforge.interaction-source-character'
  version: 1
  worldContentHash: string
  characterExportId: number
  characterKey: string
  name: string
}

export interface InteractionSceneTemplate {
  id?: number
  projectId: number
  worldId: number
  workId: number
  gameDefinitionId: number
  sceneKey: string
  title: string
  purpose: string
  location: string
  timeLabel: string
  participantKeysJson: string
  publicKnowledgeKeysJson: string
  goalsJson: string
  endingConditionsJson: string
  safetyBoundariesJson: string
  /** Added in CHATGAME-2B; legacy drafts default to an empty rule list. */
  relationshipRulesJson?: string
  openingNodeKey?: string | null
  endingNodeKey?: string | null
  maxTurns: number
  directorBudget: number
  order: number
  createdAt: number
  updatedAt: number
}

export interface FrozenInteractionCharacterProfile {
  participantKey: string
  characterKey: string
  name: string
  roleLabel: string
  voiceRules: string
  initialKnowledge: InteractionKnowledgeSeed[]
  relationshipDimensions: InteractionRelationshipDimension[]
  maxMemoryEntries: number
}

export interface FrozenInteractionSceneTemplate {
  sceneKey: string
  title: string
  purpose: string
  location: string
  timeLabel: string
  participantKeys: string[]
  publicKnowledgeKeys: string[]
  goals: string[]
  endingConditions: string[]
  safetyBoundaries: string[]
  relationshipRules: InteractionRelationshipRule[]
  openingNodeKey: string | null
  endingNodeKey: string | null
  maxTurns: number
  directorBudget: number
  order: number
}

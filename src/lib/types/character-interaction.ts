/** Runtime contracts for self-contained character-interaction product packages. */

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

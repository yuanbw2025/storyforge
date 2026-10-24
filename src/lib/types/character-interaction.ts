/** Runtime contracts for self-contained character-interaction product packages. */

/** Player-owned unsent text, outside the canonical story and all model contexts. */
export interface ChatComposerDraftV1 {
  version: 1
  text: string
  /** Intended role recipients. Missing/null means everybody currently present. */
  audienceKeys?: string[] | null
  revision: number
  updatedAt: number
}

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

export interface ChatSourceTextRangeV1 {
  /** Half-open UTF-16 offsets in the original string at source.pointer. */
  start: number
  end: number
}

/** Chat-only source projection. v6 retains original evidence exclusively for the coordinator. */
export interface FrozenChatSourceProjectionV1 {
  schema: 'storyforge.chat-runtime-source'
  version: 1 | 2 | 3 | 4 | 5 | 6
  /** v6: full author-reviewed provenance/constraints; never delivered to actor context. */
  sourceUnits?: import('../character-interaction/source-unit-authorization').ChatSourceUnitSetV1
  /** v5: Work-authored identities and original-content hashes, never world IDs. */
  privateCharacterSources?: Array<{resourceKey: string; sourceHash: string}>
  /** v2/v3: visible non-character sources, never a new character identity. */
  backgroundSources?: Array<{resourceKey: string; sourceHash: string; resourceKind: string; relatedResourceKeys?: string[]}>
  /** v3 only: a separate source subject, never an AI-controlled participant. */
  playerCharacterSource?: {resourceKey: string; sourceHash: string} | null
  projectionHash: string
  worldReleaseHash: string
  playerRole: string
  knowledge: Array<{
    key: string
    content: string
    audienceKeys: string[]
    /** v4: author-approved discovery authority, never role-visible context. */
    discovery?: {actorKeys: string[]; condition: string; prerequisiteKnowledgeKeys: string[]}
    source: {
      resourceKey: string
      sourceHash: string
      pointer: string
      purpose: 'identity' | 'motivation' | 'voice' | 'knowledge'
      textRange?: ChatSourceTextRangeV1
      /** v6 derived fact identity; original text/ranges stay in the author-only sourceUnits. */
      unit?: {fragmentKey: string; unitKey: string}
    }
  }>
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

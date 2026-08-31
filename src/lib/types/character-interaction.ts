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
  /** Live authoring character for ordinary games; portable WorldRelease projections and interaction-only guests use sourceSnapshotJson instead. */
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

/** A portable interaction-only participant. It never implies a canonical Character row. */
export interface InteractionGuestCharacterSnapshotV1 {
  schema: 'storyforge.interaction-guest-character'
  version: 1
  guestKey: string
  characterKey: string
  name: string
}

export type InteractionPortableCharacterSnapshotV1 =
  | InteractionSourceCharacterSnapshotV1
  | InteractionGuestCharacterSnapshotV1

export const CHARACTER_INTERACTION_WORLD_SOURCE_TABLES_V1 = [
  'characters',
  'workCharacterBindings',
  'characterRelations',
  'worldGroups',
  'worldGroupLinks',
  'worldNodes',
  'worldviews',
  'worldRulesProfiles',
  'cultivationSystems',
  'powerSystems',
  'geographies',
  'histories',
  'historicalTimelineEvents',
  'historicalKeywords',
  'importantLocations',
  'codexCategories',
  'codexEntries',
  'storyCores',
  'storyArcs',
  'outlineNodes',
  'detailedOutlines',
  'narrativeModules',
] as const

export type CharacterInteractionWorldSourceTableV1 =
  typeof CHARACTER_INTERACTION_WORLD_SOURCE_TABLES_V1[number]

export interface CharacterInteractionWorldSourceCatalogRecordV1 {
  table: CharacterInteractionWorldSourceTableV1
  /** Explicit _exportId when the portable table has one; otherwise the immutable Release array position. */
  exportId: number
  label: string
  summary: string
  parentExportId: number | null
  referencedExportIds: Array<{
    table: CharacterInteractionWorldSourceTableV1
    exportId: number
  }>
}

/** Read-only, product-specific view over one verified WorldReleaseManifestV2. */
export interface CharacterInteractionWorldSourceCatalogV1 {
  schema: 'storyforge.character-interaction-world-source-catalog'
  version: 1
  productType: 'character-interaction'
  contractVersion: 1
  worldReleaseId: number
  worldReleaseVersion: number
  worldReleaseLabel: string
  sourceWorldCode: string
  sourceWorldName: string
  sourceWorkTitle: string
  worldContentHash: string
  sourceWorldExportId: number
  sourceWorkExportId: number
  sourceMappingVersion: 1
  records: Partial<Record<CharacterInteractionWorldSourceTableV1, CharacterInteractionWorldSourceCatalogRecordV1[]>>
  unavailableTables: CharacterInteractionWorldSourceTableV1[]
  excludedReleaseTables: string[]
}

export interface CharacterInteractionWorldRecordSelectionV1 {
  table: CharacterInteractionWorldSourceTableV1
  granularity: 'single-record' | 'record-set' | 'tree-subgraph' | 'narrative-module' | 'dependency-closure'
  exportIds: number[]
}

/**
 * Frozen source identity for character interaction only. It deliberately does
 * not reuse WorldGameSourceSelection or another product's source contract.
 */
export interface CharacterInteractionWorldSourceSelectionV1 {
  schema: 'storyforge.character-interaction-world-source-selection'
  version: 1
  productType: 'character-interaction'
  contractVersion: 1
  worldReleaseId: number
  sourceWorldCode: string
  worldContentHash: string
  sourceWorldExportId: number
  sourceWorkExportId: number
  sourceMappingVersion: 1
  participantCharacterExportIds: number[]
  recordSelections: CharacterInteractionWorldRecordSelectionV1[]
  /** Product-authored guests live in the Brief, never masquerade as WorldRelease records. */
  guestCharacterKeys: string[]
  selectionHash: string
}

export type CharacterInteractionProductionStatusV1 =
  | 'brief-draft'
  | 'brief-confirmed'
  | 'building'
  | 'preview-ready'
  | 'release-ready'
  | 'released'
  | 'failed'
  | 'archived'

/** Product-owned root. World source and Brief revisions remain immutable children. */
export interface CharacterInteractionProductionRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionKey: string
  title: string
  status: CharacterInteractionProductionStatusV1
  activeSourceSelectionId: number | null
  activeBriefId: number | null
  currentProductReleaseId?: number | null
  createdAt: number
  updatedAt: number
}

export interface CharacterInteractionSourceSelectionRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  revision: number
  status: 'frozen'
  sourceWorldReleaseId: number
  selectionJson: string
  selectionHash: string
  worldContentHash: string
  worldReferenceJson?: string | null
  worldReferenceHash?: string | null
  sourcePlanJson?: string | null
  sourcePlanHash?: string | null
  createdAt: number
}

export type CharacterInteractionUserRoleV1 =
  | 'self'
  | 'original-visitor'
  | 'observer'
  | 'director'

export type CharacterInteractionStoryModeV1 =
  | 'inherit-ending'
  | 'parallel-timeline'
  | 'new-event'

export type CharacterInteractionMediaTierV1 =
  | 'text-core'
  | 'portrait-standard'
  | 'voice-optional'

export interface CharacterInteractionBriefParticipantV1 {
  participantKey: string
  source: 'world' | 'guest'
  displayName: string
  reason: string
}

export interface CharacterInteractionBriefGuestV1 {
  guestKey: string
  name: string
  relationToWorld: string
  profile: string
}

/** Author-controlled, product-specific production Brief. */
export interface CharacterInteractionBriefV1 {
  schema: 'storyforge.character-interaction-brief'
  version: 1
  productType: 'character-interaction'
  contractVersion: 1
  source: {
    worldReleaseId: number
    worldContentHash: string
    selectionHash: string
  }
  title: string
  userInstruction: string
  userRole: CharacterInteractionUserRoleV1
  participants: CharacterInteractionBriefParticipantV1[]
  guests: CharacterInteractionBriefGuestV1[]
  setting: {
    storyMode: CharacterInteractionStoryModeV1
    timeContext: string
    locationContext: string
    historicalContext: string
    chatGoal: string
    desiredDirections: string[]
    safetyBoundaries: string[]
  }
  knowledgePolicy: {
    publicKnowledge: string[]
    privateKnowledge: string[]
    prohibitedDisclosure: string[]
  }
  relationshipPolicy: {
    dimensions: InteractionRelationshipDimensionKey[]
    largeChangeNeedsEvidence: true
  }
  runtime: {
    sceneCount: number
    maxTurnsPerScene: number
    directorBudget: number
    endingStrategy: 'open-ended' | 'goal-complete' | 'user-decides'
  }
  media: {
    tier: CharacterInteractionMediaTierV1
  }
  worldFeedback: {
    allowCandidate: boolean
    autoWriteback: false
  }
}

export const CHARACTER_INTERACTION_PRODUCTION_STEPS_V1 = [
  'character-capsules',
  'knowledge-and-relationship-seeds',
  'scene-plan',
  'narrative-links',
  'media-bible',
  'integration',
  'counterexample-validation',
  'author-preview',
] as const

export type CharacterInteractionProductionStepKeyV1 =
  typeof CHARACTER_INTERACTION_PRODUCTION_STEPS_V1[number]

/** Formal model authority compiled only from a frozen Selection and confirmed Brief. */
export interface CharacterInteractionProductionRunContractV1 {
  schema: 'storyforge.character-interaction-production-run-contract'
  version: 1
  productType: 'character-interaction'
  contractVersion: 1
  sourceWorldReleaseId: number
  sourceSelectionHash: string
  briefHash: string
  allowedContextSourceKeys: ['characterInteractionProduction']
  allowedSteps: CharacterInteractionProductionStepKeyV1[]
  writeMode: 'candidate-only'
  worldWritebackAllowed: false
  formalMediaWriteAllowed: false
  requiredHumanConfirmations: CharacterInteractionProductionStepKeyV1[]
}

export interface CharacterInteractionBriefRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  sourceSelectionId: number
  revision: number
  status: 'draft' | 'confirmed'
  briefJson: string
  briefHash: string
  runContractJson: string | null
  runContractHash: string | null
  confirmedAt: number | null
  confirmedContractJson?: string | null
  confirmedContractHash?: string | null
  authorStartRevision?: number | null
  createdAt: number
}

export type CharacterInteractionArtifactKindV1 =
  | 'character-capsules'
  | 'knowledge-and-relationship-seeds'
  | 'scene-plan'
  | 'narrative-links'
  | 'media-bible'
  | 'integration'
  | 'validation-report'
  | 'author-preview'
  | 'world-upgrade-plan'
  | 'world-feedback-candidate'

/** Durable attempt for one product-owned production step. */
export interface CharacterInteractionProductionStepRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  stepKey: CharacterInteractionProductionStepKeyV1
  attempt: number
  status: 'pending' | 'running' | 'awaiting-confirmation' | 'confirmed' | 'rejected' | 'failed' | 'stale'
  inputHash: string
  candidateArtifactId: number | null
  confirmedArtifactId: number | null
  producerRunId: number | null
  checkpointJson: string
  errorJson: string | null
  startedAt: number | null
  completedAt: number | null
  updatedAt: number
}

/** Product-owned immutable candidate/confirmed artifact revision. */
export interface CharacterInteractionArtifactRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  stepKey: CharacterInteractionProductionStepKeyV1 | null
  artifactKey: string
  revision: number
  kind: CharacterInteractionArtifactKindV1
  status: 'candidate' | 'confirmed' | 'rejected' | 'superseded'
  sourceSelectionHash: string
  briefHash: string
  dependencyHash: string
  payloadJson: string
  payloadHash: string
  producerRunId: number | null
  sourceSessionId: number | null
  confirmationJson: string | null
  createdAt: number
  confirmedAt: number | null
}

export type CharacterInteractionMediaKindV1 = 'portrait' | 'voice-sample' | 'scene-background'

/** Versioned product metadata; bytes remain in shared mediaBlobObjects. */
export interface CharacterInteractionMediaAssetRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  slotKey: string
  assetKey: string
  version: number
  kind: CharacterInteractionMediaKindV1
  targetRef: string
  productionRequired: boolean
  status: 'planned' | 'available' | 'degraded' | 'failed' | 'superseded'
  specJson: string
  specHash: string
  fallbackText: string
  altText: string
  blobObjectId: number | null
  mimeType: string | null
  byteSize: number
  contentHash: string | null
  producerRunId: number | null
  rightsJson: string
  failureJson: string | null
  createdAt: number
  updatedAt: number
}

export interface CharacterInteractionProductReleaseRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  sourceSelectionId: number
  sourceWorldReleaseId: number
  briefId: number
  gameReleaseId: number
  version: number
  label: string
  manifestJson: string
  contentHash: string
  releaseUid?: string | null
  sourceManifestJson?: string | null
  sourceManifestHash?: string | null
  lineageJson?: string | null
  lineageHash?: string | null
  createdAt: number
}

export interface CharacterInteractionProductReleaseManifestV1 {
  schema: 'storyforge.character-interaction-product-release'
  version: 1
  productType: 'character-interaction'
  releaseVersion: number
  source: {
    worldReleaseId: number
    worldContentHash: string
    selectionHash: string
    selection: CharacterInteractionWorldSourceSelectionV1
  }
  brief: { content: CharacterInteractionBriefV1; contentHash: string }
  sourceContracts: {
    worldReferenceHash: string
    sourcePlanHash: string
    sourceManifestHash: string
    confirmedBriefHash: string
  }
  artifacts: Array<{
    artifactKey: string
    kind: CharacterInteractionArtifactKindV1
    payload: unknown
    payloadHash: string
  }>
  media: Array<{
    slotKey: string
    assetKey: string
    kind: CharacterInteractionMediaKindV1
    status: 'available' | 'degraded'
    required: boolean
    specHash: string
    fallbackText: string
    contentHash: string | null
    mimeType: string | null
    byteSize: number
  }>
  gameRelease: { contentHash: string }
  integrity: {
    artifactManifestHash: string
    mediaManifestHash: string
    releaseInputHash: string
  }
  compatibility: {
    productionContract: 1
    runtimeProtocol: 1
    minimumPlayerVersion: 1
  }
  createdAt: number
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

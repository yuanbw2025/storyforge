import type {
  ProductProductionTaskExecutionModeV1,
  ProductProductionTaskLaneV1,
  ProductTaskBudgetReservationV1,
} from './product-production'
import type { WorldReferenceV1 } from './world-product-contracts'
import type { WorldCapabilityArea } from '../registry/types'
import type { TextOpenWorldEffectOperationV1 } from './text-open-world-effect'

/**
 * Stable, product-owned artifacts in the text-open-world production compiler.
 *
 * These are Build candidates, not World Engine records and not runtime session
 * state. A ProductRelease is assembled only after every required artifact has
 * passed its declared gates.
 */
export const TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_KINDS_V1 = [
  'text-open-world.source-pin',
  'text-open-world.source-pin-unit',
  'text-open-world.source-manifest',
  'text-open-world.source-ledger',
  'text-open-world.source-gap-report',
  'text-open-world.game-brief',
  'text-open-world.experience-contract',
  'text-open-world.protagonist-asset',
  'text-open-world.gameplay-ruleset-skeleton',
  'text-open-world.presentation-profile',
  'text-open-world.story-arc',
  'text-open-world.ending-contracts',
  'text-open-world.narrative-promises',
  'text-open-world.region-skeleton',
  'text-open-world.player-build',
  'text-open-world.mainline-thread',
  'text-open-world.significant-threads',
  'text-open-world.region-narrative-packs',
  'text-open-world.quest-skeletons',
  'text-open-world.content-requirement-manifest',
  'text-open-world.progression-catalogs',
  'text-open-world.enemy-encounter-catalog',
  'text-open-world.item-reward-catalog',
  'text-open-world.crafting-economy-catalog',
  'text-open-world.npc-runtime-catalog',
  'text-open-world.map-interaction-catalog',
  'text-open-world.quest-design-documents',
  'text-open-world.director-decks',
  'text-open-world.scene-scripts',
  'text-open-world.choice-contracts',
  'text-open-world.action-bindings',
  'text-open-world.system-configs',
  'text-open-world.media-requirements',
  'text-open-world.content-budget',
  'text-open-world.deterministic-preflight',
  'text-open-world.balance-review',
  'text-open-world.semantic-review',
  'text-open-world.runtime-package',
  'text-open-world.integration-report',
  'text-open-world.quality-report',
] as const

export type TextOpenWorldProductionArtifactKindV1 =
  (typeof TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_KINDS_V1)[number]

export type TextOpenWorldSourceKindV1 = 'world-release' | 'novel'

export type TextOpenWorldSourceRightsBasisV1 =
  | 'author-owned'
  | 'licensed'
  | 'public-domain'

export type TextOpenWorldSourcePermissionV1 =
  | 'derive-text-open-world'
  | 'read-world-release-catalog'
  | 'read-world-release-original'
  | 'freeze-product-private-novel'
  | 'read-frozen-novel'

/**
 * Author authority bound to one exact source version. The raw authorization
 * nonce is never persisted; changing either the Brief or the source requires a
 * new authorization hash and therefore a new Build.
 */
export interface TextOpenWorldSourceAuthorizationV1 {
  schema: 'storyforge.text-open-world-source-authorization'
  version: 1
  productInstanceKey: string
  sourceKind: TextOpenWorldSourceKindV1
  sourceVersionHash: string
  sourceBoundaryHash: string
  briefRevision: number
  briefHash: string
  authorStartRevision: number
  authorizationNonceHash: string
  rightsBasis: TextOpenWorldSourceRightsBasisV1
  rightsNote: string
  permissions: TextOpenWorldSourcePermissionV1[]
  authorizedAt: number
  authorizationHash: string
}

export type TextOpenWorldSourcePinUnitKindV1 =
  | 'world-resource'
  | 'work-metadata'
  | 'story-core'
  | 'outline-node'
  | 'chapter'

/** One bounded, immutable unit. Novel content is copied into `contentText`;
 * WorldRelease units retain only neutral coordinates because the release is
 * already immutable and full reads must go through Context Gateway. */
export interface TextOpenWorldSourcePinUnitV1 {
  schema: 'storyforge.text-open-world-source-pin-unit'
  version: 1
  productInstanceKey: string
  sourceKind: TextOpenWorldSourceKindV1
  unitKey: string
  artifactKey: string
  kind: TextOpenWorldSourcePinUnitKindV1
  label: string
  order: number
  partIndex: number
  partCount: number
  readDepth: 'index' | 'full'
  sourceResourceKey: string | null
  sourceArea: WorldCapabilityArea | null
  sourceResourceKind: string | null
  sourceContentHash: string
  contentText: string | null
  charCount: number
  wordCount: number
  capturedAt: number
}

export interface TextOpenWorldSourcePinUnitRefV1 {
  unitKey: string
  artifactKey: string
  artifactContentHash: string
  kind: TextOpenWorldSourcePinUnitKindV1
  label: string
  order: number
  partIndex: number
  partCount: number
  readDepth: 'index' | 'full'
  sourceResourceKey: string | null
  sourceContentHash: string
  charCount: number
  wordCount: number
}

export type TextOpenWorldSourcePinSourceV1 =
  | {
      kind: 'world-release'
      /** Portable form: `localReleaseRecordId` is always zero. */
      worldReference: WorldReferenceV1
      releaseUid: string
      releaseVersion: number
      releaseHash: string
      sourceManifestHash: string
      catalogHash: string
      selection: {
        mode: 'entire-release' | 'selected-resources'
        selectedResourceKeys: string[]
      }
    }
  | {
      kind: 'novel'
      workCode: string
      workTitle: string
      snapshotVersion: 1
      sourceUpdatedAt: number
      sourceContentHash: string
      coverage: 'full-text' | 'outline-only'
      selection: {
        mode: 'entire-work' | 'outline-subtree' | 'chapter-range' | 'chapters'
        label: string
        selectedChapterCount: number
        selectedOutlineCount: number
      }
    }

/** P0 closure marker. It contains no mutable novel row id and no raw nonce. */
export interface TextOpenWorldSourcePinV1 {
  schema: 'storyforge.text-open-world-source-pin'
  version: 1
  canonicalJsonVersion: 2
  productType: 'text-open-world'
  productInstanceKey: string
  sourceKind: TextOpenWorldSourceKindV1
  sourceVersionHash: string
  sourceBoundaryHash: string
  source: TextOpenWorldSourcePinSourceV1
  authorization: TextOpenWorldSourceAuthorizationV1
  units: TextOpenWorldSourcePinUnitRefV1[]
  readEvidence: {
    method: 'world-release-index' | 'novel-private-full-copy'
    readDepth: 'index' | 'full'
    unitCount: number
    totalChars: number
    totalWords: number
    evidenceHash: string
    capturedAt: number
  }
  createdAt: number
  pinHash: string
}

export interface TextOpenWorldSourcePinBundleV1 {
  pin: TextOpenWorldSourcePinV1
  units: Array<{
    payload: TextOpenWorldSourcePinUnitV1
    artifactContentHash: string
  }>
}

export type TextOpenWorldSourceCurationDepthV1 = 'full' | 'original'

export interface TextOpenWorldSourceManifestUnitV1 {
  unitKey: string
  artifactKey: string
  kind: TextOpenWorldSourcePinUnitKindV1
  label: string
  order: number
  sourceResourceKey: string | null
  sourceContentHash: string
  frozenDepth: 'index' | 'full'
  curationStatus: 'read' | 'unread'
  curationDepth: TextOpenWorldSourceCurationDepthV1 | null
  deliveredContentHash: string | null
  deliveryEvidenceHash: string | null
  modelBatchKey: string | null
}

/**
 * Deterministic read ledger for P1. `read` means the complete unit content was
 * delivered to one governed model batch; being present in SourcePin alone does
 * not count as read.
 */
export interface TextOpenWorldSourceManifestV1 {
  schema: 'storyforge.text-open-world-source-manifest'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  sourceKind: TextOpenWorldSourceKindV1
  sourcePinHash: string
  sourceBoundaryHash: string
  units: TextOpenWorldSourceManifestUnitV1[]
  readUnitCount: number
  unreadUnitCount: number
  readSetHash: string
  createdAt: number
  manifestHash: string
}

export type TextOpenWorldSourceClaimKindV1 =
  | 'identity'
  | 'theme'
  | 'rule'
  | 'conflict'
  | 'plot'
  | 'character'
  | 'relationship'
  | 'faction'
  | 'region'
  | 'location'
  | 'event'
  | 'timeline'
  | 'resource'
  | 'constraint'

export type TextOpenWorldSourceCoverageTagV1 =
  | 'story-core'
  | 'protagonist'
  | 'core-conflict'
  | 'character'
  | 'faction'
  | 'place'
  | 'timeline'

export interface TextOpenWorldSourceEvidenceAnchorV1 {
  unitKey: string
  sourceContentHash: string
  quote: string
  start: number
  end: number
  evidenceHash: string
}

export interface TextOpenWorldSourceLedgerEntryV1 {
  claimKey: string
  claimKind: TextOpenWorldSourceClaimKindV1
  canonicalName: string
  statement: string
  entityKeys: string[]
  coverageTags: TextOpenWorldSourceCoverageTagV1[]
  confidence: number
  evidence: TextOpenWorldSourceEvidenceAnchorV1[]
  modelBatchKey: string
  entryHash: string
}

/** Every model-derived claim is evidence-bearing and points into the read set. */
export interface TextOpenWorldSourceLedgerV1 {
  schema: 'storyforge.text-open-world-source-ledger'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  sourcePinHash: string
  sourceManifestHash: string
  readSetHash: string
  entries: TextOpenWorldSourceLedgerEntryV1[]
  claimCount: number
  createdAt: number
  ledgerHash: string
}

export type TextOpenWorldSourceGapKindV1 =
  | 'unread-source'
  | 'missing-story-core'
  | 'missing-protagonist'
  | 'missing-core-conflict'
  | 'missing-character'
  | 'missing-faction'
  | 'missing-region-or-location'
  | 'missing-timeline'
  | 'contradiction'
  | 'ambiguous-source'
  | 'low-evidence'

export interface TextOpenWorldSourceGapItemV1 {
  gapKey: string
  kind: TextOpenWorldSourceGapKindV1
  severity: 'blocking' | 'warning' | 'info'
  summary: string
  relatedUnitKeys: string[]
  affectedStages: TextOpenWorldProductionStageV1[]
  resolution: 'read-source' | 'ask-author' | 'design-with-explicit-assumption' | 'none'
  status: 'open'
  gapHash: string
}

export interface TextOpenWorldSourceGapReportV1 {
  schema: 'storyforge.text-open-world-source-gap-report'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  sourcePinHash: string
  sourceManifestHash: string
  sourceLedgerHash: string
  unreadUnitCount: number
  gaps: TextOpenWorldSourceGapItemV1[]
  blockingGapCount: number
  warningGapCount: number
  createdAt: number
  reportHash: string
}

export interface TextOpenWorldGameBriefV1 {
  schema: 'storyforge.text-open-world-game-brief'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  title: string
  authorization: {
    productBriefRevision: number
    productBriefHash: string
    confirmedBriefHash: string
    authorStartRevision: number
    confirmedAt: number
  }
  source: {
    kind: TextOpenWorldSourceKindV1
    sourcePinHash: string
    sourceManifestHash: string
    sourceLedgerHash: string
    sourceGapReportHash: string
    readUnitCount: number
    unreadUnitCount: number
    openGapKeys: string[]
  }
  authorIntent: {
    playerRole: string
    protagonistMode: 'source-character' | 'author-defined'
    protagonistSourceRefs: string[]
    openingSituation: string
    coreExperience: string[]
    tone: string[]
    requiredFacts: string[]
    forbiddenChanges: string[]
    contentBoundaries: string[]
  }
  scale: {
    scope: 'scene' | 'short-arc' | 'chapter' | 'multi-chapter' | 'campaign'
    requestedPlayMinutes: number
    requestedNarrativeWords: number
    endingCount: number
    regionCount: number
    namedLocationRange: { minimum: number; maximum: number }
    mainlineStageRange: { minimum: number; maximum: number }
    significantStorylineCount: number
    ordinaryQuestRange: { minimum: number; maximum: number }
    taskTemplateRange: { minimum: number; maximum: number }
    randomEventRange: { minimum: number; maximum: number }
    requiredPlayMinuteRange: { minimum: number; maximum: number }
    optionalInventoryMinuteRange: { minimum: number; maximum: number }
  }
  fixedProductBoundary: {
    freedomMode: 'bounded-guided'
    interactionModes: ['system-action', 'fixed-choice', 'natural-language']
    mainlineOrder: 'strict-sequential'
    mainlinePressure: 'wait-for-player'
    importantStorylinePressure: 'safe-wait-point'
    ordinaryWorldEvolution: 'continues-with-time'
    criticalArrivalTriggerPolicy: 'never-location-only'
    customSolutionPolicy: 'decline-or-redirect-in-v1'
    combatInput: ['fight', 'escape', 'skill', 'item']
    combatMode: 'turn-based'
    difficulty: 'standard'
  }
  media: {
    visualLevel: 'none' | 'key-scenes' | 'illustrated'
    audioLevel: 'none' | 'music-sfx' | 'full'
    requiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background']
    textFallbackRequired: true
  }
  effectiveProductionBudget: {
    maximumModelCalls: number
    maximumInputTokens: number
    maximumOutputTokens: number
    maximumMediaCalls: number
    maximumCostUsd: number
    maximumDurationMs: number
    maximumStorageBytes: number
  }
  completion: {
    requiresPlayablePreview: true
    requiredGateIds: string[]
    minimumMediaCoverage: number
    allowSoftWaivers: boolean
    releaseMode: 'direct-after-gates'
  }
  createdAt: number
  gameBriefHash: string
}

export interface TextOpenWorldExperienceContractV1 {
  schema: 'storyforge.text-open-world-experience-contract'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  sourceLedgerHash: string
  title: string
  pitch: string
  playerFantasy: string
  narrativePillars: string[]
  regionalVarietyPromise: string
  growthPromise: string
  toneGuide: string[]
  coreLoop: [
    'observe-scene', 'choose-or-describe', 'resolve-system-action',
    'receive-consequence', 'grow-and-explore',
  ]
  freedom: {
    mode: 'bounded-guided'
    acceptedInputs: ['system-action', 'fixed-choice', 'natural-language']
    offTrackHandling: 'natural-response-then-mainline-redirect'
    impossibleActionHandling: 'explicit-decline-with-in-world-alternative'
    customSolutionPolicy: 'future-extension'
  }
  narrative: {
    mainline: 'strict-sequential-protected'
    endings: 'multiple-core-goal-compatible'
    importantStorylines: 'persistent-safe-wait'
    ordinaryContent: 'regional-deck-and-fixed-quests'
    mainlinePressure: 'none-while-absent'
  }
  worldEvolution: {
    mainlineWaits: true
    importantStorylinesWaitAtSafePoints: true
    ordinaryQuestsMayExpireOrFail: true
    ordinaryNpcsMayDie: true
    timeWeatherAndRegionsContinue: true
  }
  failure: {
    combat: 'retry-or-respawn'
    mainlineGoal: 'cannot-permanently-fail'
    importantStoryline: 'cannot-abandon'
    ordinaryQuest: 'may-abandon-expire-or-fail'
  }
  sourceClaimKeys: string[]
  basisHash: string
  createdAt: number
  experienceContractHash: string
}

export interface TextOpenWorldProtagonistAssetV1 {
  schema: 'storyforge.text-open-world-protagonist-asset'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  experienceContractHash: string
  origin: 'source-character' | 'author-defined'
  sourceRefs: string[]
  displayName: string
  playerRole: string
  identitySummary: string
  motivations: string[]
  personalStakes: string[]
  sourceClaimKeys: string[]
  protection: {
    criticalRole: true
    playerMayAbandonMainline: false
    initialBuildDeferredToP4: true
  }
  basisHash: string
  createdAt: number
  protagonistAssetHash: string
}

export interface TextOpenWorldGameplayRulesetSkeletonV1 {
  schema: 'storyforge.text-open-world-gameplay-ruleset-skeleton'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  experienceContractHash: string
  sourceLedgerHash: string
  ruleset: {
    key: 'storyforge.standard'
    version: 1
    title: string
    summary: string
    sourceClaimKeys: string[]
  }
  characterModel: {
    professionSystem: 'none'
    playerAttributeAllocation: 'automatic-no-player-points'
    attributes: [
      { key: 'power'; label: string; meaning: string; runtimeOutputs: ['attack'] },
      { key: 'vitality'; label: string; meaning: string; runtimeOutputs: ['maximum-health', 'defense'] },
      { key: 'agility'; label: string; meaning: string; runtimeOutputs: ['critical-chance', 'initiative'] },
    ]
  }
  progression: {
    moduleVersion: 1
    maximumLevel: 20
    acceptanceLevelRange: { minimum: 1; maximum: 5 }
    automaticAttributeGrowth: true
    levelTablePolicy: 'explicit-cumulative-experience-and-growth'
    levelUpResourcePolicy: 'increase-by-cap-delta'
    maximumLevelExperiencePolicy: 'cap-at-threshold'
    skillAcquisition: ['initial', 'level', 'quest']
    deferredSkillAcquisition: ['exploration', 'item']
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
    skillResourceLabel: string
  }
  combat: {
    moduleVersion: 3
    mode: 'turn-based-player-choice'
    playerActions: ['basic-attack', 'skill', 'item', 'escape']
    freeTextActions: false
    defaultAttackHits: true
    playerPartyLimit: 1
    allowFriendlyNpcCombatants: false
    allowElements: false
    allowEscape: true
    difficultyProfiles: [{
      key: 'standard'
      label: string
      enemyHealthMultiplier: 1
      enemyDamageMultiplier: 1
      rewardMultiplier: 1
    }]
    resolution: {
      algorithm: 'bounded-physical-v1'
      criticalRollMaximum: 10_000
      criticalChanceCapBasisPoints: number
      criticalMultiplierNumerator: number
      criticalMultiplierDenominator: number
      minimumDamage: number
      maximumDamage: number
    }
    defeatPolicy: 'retry-or-respawn'
    respawnCost: 'none-v1'
  }
  inventory: {
    itemModuleVersion: 1
    capacityPolicy: 'unlimited'
    equipmentSlots: [
      { key: 'weapon'; label: string },
      { key: 'armor'; label: string },
      { key: 'accessory'; label: string },
    ]
    randomAffixes: false
    enhancement: false
    durability: false
    criticalItems: 'non-droppable-non-sellable'
  }
  crafting: {
    moduleVersion: 2
    successPolicy: 'guaranteed'
    recipeKnowledgeRequired: true
    maximumBatchQuantity: number
    maximumTotalItemUnitsPerAction: number
  }
  economy: {
    moduleVersion: 2
    currency: { key: 'currency'; label: string }
    currencyModel: 'single'
    ordinaryStockPolicy: 'unlimited'
    specialStockPolicy: 'limited'
    maximumTransactionQuantity: number
    maximumTransactionTotal: number
  }
  effects: {
    actionModuleVersion: 14
    runtimeSupportedOperations: TextOpenWorldEffectOperationV1[]
    newBuildAllowedOperations: TextOpenWorldEffectOperationV1[]
    modelProposableOperations: TextOpenWorldEffectOperationV1[]
    compilerOwnedOperations: TextOpenWorldEffectOperationV1[]
    legacyReadOnlyOperations: ['start-combat', 'resolve-combat']
    definitionPolicy: 'release-predeclared-only'
    runtimeModelAuthority: 'none'
    executionPolicy: 'deterministic-validated-atomic-event'
  }
  g2Compatibility: {
    progressionModuleVersion: 1
    combatModuleVersion: 3
    itemModuleVersion: 1
    craftingModuleVersion: 2
    economyModuleVersion: 2
    actionModuleVersion: 14
    runtimePackageVersion: 1
  }
  basisHash: string
  createdAt: number
  gameplayRulesetHash: string
}

/**
 * P4 protagonist identity and initial build candidate.
 *
 * The stable skill/item keys are reservations consumed by later catalog
 * producers. They are not runnable definitions until `catalogBinding.status`
 * becomes `bound` during deterministic final assembly.
 */
export interface TextOpenWorldPlayerBuildV1 {
  schema: 'storyforge.text-open-world-player-build'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  experienceContractHash: string
  protagonistAssetHash: string
  gameplayRulesetHash: string
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
  playstyle: {
    title: string
    summary: string
    /** Descriptive playstyle only; v1 has no profession/class system. */
    professionKey: null
    primaryAttribute: 'power' | 'vitality' | 'agility'
    secondaryAttribute: 'power' | 'vitality' | 'agility'
    sourceClaimKeys: string[]
  }
  buildCandidate: {
    progressionProfileKey: 'progression.default'
    initialLevel: 1
    attributes: { power: number; vitality: number; agility: number }
    learnedSkillKeys: ['skill.player.basic-attack', 'skill.player.signature']
    startingItemKeys: ['item.player.starter-weapon', 'item.player.recovery-consumable']
    startingCurrency: 100
  }
  catalogRequirements: {
    skills: [
      {
        key: 'skill.player.basic-attack'
        role: 'basic-attack'
        title: string
        description: string
        acquisition: 'initial'
        activation: 'active'
        kind: 'attack'
        target: 'single-enemy'
        scalingAttribute: 'power'
        resourceCost: 0
        cooldownTurns: 0
      },
      {
        key: 'skill.player.signature'
        role: 'signature'
        title: string
        description: string
        combatPurpose: 'burst-damage' | 'sustained-damage' | 'guard' | 'tempo' | 'recovery' | 'resource-control'
        acquisition: 'initial'
        activation: 'active'
        kind: 'attack' | 'status' | 'recovery' | 'resource'
        target: 'self' | 'single-enemy'
        scalingAttribute: 'power' | 'vitality' | 'agility'
        resourceCost: 1
        cooldownTurns: 1
      },
    ]
    items: [
      {
        key: 'item.player.starter-weapon'
        role: 'starter-weapon'
        title: string
        description: string
        kind: 'equipment'
        equipmentSlotKey: 'weapon'
        initialQuantity: 1
      },
      {
        key: 'item.player.recovery-consumable'
        role: 'recovery-consumable'
        title: string
        description: string
        kind: 'consumable'
        equipmentSlotKey: null
        initialQuantity: 3
      },
    ]
  }
  catalogBinding: {
    status: 'reserved-unbound'
    requiredArtifactKeys: [
      'text-open-world.progression-catalogs',
      'text-open-world.item-reward-catalog',
    ]
    playerDefinitionReady: false
    bindingPolicy: 'exact-reserved-keys-before-runtime-assembly'
  }
  basisHash: string
  createdAt: number
  playerBuildHash: string
}

export type TextOpenWorldStoryMacroPhaseV1 =
  | 'opening'
  | 'rising'
  | 'turning-point'
  | 'convergence'
  | 'resolution'

export interface TextOpenWorldStoryArcV1 {
  schema: 'storyforge.text-open-world-story-arc'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  experienceContractHash: string
  protagonistAssetHash: string
  sourceLedgerHash: string
  sourceGapReportHash: string
  title: string
  logline: string
  themeStatement: string
  coreConflict: {
    coreGoal: string
    protagonistDrive: string
    opposingForce: string
    conflictMechanism: string
    personalStakes: string
    regionalStakes: string
    worldStakes: string
    protectedGoalPolicy: 'must-remain-achievable'
  }
  governance: {
    openingSituation: string
    requiredFacts: string[]
    forbiddenChanges: string[]
    contentBoundaries: string[]
    mainlineOrder: 'strict-sequential'
    mainlinePressure: 'wait-for-player'
    mainlineFailure: 'cannot-permanently-fail'
    criticalTriggerPolicy: 'never-location-only'
    targetStageRange: { minimum: number; maximum: number }
  }
  macroBeats: Array<{
    key: string
    order: number
    phase: TextOpenWorldStoryMacroPhaseV1
    title: string
    dramaticPurpose: string
    protagonistChange: string
    requiredReveal: string
    spatialFunctionNeeds: string[]
    sourceClaimKeys: string[]
    promiseSetupKeys: string[]
    promiseCallbackKeys: string[]
    promisePayoffKeys: string[]
  }>
  endingContractKeys: string[]
  narrativePromiseKeys: string[]
  sourceClaimKeys: string[]
  sourceHandling: {
    explicitAssumptionGapKeys: string[]
    unresolvedGapKeys: string[]
  }
  basisHash: string
  createdAt: number
  storyArcHash: string
}

export interface TextOpenWorldEndingContractsV1 {
  schema: 'storyforge.text-open-world-ending-contracts'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  storyArcHash: string
  endings: Array<{
    key: string
    order: number
    title: string
    outcomeSummary: string
    differentiationAxis: string
    decisivePlayerValue: string
    coreGoalResolution: string
    coreGoalStatus: 'achieved'
    eligiblePathSummary: string
    sourceClaimKeys: string[]
    runtimeBinding: {
      status: 'condition-unbound'
      conditionKeys: []
      unlockEffectKey: null
      reachEffectKey: null
    }
  }>
  endingCount: number
  basisHash: string
  createdAt: number
  endingContractsHash: string
}

export type TextOpenWorldNarrativePromiseKindV1 =
  | 'core-conflict'
  | 'mystery'
  | 'character'
  | 'faction'
  | 'world'
  | 'theme'

export interface TextOpenWorldNarrativePromisesV1 {
  schema: 'storyforge.text-open-world-narrative-promises'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  storyArcHash: string
  endingContractsHash: string
  promises: Array<{
    key: string
    order: number
    kind: TextOpenWorldNarrativePromiseKindV1
    statement: string
    setup: { beatKey: string; description: string }
    callbacks: Array<{
      key: string
      order: number
      beatKey: string
      function: 'escalate' | 'complicate' | 'recontextualize'
      description: string
    }>
    payoff: {
      beatKey: string
      description: string
      endingKeys: string[]
    }
    sourceClaimKeys: string[]
    binding: {
      status: 'scene-unbound'
      setupSceneKey: null
      callbackSceneKeys: []
      payoffSceneKey: null
    }
  }>
  promiseCount: number
  basisHash: string
  createdAt: number
  narrativePromisesHash: string
}

export type TextOpenWorldRegionDerivationBasisV1 =
  | 'source'
  | 'story-need'
  | 'source-and-story-need'

export type TextOpenWorldLocationKindV1 =
  | 'settlement'
  | 'interior'
  | 'wilderness'
  | 'dungeon'
  | 'landmark'

export type TextOpenWorldLocationFunctionV1 =
  | 'narrative'
  | 'service'
  | 'exploration'
  | 'combat'
  | 'crafting'
  | 'travel'

export interface TextOpenWorldRegionStoryNeedRefV1 {
  beatKey: string
  need: string
}

/**
 * P4 world-scale spatial skeleton. It freezes stable region/location/topology
 * keys for downstream story production without pretending that Scene, Quest,
 * Condition, presentation media, or runtime catalogs already exist.
 */
export interface TextOpenWorldRegionSkeletonV1 {
  schema: 'storyforge.text-open-world-region-skeleton'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  sourceManifestHash: string
  sourceLedgerHash: string
  experienceContractHash: string
  storyArcHash: string
  worldScale: {
    regionCount: number
    namedLocationCount: number
    requestedNamedLocationRange: { minimum: number; maximum: number }
    completeness: 'complete-at-build'
    revealPolicy: 'progressive-knowledge'
  }
  initialRegionKey: string
  initialLocationKey: string
  regions: Array<{
    key: string
    order: number
    title: string
    description: string
    theme: string
    narrativeRole: string
    derivationBasis: TextOpenWorldRegionDerivationBasisV1
    sourceClaimKeys: string[]
    storyNeedRefs: TextOpenWorldRegionStoryNeedRefV1[]
    locationKeys: string[]
    fastTravelPointKey: string
    progressionOrder: number
    knowledgePolicy: 'title-on-heard'
    initialKnowledge: 'unknown' | 'visited'
    presentationBinding: {
      status: 'presentation-unbound'
      presentationRefs: []
    }
  }>
  locations: Array<{
    key: string
    regionKey: string
    order: number
    title: string
    description: string
    kind: TextOpenWorldLocationKindV1
    purpose: string
    functions: TextOpenWorldLocationFunctionV1[]
    earlyArrivalDescription: string
    derivationBasis: TextOpenWorldRegionDerivationBasisV1
    sourceClaimKeys: string[]
    storyNeedRefs: TextOpenWorldRegionStoryNeedRefV1[]
    initialKnowledge: 'unknown' | 'visited'
    contentBinding: {
      status: 'content-unbound'
      sceneKeys: []
      questKeys: []
      actorKeys: []
      encounterKeys: []
      vendorKeys: []
    }
    presentationBinding: {
      status: 'presentation-unbound'
      presentationRefs: []
    }
  }>
  edges: Array<{
    key: string
    fromLocationKey: string
    toLocationKey: string
    bidirectional: true
    distanceBand: 'near' | 'medium' | 'far'
    travelMinutes: number
    description: string
    riskProfile: 'safe' | 'ordinary' | 'dangerous'
    connectionPurpose: string
    conditionKeys: []
    sourceClaimKeys: string[]
    storyNeedRefs: TextOpenWorldRegionStoryNeedRefV1[]
  }>
  fastTravelPoints: Array<{
    key: string
    regionKey: string
    locationKey: string
    unlockedByDefault: boolean
    canRespawn: true
  }>
  governance: {
    topology: 'all-locations-connected'
    regionTopology: 'all-regions-connected'
    everyRegionHasFastTravelPoint: true
    earlyArrival: 'all-locations-safe'
    arrivalStoryTrigger: 'never-critical-location-only'
    mainlineBindings: 'unbound-until-p5'
    ordinaryContentBindings: 'unbound-until-p7-p8'
    travelConditions: 'none-in-skeleton'
  }
  coverage: {
    requiredStoryNeedCount: number
    coveredStoryNeedCount: number
    uncoveredStoryNeedRefs: []
    usedSourceClaimKeys: string[]
  }
  basisHash: string
  createdAt: number
  regionSkeletonHash: string
}

export type TextOpenWorldMainlineGameplayFocusV1 =
  | 'dialogue'
  | 'investigation'
  | 'exploration'
  | 'combat'
  | 'preparation'
  | 'choice'

export interface TextOpenWorldMainlineThreadV1 {
  schema: 'storyforge.text-open-world-mainline-thread'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  gameplayRulesetHash: string
  storyArcHash: string
  endingContractsHash: string
  narrativePromisesHash: string
  regionSkeletonHash: string
  playerBuildHash: string
  thread: {
    key: 'storyline.main'
    kind: 'mainline'
    ownerKind: 'core'
    ownerKey: null
    title: string
    summary: string
    coreGoal: string
    stageKeys: string[]
    endingKeys: string[]
  }
  stages: Array<{
    key: string
    order: number
    previousStageKey: string | null
    nextStageKey: string | null
    storyBeatKey: string
    title: string
    summary: string
    dramaticQuestion: string
    regionKeys: string[]
    locationKeys: string[]
    gameplayFocus: TextOpenWorldMainlineGameplayFocusV1[]
    playerGoals: string[]
    requiredReveal: string
    stageOutcome: string
    protectionNeeds: string[]
    recoveryDescription: string
    recommendedLevelBand: { minimum: number; maximum: number }
    pacingWeight: number
    estimatedMinutes: number
    safeWaitBefore: true
    safeWaitAfter: true
    entryPolicy: {
      mode: 'explicit-mainline-advance'
      arrivalAloneNeverStarts: true
      previousStageCompletionRequired: boolean
      prerequisiteConditionKeys: []
    }
    failurePolicy: {
      combat: 'retry-or-respawn'
      story: 'cannot-permanently-fail'
      abandonable: false
      expirable: false
      ordinaryStateMayBlock: false
    }
    narrativePromiseMomentKeys: string[]
    questBinding: {
      status: 'quest-unbound'
      questKey: null
      questStageKeys: []
      objectiveKeys: []
    }
    sceneBinding: {
      status: 'scene-unbound'
      sceneKeys: []
    }
    rewardBinding: {
      status: 'reward-unbound'
      rewardContractKey: null
      rewardEffectKeys: []
    }
  }>
  endingRoutes: Array<{
    endingKey: string
    finalStageKey: string
    routeSummary: string
    decisivePlayerValue: string
    coreGoalStatus: 'achieved'
    runtimeBinding: {
      status: 'condition-unbound'
      conditionKeys: []
      endingSceneKey: null
      unlockEffectKey: null
    }
  }>
  promisePlan: Array<{
    promiseKey: string
    setupStageKey: string
    callbackStageKeys: string[]
    payoffStageKey: string
    endingKeys: string[]
    sceneBindingStatus: 'scene-unbound'
  }>
  governance: {
    order: 'strict-sequential'
    pressure: 'wait-for-player'
    failure: 'cannot-permanently-fail'
    criticalTrigger: 'never-location-only'
    allStagesReachable: true
    allStagesProtectedWait: true
    ordinaryStateCannotBlock: true
    criticalAssets: 'protected-by-downstream-requirements'
  }
  pacing: {
    stageCount: number
    totalEstimatedMinutes: number
    requiredPlayMinuteRange: { minimum: number; maximum: number }
    initialLevel: number
    finalRecommendedLevel: number
  }
  downstreamBinding: {
    status: 'requirements-unbound'
    requiredArtifactKeys: [
      'text-open-world.quest-skeletons',
      'text-open-world.content-requirement-manifest',
      'text-open-world.quest-design-documents',
      'text-open-world.scene-scripts',
      'text-open-world.action-bindings',
    ]
    runtimeReady: false
  }
  basisHash: string
  createdAt: number
  mainlineThreadHash: string
}

export type TextOpenWorldSignificantThreadOwnerKindV1 =
  | 'character'
  | 'faction'
  | 'region'

export type TextOpenWorldSignificantConsequenceKindV1 =
  | 'morality'
  | 'faction-affinity'
  | 'regional-state'
  | 'npc-attitude'
  | 'resource'

/**
 * P6 important-story architecture. Character and faction owners are stable
 * reservations until the NPC catalog is compiled; region owners bind to the
 * already frozen map. Runtime Quest, Scene, Condition, Effect, Reward, Actor,
 * and Faction rows remain explicitly unbound.
 */
export interface TextOpenWorldSignificantThreadsV1 {
  schema: 'storyforge.text-open-world-significant-threads'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  sourceLedgerHash: string
  storyArcHash: string
  endingContractsHash: string
  narrativePromisesHash: string
  regionSkeletonHash: string
  mainlineThreadHash: string
  threads: Array<{
    key: string
    order: number
    ownerKind: TextOpenWorldSignificantThreadOwnerKindV1
    ownerKey: string
    ownerTitle: string
    ownerBinding: {
      status: 'catalog-unbound' | 'region-bound'
      actorKey: null
      factionKey: null
      regionKey: string | null
    }
    title: string
    summary: string
    centralConflict: string
    theme: string
    sourceClaimKeys: string[]
    storyBeatKeys: string[]
    regionKeys: string[]
    locationKeys: string[]
    supportingPromiseKeys: string[]
    mainlineCompatibility: {
      availableAfterStageKey: string
      lastSafeStartStageKey: null
      requiredMainlineMutationKeys: []
      mayChangeCoreGoal: false
      mayBlockMainline: false
      mayDetermineEndingAlone: false
    }
    conflictSystem: {
      sides: Array<{
        key: string
        order: number
        name: string
        goal: string
        resource: string
        pressure: string
        catalogBindingStatus: 'unbound'
      }>
      escalationSteps: string[]
      atmosphereSignals: string[]
    }
    stageKeys: string[]
    estimatedMinutes: number
  }>
  stages: Array<{
    key: string
    threadKey: string
    order: number
    previousStageKey: string | null
    nextStageKey: string | null
    title: string
    summary: string
    dramaticQuestion: string
    regionKeys: string[]
    locationKeys: string[]
    gameplayFocus: TextOpenWorldMainlineGameplayFocusV1[]
    playerGoals: string[]
    stageOutcome: string
    safeWaitBefore: true
    safeWaitAfter: true
    pacingWeight: number
    estimatedMinutes: number
    localConsequencePlans: Array<{
      key: string
      order: number
      kind: TextOpenWorldSignificantConsequenceKindV1
      targetSemanticKey: string
      direction: 'increase' | 'decrease' | 'change'
      magnitude: 'minor' | 'moderate' | 'major'
      description: string
      runtimeBinding: {
        status: 'effect-unbound'
        conditionKeys: []
        effectKeys: []
      }
    }>
    entryPolicy: {
      mode: 'explicit-important-story-advance'
      arrivalAloneNeverStarts: true
      previousStageCompletionRequired: boolean
      prerequisiteConditionKeys: []
    }
    failurePolicy: {
      combat: 'retry-or-respawn'
      story: 'cannot-permanently-fail'
      abandonable: false
      expirable: false
      ordinaryStateMayBlock: false
    }
    contentBinding: {
      status: 'content-unbound'
      questKey: null
      questStageKeys: []
      objectiveKeys: []
      sceneKeys: []
      actionKeys: []
      rewardContractKey: null
    }
  }>
  coverage: {
    requiredThreadCount: number
    actualThreadCount: number
    ownerKinds: TextOpenWorldSignificantThreadOwnerKindV1[]
    minimumOwnerKindCount: 2
    regionKeys: string[]
    sourceClaimKeys: string[]
  }
  governance: {
    lifecycle: 'persistent-safe-wait'
    failure: 'cannot-permanently-fail'
    abandonable: false
    expirable: false
    pressureWhileAbsent: 'none'
    consequences: 'local-only'
    mainlineCompatibility: 'cannot-block-or-rewrite'
    criticalTrigger: 'never-location-only'
    criticalAssets: 'protected-by-downstream-requirements'
  }
  downstreamBinding: {
    status: 'requirements-unbound'
    requiredArtifactKeys: [
      'text-open-world.quest-skeletons',
      'text-open-world.content-requirement-manifest',
      'text-open-world.npc-runtime-catalog',
      'text-open-world.quest-design-documents',
      'text-open-world.scene-scripts',
      'text-open-world.action-bindings',
    ]
    runtimeReady: false
  }
  basisHash: string
  createdAt: number
  significantThreadsHash: string
}

export type TextOpenWorldRegionalCharacterTierV1 =
  | 'important'
  | 'recurring'
  | 'functional'
  | 'ambient'

export type TextOpenWorldRegionalEventKindV1 =
  | 'ambient'
  | 'opportunity'
  | 'danger'
  | 'discovery'
  | 'social'

/** P7 per-region content ecology and downstream catalog requirements. */
export interface TextOpenWorldRegionNarrativePacksV1 {
  schema: 'storyforge.text-open-world-region-narrative-packs'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  experienceContractHash: string
  sourceLedgerHash: string
  regionSkeletonHash: string
  mainlineThreadHash: string
  significantThreadsHash: string
  packs: Array<{
    key: string
    order: number
    regionKey: string
    identity: {
      title: string
      fantasy: string
      localConflict: string
      regionalQuestion: string
      dailyLifeBaseline: string
      distinctivenessStatement: string
    }
    sourceClaimKeys: string[]
    mainlineStageKeys: string[]
    significantThreadKeys: string[]
    tensions: Array<{
      key: string
      order: number
      title: string
      sideA: string
      sideB: string
      stakes: string
      pressureAxis: string
      mainlineMayBlock: false
    }>
    stateAxes: Array<{
      key: string
      order: number
      title: string
      lowExpression: string
      middleExpression: string
      highExpression: string
      mainlineMayBlock: false
      runtimeBinding: { status: 'effect-unbound'; conditionKeys: []; effectKeys: [] }
    }>
    locationPlans: Array<{
      key: string
      locationKey: string
      requiredFunctions: TextOpenWorldLocationFunctionV1[]
      dailyLife: string
      activityPatterns: string[]
      npcRoleNeeds: string[]
      rumorHooks: string[]
      timeExpressions: string[]
      contentRisk: 'safe' | 'ordinary' | 'dangerous'
      catalogBindingStatus: 'unbound'
    }>
    characterRequirements: Array<{
      key: string
      order: number
      tier: TextOpenWorldRegionalCharacterTierV1
      roleTitle: string
      narrativeFunction: string
      homeLocationKey: string
      routine: string
      serviceNeeds: string[]
      significantThreadKeys: string[]
      sourceClaimKeys: string[]
      runtimeMode: 'agent-maintained' | 'rule-driven'
      protectionRequirement: 'protected-nonlethal' | 'ordinary-lifecycle'
      catalogBinding: { status: 'actor-unbound'; actorKey: null }
    }>
    factionRequirements: Array<{
      key: string
      order: number
      title: string
      publicGoal: string
      localResource: string
      visiblePresence: string
      significantThreadKeys: string[]
      sourceClaimKeys: string[]
      catalogBinding: { status: 'faction-unbound'; factionKey: null }
    }>
    ordinaryQuestSeeds: Array<{
      key: string
      order: number
      title: string
      premise: string
      playerActivity: string
      locationKeys: string[]
      tensionKey: string
      rewardNeeds: string[]
      estimatedMinutes: number
      sourceClaimKeys: string[]
      binding: { status: 'quest-unbound'; questKey: null }
    }>
    taskTemplateSeeds: Array<{
      key: string
      order: number
      title: string
      storyFrame: string
      locationKeys: string[]
      variationAxes: string[]
      eligibilitySummary: string
      cooldownIntent: string
      sourceClaimKeys: string[]
      binding: { status: 'template-unbound'; questTemplateKey: null }
    }>
    randomEventSeeds: Array<{
      key: string
      order: number
      kind: TextOpenWorldRegionalEventKindV1
      title: string
      setup: string
      playerOpportunity: string
      locationKeys: string[]
      repeatability: 'one-shot' | 'repeatable-variant'
      sourceClaimKeys: string[]
      binding: { status: 'event-unbound'; eventKey: null; effectKeys: [] }
    }>
    rumors: Array<{
      key: string
      order: number
      text: string
      pointsTo: 'location' | 'quest' | 'event' | 'tension' | 'character'
      spoilerBoundary: string
      sourceClaimKeys: string[]
      bindingStatus: 'unbound'
    }>
  }>
  coverage: {
    requiredRegionCount: number
    actualRegionCount: number
    requiredLocationKeys: string[]
    coveredLocationKeys: string[]
    ordinaryQuestSeedCount: number
    requiredOrdinaryQuestSeedCount: number
    taskTemplateSeedCount: number
    requiredTaskTemplateSeedCount: number
    randomEventSeedCount: number
    requiredRandomEventSeedCount: number
    importantCharacterRequirementCount: number
    sourceClaimKeys: string[]
  }
  governance: {
    everyLocationHasPlan: true
    everyRegionDistinct: true
    ordinaryWorldContinues: true
    mainlineWaits: true
    importantStoriesWaitAtSafePoints: true
    regionalConsequencesCannotBlockMainline: true
    npcRuntimeSplit: 'important-agent-ordinary-rules'
    contentSupply: 'build-seeds-before-runtime-deck'
  }
  downstreamBinding: {
    status: 'requirements-unbound'
    requiredArtifactKeys: [
      'text-open-world.quest-skeletons',
      'text-open-world.content-requirement-manifest',
      'text-open-world.npc-runtime-catalog',
      'text-open-world.map-interaction-catalog',
      'text-open-world.quest-design-documents',
      'text-open-world.director-decks',
    ]
    runtimeReady: false
  }
  basisHash: string
  createdAt: number
  regionNarrativePacksHash: string
}

export type TextOpenWorldQuestSkeletonSourceKindV1 =
  | 'mainline-stage'
  | 'significant-stage'
  | 'ordinary-seed'
  | 'template-seed'

export type TextOpenWorldQuestObjectiveIntentV1 =
  | 'dialogue'
  | 'investigate'
  | 'explore'
  | 'combat'
  | 'collect'
  | 'craft'
  | 'trade'
  | 'choice'
  | 'travel'
  | 'interact'

export type TextOpenWorldContentRequirementKindV1 =
  | 'actor'
  | 'faction'
  | 'enemy'
  | 'encounter'
  | 'item'
  | 'equipment'
  | 'material'
  | 'skill'
  | 'recipe'
  | 'vendor'
  | 'reward'
  | 'action'
  | 'location-interaction'

export interface TextOpenWorldQuestSkeletonsV1 {
  schema: 'storyforge.text-open-world-quest-skeletons'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  experienceContractHash: string
  gameplayRulesetHash: string
  mainlineThreadHash: string
  significantThreadsHash: string
  regionNarrativePacksHash: string
  quests: Array<{
    key: string
    order: number
    type: 'mainline' | 'significant' | 'ordinary' | 'template'
    source: {
      kind: TextOpenWorldQuestSkeletonSourceKindV1
      sourceKey: string
      sourceOrder: number
    }
    owner: {
      kind: 'global' | 'actor' | 'faction' | 'region'
      semanticKey: string | null
    }
    storylineKey: string | null
    title: string
    premise: string
    storyMotivation: string
    intendedPlayerExperience: string
    regionKeys: string[]
    locationKeys: string[]
    stageKeys: string[]
    estimatedMinutes: number
    lifecyclePlan: {
      lifecyclePolicy: 'protected-wait' | 'abandon-restart' | 'abandon-terminal'
      timePolicy: 'waits' | 'timed'
      expirationMinutes: number | null
      abandonable: boolean
      mayFailPermanently: boolean
      repeatable: boolean
      instantiationPolicy: 'session-start' | 'director'
      pressureWhileAbsent: 'none' | 'deadline-only'
    }
    entryPlan: {
      mode: 'explicit-action'
      arrivalAloneNeverStarts: true
      prerequisiteRequirementKeys: []
    }
    runtimeBinding: {
      status: 'runtime-unbound'
      questKey: null
      prerequisiteConditionKeys: []
      rewardContractKey: null
      claimActionKey: null
    }
  }>
  stages: Array<{
    key: string
    questKey: string
    order: number
    previousStageKey: string | null
    nextStageKey: string | null
    title: string
    purpose: string
    completionIntent: string
    objectiveKeys: string[]
    safeWaitBefore: boolean
    safeWaitAfter: boolean
    runtimeBinding: {
      status: 'runtime-unbound'
      completionConditionKeys: []
      completionActionKey: null
    }
  }>
  objectives: Array<{
    key: string
    questKey: string
    stageKey: string
    order: number
    title: string
    playerIntent: TextOpenWorldQuestObjectiveIntentV1
    successDescription: string
    optional: boolean
    requirementKeys: string[]
    runtimeBinding: { status: 'runtime-unbound'; actionKeys: [] }
  }>
  coverage: {
    mainlineStageKeys: string[]
    significantStageKeys: string[]
    ordinarySeedKeys: string[]
    templateSeedKeys: string[]
    uncoveredSourceKeys: []
    totalQuestCount: number
    protectedQuestCount: number
    ordinaryQuestCount: number
    templateQuestCount: number
    totalEstimatedMinutes: number
  }
  governance: {
    sourceCoverage: 'one-skeleton-per-source'
    noPrematureCatalogReferences: true
    mainlineAndSignificantProtected: true
    arrivalNeverSoleTrigger: true
    allRuntimeBindingsUnbound: true
  }
  basisHash: string
  createdAt: number
  questSkeletonsHash: string
}

export interface TextOpenWorldContentRequirementManifestV1 {
  schema: 'storyforge.text-open-world-content-requirement-manifest'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  questSkeletonsHash: string
  regionNarrativePacksHash: string
  requirements: Array<{
    key: string
    order: number
    kind: TextOpenWorldContentRequirementKindV1
    title: string
    description: string
    requestedTraits: string[]
    minimumCount: number
    criticality: 'ordinary' | 'important' | 'protected'
    sourceReservationKey: string | null
    consumerRefs: Array<{
      kind: 'quest-objective' | 'region-character' | 'region-faction' | 'location-plan'
      consumerKey: string
    }>
    ownerTaskKey:
      | 'p8.catalog.progression'
      | 'p8.catalog.encounters'
      | 'p8.catalog.items-rewards'
      | 'p8.catalog.crafting-economy'
      | 'p8.catalog.npc-runtime'
      | 'p8.catalog.map-interactions'
      | 'p8f.quest-finalize'
    binding: { status: 'catalog-unbound'; definitionKeys: [] }
  }>
  coverage: {
    questObjectiveKeys: string[]
    coveredQuestObjectiveKeys: string[]
    regionCharacterRequirementKeys: string[]
    coveredRegionCharacterRequirementKeys: string[]
    regionFactionRequirementKeys: string[]
    coveredRegionFactionRequirementKeys: string[]
    locationPlanKeys: string[]
    coveredLocationPlanKeys: string[]
    requirementKindCounts: Partial<Record<TextOpenWorldContentRequirementKindV1, number>>
    unresolvedRequirementKeys: string[]
  }
  governance: {
    everyObjectiveHasRequirement: true
    everyRegionalCatalogNeedCovered: true
    duplicateSemanticsRejected: true
    catalogsOwnDefinitions: true
    questFinalizeOwnsBindings: true
  }
  basisHash: string
  createdAt: number
  contentRequirementManifestHash: string
}

export type TextOpenWorldProgressionSkillDemandKindV1 =
  | 'player-initial'
  | 'level-progression'
  | 'quest-requirement'

/**
 * P8 progression/skill catalog candidate. Stable definitions and balance
 * numbers are frozen here; Action/Effect/Condition and quest unlock bindings
 * remain explicitly unresolved until P8F.
 */
export interface TextOpenWorldProgressionCatalogsV1 {
  schema: 'storyforge.text-open-world-progression-catalogs'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameplayRulesetHash: string
  playerBuildHash: string
  questSkeletonsHash: string
  contentRequirementManifestHash: string
  rules: {
    maximumLevel: 20
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
    formulas: TextOpenWorldGameplayRulesetSkeletonV1['progression']['formulas']
  }
  levels: Array<{
    level: number
    cumulativeExperience: number
    attributeGrowth: { power: number; vitality: number; agility: number }
    unlockedSkillKeys: string[]
  }>
  skills: Array<{
    key: string
    order: number
    sourceDemandKey: string
    demandKind: TextOpenWorldProgressionSkillDemandKindV1
    title: string
    description: string
    tags: string[]
    activation: 'active' | 'passive'
    kind: 'attack' | 'status' | 'resource' | 'recovery'
    target: 'self' | 'single-enemy' | 'all-enemies'
    scalingAttribute: 'power' | 'vitality' | 'agility' | null
    unlockPlan:
      | { kind: 'initial'; level: null; requirementKey: null }
      | { kind: 'level'; level: number; requirementKey: null }
      | { kind: 'quest-requirement'; level: null; requirementKey: string }
    priority: number
    resourceCost: number
    cooldownTurns: number
    combatResolutionPlan: {
      required: boolean
      powerNumerator: number | null
      powerDenominator: number | null
      flatDamage: number | null
    }
    fulfilledRequirementKeys: string[]
    runtimeBinding: {
      status: 'runtime-unbound'
      useConditionKeys: []
      effectKeys: []
      actionKey: null
      unlockQuestKey: null
    }
  }>
  statuses: Array<{
    key: string
    order: number
    title: string
    description: string
    polarity: 'beneficial' | 'harmful' | 'neutral'
  }>
  coverage: {
    requiredPlayerSkillKeys: string[]
    coveredPlayerSkillKeys: string[]
    requiredSkillRequirementKeys: string[]
    coveredSkillRequirementKeys: string[]
    acceptanceLevelRange: { minimum: 1; maximum: 5 }
    acceptanceRangeUnlockSkillKeys: string[]
    fullLevelCount: 20
    uncoveredDemandKeys: []
  }
  governance: {
    professionSystem: 'none'
    attributeGrowthOwner: 'deterministic-compiler'
    experienceCurveOwner: 'deterministic-compiler'
    skillSemanticsOwner: 'model-validated'
    actionEffectBindingOwner: 'p8f.quest-finalize'
    allRuntimeBindingsUnbound: true
    progressionModuleReady: false
  }
  basisHash: string
  createdAt: number
  progressionCatalogsHash: string
}

export interface TextOpenWorldEnemyEncounterCatalogV1 {
  schema: 'storyforge.text-open-world-enemy-encounter-catalog'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameplayRulesetHash: string
  playerBuildHash: string
  regionNarrativePacksHash: string
  questSkeletonsHash: string
  contentRequirementManifestHash: string
  progressionCatalogsHash: string
  rules: TextOpenWorldGameplayRulesetSkeletonV1['combat']
  playerSkillResolutions: Array<{
    skillKey: string
    powerNumerator: number
    powerDenominator: number
    flatDamage: number
  }>
  strategyProfiles: Array<{
    key: string
    title: string
    selection: 'ordered-skill-priority'
    prioritySkillKeys: string[]
    fallbackSkillKey: string
  }>
  enemies: Array<{
    key: string
    order: number
    familyKey: string
    sourceDemandKey: string
    title: string
    description: string
    tags: string[]
    regionKey: string
    homeLocationKey: string
    level: number
    maximumHealth: number
    attack: number
    defense: number
    criticalChance: number
    initiative: number
    skillKeys: string[]
    strategyProfileKey: string
    fulfilledRequirementKeys: string[]
    sourceRefs: string[]
    runtimeBinding: {
      status: 'runtime-partial'
      dropTableKey: null
      dropRequirementKey: string
      presentationRefs: []
    }
  }>
  encounters: Array<{
    key: string
    order: number
    sourceDemandKey: string
    title: string
    description: string
    regionKey: string
    locationKey: string
    questObjectiveKeys: string[]
    enemyGroups: Array<{ key: string; enemyKey: string; count: number; order: number }>
    recommendedLevel: number
    levelBand: { minimum: number; maximum: number }
    difficultyProfileKey: 'standard'
    intensity: 'ordinary' | 'dangerous' | 'boss'
    escapePolicy: { allowed: true; failureConsumesTurn: true }
    defeatPolicy: { kind: 'retry-or-respawn'; preservesWorldProgress: true }
    openingText: string
    victoryText: string
    defeatText: string
    fulfilledRequirementKeys: string[]
    sourceRefs: string[]
    runtimeBinding: {
      status: 'runtime-unbound'
      questKeys: []
      rewardContractKey: null
      rewardRequirementKey: string
      presentationRefs: []
    }
  }>
  coverage: {
    requiredEnemyRequirementKeys: string[]
    coveredEnemyRequirementKeys: string[]
    requiredEncounterRequirementKeys: string[]
    coveredEncounterRequirementKeys: string[]
    combatObjectiveKeys: string[]
    coveredCombatObjectiveKeys: string[]
    requiredRegionKeys: string[]
    coveredRegionKeys: string[]
    uncoveredDemandKeys: []
  }
  governance: {
    statOwner: 'deterministic-compiler'
    semanticOwner: 'model-validated'
    standardDifficultyOnly: true
    friendlyNpcCombatants: false
    elementsDisabled: true
    everyCombatObjectiveCovered: true
    rewardsAndDropsDeferred: true
    encounterModuleReady: false
  }
  basisHash: string
  createdAt: number
  enemyEncounterCatalogHash: string
}

export interface TextOpenWorldItemRewardCatalogV1 {
  schema: 'storyforge.text-open-world-item-reward-catalog'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameplayRulesetHash: string
  playerBuildHash: string
  questSkeletonsHash: string
  contentRequirementManifestHash: string
  progressionCatalogsHash: string
  enemyEncounterCatalogHash: string
  equipmentSlots: TextOpenWorldGameplayRulesetSkeletonV1['inventory']['equipmentSlots']
  items: Array<{
    key: string
    order: number
    sourceDemandKey: string
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
    equipmentSlotKey: 'weapon' | 'armor' | 'accessory' | null
    statModifiers: Partial<Record<'maximumHealth' | 'attack' | 'defense' | 'criticalChance' | 'initiative' | 'skillPower' | 'skillResource', number>>
    fulfilledRequirementKeys: string[]
    sourceRefs: string[]
    runtimeBinding: {
      status: 'runtime-unbound'
      useActionKey: null
      equipActionKey: null
      unequipActionKey: null
      equipConditionKeys: []
      effectKeys: []
      presentationRefs: []
    }
  }>
  rewardContracts: Array<{
    key: string
    order: number
    sourceDemandKey: string
    title: string
    description: string
    sourceKind: 'quest' | 'combat'
    sourceSemanticKey: string
    expectedMinutes: number
    budgetClass: 'minor' | 'standard' | 'major'
    grants: {
      experience: number
      currency: number
      items: Array<{ itemKey: string; quantity: number }>
      skillKeys: string[]
    }
    fulfilledRequirementKeys: string[]
    runtimeBinding: {
      status: 'runtime-unbound'
      conditionKeys: []
      effectKeys: []
      dropTableKeys: string[]
      sourceQuestKey: null
      sourceEncounterKey: string | null
    }
  }>
  dropTables: Array<{
    key: string
    order: number
    sourceEnemyKey: string
    algorithm: 'weighted-item-then-quantity-v1'
    rolls: 1
    entries: Array<{
      itemKey: string
      minimum: number
      maximum: number
      weight: number
      uniquePolicy: 'reject'
      quantityEffectBindings: Array<{ quantity: number; effectKey: null }>
    }>
    runtimeBinding: { status: 'effect-unbound'; conditionKeys: [] }
  }>
  coverage: {
    requiredPlayerItemKeys: string[]
    coveredPlayerItemKeys: string[]
    requiredItemRequirementKeys: string[]
    coveredItemRequirementKeys: string[]
    requiredRewardRequirementKeys: string[]
    coveredRewardRequirementKeys: string[]
    questKeys: string[]
    rewardedQuestKeys: string[]
    encounterKeys: string[]
    rewardedEncounterKeys: string[]
    enemyKeys: string[]
    enemyKeysWithDropSource: string[]
    mainlineExperienceTotal: number
    mainlineTargetExperience: number
    uncoveredDemandKeys: []
  }
  governance: {
    rewardBudgetOwner: 'deterministic-compiler'
    itemSemanticsOwner: 'model-validated'
    singleCurrency: true
    noAffixesEnhancementDurability: true
    everyItemHasSourcePlan: true
    everyQuestAndEncounterRewarded: true
    allRuntimeBindingsUnbound: true
    itemModuleReady: false
  }
  basisHash: string
  createdAt: number
  itemRewardCatalogHash: string
}

export const TEXT_OPEN_WORLD_PRODUCTION_STAGES_V1 = [
  'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P8F', 'P9', 'P10',
  'V1', 'V2', 'V3', 'QA',
] as const

export type TextOpenWorldProductionStageV1 =
  (typeof TEXT_OPEN_WORLD_PRODUCTION_STAGES_V1)[number]

export interface TextOpenWorldProductionArtifactDefinitionV1 {
  artifactKey: TextOpenWorldProductionArtifactKindV1
  kind: TextOpenWorldProductionArtifactKindV1
  schema: `storyforge.${string}`
  version: 1
  ownerTaskKey: string
}

export interface TextOpenWorldProductionStalePolicyV1 {
  watches: Array<
    | 'sourcePinHash'
    | 'briefHash'
    | 'planHash'
    | 'controlEpoch'
    | 'inputArtifactHashes'
  >
  propagation: 'transitive-downstream'
  onChange: 'pause-for-author'
  staleCandidatePolicy: 'view-only-rebuild-required'
}

export interface TextOpenWorldProductionRetryPolicyV1 {
  maxAttempts: number
  retryableFailures: Array<'transport' | 'rate-limit' | 'protocol' | 'schema-repair'>
  nonRetryableFailures: Array<'authorization' | 'insufficient-balance' | 'stale' | 'unknown-result'>
  repairMode: 'none' | 'bounded-local-repair'
}

export interface TextOpenWorldProductionCompletionPolicyV1 {
  requiresAcceptedOutputs: true
  requiredGateIds: string[]
  terminalEvidence: 'task-receipt'
}

/**
 * Product-specific blueprint consumed by the shared production scheduler.
 * Actual Run ids, hashes, scope, Skill snapshots and provider bindings are
 * frozen by the shared AgentRun contract at execution time.
 */
export interface TextOpenWorldProductionTaskContractV1 {
  stage: TextOpenWorldProductionStageV1
  taskKey: string
  objective: string
  lane: ProductProductionTaskLaneV1
  executionMode: ProductProductionTaskExecutionModeV1
  skillId: string | null
  dependsOn: string[]
  inputArtifactKeys: TextOpenWorldProductionArtifactKindV1[]
  outputArtifactKeys: TextOpenWorldProductionArtifactKindV1[]
  contextSourceKeys: Array<
    | 'product-production.brief'
    | 'product-production.artifact-inputs'
    | 'product-production.quality-feedback'
  >
  writeTarget: {
    table: 'productBuildArtifacts'
    fields: Array<'payloadJson' | 'metadataJson' | 'qualityJson'>
    adoptionExtension: 'product-production-artifacts'
  }
  budgetClass: 'deterministic' | 'model'
  /** Recommended total provider calls across initial execution and repairs. */
  recommendedModelCalls: number
  retryPolicy: TextOpenWorldProductionRetryPolicyV1
  stalePolicy: TextOpenWorldProductionStalePolicyV1
  failurePolicy: 'fail-build' | 'pause'
  timeoutMs: number
  completion: TextOpenWorldProductionCompletionPolicyV1
}

export interface TextOpenWorldProductionRunContractBlueprintV1 {
  version: 1
  productOwner: 'text-open-world'
  workflowKind: 'long-running-resumable'
  activation: 'contract-only-until-skills-and-executors-registered'
  scopeBindings: Array<'projectId' | 'worldId' | 'workId' | 'productionId' | 'buildId'>
  lineageBindings: Array<'sourceReleaseId' | 'sourceHash' | 'briefHash' | 'planHash' | 'controlEpoch'>
  artifactAcceptance: 'candidate-then-accepted-by-shared-artifact-store'
  tasks: TextOpenWorldProductionTaskContractV1[]
  terminalTaskKey: 'qa.release'
}

export interface TextOpenWorldProductionPlanBudgetV1 {
  deterministic: ProductTaskBudgetReservationV1
  model: ProductTaskBudgetReservationV1
}

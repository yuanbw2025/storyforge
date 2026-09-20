import type {
  ProductProductionTaskExecutionModeV1,
  ProductProductionTaskLaneV1,
  ProductTaskBudgetReservationV1,
} from './product-production'
import type { AdaptationSourceSelectionV1 } from './adaptation'
import type { OutlineNodeType } from './outline'
import type {
  WorldReferenceV1,
  WorldRequirementResolutionV1,
} from './world-product-contracts'
import type { WorldCapabilityArea } from '../registry/types'
import type { TextOpenWorldActionDefinitionV1 } from './text-open-world-action'
import type { TextOpenWorldConditionDefinitionV1 } from './text-open-world-condition'
import type { TextOpenWorldEffectDefinitionV1, TextOpenWorldEffectOperationV1 } from './text-open-world-effect'
import type { TextOpenWorldRuntimeModuleKeyV1 } from './text-open-world-runtime'
import type { WorkspaceScope } from './world-ownership'
import type { AIProvider } from './ai'

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

export type TextOpenWorldCreatorSourceReadinessV1 =
  | 'ready'
  | 'ready-with-gaps'
  | 'blocked'

export type TextOpenWorldCreatorSourceGapSeverityV1 =
  | 'blocking'
  | 'warning'
  | 'recommendation'

/** Author-facing preflight evidence. It never carries source text or a
 * physical WorldRelease manifest. */
export interface TextOpenWorldCreatorSourceGapV1 {
  code: string
  severity: TextOpenWorldCreatorSourceGapSeverityV1
  title: string
  detail: string
  requirementKey: string | null
}

export interface TextOpenWorldCreatorWorldResourceCountsV1 {
  totalResources: number
  totalRows: number
  byArea: Array<{
    area: WorldCapabilityArea
    resourceCount: number
    rowCount: number
  }>
  byKind: Array<{
    resourceKind: string
    resourceCount: number
    rowCount: number
  }>
}

/** Product-facing capability projection returned by the neutral Context
 * Gateway. It intentionally does not depend on the physical WorldRelease
 * manifest contract. */
export interface TextOpenWorldCreatorWorldCapabilityV1 {
  area: WorldCapabilityArea
  resourceCount: number
  rowCount: number
  status: 'missing' | 'partial' | 'available'
  selectionStatus: 'selected' | 'partial-selection' | 'omitted'
  selectedResourceCount: number
  omittedResourceCount: number
  confirmedRowCount: number
  candidateRowCount: number
  conflictRowCount: number
  omittedRowCount: number
  latestRevision: number | null
  originalEvidenceAvailable: boolean
  queryableIndexAvailable: boolean
}

/** A verified, immutable world candidate available before product creation. */
export interface TextOpenWorldCreatorWorldSourceCandidateV1 {
  schema: 'storyforge.text-open-world-creator-world-source-candidate'
  version: 1
  sourceKind: 'world-release'
  worldReference: WorldReferenceV1
  label: string
  worldName: string
  workTitle: string
  releasedAt: number
  capabilities: TextOpenWorldCreatorWorldCapabilityV1[]
  resourceCounts: TextOpenWorldCreatorWorldResourceCountsV1
  requirements: WorldRequirementResolutionV1[]
  readiness: TextOpenWorldCreatorSourceReadinessV1
  gaps: TextOpenWorldCreatorSourceGapV1[]
}

export interface TextOpenWorldCreatorNovelOutlineOptionV1 {
  id: number
  parentId: number | null
  type: OutlineNodeType
  title: string
  order: number
}

export interface TextOpenWorldCreatorNovelChapterOptionV1 {
  id: number
  outlineNodeId: number
  title: string
  order: number
  wordCount: number
  hasContent: boolean
}

export interface TextOpenWorldNovelSourceSnapshotPreviewV1 {
  schema: 'storyforge.text-open-world-novel-source-snapshot-preview'
  version: 1
  sourceKind: 'novel'
  workCode: string
  workTitle: string
  sourceUpdatedAt: number
  sourceVersionHash: string
  sourceBoundaryHash: string
  coverage: 'full-text' | 'outline-only'
  selection: {
    mode: AdaptationSourceSelectionV1['mode']
    label: string
    selectedChapterCount: number
    selectedOutlineCount: number
  }
  outlines: TextOpenWorldCreatorNovelOutlineOptionV1[]
  chapters: TextOpenWorldCreatorNovelChapterOptionV1[]
  storyCoreCount: number
  writtenChapterCount: number
  totalWordCount: number
  sourceUnitCount: number
}

/** Read-only catalog for choosing an adaptation-style novel range. */
export interface TextOpenWorldCreatorNovelSourceCatalogV1 {
  schema: 'storyforge.text-open-world-creator-novel-source-catalog'
  version: 1
  sourceKind: 'novel'
  workCode: string
  workTitle: string
  sourceUpdatedAt: number
  coverage: 'full-text' | 'outline-only'
  outlines: TextOpenWorldCreatorNovelOutlineOptionV1[]
  chapters: TextOpenWorldCreatorNovelChapterOptionV1[]
  range: {
    firstChapterId: number | null
    lastChapterId: number | null
    outlineCount: number
    chapterCount: number
  }
  totalWordCount: number
  readiness: TextOpenWorldCreatorSourceReadinessV1
  gaps: TextOpenWorldCreatorSourceGapV1[]
}

export interface TextOpenWorldCreatorNovelSourcePreviewV1
  extends TextOpenWorldNovelSourceSnapshotPreviewV1 {
  readiness: TextOpenWorldCreatorSourceReadinessV1
  gaps: TextOpenWorldCreatorSourceGapV1[]
}

export type TextOpenWorldCreatorSourcePreviewV1 =
  | TextOpenWorldCreatorWorldSourceCandidateV1
  | TextOpenWorldCreatorNovelSourcePreviewV1

/** Local creator selection. `sourceScope` and numeric locators are deliberately
 * excluded from the confirmed Brief hash; they are only used to re-open and
 * compare-and-swap the exact source inside the current workspace. */
export type TextOpenWorldCreatorSourceSelectionV1 =
  | {
      sourceKind: 'world-release'
      sourceScope: WorkspaceScope
      localReleaseRecordId: number
      expectedReleaseHash: string
      preview: TextOpenWorldCreatorWorldSourceCandidateV1
    }
  | {
      sourceKind: 'novel'
      sourceScope: WorkspaceScope
      selection: AdaptationSourceSelectionV1
      preview: TextOpenWorldCreatorNovelSourcePreviewV1
    }

/** Local, remappable locator persisted beside the portable creator Brief.
 * Numeric ids never enter the Brief hash. */
export type TextOpenWorldCreatorSourceLocatorV1 =
  | {
      kind: 'world-release'
      localReleaseRecordId: number
      expectedReleaseHash: string
    }
  | {
      kind: 'novel'
      sourceWorkId: number
      selection: AdaptationSourceSelectionV1
      expectedSourceVersionHash: string
      expectedSourceBoundaryHash: string
    }

/** Portable identity copied from the G5-01 candidate. It contains no source
 * text, physical WorldRelease manifest, API credential, or local database id. */
export type TextOpenWorldCreatorSourceBindingV1 =
  | {
      kind: 'world-release'
      worldCode: string
      releaseUid: string
      releaseVersion: number
      releaseHash: string
      referenceHash: string
      manifestSchemaHash: string
      capabilityCatalogHash: string
      capabilityProfileHash: string
    }
  | {
      kind: 'novel'
      workCode: string
      sourceVersionHash: string
      sourceBoundaryHash: string
      coverage: 'full-text' | 'outline-only'
      selectionMode: AdaptationSourceSelectionV1['mode']
      selectedChapterCount: number
      selectedOutlineCount: number
    }

/** Source metadata visible to the consultation model. It is intentionally a
 * bounded projection and never substitutes for P0/P1 source freezing/reading. */
export interface TextOpenWorldCreatorSourceSummaryV1 {
  label: string
  sourceKind: TextOpenWorldSourceKindV1
  coverage: 'world-release-catalog' | 'full-text' | 'outline-only'
  resourceCount: number
  rowOrWordCount: number
  capabilityAreas: string[]
  gaps: Array<{
    code: string
    severity: TextOpenWorldCreatorSourceGapSeverityV1
    title: string
  }>
}

export interface TextOpenWorldCreatorScaleV1 {
  regions: number
  namedLocations: { minimum: number; maximum: number }
  mainlineStages: { minimum: number; maximum: number }
  endings: number
  significantStorylines: number
  ordinaryQuests: { minimum: number; maximum: number }
  taskTemplates: { minimum: number; maximum: number }
  randomEvents: { minimum: number; maximum: number }
  requiredPlayMinutes: { minimum: number; maximum: number }
  optionalInventoryMinutes: { minimum: number; maximum: number }
}

export interface TextOpenWorldCreatorMediaIntentV1 {
  proceduralMap: 'required'
  characterPortraits: 'required'
  sceneBackgrounds: 'required'
  audio: 'none' | 'optional'
  artDirection: string
}

export interface TextOpenWorldCreatorCompletionIntentV1 {
  playablePreviewRequired: true
  deterministicGatesRequired: true
  semanticReviewRequired: true
  publishAfterGates: true
  humanPlaytest: 'post-release'
  repairPolicy: 'new-release'
}

/** Current product-stage freedoms. These are code-owned capability boundaries,
 * not model suggestions and not author-overridable promises. */
export interface TextOpenWorldCreatorProductBoundaryV1 {
  freedomModel: 'bounded-guided'
  mainlineStructure: 'strict-sequential-with-multiple-endings'
  mainlineWaitsForPlayer: true
  significantStorylinesWaitAtSafePoints: true
  ordinaryWorldContinues: true
  criticalActorsProtected: true
  criticalItemsProtected: true
  freeTextPolicy: 'respond-then-redirect-or-reject'
  unsupportedSolutionPolicy: 'declared-actions-only'
  combatMode: 'turn-based-four-actions'
  difficulty: 'standard'
  locationOnlyCriticalTriggersForbidden: true
}

export interface TextOpenWorldCreatorBriefDraftV1 {
  schema: 'storyforge.text-open-world-creator-brief-draft'
  version: 1
  gameTitle: string
  playerRole: string
  playerFantasy: string
  protagonistMode: 'source-character' | 'author-defined'
  protagonistDirective: string
  coreGoal: string
  primaryConflict: string
  openingSituation: string
  experiencePillars: string[]
  toneKeywords: string[]
  mustKeep: string[]
  allowedInferences: string[]
  forbiddenChanges: string[]
  contentRating: string
  contentBoundaries: string[]
  authorNotes: string
  unresolvedQuestions: string[]
  acceptedAssumptions: string[]
  scale: TextOpenWorldCreatorScaleV1
  media: TextOpenWorldCreatorMediaIntentV1
  completion: TextOpenWorldCreatorCompletionIntentV1
}

export interface TextOpenWorldCreatorBriefSynthesisV1 {
  suggestedTitle: string
  understandingSummary: string
  playerFantasy: string
  experiencePromise: string
  primaryConflict: string
  recommendedOpening: string
  protagonistFit: string
  experiencePillars: string[]
  sourceUsePlan: string[]
  unresolvedQuestions: string[]
  assumptions: string[]
  risks: string[]
}

export interface TextOpenWorldCreatorBriefModelEvidenceV1 {
  provider: string
  model: string
  usageSource: 'provider' | 'estimated'
  inputTokens: number
  outputTokens: number
  totalTokens: number
  latencyMs: number
  estimatedCostUsd: number | null
}

export interface TextOpenWorldCreatorBriefCandidateV1 {
  schema: 'storyforge.text-open-world-creator-brief-candidate'
  version: 1
  origin: 'ai'
  /** Portable runtime binding identity; unlike the full RunContract hash it
   * does not change when a backup rebinds local project/record ids. */
  runBindingHash: string
  sourceBindingHash: string
  draftHash: string
  contextManifestHashes: string[]
  synthesis: TextOpenWorldCreatorBriefSynthesisV1
  modelCalls: TextOpenWorldCreatorBriefModelEvidenceV1[]
  repairApplied: boolean
  candidateHash: string
}

export interface TextOpenWorldCreatorBriefConfirmationV1 {
  sourceIdentityReviewed: true
  productBoundaryReviewed: true
  unresolvedItemsClosed: true
  directPublishWorkflowReviewed: true
}

/** Author-confirmed G5-02 terminal fact. It is still a creator-process record;
 * G5-04 must promote it into ProductProduction rather than re-infer it. */
export interface TextOpenWorldCreatorBriefV1 {
  schema: 'storyforge.text-open-world-creator-brief'
  version: 1
  productInstanceKey: string
  revision: number
  sourceBinding: TextOpenWorldCreatorSourceBindingV1
  sourceBindingHash: string
  sourceSummary: TextOpenWorldCreatorSourceSummaryV1
  draft: TextOpenWorldCreatorBriefDraftV1
  productBoundary: TextOpenWorldCreatorProductBoundaryV1
  confirmation: TextOpenWorldCreatorBriefConfirmationV1
  candidateEvidence: {
    candidateHash: string
    runBindingHash: string
    origin: 'ai' | 'author'
    contextManifestHashes: string[]
  }
  confirmedAt: number
  briefHash: string
}

export type TextOpenWorldCreatorCredentialModeV1 =
  | 'session'
  | 'remembered-browser'
  | 'local-no-key'
  | 'missing'

/**
 * Non-secret model binding shown before production. API keys and full request
 * URLs are deliberately absent; G5-04 may freeze this value but must resolve
 * the credential again at execution time.
 */
export interface TextOpenWorldCreatorProviderBindingV1 {
  schema: 'storyforge.text-open-world-creator-provider-binding'
  version: 1
  provider: AIProvider
  model: string
  /** Safe display value only; request paths are never exposed here. */
  endpointOrigin: string
  /** Hash of the normalized origin + base path, excluding userinfo/query/fragment. */
  endpointRouteHash: string
  /** True only when the resolved route exactly matches this provider's registered commercial endpoint. */
  catalogPricingEligible: boolean
  credentialMode: TextOpenWorldCreatorCredentialModeV1
  credentialPresent: boolean
  credentialReady: boolean
  temperature: number
  maxTokens: number
  contextWindow: number | null
  bindingHash: string
}

export type TextOpenWorldCreatorPriceQuoteSourceV1 =
  | 'storyforge-catalog'
  | 'author-provided'
  | 'author-confirmed-local-zero'

/** One author-reviewable USD text-token price snapshot. */
export interface TextOpenWorldCreatorPriceQuoteV1 {
  schema: 'storyforge.text-open-world-creator-price-quote'
  version: 1
  provider: AIProvider
  model: string
  source: TextOpenWorldCreatorPriceQuoteSourceV1
  sourceLabel: string
  catalogVersion: string | null
  asOf: string
  currency: 'USD'
  inputUsdPerMillionTokens: number
  outputUsdPerMillionTokens: number
  quoteHash: string
}

export interface TextOpenWorldCreatorProductionEstimateV1 {
  schema: 'storyforge.text-open-world-creator-production-estimate'
  version: 1
  recommendedModelCalls: number
  maximumModelCalls: number
  reservedInputTokens: number
  reservedOutputTokens: number
  estimatedTextCostUsd: number | null
  maximumCostUsd: number
  maximumDurationMs: number
  maximumStorageBytes: number
  mediaCostPolicy: 'deferred-until-media-plan'
  estimateHash: string
}

/**
 * Ephemeral G5-03 readiness snapshot. It creates no Build, SourcePlan or DB
 * record; G5-04 must CAS the confirmed Brief and freeze an equivalent snapshot
 * atomically when production is authorized.
 */
export interface TextOpenWorldCreatorProductionPreflightV1 {
  schema: 'storyforge.text-open-world-creator-production-preflight'
  version: 1
  productInstanceKey: string
  briefHash: string
  sourceBindingHash: string
  providerBinding: TextOpenWorldCreatorProviderBindingV1
  priceQuote: TextOpenWorldCreatorPriceQuoteV1 | null
  estimate: TextOpenWorldCreatorProductionEstimateV1
  blockers: string[]
  warnings: string[]
  ready: boolean
  preflightHash: string
}

export interface TextOpenWorldCreatorProductionPreflightConfirmationV1 {
  schema: 'storyforge.text-open-world-creator-production-preflight-confirmation'
  version: 1
  productInstanceKey: string
  briefHash: string
  providerBindingHash: string
  priceQuoteHash: string
  estimateHash: string
  acknowledgement: {
    credentialPolicyReviewed: true
    providerAndModelReviewed: true
    priceAndBudgetReviewed: true
    mediaCostBoundaryReviewed: true
  }
  confirmedAt: number
  confirmationHash: string
}

/**
 * Portable, product-owned source plan frozen when the author starts a Build.
 * Local row ids stay in ProductProduction/Brief locator columns and are never
 * copied into this hash. P0 must compare those local locators against this
 * immutable identity before it writes the first SourcePin Artifact.
 */
export interface TextOpenWorldCreatorProductionSourcePlanV1 {
  schema: 'storyforge.text-open-world-creator-production-source-plan'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  sourceKind: TextOpenWorldSourceKindV1
  sourceBinding: TextOpenWorldCreatorSourceBindingV1
  sourceBindingHash: string
  sourceVersionHash: string
  /** Exact author-visible source and descriptor boundary for both source kinds. */
  expectedSourceBoundaryHash: string
  selection:
    | {
        kind: 'world-release'
        mode: 'entire-release'
        resourceKeys: string[]
      }
    | {
        kind: 'novel'
        mode: AdaptationSourceSelectionV1['mode']
        sourceUnitCount: number
        selectedChapterCount: number
        selectedOutlineCount: number
      }
  /** Concrete Artifact keys owned by P0 and consumed by P1. */
  sourceUnitArtifactKeys: string[]
  createdAt: number
  planHash: string
}

/** One durable author authorization boundary for a Creator Brief Build. */
export interface TextOpenWorldCreatorProductionStartV1 {
  schema: 'storyforge.text-open-world-creator-production-start'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  briefRevision: number
  briefHash: string
  sourceBindingHash: string
  sourcePlanHash: string
  /** Exact G5-03 facts, frozen before a Build exists. */
  preflight: TextOpenWorldCreatorProductionPreflightV1
  confirmation: TextOpenWorldCreatorProductionPreflightConfirmationV1
  /** Scheduler compatibility projection only. The Creator Brief above remains
   * the authoring authority and this projection may not replace it. */
  executionBrief: import('./product-production').ProductProductionBriefV3
  executionBriefHash: string
  /** Epoch of the exact plan authorized by the author. Later scheduler plans
   * may only rebind this one field while retaining the frozen plan body. */
  productionPlanControlEpoch: number
  productionPlanHash: string
  authorStartRevision: number
  authorizationNonceHash: string
  rightsBasis: TextOpenWorldSourceRightsBasisV1
  rightsNote: string
  authorizedAt: number
  startHash: string
}

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
  sourceArea: WorldCapabilityArea | null
  sourceResourceKind: string | null
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

/** Portable author confirmation for the single irreversible publication
 * boundary. The raw nonce is never persisted; every reviewed Build/source/
 * quality coordinate is part of `authorizationHash`. */
export interface TextOpenWorldCreatorReleaseAuthorizationV1 {
  schema: 'storyforge.text-open-world-creator-release-authorization'
  version: 1
  productInstanceKey: string
  buildNumber: number
  adoptionIntentHash: string
  buildManifestHash: string
  runtimePackageHash: string
  releaseQualityReceiptHash: string
  releaseLabel: string
  acknowledgement: {
    sourceAndRightsReviewed: true
    buildAndQualityReviewed: true
    immutableReleaseReviewed: true
    publishNow: true
  }
  authorizationNonceHash: string
  authorizedAt: number
  authorizationHash: string
}

export interface TextOpenWorldCreatorReleaseArtifactReceiptV1 {
  artifactKey: string
  version: number
  contentHash: string
  producerReceiptHash: string | null
}

/** Product-specific stage-three source and assembly evidence. It deliberately
 * contains no local row ids and no novel source body. SourcePin unit hashes and
 * the sealed Build receipt set prove that private source copy without exposing
 * it in a player/distribution manifest. */
export interface TextOpenWorldCreatorReleaseSourceContractsV1 {
  schema: 'storyforge.text-open-world-creator-release-source-contracts'
  version: 1
  productType: 'text-open-world'
  creatorBrief: TextOpenWorldCreatorBriefV1
  sourcePlan: TextOpenWorldCreatorProductionSourcePlanV1
  creatorStart: TextOpenWorldCreatorProductionStartV1
  sourcePin: TextOpenWorldSourcePinV1
  sourceManifest: TextOpenWorldSourceManifestV1
  artifactReceipts: TextOpenWorldCreatorReleaseArtifactReceiptV1[]
  artifactSetHash: string
  integrationReport: TextOpenWorldIntegrationReportV1
  governanceSnapshotHash: string
  releaseQuality: {
    gateId: 'text-open-world.creator.release-quality'
    status: 'passed'
    receiptHash: string
    evidence: import('../open-world/creator-quality-contract').TextOpenWorldCreatorReleaseQualityEvidenceV1
    createdAt: number
  }
  releaseAuthorization: TextOpenWorldCreatorReleaseAuthorizationV1
  contractHash: string
}

/** Creator releases use a neutral source lineage instead of fabricating a
 * WorldReference for novel sources. Common release identity/build/quality
 * fields stay compatible with the shared ProductRelease reader. */
export interface TextOpenWorldCreatorReleaseLineageV1 {
  schema: 'storyforge.text-open-world-creator-release-lineage'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  releaseUid: string
  releaseVersion: number
  releaseHash: string
  parentRelease: null | { releaseUid: string; releaseHash: string }
  sourceKind: TextOpenWorldSourceKindV1
  sourceBindingHash: string
  sourcePlanHash: string
  sourcePinHash: string
  sourceManifestHash: string
  creatorBriefHash: string
  creatorStartHash: string
  build: { buildUid: string; buildHash: string }
  quality: { passed: true; receiptHashes: string[] }
  governanceSnapshotHash: string
  releaseAuthorizationHash: string
  compatibility: {
    status: 'initial' | 'compatible' | 'requires-migration' | 'incompatible'
    protocolVersion: number
    evidenceHashes: string[]
  }
  createdAt: number
  lineageHash: string
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
  qualityProfile: 'prototype' | 'internal' | 'commercial-candidate'
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
    imageCount: number
    musicTrackCount: number
    sfxCount: number
    voiceLineCount: number
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
    initialKnowledge: 'unknown' | 'heard' | 'visited'
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
    initialKnowledge: 'unknown' | 'heard' | 'visited'
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
      /**
       * Added by the governed Knowledge production contract. Historical P7
       * artifacts omit these fields and are only accepted through the legacy
       * downstream path; fresh default-model output supplies them explicitly.
       */
      truthSummary?: string
      reliability?: 'uncertain' | 'likely' | 'confirmed'
      subjectKind?: 'location' | 'actor' | 'faction' | 'lore' | 'quest-clue'
      subjectSourceKey?: string | null
      minimumRevealGate?: {
        kind: 'regional-public' | 'mainline-stage-complete' | 'significant-stage-complete'
        stageKey: string | null
      }
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
    /** Missing on historical P8 artifacts that can only assemble v15/v16. */
    structuredCombatSemanticsReady?: true
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

export type TextOpenWorldCraftingEconomyDemandKindV1 =
  | 'content-requirement'
  | 'region-baseline'

/**
 * P8 recipe/store catalog candidate. The model selects world-grounded item and
 * location semantics from bounded candidates; code owns quantities, prices,
 * stock policy, source/sink closure and every runtime binding slot.
 */
export interface TextOpenWorldCraftingEconomyCatalogV1 {
  schema: 'storyforge.text-open-world-crafting-economy-catalog'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameplayRulesetHash: string
  regionNarrativePacksHash: string
  questSkeletonsHash: string
  contentRequirementManifestHash: string
  itemRewardCatalogHash: string
  currency: TextOpenWorldGameplayRulesetSkeletonV1['economy']['currency']
  craftingRules: TextOpenWorldGameplayRulesetSkeletonV1['crafting']
  economyRules: TextOpenWorldGameplayRulesetSkeletonV1['economy']
  recipes: Array<{
    key: string
    order: number
    sourceDemandKey: string
    demandKind: TextOpenWorldCraftingEconomyDemandKindV1
    title: string
    description: string
    category: 'consumable' | 'equipment' | 'tool' | 'material'
    learnedByDefault: boolean
    regionKey: string
    stationLocationKeys: string[]
    ingredients: Array<{ itemKey: string; quantity: number }>
    outputs: Array<{ itemKey: string; quantity: number }>
    timeCostMinutes: number
    fulfilledRequirementKeys: string[]
    runtimeBinding: {
      status: 'runtime-unbound'
      requirementConditionKeys: []
      craftActionKey: null
      learnActionKey: null
      learnQuestKey: null
      consumeEffectKeys: []
      outputEffectKeys: []
      presentationRefs: []
    }
  }>
  vendors: Array<{
    key: string
    order: number
    sourceDemandKey: string
    demandKind: TextOpenWorldCraftingEconomyDemandKindV1
    title: string
    description: string
    regionKey: string
    locationKey: string
    buyPriceMultiplierBasisPoints: number
    sellPriceMultiplierBasisPoints: number
    buyCategories: Array<'equipment' | 'consumable' | 'material' | 'misc'>
    sellCategories: Array<'equipment' | 'consumable' | 'material' | 'misc'>
    inventoryEntries: Array<{
      itemKey: string
      stockPolicy: 'unlimited' | 'limited'
      initialQuantity: number | null
    }>
    fulfilledRequirementKeys: string[]
    runtimeBinding: {
      status: 'runtime-unbound'
      actorKey: null
      actorRequirementKey: string
      factionKey: null
      availabilityConditionKeys: []
      buyActionKey: null
      sellActionKey: null
    }
  }>
  itemFlows: Array<{
    itemKey: string
    sourceKinds: Array<'initial' | 'reward' | 'drop' | 'craft' | 'vendor'>
    sinkKinds: Array<'consume' | 'equip' | 'quest' | 'craft' | 'vendor-sale'>
  }>
  coverage: {
    requiredRecipeRequirementKeys: string[]
    coveredRecipeRequirementKeys: string[]
    requiredVendorRequirementKeys: string[]
    coveredVendorRequirementKeys: string[]
    requiredRegionKeys: string[]
    regionsWithRecipe: string[]
    regionsWithVendor: string[]
    ingredientItemKeys: string[]
    sourcedIngredientItemKeys: string[]
    outputItemKeys: string[]
    sinkedOutputItemKeys: string[]
    riskFreeArbitrageRecipeKeys: []
    uncoveredDemandKeys: []
  }
  governance: {
    singleCurrency: true
    guaranteedCrafting: true
    recipeKnowledgeRequired: true
    ordinaryStockUnlimited: true
    specialStockLimited: true
    quantityAndPriceOwner: 'deterministic-compiler'
    semanticSelectionOwner: 'model-validated'
    everyIngredientSourced: true
    everyOutputHasSink: true
    noRiskFreeArbitrage: true
    allRuntimeBindingsUnbound: true
    craftingEconomyModulesReady: false
  }
  basisHash: string
  createdAt: number
  craftingEconomyCatalogHash: string
}

export type TextOpenWorldNpcRuntimeDemandKindV1 =
  | 'content-requirement'
  | 'vendor-service'
  | 'service-replacement'

/** P8 actor/faction catalog candidate. Biography and portrayal remain cohesive
 * authored assets; deterministic runtime rules are structured separately. */
export interface TextOpenWorldNpcRuntimeCatalogV1 {
  schema: 'storyforge.text-open-world-npc-runtime-catalog'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameplayRulesetHash: string
  regionNarrativePacksHash: string
  questSkeletonsHash: string
  contentRequirementManifestHash: string
  craftingEconomyCatalogHash: string
  factions: Array<{
    key: string
    order: number
    sourceDemandKey: string
    title: string
    description: string
    publicGoal: string
    moralityMultiplier: -1 | 0 | 1
    fulfilledRequirementKeys: string[]
    sourceRefs: string[]
  }>
  actors: Array<{
    key: string
    order: number
    sourceDemandKey: string
    demandKind: TextOpenWorldNpcRuntimeDemandKindV1
    tier: 'mainline' | 'significant' | 'resident' | 'transient'
    runtimeMode: 'agent-maintained' | 'rule-driven'
    name: string
    biography: string
    portrayal: string
    factionKey: string | null
    homeLocationKey: string
    regionKey: string
    protected: boolean
    mortalityPolicy: 'protected' | 'story-only' | 'mortal' | 'despawn-on-resolution'
    serviceKeys: string[]
    scheduleKey: string | null
    fulfilledRequirementKeys: string[]
    questConsumerKeys: string[]
    sourceRefs: string[]
    runtimeBinding: {
      status: 'runtime-partial'
      dialogueSceneKeys: []
      actionKeys: []
      presentationRefs: []
    }
  }>
  schedules: Array<{
    key: string
    actorKey: string
    entries: Array<{
      timePeriodKey: 'period.dawn' | 'period.day' | 'period.evening' | 'period.night'
      locationKey: string
      activity: string
      availableServiceKeys: string[]
    }>
  }>
  serviceContinuity: Array<{
    key: string
    ownerActorKey: string
    serviceKey: string
    policy: 'replace-on-owner-death' | 'disappear-on-owner-death'
    replacementActorKey: string | null
    replacementServiceKey: string | null
  }>
  relationshipPolicy: {
    morality: { minimum: number; maximum: number; initial: number }
    factionAffinity: { minimum: number; maximum: number; initial: number }
    attitude: {
      badMaximum: number
      goodMinimum: number
      moralityWeight: number
      factionWeight: number
      explicitStoryModifierCap: number
    }
    unaffiliatedMoralityMultiplier: 0
    attitudeBands: Array<{
      attitude: 'bad' | 'neutral' | 'good'
      label: string
      greetingTone: string
      buyPriceMultiplier: number
      sellPriceMultiplier: number
      optionalInteractionPolicy: 'available' | 'may-refuse'
    }>
    crimeScope: 'morality-affinity-prices-local-quests-only'
    storyModifiers: 'p8f-unbound'
  }
  coverage: {
    requiredActorRequirementKeys: string[]
    coveredActorRequirementKeys: string[]
    requiredFactionRequirementKeys: string[]
    coveredFactionRequirementKeys: string[]
    requiredVendorActorReservationKeys: string[]
    coveredVendorActorReservationKeys: string[]
    requiredRegionKeys: string[]
    regionsWithResidentActors: string[]
    protectedQuestActorKeys: string[]
    protectedQuestActorKeysWithProtection: string[]
    functionalMortalActorKeys: string[]
    functionalMortalActorKeysWithReplacement: string[]
    uncoveredDemandKeys: []
  }
  governance: {
    importantActors: 'agent-maintained'
    ordinaryActors: 'rule-driven'
    attitudes: 'bad-neutral-good'
    independentNpcAffinity: false
    importantActorsProtected: true
    ordinaryActorsMayDie: true
    functionalServicesReplaceable: true
    uniqueContentMayDisappear: true
    mainlineCannotBeBlockedByRelationship: true
    dialogueAndActionsDeferred: true
    npcRuntimeModuleReady: false
  }
  basisHash: string
  createdAt: number
  npcRuntimeCatalogHash: string
}

/** P8 spatial/runtime interaction catalog candidate. Topology is copied from
 * RegionSkeleton; the model cannot add map nodes, roads or quest triggers. */
export interface TextOpenWorldMapInteractionCatalogV1 {
  schema: 'storyforge.text-open-world-map-interaction-catalog'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  regionSkeletonHash: string
  regionNarrativePacksHash: string
  questSkeletonsHash: string
  contentRequirementManifestHash: string
  initialRegionKey: string
  initialLocationKey: string
  regions: Array<{
    key: string
    order: number
    title: string
    description: string
    theme: string
    locationKeys: string[]
    fastTravelPointKey: string
    initialKnowledge: 'unknown' | 'heard' | 'visited'
    sourceRefs: string[]
    presentationRefs: []
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
    initialKnowledge: 'unknown' | 'heard' | 'visited'
    interactionKeys: string[]
    sourceRefs: string[]
    presentationRefs: []
  }>
  edges: Array<{
    key: string
    fromLocationKey: string
    toLocationKey: string
    bidirectional: true
    travelMinutes: number
    description: string
    riskProfile: 'safe' | 'ordinary' | 'dangerous'
    sourceRefs: string[]
    runtimeBinding: {
      status: 'runtime-unbound'
      forwardActionKey: null
      reverseActionKey: null
      conditionKeys: []
      effectKeys: []
    }
  }>
  fastTravelPoints: Array<{
    key: string
    regionKey: string
    locationKey: string
    unlockedByDefault: boolean
    unlockPolicy: 'initial' | 'first-visit'
    canRespawn: true
    runtimeBinding: { status: 'runtime-unbound'; unlockEffectKey: null }
  }>
  interactions: Array<{
    key: string
    order: number
    sourceDemandKey: string
    title: string
    description: string
    playerPrompt: string
    kind: 'observe' | 'investigate' | 'explore' | 'service' | 'crafting'
    regionKey: string
    locationKey: string
    requiredFunctions: TextOpenWorldLocationFunctionV1[]
    questConsumerKeys: string[]
    fulfilledRequirementKeys: string[]
    earlyArrivalSafe: true
    startsQuestOnArrival: false
    runtimeBinding: {
      status: 'runtime-unbound'
      actionKey: null
      sceneKey: null
      conditionKeys: []
      effectKeys: []
      questKeys: []
    }
  }>
  mapLayout: {
    version: 1
    coordinateSystem: 'normalized-1000'
    width: 1000
    height: 700
    source: 'deterministic-fallback'
    locationNodes: Array<{ locationKey: string; x: number; y: number }>
  }
  travelPolicy: {
    ordinaryTravelAdvancesWorldTime: true
    ordinaryTravelMayBeInterrupted: false
    fastTravelRequiresVisitedDestination: true
    fastTravelAdvancesWorldTime: true
    travelResourceConsumption: 'none'
  }
  coverage: {
    requiredRegionKeys: string[]
    coveredRegionKeys: string[]
    requiredLocationKeys: string[]
    coveredLocationKeys: string[]
    requiredEdgeKeys: string[]
    coveredEdgeKeys: string[]
    requiredFastTravelPointKeys: string[]
    coveredFastTravelPointKeys: string[]
    requiredLocationInteractionRequirementKeys: string[]
    coveredLocationInteractionRequirementKeys: string[]
    protectedQuestKeys: string[]
    protectedQuestKeysWithArrivalSafeInteractions: string[]
    unreachableLocationKeys: []
    uncoveredDemandKeys: []
  }
  governance: {
    completeMapAtBuild: true
    progressiveKnowledge: true
    allLocationsConnected: true
    everyRegionHasFastTravelPoint: true
    arrivalNeverSoleCriticalTrigger: true
    earlyArrivalAlwaysSafe: true
    topologyOwner: 'deterministic-compiler'
    interactionSemanticsOwner: 'model-validated'
    allRuntimeBindingsUnbound: true
    worldAndActionModulesReady: false
  }
  basisHash: string
  createdAt: number
  mapInteractionCatalogHash: string
}

export type TextOpenWorldQuestBindingDefinitionKindV1 =
  | 'actor' | 'faction' | 'enemy' | 'encounter' | 'item' | 'skill'
  | 'recipe' | 'vendor' | 'reward' | 'interaction' | 'action'

/**
 * P8F quest and gameplay binding document. It owns the exact cross-catalog
 * references plus deterministic Action/Condition/Effect definitions. P9 may
 * add scene-facing actions, but must not replace these gameplay results.
 */
export interface TextOpenWorldQuestDesignDocumentsV1 {
  schema: 'storyforge.text-open-world-quest-design-documents'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  mainlineThreadHash: string
  significantThreadsHash: string
  regionNarrativePacksHash: string
  questSkeletonsHash: string
  contentRequirementManifestHash: string
  progressionCatalogsHash: string
  enemyEncounterCatalogHash: string
  itemRewardCatalogHash: string
  craftingEconomyCatalogHash: string
  npcRuntimeCatalogHash: string
  mapInteractionCatalogHash: string
  requirementBindings: Array<{
    requirementKey: string
    kind: TextOpenWorldContentRequirementKindV1
    consumerObjectiveKeys: string[]
    definitionKind: TextOpenWorldQuestBindingDefinitionKindV1
    definitionKeys: string[]
  }>
  quests: Array<{
    key: string
    order: number
    type: 'mainline' | 'significant' | 'ordinary' | 'template'
    ownerKind: 'global' | 'actor' | 'faction' | 'region' | 'location'
    ownerKey: string | null
    title: string
    description: string
    storylineKey: string | null
    regionKeys: string[]
    stageKeys: string[]
    prerequisiteConditionKeys: string[]
    rewardEffectKeys: string[]
    rewardContractKey: string
    claimActionKey: string
    acceptActionKey: string
    abandonActionKey: string | null
    expirationActionKeys: string[]
    lifecyclePolicy: 'protected-wait' | 'abandon-restart' | 'abandon-terminal'
    timePolicy: 'waits' | 'timed'
    expirationMinutes: number | null
    repeatable: boolean
    instantiationPolicy: 'session-start' | 'director'
    initialStatus: 'locked' | 'available' | 'revealed'
    estimatedMinutes: number
    tags: string[]
  }>
  stages: Array<{
    key: string
    questKey: string
    order: number
    title: string
    objectiveKeys: string[]
    completionConditionKeys: string[]
    completionActionKey: string
  }>
  objectives: Array<{
    key: string
    questKey: string
    stageKey: string
    order: number
    title: string
    description: string
    successDescription: string
    optional: boolean
    requirementKeys: string[]
    boundDefinitionKeys: string[]
    supportActionKeys: string[]
    interactionTimeCostMinutes: number
    completionConditionKeys: string[]
    completionActionKey: string
  }>
  conditions: TextOpenWorldConditionDefinitionV1[]
  effects: TextOpenWorldEffectDefinitionV1[]
  actions: TextOpenWorldActionDefinitionV1[]
  /**
   * Fresh P8F builds compile the player-facing Knowledge inventory and every
   * obtainability path here. SourceLedger remains production truth and is not
   * a runtime encyclopedia inventory.
   */
  knowledgeBindings?: Array<{
    order: number
    sourceRumorKey: string
    regionKey: string
    propagationLocationKey: string
    knowledgeKey: string
    kind: 'location' | 'actor' | 'faction' | 'enemy' | 'lore' | 'quest-clue'
    subjectSourceKey: string | null
    subjectDefinitionKey: string | null
    truthSummary: string
    sourceClaimKeys: string[]
    rumorKey: string
    rumorText: string
    reliability: 'uncertain' | 'likely' | 'confirmed'
    minimumRevealGate: {
      kind: 'regional-public' | 'mainline-stage-complete' | 'significant-stage-complete'
      stageKey: string | null
    }
    propagationEventKey: string
    propagationConditionKeys: string[]
    confirmationBindings: Array<{
      order: number
      sourceKind: 'quest-reward-claim' | 'ending-action'
      sourceKey: string
      sourceActionKey: string
      effectOwnerKind: 'reward-contract' | 'action'
      effectOwnerKey: string
      revealEffectKey: string
    }>
  }>
  /** Achievement definitions and their exact one-time Action/Effect owner path. */
  achievementBindings?: Array<{
    order: number
    achievementKey: string
    sourceKind: 'quest-reward-claim' | 'ending-action'
    sourceKey: string
    sourceActionKey: string
    effectOwnerKind: 'reward-contract' | 'action'
    effectOwnerKey: string
    earnEffectKey: string
  }>
  /**
   * Fresh G7 story-outcome builds bind every semantic important-story
   * consequence to the exact protected quest-stage completion Action that
   * commits it. Historical artifacts omit this field and retain their frozen
   * byte shape.
   */
  storyOutcomeBindings?: Array<{
    threadKey: string
    sourceStageKey: string
    questKey: string
    questStageKey: string
    consequencePlanKey: string
    effectKeys: string[]
  }>
  /**
   * Deterministic P8F binding of every authored ending to the final protected
   * mainline quest. P9 may author the visible choice copy, but it must point at
   * these already-frozen Actions instead of creating a second result path.
   */
  endingBindings: {
    finalMainlineQuestKey: string
    finalMainlineStageKey: string
    finalLocationKey: string
    selectionReadyConditionKey: string
    routes: Array<{
      endingKey: string
      conditionKey: string
      /** Fresh G7 builds gate the choice with authored, closed-candidate prerequisites. */
      eligibilityConditionKey?: string
      actionKey: string
      routeEffectKey: string
      unlockEffectKey: string
      reachEffectKey: string
      eligibility?: {
        requiredQuestKeys: string[]
        anyQuestKeyGroups: string[][]
        requiredFactionAffinities: Array<{ factionKey: string; minimum: number }>
        requiredRecipeKeys: string[]
      }
    }>
  }
  catalogBindings: {
    skills: Array<{
      skillKey: string
      useConditionKeys: string[]
      effectKeys: string[]
      actionKey: string | null
      unlockQuestKey: string | null
    }>
    enemies: Array<{ enemyKey: string; dropTableKey: string }>
    encounters: Array<{
      encounterKey: string
      questKeys: string[]
      rewardContractKey: string
      startActionKey: string
      completionFlagKey: string
    }>
    items: Array<{
      itemKey: string
      useActionKey: string | null
      equipActionKey: string | null
      unequipActionKey: string | null
      equipConditionKeys: string[]
      effectKeys: string[]
    }>
    rewards: Array<{
      rewardContractKey: string
      conditionKeys: string[]
      effectKeys: string[]
      dropTableKeys: string[]
      sourceQuestKey: string | null
      sourceEncounterKey: string | null
    }>
    dropTables: Array<{
      dropTableKey: string
      conditionKeys: string[]
      quantityEffectBindings: Array<{ itemKey: string; quantity: number; effectKey: string }>
    }>
    recipes: Array<{
      recipeKey: string
      requirementConditionKeys: string[]
      craftActionKey: string
      learnActionKey: string | null
      learnQuestKey: string | null
      consumeEffectKeys: string[]
      outputEffectKeys: string[]
    }>
    vendors: Array<{
      vendorKey: string
      actorKey: string
      factionKey: string | null
      availabilityConditionKeys: string[]
      buyActionKey: string
      sellActionKey: string
    }>
    actors: Array<{ actorKey: string; questKeys: string[]; actionKeys: string[] }>
    interactions: Array<{
      interactionKey: string
      actionKey: string
      conditionKeys: string[]
      effectKeys: string[]
      questKeys: string[]
    }>
    edges: Array<{
      edgeKey: string
      forwardActionKey: string
      reverseActionKey: string | null
      conditionKeys: string[]
      effectKeys: string[]
    }>
    fastTravelPoints: Array<{
      fastTravelPointKey: string
      unlockEffectKey: string | null
      respawnActionKey: string
    }>
  }
  coverage: {
    requiredQuestKeys: string[]
    finalizedQuestKeys: string[]
    requiredObjectiveKeys: string[]
    finalizedObjectiveKeys: string[]
    requiredRequirementKeys: string[]
    boundRequirementKeys: string[]
    encounterKeys: string[]
    encounterKeysWithRewardAndAction: string[]
    catalogDefinitionKeys: string[]
    referencedCatalogDefinitionKeys: string[]
    requiredEndingKeys: string[]
    boundEndingKeys: string[]
    requiredKnowledgeKeys?: string[]
    confirmableKnowledgeKeys?: string[]
    requiredRumorSeedKeys?: string[]
    boundRumorSeedKeys?: string[]
    requiredAchievementKeys?: string[]
    earnableAchievementKeys?: string[]
    orphanActionKeys: string[]
    orphanEffectKeys: string[]
    uncoveredRequirementKeys: []
  }
  governance: {
    referenceOwner: 'deterministic-compiler'
    objectiveSemanticsOwner: 'model-validated'
    protectedStoriesWait: true
    ordinaryFailureAllowed: true
    criticalArrivalNeverSoleTrigger: true
    allObjectivesHaveActions: true
    allRewardsClaimableOnce: true
    allTimedQuestsHaveExpirationCoverage: true
    /** Missing on the pre-G4-05 P8F v1 artifact contract. */
    allAbandonableQuestStagesCovered?: true
    /** P9 must prove this requirement against the authored quest-offer scene. */
    restartActionsRequireOriginalOfferRoute?: true
    /**
     * Fresh P8F builds compile active recovery/resource/status and passive
     * mechanics into the strict Action v17 + Progression v2 + Combat v4
     * runtime triplet. Missing on historical v15/v16 artifacts.
     */
    structuredCombatMechanicsReady?: true
    /** Fresh Action v18 compiles every locked protected story into a durable
     * system-owned locked -> available -> revealed transition path. */
    protectedStoryRevealActionsReady?: true
    allRumorsHaveUniquePropagationPath?: true
    allKnowledgeHasConfirmationPath?: true
    allAchievementsOneTimeReachable?: true
    /** Fresh P8F Knowledge/rumor/achievement graph is complete and runnable. */
    knowledgeProgressReady?: true
    /** Fresh G7 build binds important-story consequences and distinct ending eligibility paths. */
    storyOutcomesRuntimeBound?: true
    allCatalogBindingsResolved: true
    allEndingsRuntimeBound: true
    sceneBindingsDeferred: true
    questAndEncounterBindingsReady: true
  }
  basisHash: string
  createdAt: number
  questDesignDocumentsHash: string
}

/** P8F build-time regional director inventory. Presentation variants and
 * scene prose are reserved for P9, while deck eligibility and budgets are
 * already frozen and executable. */
export interface TextOpenWorldDirectorDecksV1 {
  schema: 'storyforge.text-open-world-director-decks'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  regionNarrativePacksHash: string
  questDesignDocumentsHash: string
  mapInteractionCatalogHash: string
  rules: {
    globalMaximumRevealed: number
    globalMaximumActive: number
    maximumQuestInstances: number
    highIntensityStreakLimit: number
    historyLimit: number
    maximumSettlementIntervals: number
    systemActionKey: string
  }
  decks: Array<{
    regionKey: string
    fixedQuestKeys: string[]
    templateKeys: string[]
    randomEventKeys: string[]
    triggerKinds: Array<'arrival' | 'explore' | 'talk' | 'rest' | 'quest-complete' | 'time-batch' | 'activity'>
    maximumRevealed: number
    maximumActive: number
    cooldownMinutes: number
    blankWeight: number
  }>
  templates: Array<{
    key: string
    questKey: string
    regionKeys: string[]
    variantTextRequirementKeys: [string, string, string]
    fingerprint: string
    cooldownMinutes: number
    conditionKeys: string[]
    levelBand: { minimum: number; maximum: number }
    category: 'help' | 'resource' | 'exploration' | 'conflict' | 'mystery'
    intensity: number
    weight: number
    presentationBinding: { status: 'variant-text-unbound'; variantTextKeys: [] }
  }>
  randomEvents: Array<{
    key: string
    sourceSeedKey: string
    title: string
    description: string
    kind: 'atmosphere' | 'resource' | 'encounter' | 'clue' | 'quest-upgrade'
    regionKeys: string[]
    locationKeys: string[]
    actionKeys: string[]
    effectKeys: string[]
    conditionKeys: string[]
    fingerprint: string
    rumorRequirementKey: string | null
    /** Present on governed-v18 Knowledge builds; absent on historical decks. */
    rumorKey?: string | null
    upgradeTemplateKey: string | null
    intensity: number
    weight: number
    cooldownMinutes: number
  }>
  regionRules: Array<{
    regionKey: string
    settlementIntervalMinutes: number
    initialPressure: number
    minimumPressure: number
    maximumPressure: number
    driftPerInterval: number
    stateBands: Array<{ key: string; minimumPressure: number }>
  }>
  coverage: {
    requiredRegionKeys: string[]
    coveredRegionKeys: string[]
    ordinaryQuestKeys: string[]
    fixedQuestKeys: string[]
    templateQuestKeys: string[]
    coveredTemplateQuestKeys: string[]
    randomEventSeedKeys: string[]
    coveredRandomEventSeedKeys: string[]
    requiredRumorSeedKeys?: string[]
    boundRumorSeedKeys?: string[]
    emptyPlayableDeckRegionKeys: []
  }
  governance: {
    regionalBudgetsBounded: true
    protectedStoriesExcluded: true
    mainlinePressureDisabled: true
    duplicateFingerprintsRejected: true
    highIntensityStreakBounded: true
    runtimeHistorySessionOwned: true
    presentationVariantsDeferred: true
    directorRuntimeReadyExceptPresentation: true
    allRumorsHaveUniquePropagationPath?: true
    knowledgeProgressReady?: true
  }
  basisHash: string
  createdAt: number
  directorDecksHash: string
}

export type TextOpenWorldSceneSourceKindV1 =
  | 'quest-offer'
  | 'quest-objective'
  | 'quest-resolution'
  | 'actor-dialogue'
  | 'location-interaction'
  | 'random-event'

/**
 * P9 authored presentation over the already-finalized P8F result graph.
 * Scene prose may explain an Action result, but never owns or duplicates it.
 */
export interface TextOpenWorldSceneScriptsV1 {
  schema: 'storyforge.text-open-world-scene-scripts'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  sourceLedgerHash: string
  experienceContractHash: string
  storyArcHash: string
  regionNarrativePacksHash: string
  questSkeletonsHash: string
  npcRuntimeCatalogHash: string
  mapInteractionCatalogHash: string
  questDesignDocumentsHash: string
  directorDecksHash: string
  scenes: Array<{
    key: string
    order: number
    sourceKind: TextOpenWorldSceneSourceKindV1
    sourceKey: string
    title: string
    purpose: string
    regionKey: string
    locationKey: string
    questKey: string | null
    stageKey: string | null
    objectiveKey: string | null
    actorKey: string | null
    interactionKey: string | null
    randomEventKey: string | null
    participantKeys: string[]
    openingText: string
    bodyText: string
    successText: string
    failureText: string | null
    attitudeOpenings: {
      bad: string
      neutral: string
      good: string
    } | null
    allowedKnowledgeClaimKeys: string[]
    forbiddenFutureObjectiveKeys: string[]
    availabilityConditionKeys: string[]
    actionKeys: string[]
    fixedChoiceKeys: string[]
  }>
  templateTextVariants: Array<{
    key: string
    order: number
    requirementKey: string
    templateKey: string
    title: string
    description: string
  }>
  randomEventPresentations: Array<{
    key: string
    order: number
    randomEventKey: string
    openingText: string
    resolutionText: string
    rumorKey: string | null
    rumorRequirementKey: string | null
    rumorText: string | null
    reliability: 'uncertain' | 'likely' | 'confirmed' | null
    sourceClaimKeys: string[]
  }>
  /** Player-visible copy over P8F-owned definitions; no new keys or truth. */
  knowledgePresentations?: Array<{
    key: string
    order: number
    knowledgeKey: string
    title: string
    summary: string
  }>
  achievementPresentations?: Array<{
    key: string
    order: number
    achievementKey: string
    title: string
    description: string
  }>
  coverage: {
    requiredQuestKeys: string[]
    questOfferSceneKeys: string[]
    questResolutionSceneKeys: string[]
    requiredObjectiveKeys: string[]
    objectiveSceneKeys: string[]
    requiredActorKeys: string[]
    actorSceneKeys: string[]
    requiredInteractionKeys: string[]
    interactionSceneKeys: string[]
    requiredRandomEventKeys: string[]
    randomEventSceneKeys: string[]
    requiredTemplateVariantRequirementKeys: string[]
    fulfilledTemplateVariantRequirementKeys: string[]
    uncoveredSceneSourceKeys: []
    requiredKnowledgeKeys?: string[]
    presentedKnowledgeKeys?: string[]
    requiredAchievementKeys?: string[]
    presentedAchievementKeys?: string[]
  }
  governance: {
    proseOwner: 'model-validated'
    referenceOwner: 'deterministic-compiler'
    currentAndPriorKnowledgeOnly: true
    futureObjectiveSpoilersForbidden: true
    everyObjectiveHasScene: true
    everyActorHasDialogueEntry: true
    everyLocationInteractionHasScene: true
    everyDirectorEventHasPresentation: true
    allTemplateVariantsFulfilled: true
    actionResultsReferencedNotDuplicated: true
    disclosureSafeModelContextV3?: true
    knowledgePresentationsComplete?: true
    achievementPresentationsComplete?: true
    rumorFactsCopiedFromQuestDesign?: true
    sceneKnowledgeRefsAreRuntimeKnowledgeKeys?: true
  }
  basisHash: string
  createdAt: number
  sceneScriptsHash: string
}

/** Every fixed choice is only a presentation alias for one P8F Action. */
export interface TextOpenWorldChoiceContractsV1 {
  schema: 'storyforge.text-open-world-choice-contracts'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  questDesignDocumentsHash: string
  sceneScriptsHash: string
  choices: Array<{
    key: string
    sceneKey: string
    order: number
    label: string
    description: string
    actionKey: string
    actionDefinitionHash: string
    targetPolicy: 'none' | 'fixed' | 'runtime-valid-target'
    targetKey: string | null
    availabilityConditionKeys: string[]
    confirmationPolicy: 'never' | 'high-risk' | 'always'
    executionSource: 'fixed-choice'
    resultAuthority: 'text-open-world.quest-design-documents.actions'
  }>
  coverage: {
    requiredSceneActionPairs: Array<{ sceneKey: string; actionKey: string }>
    coveredSceneActionPairs: Array<{ sceneKey: string; actionKey: string }>
    scenesWithActions: string[]
    scenesWithChoices: string[]
    duplicateChoiceKeys: []
    uncoveredSceneActionPairs: []
  }
  governance: {
    exactActionReferenceOnly: true
    effectsNeverDuplicated: true
    availabilityInheritedFromAction: true
    confirmationInheritedFromAction: true
    runtimeTargetValidationRequired: true
  }
  basisHash: string
  createdAt: number
  choiceContractsHash: string
}

export type TextOpenWorldNaturalLanguageBindingModeV1 =
  | 'existing-action-candidate'
  | 'disabled-system-only'
  | 'disabled-combat-button-only'

/**
 * P9 binds UI Actions, fixed choices, and natural-language candidates to the
 * same immutable P8F Action definition. It contains no Effect payloads.
 */
export interface TextOpenWorldActionBindingsV1 {
  schema: 'storyforge.text-open-world-action-bindings'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  experienceContractHash: string
  questDesignDocumentsHash: string
  sceneScriptsHash: string
  choiceContractsHash: string
  actions: Array<{
    key: string
    order: number
    actionKey: string
    actionDefinitionHash: string
    actorScope: 'player' | 'system'
    category: TextOpenWorldActionDefinitionV1['category']
    targetScope: TextOpenWorldActionDefinitionV1['targetScope']
    systemAction: {
      enabled: boolean
      label: string
      description: string
      executionSource: 'system-action'
    }
    fixedChoiceKeys: string[]
    naturalLanguage: {
      mode: TextOpenWorldNaturalLanguageBindingModeV1
      exampleUtterances: string[]
      candidateMayOnlySelectThisAction: true
      targetResolution: 'current-projection-valid-targets-only'
      highConfidenceLowRisk: 'execute-after-runtime-validation'
      highRiskOrIrreversible: 'require-explicit-confirmation'
      lowConfidence: 'respond-and-recommend-formal-actions'
      mayCreateAction: false
      mayCreateQuest: false
      mayCreateMapContent: false
      mayWriteState: false
    }
    resultAuthority: {
      artifactKey: 'text-open-world.quest-design-documents'
      collection: 'actions'
      actionKey: string
      actionDefinitionHash: string
    }
  }>
  unmatchedNaturalLanguage: {
    policy: 'natural-response-then-formal-action-redirect'
    impossibleActionPolicy: 'explicit-decline-with-in-world-alternative'
    customSolutionPolicy: 'future-extension-disabled'
    stateMutationAllowed: false
  }
  thresholds: {
    directExecutionMinimumConfidence: 0.9
    recommendationMinimumConfidence: 0.55
  }
  coverage: {
    requiredActionKeys: string[]
    boundActionKeys: string[]
    playerActionKeys: string[]
    systemActionUiKeys: string[]
    naturalLanguageEligibleActionKeys: string[]
    naturalLanguageBoundActionKeys: string[]
    combatButtonOnlyActionKeys: string[]
    fixedChoiceActionKeys: string[]
    duplicateNaturalLanguageExamples: []
    unboundActionKeys: []
  }
  governance: {
    singleResultSource: true
    allThreeInputsUseActionRegistry: true
    modelCannotCreateActionOrResult: true
    combatFreeTextDisabled: true
    lowConfidenceNeverExecutes: true
    irreversibleActionsRequireConfirmation: true
    runtimeProjectionValidationRequired: true
  }
  basisHash: string
  createdAt: number
  actionBindingsHash: string
}

/** P2 presentation intent. It defines consumer-facing language and fallbacks,
 * not concrete media files or runtime state. */
export interface TextOpenWorldPresentationProfileV1 {
  schema: 'storyforge.text-open-world-presentation-profile'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  experienceContractHash: string
  theme: {
    title: string
    designIntent: string
    colorMood: string
    typographyTone: string
    informationDensity: 'comfortable'
    mapStyle: 'svg-terrain-with-interactive-nodes'
  }
  consumerSlots: Array<{
    key: string
    surface: 'creation' | 'play' | 'overlay' | 'system'
    purpose: string
    required: true
    textFallback: string
  }>
  interactionPresentation: {
    acceptedInputs: ['system-action', 'fixed-choice', 'natural-language']
    combatControls: ['fight', 'escape', 'skill', 'item']
    impossibleActionPolicy: 'explicit-decline-with-in-world-alternative'
    offTrackPolicy: 'natural-response-then-mainline-redirect'
    modelFailurePolicy: 'show-formal-actions-and-safe-template'
  }
  mediaPolicy: {
    visualLevel: 'none' | 'key-scenes' | 'illustrated'
    audioLevel: 'none' | 'music-sfx' | 'full'
    requiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background']
    textFallbackRequired: true
    missingMediaPolicy: 'placeholder-with-text-playable'
    authorizedMaximumMediaCalls: number
  }
  contentLanguage: string
  governance: {
    allRequiredConsumersDeclared: true
    gameplayResultNeverOwnedByPresentation: true
    stableIdsNeverUseDisplayText: true
    textOnlyReleasePlayable: true
  }
  basisHash: string
  createdAt: number
  presentationProfileHash: string
}

export interface TextOpenWorldSystemConfigsV1 {
  schema: 'storyforge.text-open-world-system-configs'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  gameBriefHash: string
  experienceContractHash: string
  presentationProfileHash: string
  gameplayRulesetHash: string
  playerBuildHash: string
  regionNarrativePacksHash: string
  progressionCatalogsHash: string
  enemyEncounterCatalogHash: string
  itemRewardCatalogHash: string
  craftingEconomyCatalogHash: string
  npcRuntimeCatalogHash: string
  mapInteractionCatalogHash: string
  questDesignDocumentsHash: string
  directorDecksHash: string
  sceneScriptsHash: string
  choiceContractsHash: string
  actionBindingsHash: string
  runtimeModules: Array<{
    moduleKey: TextOpenWorldRuntimeModuleKeyV1
    schemaVersion: number
    sourceArtifactKeys: TextOpenWorldProductionArtifactKindV1[]
    status: 'ready-for-v3-assembly'
  }>
  uiConsumers: Array<{
    key: string
    sourceArtifactKeys: TextOpenWorldProductionArtifactKindV1[]
    requiredRuntimeModuleKeys: TextOpenWorldRuntimeModuleKeyV1[]
    status: 'ready'
  }>
  runtimePolicies: {
    difficulty: 'standard'
    maximumLevel: 20
    initialLevel: 1
    acceptanceFinalLevel: 5
    professionSystem: 'none'
    manualAttributeAllocation: false
    combatMode: 'turn-based-four-action'
    combatNaturalLanguage: false
    inventoryCapacity: 'unlimited'
    equipmentSlots: ['weapon', 'armor', 'accessory']
    craftingSuccess: 'guaranteed-known-recipes-only'
    currencyCount: 1
    mapMode: 'svg-terrain-with-interactive-nodes'
    quickTravel: 'visited-region-points-no-interruption'
    worldClockDisplay: 'day-and-period'
    questTracking: 'one-primary-and-multiple-pinned'
    savePolicy: 'bounded-manual-list-with-branches'
    tutorial: 'progressive-hints'
    releaseLanguageCount: 1
  }
  coverage: {
    requiredRuntimeModuleKeys: TextOpenWorldRuntimeModuleKeyV1[]
    readyRuntimeModuleKeys: TextOpenWorldRuntimeModuleKeyV1[]
    requiredConsumerKeys: string[]
    readyConsumerKeys: string[]
    missingRuntimeModuleKeys: []
    missingConsumerKeys: []
  }
  governance: {
    everyRuntimeModuleHasOneAssemblySourceSet: true
    allPlayerSurfacesHaveConsumers: true
    presentationCannotMutateState: true
    runtimeStateSessionOwned: true
    readyForDeterministicPreflight: true
  }
  basisHash: string
  createdAt: number
  systemConfigsHash: string
}

export type TextOpenWorldMediaSlotKindV1 =
  | 'procedural-map' | 'character-portrait' | 'scene-background' | 'ui-skin'
  | 'music' | 'ambient-sound' | 'sound-effect' | 'voice'

export interface TextOpenWorldMediaRequirementsV1 {
  schema: 'storyforge.text-open-world-media-requirements'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  presentationProfileHash: string
  npcRuntimeCatalogHash: string
  mapInteractionCatalogHash: string
  sceneScriptsHash: string
  slots: Array<{
    key: string
    order: number
    kind: TextOpenWorldMediaSlotKindV1
    subjectKind: 'world' | 'region' | 'actor' | 'scene' | 'ui'
    subjectKey: string
    title: string
    creativeBrief: string
    required: boolean
    productionMode: 'procedural-code' | 'generate-or-import' | 'optional-generate-or-import' | 'fallback-only'
    fallback: 'procedural-svg' | 'generated-placeholder' | 'text-description' | 'silent'
    sourceArtifactKey: TextOpenWorldProductionArtifactKindV1
    sourceEntityKey: string
    consumerKeys: string[]
  }>
  coverage: {
    requiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background']
    coveredRequiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background']
    requiredActorKeys: string[]
    coveredActorKeys: string[]
    requiredRegionKeys: string[]
    coveredRegionKeys: string[]
    requiredSlotKeys: string[]
    fallbackReadySlotKeys: string[]
    missingRequiredSlotKeys: []
  }
  productionBudget: {
    requestedGeneratedSlotCount: number
    authorizedMaximumMediaCalls: number
    fitsAuthorizedMediaCalls: boolean
    overflowSlotKeys: string[]
  }
  governance: {
    requirementsDerivedAfterContent: true
    mediaNeverBlocksTextFallback: true
    proceduralMapRequiresNoModelCall: true
    everyRequiredSlotHasFallback: true
    rightsCheckedAtAssetAcceptance: true
  }
  basisHash: string
  createdAt: number
  mediaRequirementsHash: string
}

export interface TextOpenWorldContentBudgetV1 {
  schema: 'storyforge.text-open-world-content-budget'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  experienceContractHash: string
  regionNarrativePacksHash: string
  questDesignDocumentsHash: string
  directorDecksHash: string
  sceneScriptsHash: string
  inventory: {
    mainlineMinutes: number
    significantMinutes: number
    ordinaryFixedMinutes: number
    templateVariantMinutes: number
    randomEventMinutes: number
    totalAuthoredMinutes: number
    questCounts: { mainline: number; significant: number; ordinary: number; template: number }
    templateVariantCount: number
    randomEventCount: number
    regionCount: number
    sceneCount: number
  }
  singlePlaythrough: {
    requiredMainlineMinutes: number
    minimumOptionalMinutes: number
    maximumOptionalMinutes: number
    minimumTotalMinutes: number
    typicalTotalMinutes: number
    maximumTotalMinutes: number
    assumptions: string[]
  }
  requested: {
    requiredPlayMinuteRange: { minimum: number; maximum: number }
    optionalInventoryMinuteRange: { minimum: number; maximum: number }
  }
  fit: {
    requiredPlayMinutesInRange: boolean
    optionalInventoryMinutesInRange: boolean
    inventoryAtLeastSinglePlaythrough: boolean
    everyRegionHasOrdinarySupply: boolean
  }
  perRegion: Array<{
    regionKey: string
    fixedQuestMinutes: number
    templateVariantMinutes: number
    randomEventMinutes: number
    authoredInventoryMinutes: number
  }>
  governance: {
    inventoryAndSingleRunSeparated: true
    repeatedProceduralPlayNotCountedAsAuthoredInventory: true
    durationIsEstimateUntilHumanCalibration: true
    humanPlaytimeSampleCount: 0
  }
  basisHash: string
  createdAt: number
  contentBudgetHash: string
}

export type TextOpenWorldPreflightCheckCategoryV1 =
  | 'schema' | 'hash-chain' | 'reference' | 'solvability' | 'budget' | 'consumer-slot'

export interface TextOpenWorldDeterministicPreflightV1 {
  schema: 'storyforge.text-open-world-deterministic-preflight'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  systemConfigsHash: string
  contentBudgetHash: string
  questDesignDocumentsHash: string
  actionBindingsHash: string
  checks: Array<{
    key: string
    category: TextOpenWorldPreflightCheckCategoryV1
    status: 'pass' | 'block'
    summary: string
    evidenceRefs: string[]
    targetArtifactKeys: TextOpenWorldProductionArtifactKindV1[]
  }>
  reachability: {
    mainlineQuestKeys: string[]
    reachableMainlineQuestKeys: string[]
    protectedWaitQuestKeys: string[]
    ordinaryContentMayBlockMainline: false
    unknownConditionKeys: []
    unknownEffectKeys: []
    unknownActionKeys: []
  }
  result: {
    passedCheckKeys: string[]
    blockingCheckKeys: []
    readyForModelReviews: true
  }
  governance: {
    codeOnly: true
    noSemanticQualityClaims: true
    boundedAbstractReachability: true
    exactInputHashesVerified: true
  }
  basisHash: string
  createdAt: number
  deterministicPreflightHash: string
}

export type TextOpenWorldReviewVerdictV1 = 'pass' | 'repair-required'
export type TextOpenWorldReviewSeverityV1 = 'advisory' | 'blocking'

export interface TextOpenWorldReviewFindingV1 {
  key: string
  metricKey: string
  severity: TextOpenWorldReviewSeverityV1
  score: number
  summary: string
  evidence: string
  targetArtifactKey: TextOpenWorldProductionArtifactKindV1
  targetEntityKeys: string[]
  repair: {
    targetTaskKey: string
    mode: 'new-build-bounded-local-repair'
    instruction: string
    staleTaskKeys: string[]
    mutatesAcceptedArtifact: false
  }
}

export interface TextOpenWorldBalanceReviewV1 {
  schema: 'storyforge.text-open-world-balance-review'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  progressionCatalogsHash: string
  enemyEncounterCatalogHash: string
  itemRewardCatalogHash: string
  craftingEconomyCatalogHash: string
  questDesignDocumentsHash: string
  contentBudgetHash: string
  deterministicPreflightHash: string
  scores: Array<{
    metricKey: 'progression' | 'encounters' | 'rewards' | 'economy' | 'solvability' | 'content-supply'
    score: number
    rationale: string
  }>
  findings: TextOpenWorldReviewFindingV1[]
  verdict: TextOpenWorldReviewVerdictV1
  threshold: 70
  minimumScore: number
  governance: {
    modelReviewsSemanticsOnly: true
    deterministicFactsNotOverridden: true
    acceptedArtifactsNeverMutated: true
    repairCreatesNewBuild: true
    impactClosureCodeOwned: true
  }
  basisHash: string
  createdAt: number
  balanceReviewHash: string
}

export interface TextOpenWorldSemanticReviewV1 {
  schema: 'storyforge.text-open-world-semantic-review'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  storyArcHash: string
  mainlineThreadHash: string
  significantThreadsHash: string
  regionNarrativePacksHash: string
  questDesignDocumentsHash: string
  sceneScriptsHash: string
  contentBudgetHash: string
  deterministicPreflightHash: string
  scores: Array<{
    metricKey: 'source-fidelity' | 'mainline-arc' | 'significant-stories' | 'regional-identity'
      | 'quest-experience' | 'dialogue-and-knowledge' | 'repetition' | 'duration-and-guidance'
    score: number
    rationale: string
  }>
  findings: TextOpenWorldReviewFindingV1[]
  verdict: TextOpenWorldReviewVerdictV1
  threshold: 70
  minimumScore: number
  governance: {
    modelReviewsSemanticsOnly: true
    deterministicFactsNotOverridden: true
    acceptedArtifactsNeverMutated: true
    repairCreatesNewBuild: true
    impactClosureCodeOwned: true
    humanPlaytimeCalibrationStillRequired: true
  }
  basisHash: string
  createdAt: number
  semanticReviewHash: string
}

/** Deterministic V3 evidence that the accepted production graph was compiled
 * into the single ProductRuntimePackage consumed by preview and ProductRelease. */
export interface TextOpenWorldIntegrationReportV1 {
  schema: 'storyforge.text-open-world-integration-report'
  version: 1
  productType: 'text-open-world'
  productInstanceKey: string
  runtimePackageHash: string
  sourcePinHash: string
  systemConfigsHash: string
  deterministicPreflightHash: string
  balanceReviewHash: string
  semanticReviewHash: string
  modules: Array<{
    moduleKey: TextOpenWorldRuntimeModuleKeyV1
    schemaVersion: number
    contentHash: string
    sourceArtifactKeys: string[]
    parsed: true
  }>
  generatedBindings: {
    endingActionKeys: string[]
    generatedMediaArtifactKeys: string[]
    fallbackMediaSlotKeys: string[]
  }
  verification: {
    productPackageParsed: true
    allModulesParsed: true
    initialProjectionCreated: true
    mainlineHasStart: true
    endingActionsReachable: true
    sourceProvenanceClosed: true
    rightsEvidenceClosed: true
    mediaCoveragePolicyEvaluated: true
  }
  media: {
    qualityProfile: 'prototype' | 'internal' | 'commercial-candidate'
    slotCount: number
    requiredSlotCount: number
    requiredGeneratedSlotCount: number
    generatedBindingCount: number
    generatedRequiredBindingCount: number
    fallbackReadyCount: number
    playableCoverage: number
    generatedRequiredCoverage: number
    evaluatedCoverage: number
    minimumCoverage: number
    releaseReady: boolean
    coverageEvidenceHash: string
  }
  rights: {
    evaluatedArtifactCount: number
    evidence: Array<{
      artifactKey: string
      assetKey: string
      origin: string
      adapterId: string
      source: string
      license: string
      commercialUse: true
      commercialPolicyPassed: boolean
      capabilityRequirementKey: string
      rightsPolicyVersion: string
      producerReceiptHash: string
      providerReceiptHash: string | null
      evidenceHash: string
    }>
    complete: true
    commercialPolicyPassed: boolean
    rightsEvidenceHash: string
  }
  governance: {
    compilerOnly: true
    acceptedArtifactsNeverMutated: true
    runtimeStateSessionOwned: true
    productReleaseOwned: true
  }
  basisHash: string
  createdAt: number
  integrationReportHash: string
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
  /** Maximum initial provider calls reserved for this durable task. */
  recommendedModelCalls: number
  /** Independent share of the Build input/output token budgets. */
  tokenBudgetWeight: number
  /** Independent share of the Build wall-clock reservation. */
  durationBudgetWeight: number
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
  activation: 'active'
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

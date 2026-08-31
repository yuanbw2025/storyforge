import type {
  TtrpgProductionSourceKindV1,
  TtrpgProductionSourceSelectionV1,
} from './ttrpg-production-source'
import type { TtrpgProductionBriefV2 } from './game-production'
import type {
  RulePackV1,
  TtrpgCampaignContentV1,
  TtrpgRuntimeMediaAudienceV1,
  TtrpgRuntimeMediaKindV1,
} from './ttrpg-product'

export const TTRPG_PRODUCTION_STEP_KEYS_V1 = [
  'source-frozen',
  'brief-confirmed',
  'rule-mapping',
  'roster-and-sheets',
  'campaign-proposals',
  'campaign-graph',
  'clues-fronts-secrets-rewards',
  'visual-bible',
  'media-prebuild',
  'integration',
  'counterexample-validation',
  'author-preview',
] as const

export type TtrpgProductionStepKeyV1 = typeof TTRPG_PRODUCTION_STEP_KEYS_V1[number]

export interface TtrpgProductionRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionKey: string
  title: string
  status: 'draft' | 'source-frozen' | 'brief-confirmed' | 'building' | 'preview-ready' | 'release-ready' | 'released' | 'failed' | 'archived'
  activeSourceSelectionId: number | null
  activeBriefId: number | null
  currentBuildId: number | null
  currentProductReleaseId: number | null
  createdAt: number
  updatedAt: number
}

/** Immutable source catalog + selection snapshot owned by one TTRPG production. */
export interface TtrpgSourceSelectionRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  revision: number
  sourceKind: TtrpgProductionSourceKindV1
  developmentOnly: boolean
  sourceWorldReleaseId: number | null
  sourceKey: string
  sourceContentHash: string
  sourceCatalogJson: string
  sourceCatalogHash: string
  selectionJson: string
  selectionHash: string
  /** ARCH-04/05 logical cross-product contracts; null only for development fixtures or legacy rows. */
  worldReferenceJson?: string | null
  worldReferenceHash?: string | null
  sourcePlanJson?: string | null
  sourcePlanHash?: string | null
  status: 'frozen' | 'superseded'
  createdAt: number
}

/** Append-only Brief revision. Confirming a new revision supersedes, never mutates, the old one. */
export interface TtrpgProductionBriefRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  sourceSelectionId: number
  revision: number
  briefJson: string
  briefHash: string
  confirmedContractJson?: string | null
  confirmedContractHash?: string | null
  authorStartRevision?: number | null
  status: 'confirmed' | 'superseded'
  createdAt: number
}

/** Durable, explicit attempt/checkpoint for one product-owned production step. */
export interface TtrpgProductionStepRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  buildId: number | null
  stepKey: TtrpgProductionStepKeyV1
  attempt: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stale'
  inputHash: string
  outputHash: string | null
  checkpointJson: string
  errorJson: string | null
  startedAt: number | null
  completedAt: number | null
  updatedAt: number
}

/** Complete product preview/build. Development builds are playable but cannot become ProductRelease. */
export interface TtrpgProductionBuildRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  sourceSelectionId: number
  briefId: number
  buildNumber: number
  status: 'building' | 'preview-ready' | 'validated' | 'release-ready' | 'failed' | 'superseded'
  developmentOnly: boolean
  rulePackJson: string
  rulePackHash: string
  campaignJson: string
  campaignHash: string
  validationJson: string
  buildHash: string
  errorJson: string | null
  createdAt: number
  updatedAt: number
}

/**
 * Versioned product-owned media ledger for one TTRPG Build. Binary bytes stay
 * in the shared content-addressed mediaBlobObjects store; this record freezes
 * slot intent, accepted provenance and the exact blob binding.
 */
export interface TtrpgProductionMediaAssetRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  buildId: number
  slotKey: string
  assetKey: string
  version: number
  kind: TtrpgRuntimeMediaKindV1
  targetRef: string
  audience: TtrpgRuntimeMediaAudienceV1
  productionRequired: boolean
  status: 'planned' | 'available' | 'failed' | 'superseded'
  specHash: string
  prompt: string
  negativePrompt: string
  fallbackText: string
  altText: string
  width: number | null
  height: number | null
  blobObjectId: number | null
  mimeType: string | null
  byteSize: number
  contentHash: string | null
  producerRunId: number | null
  providerAdapterId: string | null
  providerRequestId: string | null
  providerModelId: string | null
  providerReceiptHash: string | null
  rightsPolicyVersion: string
  rightsJson: string
  failureJson: string | null
  createdAt: number
  updatedAt: number
}

/** Immutable commercial product release. Development sources are rejected before insertion. */
export interface TtrpgProductReleaseRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  sourceSelectionId: number
  sourceWorldReleaseId: number
  briefId: number
  buildId: number
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

export interface TtrpgProductReleaseManifestV1 {
  schema: 'storyforge.ttrpg-product-release'
  version: 1
  productType: 'ttrpg'
  releaseVersion: number
  source: {
    worldReleaseId: number
    sourceContentHash: string
    sourceCatalogHash: string
    selection: TtrpgProductionSourceSelectionV1
  }
  brief: { content: TtrpgProductionBriefV2; contentHash: string }
  sourceContracts?: {
    worldReferenceHash: string
    sourcePlanHash: string
    sourceManifestHash: string
    confirmedBriefHash: string
  }
  rulePack: { content: RulePackV1; contentHash: string }
  campaign: { content: TtrpgCampaignContentV1; contentHash: string }
  media: {
    assets: Array<{
      slotKey: string
      assetKey: string
      kind: TtrpgRuntimeMediaKindV1
      contentHash: string
      mimeType: string
      byteSize: number
      width: number | null
      height: number | null
      specHash: string
      providerReceiptHash: string | null
      rightsPolicyVersion: string
    }>
    manifestHash: string
  }
  buildHash: string
  compatibility: {
    productionContract: 1
    runtimeProtocol: 1
    minimumPlayerVersion: 1
  }
  createdAt: number
}

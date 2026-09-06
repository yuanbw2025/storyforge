import type {
  ProductProductionTaskExecutionModeV1,
  ProductProductionTaskLaneV1,
  ProductTaskBudgetReservationV1,
} from './product-production'
import type { WorldReferenceV1 } from './world-product-contracts'
import type { WorldCapabilityArea } from '../registry/types'

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

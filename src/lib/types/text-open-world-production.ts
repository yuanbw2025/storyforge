import type {
  ProductProductionTaskExecutionModeV1,
  ProductProductionTaskLaneV1,
  ProductTaskBudgetReservationV1,
} from './product-production'

/**
 * Stable, product-owned artifacts in the text-open-world production compiler.
 *
 * These are Build candidates, not World Engine records and not runtime session
 * state. A ProductRelease is assembled only after every required artifact has
 * passed its declared gates.
 */
export const TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_KINDS_V1 = [
  'text-open-world.source-pin',
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

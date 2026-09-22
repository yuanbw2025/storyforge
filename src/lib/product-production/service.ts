import { db } from '../db/schema'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import type {
  ProductBuildRecordV1,
  ProductMediaKind,
  ProductBuildArtifactKindV1,
  ProductEvolutionAffectedLaneV1,
  ProductEvolutionBaseV1,
  ProductProductionBriefRecordV1,
  ProductProductionBriefV3,
  ProductProductionCommandRecordV1,
  ProductProductionRecordV1,
  ProductionProductKindV1,
  TextOpenWorldCreatorProductionPreflightConfirmationV1,
  TextOpenWorldCreatorProductionPreflightV1,
  TextOpenWorldCreatorSourceLocatorV1,
  TextOpenWorldSourceRightsBasisV1,
  WorkspaceScope,
  WorldReferenceCatalogEntryV1,
} from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { listWorldReferenceCatalogV1 } from '../product/source'
import { prepareProductProductionAdoption, publishProductProductionBuild } from './adoption'
import {
  canReviseTextAdventureContentBeforeMediaV1,
  canReviseTextAdventureRuntimeCopyFromRecoveryV1,
  canReviseTextAdventureVisualContractFromRecoveryV1,
  canUpgradeTextAdventureExecutionPlanV1,
  executeProductProductionCommand,
  hasPassedTextAdventureQualityReviewForExecutionPlanUpgradeV1,
  isLegacyOversizedTextAdventureQualityReviewPlanV1,
  isRepairRetryableFailedProductBuildV1,
  isTextAdventureBuildLifetimeBudgetExhaustedV1,
  type ProductProductionCommandReceiptV1,
} from './commands'
import {
  inspectProductProductionBuildRecoveryPolicyV1,
  readProductProductionRecoveryTaskKeyV1,
} from './recovery-policy'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from './consultation'
import { parseProductProductionBriefV3 } from './contracts'
import {
  inspectConfiguredTextCapabilityV1,
  resolveConfiguredTextCapabilityV1,
  type ConfiguredTextCapabilityReadinessV1,
} from './capabilities'
import {
  createBuiltInProductionCapabilityBindingV1,
  createConfiguredProductProductionExecutorV1,
} from './production-executor'
import { createTextOpenWorldProductionExecutorV1 } from '../open-world/production-executor'
import {
  createTextOpenWorldCreatorStartPreparationV1,
  type TextOpenWorldCreatorStartPreparationV1,
} from '../open-world/creator-production-start'
import { verifyTextOpenWorldCreatorProductionPreflightConfirmationV1 } from '../open-world/creator-production-preflight'
import {
  abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1 as abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeCoreV1,
  cancelTextOpenWorldCreatorArtifactEditIntakeV1 as cancelTextOpenWorldCreatorArtifactEditIntakeCoreV1,
  confirmTextOpenWorldCreatorArtifactEditIntentV1 as confirmTextOpenWorldCreatorArtifactEditIntentCoreV1,
  generateTextOpenWorldCreatorArtifactEditCandidateV1 as generateTextOpenWorldCreatorArtifactEditCandidateCoreV1,
  prepareTextOpenWorldCreatorArtifactEditV1 as prepareTextOpenWorldCreatorArtifactEditCoreV1,
  readLatestTextOpenWorldCreatorArtifactEditStateV1 as readLatestTextOpenWorldCreatorArtifactEditStateCoreV1,
  rejectTextOpenWorldCreatorArtifactEditCandidateV1 as rejectTextOpenWorldCreatorArtifactEditCandidateCoreV1,
  resumeTextOpenWorldCreatorArtifactEditIntakeV1 as resumeTextOpenWorldCreatorArtifactEditIntakeCoreV1,
  reviseTextOpenWorldCreatorArtifactEditCandidateV1 as reviseTextOpenWorldCreatorArtifactEditCandidateCoreV1,
  type TextOpenWorldCreatorArtifactEditSelectionV1,
} from '../open-world/creator-artifact-edit'
import type { TextOpenWorldCreatorEditPatchOperationV1 } from '../open-world/creator-artifact-edit-contract'
import { prepareTextOpenWorldCreatorArtifactRepairV1 as prepareTextOpenWorldCreatorArtifactRepairCoreV1 } from '../open-world/creator-artifact-repair'
import { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } from '../open-world/creator-derived-authority'
import {
  inspectTextOpenWorldCreatorMediaWorkspaceV1 as inspectTextOpenWorldCreatorMediaWorkspaceCoreV1,
  prepareTextOpenWorldCreatorMediaV1 as prepareTextOpenWorldCreatorMediaCoreV1,
  type TextOpenWorldCreatorMediaImportInputV1,
  type TextOpenWorldCreatorMediaPreparationV1,
} from '../open-world/creator-media'
import type {
  TextOpenWorldCreatorMediaModeV1,
} from '../open-world/creator-media-contract'
import { detectProductImageDimensionsV1, detectProductMediaMimeTypeV1 } from './media-adapters'
import { useAIConfigStore } from '../../stores/ai-config'
import {
  assertProductProductionBudgetLedgerV1,
  projectProductProductionSchedulerV1,
  recoverImportedProductProductionProofsV1 as recoverImportedProductProductionProofsCoreV1,
  runProductProductionUntilBlockedV1,
  type ProductProductionCapabilityBindingV1,
  type ProductProductionSchedulerProjectionV1,
} from './scheduler'
import { createProductRuntimeInstanceFromSource } from '../product/runtime-instances'
import { startAiTownInitialSceneV1 } from '../ai-town/runtime-api'
import {
  listProductMediaProviderCapabilitiesV1,
  type ProductMediaProviderCapabilityV1,
} from './media-adapters'
import {
  configuredAuthoredImagePackUrlV1,
  configuredMediaRelayUrlV1,
  inspectAuthoredImagePackConfigurationV1,
  inspectConfiguredAgnesImageCapabilityV1,
  inspectTrustedRelayMediaConfigurationV1,
  resolveAuthoredImagePackCapabilityV1,
  resolveConfiguredAgnesImageCapabilityV1,
  resolveTrustedRelayMediaCapabilityV1,
  type ConfiguredAgnesImageReadinessV1,
  type ResolvedProductMediaCapabilityV1,
} from './media-transport'
import { readAcceptedBuildArtifacts } from './artifact-store'
import { putMediaBlobObject, readMediaBlobObjectData } from './media-blob-store'
import { minimumTextAdventureCommercialImageCountV1 } from '../adventure/production-brief'
import { parseProductProductionPlanV3, textAdventureProductionBudgetFloorV1 } from './plan'

export interface ProductProductionDetailsV1 {
  production: ProductProductionRecordV1
  brief: ProductProductionBriefRecordV1 | null
  /** Frozen scheduler/runtime envelope. Creator rows retain their own author
   * Brief in `briefJson`; this projection is available only after start. */
  executionBrief: ProductProductionBriefV3 | null
  build: ProductBuildRecordV1 | null
  artifactCount: number
  recentCommands: ProductProductionCommandRecordV1[]
  briefHistory: ProductProductionBriefRecordV1[]
  buildHistory: ProductBuildRecordV1[]
}

export type ProductProductionProgressV1 = ProductProductionSchedulerProjectionV1

/**
 * Creator editing facade. Direct field edits are credential-free; Agent edits
 * reuse the existing global/task-routed configuration without copying a secret
 * into ProductProduction or its durable Run.
 */
export function prepareTextOpenWorldCreatorArtifactEditV1(
  selection: TextOpenWorldCreatorArtifactEditSelectionV1,
) {
  return prepareTextOpenWorldCreatorArtifactEditCoreV1(selection)
}

async function resolveTextOpenWorldCreatorMediaProviderV1(input: {
  scope: WorkspaceScope
  buildId: number
  now?: number
}): Promise<ResolvedProductMediaCapabilityV1> {
  const authority = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
    scope: input.scope,
    buildId: input.buildId,
  })
  const visualTask = authority.productionPlan.tasks.find(task => task.taskKey === 'media.visual')
  const requirementKey = visualTask?.capabilityRequirementKeys[0]
  const requirement = authority.contracts.executionBrief.capabilityRequirements.find(item => (
    item.requirementKey === requirementKey && item.mediaClass === 'image'
  ))
  if (!visualTask || !requirement) {
    throw new Error('[product-production-service] 当前 Creator Build 缺少图片生产能力合同')
  }
  const agnes = inspectConfiguredAgnesImageCapabilityV1({ projectId: input.scope.projectId })
  if (agnes.ready) {
    return resolveConfiguredAgnesImageCapabilityV1({
      projectId: input.scope.projectId,
      requirement,
      now: input.now,
    })
  }
  const relayUrl = configuredMediaRelayUrlV1()
  if (relayUrl) {
    return resolveTrustedRelayMediaCapabilityV1({ requirement, relayUrl, now: input.now })
  }
  throw new Error(`[product-production-service] capability-unbound: ${agnes.issue || '没有可用的图片 Provider 或可信 Relay。'}`)
}

/** Store one author-selected image in the product-owned content-addressed Blob
 * store. The returned id is a local locator only and never enters the durable
 * command/result contract. */
export async function importTextOpenWorldCreatorMediaBlobV1(input: {
  scope: WorkspaceScope
  data: ArrayBuffer
}): Promise<{
  blobObjectId: number
  contentHash: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  byteSize: number
  width: number
  height: number
}> {
  const mimeType = detectProductMediaMimeTypeV1(input.data)
  const dimensions = detectProductImageDimensionsV1(input.data)
  if (!mimeType || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || !dimensions) {
    throw new Error('[product-production-service] 只允许导入可验证的 PNG、JPEG 或 WebP 图片')
  }
  const row = await putMediaBlobObject({ scope: input.scope, data: input.data, mimeType })
  if (row.id == null) throw new Error('[product-production-service] 导入图片没有形成持久 Blob')
  return {
    blobObjectId: row.id,
    contentHash: row.contentHash,
    mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
    byteSize: row.byteSize,
    width: dimensions.width,
    height: dimensions.height,
  }
}

export function inspectTextOpenWorldCreatorMediaWorkspaceV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}) {
  return inspectTextOpenWorldCreatorMediaWorkspaceCoreV1(input)
}

export async function previewTextOpenWorldCreatorMediaV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  mode: TextOpenWorldCreatorMediaModeV1
  maximumCostUsd?: number
  imports?: TextOpenWorldCreatorMediaImportInputV1[]
  now?: number
}): Promise<TextOpenWorldCreatorMediaPreparationV1> {
  const provider = input.mode === 'provider-generate'
    ? await resolveTextOpenWorldCreatorMediaProviderV1({
        scope: input.scope,
        buildId: input.buildId,
        now: input.now,
      })
    : null
  return prepareTextOpenWorldCreatorMediaCoreV1({
    scope: input.scope,
    productionId: input.productionId,
    buildId: input.buildId,
    mode: input.mode,
    maximumCostUsd: input.maximumCostUsd,
    provider,
    imports: input.imports,
  })
}

export async function authorizeTextOpenWorldCreatorMediaV1(input: {
  prepared: TextOpenWorldCreatorMediaPreparationV1
  acknowledgement: {
    completeBundle: boolean
    rightsAndProvenance: boolean
    costAndProvider: boolean
    oldBuildImmutable: boolean
  }
  authorizationNonce?: string
  authorizedAt?: number
}): Promise<ProductProductionCommandReceiptV1> {
  if (Object.values(input.acknowledgement).some(value => value !== true)) {
    throw new Error('[product-production-service] 创建媒资 Build 前必须完成四项显式确认')
  }
  const plan = input.prepared.mediaPlan
  return executeProductProductionCommand({
    scope: input.prepared.scope,
    productionId: input.prepared.production.id,
    preparedCreatorMedia: input.prepared,
    command: {
      type: 'authorize-text-open-world-creator-media',
      commandId: `tow-creator-media:${crypto.randomUUID()}`,
      expectedStateRevision: input.prepared.production.stateRevision,
      baseBuildNumber: plan.baseBuild.buildNumber,
      expectedBasePlanHash: plan.baseBuild.planHash,
      expectedMediaPlanHash: plan.planHash,
      expectedTargetPlanHash: input.prepared.targetPlanHash,
      mode: plan.mode,
      acknowledgement: {
        completeBundle: true,
        rightsAndProvenance: true,
        costAndProvider: true,
        oldBuildImmutable: true,
      },
      authorizationNonce: input.authorizationNonce ?? crypto.randomUUID(),
      authorizedAt: input.authorizedAt ?? Date.now(),
    },
  })
}

export async function previewTextOpenWorldCreatorArtifactRepairV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}) {
  const prepared = await prepareTextOpenWorldCreatorArtifactRepairCoreV1(input)
  return {
    productionId: prepared.production.id,
    productionStateRevision: prepared.production.stateRevision,
    baseBuildId: prepared.baseBuild.id,
    baseBuildNumber: prepared.baseBuild.buildNumber,
    basePlanHash: prepared.baseBuild.planHash,
    targetPlanHash: prepared.targetPlanHash,
    impactPlan: prepared.impactPlan,
  }
}

export async function authorizeTextOpenWorldCreatorArtifactRepairV1(input: {
  scope: WorkspaceScope
  productionId: number
  expectedStateRevision: number
  baseBuildNumber: number
  expectedBasePlanHash: string
  expectedHandoffSetHash: string
  expectedImpactPlanHash: string
  expectedTargetPlanHash: string
  authorizationNonce?: string
  authorizedAt?: number
}): Promise<ProductProductionCommandReceiptV1> {
  return executeProductProductionCommand({
    scope: input.scope,
    productionId: input.productionId,
    command: {
      type: 'authorize-text-open-world-creator-repair',
      commandId: `tow-creator-repair:${crypto.randomUUID()}`,
      expectedStateRevision: input.expectedStateRevision,
      baseBuildNumber: input.baseBuildNumber,
      expectedBasePlanHash: input.expectedBasePlanHash,
      expectedHandoffSetHash: input.expectedHandoffSetHash,
      expectedImpactPlanHash: input.expectedImpactPlanHash,
      expectedTargetPlanHash: input.expectedTargetPlanHash,
      authorizationNonce: input.authorizationNonce ?? crypto.randomUUID(),
      authorizedAt: input.authorizedAt ?? Date.now(),
    },
  })
}

export function generateTextOpenWorldCreatorArtifactEditCandidateV1(input:
  | {
    selection: TextOpenWorldCreatorArtifactEditSelectionV1
    mode: 'direct'
    operations: readonly TextOpenWorldCreatorEditPatchOperationV1[]
    signal?: AbortSignal
  }
  | {
    selection: TextOpenWorldCreatorArtifactEditSelectionV1
    mode: 'agent'
    authorInstruction: string
    signal?: AbortSignal
  }) {
  return input.mode === 'direct'
    ? generateTextOpenWorldCreatorArtifactEditCandidateCoreV1({
        selection: input.selection,
        mode: 'direct',
        operations: input.operations,
        signal: input.signal,
      })
    : generateTextOpenWorldCreatorArtifactEditCandidateCoreV1({
        selection: input.selection,
        mode: 'agent',
        authorInstruction: input.authorInstruction,
        signal: input.signal,
        aiConfig: useAIConfigStore.getState().config,
      })
}

export function readLatestTextOpenWorldCreatorArtifactEditStateV1(input: {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
}) {
  return readLatestTextOpenWorldCreatorArtifactEditStateCoreV1(input.selection)
}

export function resumeTextOpenWorldCreatorArtifactEditIntakeV1(input: {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
  signal?: AbortSignal
}) {
  return resumeTextOpenWorldCreatorArtifactEditIntakeCoreV1({
    selection: input.selection,
    runId: input.runId,
    signal: input.signal,
    aiConfig: useAIConfigStore.getState().config,
  })
}

export function cancelTextOpenWorldCreatorArtifactEditIntakeV1(input: {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
}) {
  return cancelTextOpenWorldCreatorArtifactEditIntakeCoreV1({
    selection: input.selection,
    runId: input.runId,
  })
}

export function reviseTextOpenWorldCreatorArtifactEditCandidateV1(input: {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
  operations: readonly TextOpenWorldCreatorEditPatchOperationV1[]
}) {
  if (!input.operations.length) {
    throw new Error('[product-production-service] 候选修订必须提供字段操作；Agent 不会隐式追加第二次模型调用')
  }
  return reviseTextOpenWorldCreatorArtifactEditCandidateCoreV1({
    selection: input.selection,
    runId: input.runId,
    operations: input.operations,
  })
}

export function abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1(input: {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
  acknowledgePossibleCharge: true
}) {
  return abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeCoreV1({
    selection: input.selection,
    runId: input.runId,
    acknowledgePossibleCharge: true,
  })
}

export function rejectTextOpenWorldCreatorArtifactEditCandidateV1(input: {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
}) {
  return rejectTextOpenWorldCreatorArtifactEditCandidateCoreV1({
    selection: input.selection,
    runId: input.runId,
  })
}

export function confirmTextOpenWorldCreatorArtifactEditIntentV1(input: {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
  warningAcknowledgementCodes: readonly string[]
}) {
  return confirmTextOpenWorldCreatorArtifactEditIntentCoreV1({
    selection: input.selection,
    runId: input.runId,
    warningAcknowledgementCodes: input.warningAcknowledgementCodes,
  })
}

/** Author-only inspection of evidence already bound to the current Build task. */
export async function readProductProductionTaskEvidenceV1(input: {
  scope: WorkspaceScope
  productionId: number
  taskKey: string
}): Promise<Array<{ attempt: number; kind: string; content: string }>> {
  const scope = await resolveScope({ scope: input.scope })
  const progress = await projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
  const task = progress.tasks.find(item => item.taskKey === input.taskKey)
  if (!task?.runId) return []
  const snapshot = await readAgentRunV1(scope, task.runId)
  const boundary = snapshot.contract.scope.productProduction
  if (snapshot.run.productBuildId !== progress.buildId
    || snapshot.run.parentRunId !== progress.rootRunId
    || snapshot.run.parentRelation !== `task:${input.taskKey}`
    || !boundary
    || boundary.productBuildId !== progress.buildId
    || boundary.controlEpoch !== progress.controlEpoch
    || boundary.planHash !== progress.planHash
    || boundary.taskKey !== input.taskKey) {
    throw new Error('任务证据不属于当前 Build/task Run')
  }
  const isCurrentGovernedAttempt = (stepId: string | undefined, attempt: number | undefined) => {
    if (stepId == null || attempt == null) return false
    const step = snapshot.projection.steps[stepId]
    if (!step || step.attempt !== attempt) return false
    if (stepId === input.taskKey) return true
    return input.taskKey === 'p1.source-curation'
      && stepId.startsWith(`${input.taskKey}.world.source-curation.batch.`)
      && ['succeeded', 'failed'].includes(step.status)
  }
  const result: Array<{ attempt: number; kind: string; content: string }> = []
  for (const event of snapshot.events) {
    if (event.type === 'evidence.artifact.recorded'
      && isCurrentGovernedAttempt(event.payload.stepId, event.payload.attempt)
      && ['raw-response', 'source-snapshot', 'tool-result'].includes(event.payload.artifactKind)) {
      const content = await readAgentRunArtifactExactV1({
        projectId: scope.projectId, artifactKind: event.payload.artifactKind,
        contentHash: event.payload.contentHash,
      })
      result.push({ attempt: event.payload.attempt ?? 0, kind: event.payload.artifactKind, content })
    }
    if (event.type === 'step.failed'
      && isCurrentGovernedAttempt(event.payload.stepId, event.payload.attempt)) {
      result.push({ attempt: event.payload.attempt, kind: 'failure', content: event.payload.code })
    }
  }
  return result
}

export interface ProductProductionCapabilityReadinessV1 {
  text: ConfiguredTextCapabilityReadinessV1
  image: ConfiguredAgnesImageReadinessV1
  authoredImagePackConfigured: boolean
  authoredImagePackReady: boolean
  authoredImagePackManifestPath: string | null
  authoredImagePackIssue: string | null
  mediaRelayConfigured: boolean
  mediaRelayReady: boolean
  mediaRelayOrigin: string | null
  mediaRelayIssue: string | null
}

export interface ProductProductionAuthorizationReadinessV1 {
  ready: boolean
  blockerCode: 'capability-unbound' | null
  blockerMessages: string[]
  requiredMediaRequirementKeys: string[]
}

export interface ProductProductionReviewArtifactV1 {
  artifactKey: string
  kind: ProductBuildArtifactKindV1
  version: number
  status: 'accepted' | 'carried-forward'
  contentHash: string
  byteSize: number
  producerRunId: number | null
  payload: unknown
  quality: unknown
}

export interface TextAdventureMediaAssetV1 {
  assetKey: string
  artifactKey: string
  version: number
  status: 'accepted' | 'carried-forward'
  contentHash: string
  blobObjectId: number
  mediaKind: ProductMediaKind
  mimeType: string
  byteSize: number
  metadata: Record<string, unknown>
  quality: Record<string, unknown>
  rights: Record<string, unknown>
  locked: boolean
}

function productProductionFailureTaskKey(build: ProductBuildRecordV1 | null): string | null {
  if (!build) return null
  try {
    const failure = JSON.parse(build.failureJson) as { taskKey?: unknown }
    return typeof failure.taskKey === 'string' ? failure.taskKey : null
  } catch { return null }
}

export function isTextAdventureSourceDecisionBlockerV1(details: ProductProductionDetailsV1): boolean {
  return details.production.productType === 'text-adventure'
    && details.build?.status === 'recovery-required'
    && productProductionFailureTaskKey(details.build) === 'source.author-gate'
}

export function isTextAdventureMediaAnchorBlockerV1(details: ProductProductionDetailsV1): boolean {
  return details.production.productType === 'text-adventure'
    && details.build?.status === 'recovery-required'
    && productProductionFailureTaskKey(details.build) === 'media.anchor-author-gate'
}

export function canRetryProductProductionBlockerV1(details: ProductProductionDetailsV1): boolean {
  return (details.build?.status === 'recovery-required'
      && !isTextAdventureSourceDecisionBlockerV1(details)
      && !isTextAdventureMediaAnchorBlockerV1(details))
    || !!details.build && isRepairRetryableFailedProductBuildV1(details.build)
}

export function canUpgradeTextAdventureProductionPlanV1(details: ProductProductionDetailsV1): boolean {
  return details.production.productType === 'text-adventure'
    && details.production.status === 'producing'
    && !!details.build
    && canUpgradeTextAdventureExecutionPlanV1(details.build)
}

export function canRepairTextAdventureVisualContractV1(details: ProductProductionDetailsV1): boolean {
  return details.production.productType === 'text-adventure'
    && !!details.build
    && (details.production.status === 'producing' || details.production.status === 'stopped')
    && canReviseTextAdventureVisualContractFromRecoveryV1(details.build)
}

export function canRepairTextAdventureRuntimeCopyV1(details: ProductProductionDetailsV1): boolean {
  return details.production.productType === 'text-adventure'
    && details.production.status === 'producing'
    && !!details.build
    && canReviseTextAdventureRuntimeCopyFromRecoveryV1(details.build)
}

const AUTHOR_REVIEW_ARTIFACT_KEYS = new Set([
  'production.supervision',
  'design.game',
  'content.source-sufficiency',
  'content.source-decision',
  'content.story-bible',
  'content.cast-bible',
  'content.adventure-architecture',
  'content.narrative-arc-scenes',
  'content.narrative-decision-plan',
  'content.narrative-arc-plan',
  'content.ending-route-plan',
  'content.main-quest-plan',
  'content.quest-script.supplemental',
  'content.quest-script',
  'content.scene-script.act-1',
  'content.scene-script.act-2',
  'content.scene-script.act-3',
  'content.dialogue-pass.act-1',
  'content.dialogue-pass.act-2',
  'content.dialogue-pass.act-3',
  'content.narrative',
  'content.product-module',
  'content.adventure-side-quests',
  'content.adventure-ambient-events',
  'quality.adventure-review',
  'media.requirements',
  'media.visual-bible',
  'media.vision-preflight',
  'media.anchor-decision',
  'media.audit',
  'runtime.package',
  'quality.autoplay',
  'quality.visual-review',
  'media.repair-feedback',
  'quality.report',
  'quality.playtest-plan',
])

export async function listProductProductionReviewArtifactsV1(input: {
  scope: WorkspaceScope
  buildId: number
}): Promise<ProductProductionReviewArtifactV1[]> {
  const rows = await readAcceptedBuildArtifacts(input)
  return rows.filter(row => AUTHOR_REVIEW_ARTIFACT_KEYS.has(row.artifactKey)
    || /^content\.quest-script\.main\.act-[1-3]\.(single|multi)$/.test(row.artifactKey)
    || /^content\.scene-script\.act-[1-3]\.part-[1-2]$/.test(row.artifactKey)).map(row => ({
    artifactKey: row.artifactKey,
    kind: row.kind,
    version: row.version,
    status: row.status as 'accepted' | 'carried-forward',
    contentHash: row.contentHash,
    byteSize: row.byteSize,
    producerRunId: row.producerRunId,
    payload: JSON.parse(row.payloadJson) as unknown,
    quality: JSON.parse(row.qualityJson) as unknown,
  }))
}

export async function listTextAdventureMediaAssetsV1(input: {
  scope: WorkspaceScope
  buildId: number
}): Promise<TextAdventureMediaAssetV1[]> {
  const rows = await readAcceptedBuildArtifacts(input)
  return rows.filter(row => row.kind === 'image' && row.mediaKind != null
    && row.blobObjectId != null && row.mimeType != null && row.artifactKey.startsWith('media.visual.'))
    .map(row => {
      const metadata = JSON.parse(row.metadataJson) as Record<string, unknown>
      if (typeof metadata.assetKey !== 'string' || !metadata.assetKey.trim()) {
        throw new Error(`[product-production-service] 图片缺少稳定 assetKey:${row.artifactKey}`)
      }
      const revision = metadata.authorRevision
      return {
        assetKey: metadata.assetKey, artifactKey: row.artifactKey, version: row.version,
        status: row.status as 'accepted' | 'carried-forward', contentHash: row.contentHash,
        blobObjectId: row.blobObjectId!, mediaKind: row.mediaKind!, mimeType: row.mimeType!,
        byteSize: row.byteSize, metadata, quality: JSON.parse(row.qualityJson) as Record<string, unknown>,
        rights: JSON.parse(row.rightsJson) as Record<string, unknown>,
        locked: !!revision && typeof revision === 'object' && !Array.isArray(revision)
          && (revision as Record<string, unknown>).locked === true,
      }
    }).sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
}

export async function readTextAdventureMediaAssetBytesV1(input: {
  scope: WorkspaceScope
  asset: TextAdventureMediaAssetV1
}): Promise<ArrayBuffer> {
  return readMediaBlobObjectData({
    scope: input.scope, blobObjectId: input.asset.blobObjectId,
    expected: {
      contentHash: input.asset.contentHash,
      byteSize: input.asset.byteSize,
      mimeType: input.asset.mimeType,
    },
  })
}

async function decodeUploadedImageSize(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    try { return { width: bitmap.width, height: bitmap.height } }
    finally { bitmap.close() }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('[product-production-service] 无法解码作者上传的图片'))
    }
    image.src = url
  })
}

export async function reviseTextAdventureMediaAssetV1(input: {
  scope: WorkspaceScope
  details: ProductProductionDetailsV1
  asset: TextAdventureMediaAssetV1
  action: 'upload-replacement' | 'regenerate' | 'lock' | 'unlock'
  repairFeedback?: {
    sourceGateReceiptHash: string
    sourceEvidenceHash: string
    priorContentHash: string
    note: string
  }
  upload?: {
    file: File
    altText: string
    license: string
    commercialUse: boolean
    redistribution: boolean
    declaration: string
    attribution: string
  }
}): Promise<{ parentBuildNumber: number; buildNumber: number }> {
  const build = input.details.build
  if (!build || input.details.production.productType !== 'text-adventure') {
    throw new Error('[product-production-service] 缺少可修订的文字冒险 Build')
  }
  let uploadContract: Extract<import('../types').ProductProductionCommandV1, {
    type: 'revise-media-asset'
  }>['replacement'] = null
  if (input.action === 'upload-replacement') {
    if (!input.upload) throw new Error('[product-production-service] 上传替换缺少图片与权利声明')
    const mimeType = input.upload.file.type.trim().toLowerCase()
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
      throw new Error('[product-production-service] 只允许 PNG、JPEG 或 WebP 图片')
    }
    const data = await input.upload.file.arrayBuffer()
    const size = await decodeUploadedImageSize(input.upload.file)
    const blob = await putMediaBlobObject({ scope: input.scope, data, mimeType })
    uploadContract = {
      blobObjectId: blob.id!, contentHash: blob.contentHash,
      mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp', byteSize: blob.byteSize,
      width: size.width, height: size.height,
      altText: input.upload.altText.trim(), license: input.upload.license.trim(),
      commercialUse: input.upload.commercialUse, redistribution: input.upload.redistribution,
      declaration: input.upload.declaration.trim(), attribution: input.upload.attribution.trim() || '无需署名',
    }
  } else if (input.upload) {
    throw new Error('[product-production-service] 非上传操作不能携带图片')
  }
  const repairFeedback = input.repairFeedback ? {
    ...input.repairFeedback,
    note: input.repairFeedback.note.trim().normalize('NFC'),
  } : null
  if (input.action === 'regenerate' && (!repairFeedback
    || repairFeedback.priorContentHash !== input.asset.contentHash || !repairFeedback.note)) {
    throw new Error('[product-production-service] 重生成必须绑定当前图片的作者退回回执与非空修订意见')
  }
  if (input.action !== 'regenerate' && repairFeedback) {
    throw new Error('[product-production-service] 只有重生成可以携带作者退回证据')
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.details.production.id!,
    command: {
      type: 'revise-media-asset', commandId: commandId(`media-${input.action}`),
      expectedStateRevision: input.details.production.stateRevision,
      buildNumber: build.buildNumber, artifactKey: input.asset.artifactKey,
      expectedArtifactHash: input.asset.contentHash, action: input.action,
      repairFeedback,
      replacement: uploadContract,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '媒资修订失败'))
  return {
    parentBuildNumber: Number(receipt.result.parentBuildNumber),
    buildNumber: Number(receipt.result.buildNumber),
  }
}

export async function regenerateTextAdventureMediaAssetsV1(input: {
  scope: WorkspaceScope
  details: ProductProductionDetailsV1
  assets: TextAdventureMediaAssetV1[]
}): Promise<{ parentBuildNumber: number; buildNumber: number; artifactKeys: string[] }> {
  const build = input.details.build
  if (!build || input.details.production.productType !== 'text-adventure') {
    throw new Error('[product-production-service] 缺少可批量修复的文字冒险 Build')
  }
  const targets = input.assets.map(asset => ({
    artifactKey: asset.artifactKey, expectedArtifactHash: asset.contentHash,
  }))
  if (!targets.length || new Set(targets.map(target => target.artifactKey)).size !== targets.length) {
    throw new Error('[product-production-service] 批量媒资修复目标为空或重复')
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.details.production.id!,
    command: {
      type: 'revise-media-assets', commandId: commandId('media-batch-regenerate'),
      expectedStateRevision: input.details.production.stateRevision,
      buildNumber: build.buildNumber, action: 'regenerate', targets,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '批量媒资修复失败'))
  return {
    parentBuildNumber: Number(receipt.result.parentBuildNumber),
    buildNumber: Number(receipt.result.buildNumber),
    artifactKeys: Array.isArray(receipt.result.artifactKeys)
      ? receipt.result.artifactKeys.map(String) : targets.map(target => target.artifactKey),
  }
}

/** Safe preflight only; never returns a provider credential or performs a call. */
export function inspectProductProductionCapabilityReadinessV1(input: {
  projectId: number
}): ProductProductionCapabilityReadinessV1 {
  const relay = inspectTrustedRelayMediaConfigurationV1()
  const authoredPack = inspectAuthoredImagePackConfigurationV1()
  return {
    text: inspectConfiguredTextCapabilityV1({
      projectId: input.projectId,
      category: 'product-production',
    }),
    image: inspectConfiguredAgnesImageCapabilityV1({ projectId: input.projectId }),
    authoredImagePackConfigured: authoredPack.configured,
    authoredImagePackReady: authoredPack.ready,
    authoredImagePackManifestPath: authoredPack.manifestPath,
    authoredImagePackIssue: authoredPack.issue,
    mediaRelayConfigured: relay.configured,
    mediaRelayReady: relay.ready,
    mediaRelayOrigin: relay.relayOrigin,
    mediaRelayIssue: relay.issue,
  }
}

/**
 * Pure authorization gate shared by service and UI. A Brief may be drafted
 * while capabilities are unavailable, but no Build is created until every
 * capability required by that frozen Brief is bound.
 */
export function evaluateProductProductionAuthorizationReadinessV1(input: {
  brief: Pick<ProductProductionBriefV3, 'capabilityRequirements' | 'avgRevision'>
  readiness: ProductProductionCapabilityReadinessV1
}): ProductProductionAuthorizationReadinessV1 {
  const blockerMessages: string[] = []
  if (!input.brief.avgRevision && !input.readiness.text.ready) {
    blockerMessages.push(input.readiness.text.issue || '设置中的文本生成能力尚未就绪。')
  }
  const requiredMediaRequirementKeys = input.brief.capabilityRequirements
    .filter(requirement => requirement.required && ['image', 'music', 'sfx'].includes(requirement.mediaClass))
    .map(requirement => requirement.requirementKey)
  const requiresImage = input.brief.capabilityRequirements
    .some(requirement => requirement.required && requirement.mediaClass === 'image')
  const requiresAudio = input.brief.capabilityRequirements
    .some(requirement => requirement.required && ['music', 'sfx'].includes(requirement.mediaClass))
  if (requiresImage && !input.readiness.image.ready && !input.readiness.mediaRelayReady) {
    blockerMessages.push(input.readiness.image.issue || '全局 Agnes 图片能力尚未就绪。')
  }
  if (requiresAudio && !input.readiness.mediaRelayReady) {
    blockerMessages.push(input.readiness.mediaRelayIssue || '商业音乐与音效可信中继尚未绑定。')
  }
  return {
    ready: blockerMessages.length === 0,
    blockerCode: blockerMessages.length === 0 ? null : 'capability-unbound',
    blockerMessages,
    requiredMediaRequirementKeys,
  }
}

/**
 * Read-only provider catalog for capability selection and blocker UI. Listing
 * it never resolves credentials or makes a provider request.
 */
export function listProductProductionMediaCapabilitiesV1(): ProductMediaProviderCapabilityV1[] {
  return listProductMediaProviderCapabilitiesV1()
}

function commandId(prefix: string): string {
  return `${prefix}.${crypto.randomUUID()}`
}

export interface TextOpenWorldCreatorStartInputV1 {
  scope: WorkspaceScope
  productionId: number
  briefRevision: number
  briefHash: string
  expectedStateRevision: number
  sourceLocator: TextOpenWorldCreatorSourceLocatorV1
  preflight: TextOpenWorldCreatorProductionPreflightV1
  confirmation: TextOpenWorldCreatorProductionPreflightConfirmationV1
  rightsBasis: TextOpenWorldSourceRightsBasisV1
  rightsNote: string
  authorizationNonce: string
  authorizedAt: number
}

/** Zero-write deterministic plan preview shown before the author starts. */
export async function previewTextOpenWorldCreatorProductionStartV1(
  input: TextOpenWorldCreatorStartInputV1,
): Promise<TextOpenWorldCreatorStartPreparationV1> {
  const state = useAIConfigStore.getState()
  return createTextOpenWorldCreatorStartPreparationV1({
    ...input,
    aiConfig: state.config,
    rememberApiKey: state.rememberApiKey,
  })
}

/** Repeats the full CAS and atomically freezes SourcePlan/Start/Plan/Build. */
export async function authorizeTextOpenWorldCreatorProductionStartV1(
  input: TextOpenWorldCreatorStartInputV1 & { expectedPlanHash: string },
): Promise<ProductProductionCommandReceiptV1> {
  const receipt = await executeProductProductionCommand({
    scope: input.scope,
    productionId: input.productionId,
    now: input.authorizedAt,
    command: {
      type: 'authorize-text-open-world-creator-start',
      commandId: 'text-open-world.start.' + input.confirmation.confirmationHash.slice(0, 16)
        + '.' + input.expectedPlanHash.slice(0, 12),
      expectedStateRevision: input.expectedStateRevision,
      briefRevision: input.briefRevision,
      briefHash: input.briefHash,
      sourceLocator: input.sourceLocator,
      preflight: input.preflight,
      confirmation: input.confirmation,
      rightsBasis: input.rightsBasis,
      rightsNote: input.rightsNote,
      authorizationNonce: input.authorizationNonce,
      expectedPlanHash: input.expectedPlanHash,
      authorizedAt: input.authorizedAt,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '文字开放世界启动失败'))
  return receipt
}

export async function listProductProductionWorkspaceV1(
  scopeInput: WorkspaceScope,
  allowedProducts: readonly ProductionProductKindV1[],
): Promise<{
  worldReleases: WorldReferenceCatalogEntryV1[]
  productions: ProductProductionRecordV1[]
}> {
  const scope = await resolveScope({ scope: scopeInput })
  const [worldReleases, rows] = await Promise.all([
    listWorldReferenceCatalogV1(scope),
    db.productProductions.where('workId').equals(scope.workId).toArray(),
  ])
  const productions: ProductProductionRecordV1[] = []
  for (const row of rows) {
    if (allowedProducts.includes(row.productType)
      && await assertRecordInScope(scope, 'productProductions', row, { owner: 'work' })) productions.push(row)
  }
  worldReleases.sort((left, right) => (
    right.reference.releaseVersion - left.reference.releaseVersion || right.createdAt - left.createdAt
  ))
  productions.sort((left, right) => right.updatedAt - left.updatedAt)
  return { worldReleases, productions }
}

export async function readProductProductionDetailsV1(
  scopeInput: WorkspaceScope,
  productionId: number,
  allowedProducts?: readonly ProductionProductKindV1[],
): Promise<ProductProductionDetailsV1> {
  const scope = await resolveScope({ scope: scopeInput })
  const production = await db.productProductions.get(productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) {
    throw new Error('[product-production-service] Production 不存在或跨 Work')
  }
  if (allowedProducts && !allowedProducts.includes(production.productType)) {
    throw new Error('[product-production-service] Production 不属于当前产品入口')
  }
  const [brief, build, commandRows, briefRows, buildRows] = await Promise.all([
    production.currentBriefRevision == null ? null : db.productProductionBriefs
      .where('[productionId+revision]').equals([productionId, production.currentBriefRevision]).first(),
    production.currentBuildNumber == null ? null : db.productBuilds
      .where('[productionId+buildNumber]').equals([productionId, production.currentBuildNumber]).first(),
    db.productProductionCommands.where('productionId').equals(productionId).toArray(),
    db.productProductionBriefs.where('productionId').equals(productionId).toArray(),
    db.productBuilds.where('productionId').equals(productionId).toArray(),
  ])
  if (brief && !await assertRecordInScope(scope, 'productProductionBriefs', brief, { owner: 'work' })) {
    throw new Error('[product-production-service] Brief 跨 Work')
  }
  if (build && !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) {
    throw new Error('[product-production-service] Build 跨 Work')
  }
  const recentCommands: ProductProductionCommandRecordV1[] = []
  for (const command of commandRows
    .sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
    .slice(0, 8)) {
    if (!await assertRecordInScope(scope, 'productProductionCommands', command, { owner: 'work' })) {
      throw new Error('[product-production-service] Command 跨 Work')
    }
    recentCommands.push(command)
  }
  const briefHistory: ProductProductionBriefRecordV1[] = []
  for (const row of briefRows.sort((left, right) => right.revision - left.revision)) {
    if (!await assertRecordInScope(scope, 'productProductionBriefs', row, { owner: 'work' })) {
      throw new Error('[product-production-service] Brief history 跨 Work')
    }
    briefHistory.push(row)
  }
  const buildHistory: ProductBuildRecordV1[] = []
  for (const row of buildRows.sort((left, right) => right.buildNumber - left.buildNumber)) {
    if (!await assertRecordInScope(scope, 'productBuilds', row, { owner: 'work' })) {
      throw new Error('[product-production-service] Build history 跨 Work')
    }
    buildHistory.push(row)
  }
  const executionBrief = brief?.briefKind === 'text-open-world-creator-v1'
    ? brief.status === 'authorized' && build
      ? (await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
          scope,
          buildId: build.id!,
        })).contracts.executionBrief
      : null
    : brief ? parseProductProductionBriefV3(brief.briefJson) : null
  return {
    production,
    brief: brief ?? null,
    executionBrief,
    build: build ?? null,
    artifactCount: build?.id == null ? 0 : await db.productBuildArtifacts.where('buildId').equals(build.id).count(),
    recentCommands,
    briefHistory,
    buildHistory,
  }
}

export async function consultProductProductionStartV1(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}) {
  return suggestProductStartingPoints(input)
}

export async function compileProductProductionBriefV3(
  input: Parameters<typeof draftProductProductionBriefV3>[0],
) {
  return draftProductProductionBriefV3(input)
}

export async function createProductProductionWithBriefV1(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  title: string
  brief: ProductProductionBriefV3
}): Promise<number> {
  const title = input.title.trim()
  if (!title) throw new Error('[product-production-service] 游戏标题不能为空')
  const productionKey = `productprod.${Date.now().toString(36)}.${crypto.randomUUID().slice(0, 8)}`
  const created = await executeProductProductionCommand({
    scope: input.scope,
    command: {
      type: 'create-intent', commandId: commandId('intent'), productionKey,
      productType: input.brief.intent.productType,
      worldReleaseId: input.worldReleaseId, userText: title,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: input.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: commandId('brief'), expectedStateRevision: 0,
      parentRevision: null, brief: input.brief,
    },
  })
  if (!saved.ok) throw new Error(String(saved.result.message ?? saved.errorCode ?? 'Brief 保存失败'))
  return created.productionId
}

/**
 * Builds a reviewable replacement for a legacy commercial text-adventure
 * Brief whose frozen image count predates the current recommendation floor.
 * This is deliberately pure: the author must save the revision and then
 * authorize a new Build in two separate commands.
 */
export function draftTextAdventureCommercialMediaRepairV1(
  details: ProductProductionDetailsV1,
): ProductProductionBriefV3 {
  if (details.production.productType !== 'text-adventure'
    || details.production.status !== 'stopped'
    || details.build?.status !== 'cancelled'
    || !details.brief) {
    throw new Error('[product-production-service] 只有已取消的文字冒险 Build 可以生成商业媒资修订 Brief')
  }
  const brief = parseProductProductionBriefV3(details.brief.briefJson)
  if (brief.qualityProfile !== 'commercial-candidate' || !brief.textAdventure) {
    throw new Error('[product-production-service] 当前 Brief 不是商业文字冒险')
  }
  const minimum = minimumTextAdventureCommercialImageCountV1(brief.textAdventure.media.mode)
  if (minimum === 0 || brief.media.imageCount >= minimum) {
    throw new Error('[product-production-service] 当前 Brief 已满足商业媒资底线，无需自动修订')
  }
  return parseProductProductionBriefV3({
    ...brief,
    media: { ...brief.media, imageCount: minimum },
    productionBudget: {
      ...brief.productionBudget,
      maximumMediaCalls: Math.max(
        brief.productionBudget.maximumMediaCalls,
        minimum + brief.media.musicTrackCount + brief.media.sfxCount,
      ),
    },
  })
}

/**
 * Upgrades a stopped legacy commercial candidate to the minimum envelope used
 * by the current one-hour flagship pipeline. This is a reviewable Brief only:
 * the cancelled Build and its paid-attempt evidence remain immutable, and a
 * new Build still requires the normal save + authorize commands.
 */
export function draftTextAdventureCommunityCandidateRepairV1(
  details: ProductProductionDetailsV1,
): ProductProductionBriefV3 {
  if (details.production.productType !== 'text-adventure'
    || details.production.status !== 'stopped'
    || details.build?.status !== 'cancelled'
    || !details.brief) {
    throw new Error('[product-production-service] 只有已取消的文字冒险 Build 可以生成社区候选修订 Brief')
  }
  const brief = parseProductProductionBriefV3(details.brief.briefJson)
  if (brief.qualityProfile !== 'commercial-candidate' || !brief.textAdventure) {
    throw new Error('[product-production-service] 当前 Brief 不是商业文字冒险')
  }
  const minimumImages = minimumTextAdventureCommercialImageCountV1(brief.textAdventure.media.mode)
  const targetEndingCount = Math.max(
    3, brief.scale.targetEndingCount, brief.textAdventure.narrative.targetEndingCount,
  )
  const repairedContent = parseProductProductionBriefV3({
    ...brief,
    scale: {
      ...brief.scale,
      scope: brief.scale.scope === 'scene' ? 'short-arc' : brief.scale.scope,
      targetPlayMinutes: Math.max(60, brief.scale.targetPlayMinutes),
      targetWordCount: Math.max(10_000, brief.scale.targetWordCount),
      targetEndingCount,
    },
    textAdventure: {
      ...brief.textAdventure,
      narrative: {
        ...brief.textAdventure.narrative,
        targetRegionCount: Math.max(2, brief.textAdventure.narrative.targetRegionCount),
        targetAreaCount: Math.max(4, brief.textAdventure.narrative.targetAreaCount),
        targetLocationCount: Math.max(8, brief.textAdventure.narrative.targetLocationCount),
        targetSceneCount: Math.max(12, brief.textAdventure.narrative.targetSceneCount),
        targetSideQuestCount: Math.max(3, brief.textAdventure.narrative.targetSideQuestCount),
        targetAmbientEventCount: Math.max(4, brief.textAdventure.narrative.targetAmbientEventCount),
        targetEndingCount,
        minimumDistinctRoutes: Math.max(2, brief.textAdventure.narrative.minimumDistinctRoutes),
      },
    },
    media: { ...brief.media, imageCount: Math.max(minimumImages, brief.media.imageCount) },
  })
  const floor = textAdventureProductionBudgetFloorV1(repairedContent)
  return parseProductProductionBriefV3({
    ...repairedContent,
    productionBudget: {
      ...repairedContent.productionBudget,
      maximumModelCalls: Math.max(
        repairedContent.productionBudget.maximumModelCalls,
        floor.minimumModelCalls,
      ),
      maximumInputTokens: Math.max(
        repairedContent.productionBudget.maximumInputTokens,
        floor.minimumInputTokens,
      ),
      maximumOutputTokens: Math.max(
        repairedContent.productionBudget.maximumOutputTokens,
        floor.minimumOutputTokens,
      ),
      maximumDurationMs: Math.max(
        repairedContent.productionBudget.maximumDurationMs,
        floor.minimumDurationMs,
      ),
      maximumMediaCalls: Math.max(
        repairedContent.productionBudget.maximumMediaCalls,
        repairedContent.media.imageCount
          + repairedContent.media.musicTrackCount + repairedContent.media.sfxCount,
      ),
    },
  })
}

export function isTextAdventureCommunityCandidateRepairRequiredV1(
  details: ProductProductionDetailsV1,
): boolean {
  try {
    const current = parseProductProductionBriefV3(details.brief?.briefJson ?? '')
    const repaired = draftTextAdventureCommunityCandidateRepairV1(details)
    return current.scale.targetPlayMinutes !== repaired.scale.targetPlayMinutes
      || current.scale.targetWordCount !== repaired.scale.targetWordCount
      || current.scale.targetEndingCount !== repaired.scale.targetEndingCount
      || current.media.imageCount !== repaired.media.imageCount
      || current.productionBudget.maximumModelCalls !== repaired.productionBudget.maximumModelCalls
      || current.productionBudget.maximumInputTokens !== repaired.productionBudget.maximumInputTokens
      || current.productionBudget.maximumOutputTokens !== repaired.productionBudget.maximumOutputTokens
      || current.productionBudget.maximumMediaCalls !== repaired.productionBudget.maximumMediaCalls
      || current.textAdventure?.narrative.targetSceneCount
        !== repaired.textAdventure?.narrative.targetSceneCount
  } catch {
    return false
  }
}

/** Saves a candidate revision on the same stopped Production lineage. */
export async function saveStoppedProductProductionBriefRevisionV1(input: {
  scope: WorkspaceScope
  details: ProductProductionDetailsV1
  brief: ProductProductionBriefV3
}): Promise<void> {
  if (input.details.production.status !== 'stopped'
    || input.details.build?.status !== 'cancelled'
    || !input.details.brief) {
    throw new Error('[product-production-service] 当前 Production 没有可修订的已取消 Build')
  }
  if (input.brief.intent.productType !== input.details.production.productType
    || input.brief.source.worldReleaseId !== input.details.brief.sourceWorldReleaseId
    || input.brief.source.worldContentHash !== input.details.brief.sourceWorldContentHash) {
    throw new Error('[product-production-service] Brief 修订不得静默更换产品或冻结世界来源')
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope,
    productionId: input.details.production.id!,
    command: {
      type: 'save-brief-revision', commandId: commandId('brief-repair'),
      expectedStateRevision: input.details.production.stateRevision,
      parentRevision: input.details.brief.revision,
      brief: input.brief,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? 'Brief 修订保存失败'))
}

export async function authorizeProductProductionStartV1(input: {
  scope: WorkspaceScope
  details: ProductProductionDetailsV1
}): Promise<void> {
  const brief = input.details.brief
  if (!brief) throw new Error('[product-production-service] 缺少当前 Brief')
  const parsedBrief = parseProductProductionBriefV3(brief.briefJson)
  const readiness = evaluateProductProductionAuthorizationReadinessV1({
    brief: parsedBrief,
    readiness: inspectProductProductionCapabilityReadinessV1({ projectId: input.scope.projectId }),
  })
  if (!readiness.ready) {
    throw new Error(`[product-production-service] capability-unbound: ${readiness.blockerMessages.join('；')}`)
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.details.production.id!,
    command: {
      type: 'authorize-start', commandId: commandId('authorize'),
      expectedStateRevision: input.details.production.stateRevision,
      briefRevision: brief.revision, briefHash: brief.briefHash,
      authorizationNonce: `author.${crypto.randomUUID()}`,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '授权失败'))
}

export async function setProductProductionPausedV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
  build?: ProductBuildRecordV1 | null
  pausedReservationDisposition?: 'confirmed-not-charged' | 'charge-reservation-upper-bound'
}): Promise<'paused' | 'resumed'> {
  const paused = input.production.status === 'paused'
  let pausedReservationDispositions: Extract<
    import('../types').ProductProductionCommandV1,
    { type: 'resume' }
  >['pausedReservationDispositions']
  if (paused && input.build?.status === 'paused') {
    let failure: Record<string, unknown>
    try {
      const parsed = JSON.parse(input.build.failureJson) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
      failure = parsed as Record<string, unknown>
    } catch {
      throw new Error('[product-production-service] 暂停恢复证据损坏')
    }
    if (failure!.code !== 'pause-provider-result-unknown') {
      if (input.pausedReservationDisposition) {
        throw new Error('[product-production-service] 普通暂停没有待结算 provider reservation')
      }
    } else if (!Array.isArray(failure!.pausedProviderReservations)
      || failure!.pausedProviderReservations.length < 1) {
      throw new Error('[product-production-service] 暂停 reservation 证据损坏')
    } else {
      assertProductProductionBudgetLedgerV1(input.build.budgetLedgerJson)
      const ledger = input.build.budgetLedgerJson === '{}' || !input.build.budgetLedgerJson.trim()
        ? {
            version: 2,
            attempts: [] as Array<Record<string, unknown>>,
          }
        : JSON.parse(input.build.budgetLedgerJson) as {
            version: number
            attempts?: Array<Record<string, unknown>>
          }
      const currentAttempts = ledger.version === 2 && Array.isArray(ledger.attempts)
        ? ledger.attempts
        : []
      const unresolved = (failure!.pausedProviderReservations as unknown[]).flatMap((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 损坏`)
        }
        const reservation = value as Record<string, unknown>
        if (typeof reservation.taskKey !== 'string'
          || !Number.isSafeInteger(reservation.runId) || Number(reservation.runId) < 1
          || !Number.isSafeInteger(reservation.attempt) || Number(reservation.attempt) < 1
          || !Number.isSafeInteger(reservation.controlEpoch) || Number(reservation.controlEpoch) < 0) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 身份损坏`)
        }
        const matchingAttempts = currentAttempts.filter(current => (
          current.runId === reservation.runId && current.attempt === reservation.attempt
        ))
        if (matchingAttempts.length > 1) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 重复封账`)
        }
        const current = matchingAttempts[0]
        if (!current) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 缺少精确封账证据`)
        }
        if (current.taskKey !== reservation.taskKey
          || current.runId !== reservation.runId
          || current.attempt !== reservation.attempt
          || current.controlEpoch !== reservation.controlEpoch) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 与当前账本不一致`)
        }
        if (current.usageKnown !== true && current.usageKnown !== false) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 当前账本损坏`)
        }
        if (current.usageKnown) return []
        if (!current.usage || typeof current.usage !== 'object' || Array.isArray(current.usage)) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 缺少冻结预留上限`)
        }
        return [{
          taskKey: reservation.taskKey,
          runId: Number(reservation.runId),
          attempt: Number(reservation.attempt),
          controlEpoch: Number(reservation.controlEpoch),
        }]
      })
      if (unresolved.length > 0 && !input.pausedReservationDisposition) {
        throw new Error('[product-production-service] 恢复前请先结算暂停时仍在途的供应商请求')
      }
      pausedReservationDispositions = unresolved.length > 0
        ? unresolved.map(reservation => ({
            ...reservation,
            disposition: input.pausedReservationDisposition!,
          }))
        : undefined
    }
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.production.id!,
    command: paused
      ? {
          type: 'resume',
          commandId: commandId('resume'),
          expectedStateRevision: input.production.stateRevision,
          ...(pausedReservationDispositions ? { pausedReservationDispositions } : {}),
        }
      : {
          type: 'pause', commandId: commandId('pause'), expectedStateRevision: input.production.stateRevision,
          reason: '作者从制作工作台暂停',
        },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '状态切换失败'))
  return paused ? 'resumed' : 'paused'
}

export async function stopProductProductionV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
}): Promise<void> {
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.production.id!,
    command: {
      type: 'stop', commandId: commandId('stop'), expectedStateRevision: input.production.stateRevision,
      retention: 'keep-build',
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '停止失败'))
}

export async function archiveProductProductionV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
}): Promise<void> {
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.production.id!,
    command: {
      type: 'archive', commandId: commandId('archive'),
      expectedStateRevision: input.production.stateRevision,
      reason: '作者从版本页归档 Production；保留 Build、Release、receipt 与存档引用',
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '归档失败'))
}

export async function restoreArchivedProductProductionV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
}): Promise<void> {
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.production.id!,
    command: {
      type: 'restore', commandId: commandId('restore'),
      expectedStateRevision: input.production.stateRevision,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '恢复归档失败'))
}

export async function retryProductProductionBlockerV1(input: {
  scope: WorkspaceScope
  details: ProductProductionDetailsV1
  afterCapabilityChange?: boolean
  repairNote?: string
  authorDraftJson?: string
  unknownResultDisposition?: 'confirmed-not-charged' | 'charge-reservation-upper-bound'
}): Promise<
  | 'provider-actual-charge'
  | 'author-confirmed-not-charged'
  | 'author-charged-reservation-upper-bound'
  | null
> {
  if (!input.details.build || !canRetryProductProductionBlockerV1(input.details)) {
    throw new Error('[product-production-service] 当前 Build 没有可重试 blocker')
  }
  const taskKey = readProductProductionRecoveryTaskKeyV1(input.details.build.failureJson)
  const blockerKey = taskKey ?? 'build-recovery'
  const repairNote = input.repairNote?.trim() || undefined
  const authorDraftJson = input.authorDraftJson?.trim() || undefined
  if (repairNote || authorDraftJson) {
    if (!taskKey) throw new Error('[product-production-service] 当前 blocker 不支持作者引导修复')
    const policy = inspectProductProductionBuildRecoveryPolicyV1({
      productType: input.details.production.productType,
      planJson: input.details.build.planJson,
      taskKey,
    })
    if (repairNote && !policy.repairNoteAllowed) {
      throw new Error('[product-production-service] 当前任务不支持作者修复要求')
    }
    if (authorDraftJson && !policy.authorDraftAllowed) {
      throw new Error('[product-production-service] 当前任务不支持作者完整 JSON 修订')
    }
  }
  let unknownResultReservation: {
    runId: number
    attempt: number
    controlEpoch: number
    disposition: 'confirmed-not-charged' | 'charge-reservation-upper-bound'
  } | undefined
  let failure: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(input.details.build.failureJson) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      failure = parsed as Record<string, unknown>
    }
  } catch { /* command boundary will reject corrupt failure evidence */ }
  const providerReservationFailure = failure.code === 'unknown-result'
    || failure.code === 'provider-response-uncheckpointed'
  if (providerReservationFailure) {
    if (!input.unknownResultDisposition) {
      throw new Error(failure.code === 'provider-response-uncheckpointed'
        ? '[product-production-service] 已收到供应商响应证据；请按冻结预留上限封账后重试'
        : '[product-production-service] 结果未知；请先确认供应商是否计费')
    }
    if (failure.code === 'provider-response-uncheckpointed'
      && input.unknownResultDisposition !== 'charge-reservation-upper-bound') {
      throw new Error('[product-production-service] 已收到供应商响应证据，不能声明为未计费')
    }
    const provenance = failure.failureProvenance != null
      && typeof failure.failureProvenance === 'object'
      && !Array.isArray(failure.failureProvenance)
      ? failure.failureProvenance as Record<string, unknown>
      : null
    if (!provenance
      || !Number.isSafeInteger(provenance.runId) || Number(provenance.runId) < 1
      || !Number.isSafeInteger(provenance.attempt) || Number(provenance.attempt) < 1
      || !Number.isSafeInteger(provenance.controlEpoch) || Number(provenance.controlEpoch) < 0) {
      throw new Error('[product-production-service] unknown-result 缺少可核对的 Run/attempt/epoch')
    }
    unknownResultReservation = {
      runId: Number(provenance.runId),
      attempt: Number(provenance.attempt),
      controlEpoch: Number(provenance.controlEpoch),
      disposition: input.unknownResultDisposition,
    }
  } else if (input.unknownResultDisposition) {
    throw new Error('[product-production-service] 当前 blocker 不存在待结算 provider reservation')
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.details.production.id!,
    command: {
      type: 'resolve-blocker', commandId: commandId('resolve-blocker'),
      expectedStateRevision: input.details.production.stateRevision, blockerKey,
      resolution: {
        action: authorDraftJson ? 'author-edit' : input.afterCapabilityChange ? 'change-capability' : 'retry',
        ...(authorDraftJson ? { authorDraftJson } : {}),
        ...(unknownResultReservation ? { unknownResultReservation } : {}),
        note: repairNote || (input.afterCapabilityChange ? '作者已调整全局能力配置并要求重试' : '作者从制作工作台要求重试'),
      },
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? 'blocker 重试失败'))
  const accounting = receipt.result.unknownResultAccounting
  if (accounting == null) return null
  if (!accounting || typeof accounting !== 'object' || Array.isArray(accounting)) {
    throw new Error('[product-production-service] unknown-result 结算回执损坏')
  }
  const effectiveDisposition = (accounting as Record<string, unknown>).effectiveDisposition
  if (effectiveDisposition !== 'provider-actual-charge'
    && effectiveDisposition !== 'author-confirmed-not-charged'
    && effectiveDisposition !== 'author-charged-reservation-upper-bound') {
    throw new Error('[product-production-service] unknown-result 结算回执缺少有效处置')
  }
  return effectiveDisposition
}

export async function resolveTextAdventureSourceDecisionV1(input: {
  scope: WorkspaceScope
  details: ProductProductionDetailsV1
  action: 'accept-product-private-expansion' | 'cancel'
  note: string
}): Promise<void> {
  if (!input.details.build || !isTextAdventureSourceDecisionBlockerV1(input.details)) {
    throw new Error('[product-production-service] 当前 Build 没有待作者处理的来源决策')
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope,
    productionId: input.details.production.id!,
    command: {
      type: 'resolve-blocker', commandId: commandId('source-decision'),
      expectedStateRevision: input.details.production.stateRevision,
      blockerKey: 'source.author-gate',
      resolution: { action: input.action, note: input.note.trim() },
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '来源决策失败'))
}

export async function retryTextAdventureSourceReviewV1(input: {
  scope: WorkspaceScope
  details: ProductProductionDetailsV1
}): Promise<void> {
  if (!input.details.build || !isTextAdventureSourceDecisionBlockerV1(input.details)) {
    throw new Error('[product-production-service] 当前 Build 没有可重新审查的来源结论')
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope,
    productionId: input.details.production.id!,
    command: {
      type: 'resolve-blocker', commandId: commandId('source-review-retry'),
      expectedStateRevision: input.details.production.stateRevision,
      blockerKey: 'content.source-sufficiency',
      resolution: {
        action: 'retry',
        note: '作者拒绝当前来源编辑的阻断归因；保持 WorldRelease 与 Brief 不变，要求按产品私域边界重新审查。',
      },
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '来源重新审查失败'))
}

export async function resolveTextAdventureMediaAnchorDecisionV1(input: {
  scope: WorkspaceScope
  details: ProductProductionDetailsV1
  action: 'confirm-character-anchors' | 'cancel'
  note: string
}): Promise<void> {
  if (!input.details.build || !isTextAdventureMediaAnchorBlockerV1(input.details)) {
    throw new Error('[product-production-service] 当前 Build 没有待作者处理的角色视觉锚点')
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope,
    productionId: input.details.production.id!,
    command: {
      type: 'resolve-blocker', commandId: commandId('media-anchor-decision'),
      expectedStateRevision: input.details.production.stateRevision,
      blockerKey: 'media.anchor-author-gate',
      resolution: { action: input.action, note: input.note.trim() },
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '角色视觉锚点决策失败'))
}

export async function readProductProductionProgressV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<ProductProductionSchedulerProjectionV1> {
  return projectProductProductionSchedulerV1(input)
}

/** Re-seal a terminal Build after a trusted project import remapped local IDs.
 * This path is deterministic and never resolves or calls an AI/media provider. */
export async function recoverImportedProductProductionProofsV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<ProductProductionSchedulerProjectionV1> {
  return recoverImportedProductProductionProofsCoreV1(input)
}

/**
 * Formal production entry. It reuses the existing global/task-routed AI
 * configuration and only freezes non-secret provider identity in the Build.
 * No production-scoped API key form or secret copy is allowed here.
 */
export async function runAuthorizedProductProductionV1(input: {
  scope: WorkspaceScope
  productionId: number
  signal?: AbortSignal
  onProgress?: (projection: ProductProductionSchedulerProjectionV1) => void | Promise<void>
}): Promise<ProductProductionSchedulerProjectionV1> {
  const scope = await resolveScope({ scope: input.scope })
  const details = await readProductProductionDetailsV1(scope, input.productionId)
  if (!details.brief || !details.build) throw new Error('[product-production-service] Production 尚未授权 Build')
  if (!['producing', 'preview-ready'].includes(details.production.status)) {
    throw new Error(`[product-production-service] Production 状态 ${details.production.status} 不允许自动制作`)
  }
  if (['preview-ready', 'release-ready', 'released'].includes(details.build.status)) {
    return projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
  }
  const creatorAuthority = details.brief.briefKind === 'text-open-world-creator-v1'
    ? await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
        scope,
        buildId: details.build.id!,
      })
    : null
  const creatorContracts = creatorAuthority?.contracts ?? null
  if (creatorContracts) {
    // Creator authorization freezes the complete non-secret route identity,
    // pricing and generation settings. Re-prove it before every run/resume;
    // resolving a fresh capability receipt alone would otherwise silently
    // authorize whatever route happens to be configured now.
    const aiState = useAIConfigStore.getState()
    const confirmation = await verifyTextOpenWorldCreatorProductionPreflightConfirmationV1({
      brief: creatorContracts.creatorBrief,
      preflight: creatorContracts.start.preflight,
      confirmation: creatorContracts.start.confirmation,
      projectId: scope.projectId,
      aiConfig: aiState.config,
      rememberApiKey: aiState.rememberApiKey,
    })
    if (confirmation.confirmationHash !== creatorContracts.start.confirmation.confirmationHash) {
      throw new Error('[product-production-service] Creator 模型授权已变化，请重新检查并确认生产')
    }
  }
  const brief = creatorContracts?.executionBrief
    ?? parseProductProductionBriefV3(details.brief.briefJson)
  if (brief.avgRevision) return (await import('../avg/revision-production')).runAvgRevisionV1({ ...input, scope, details, brief })
  const textRequirements = brief.capabilityRequirements.filter(requirement => requirement.mediaClass === 'text')
  if (textRequirements.length !== 1) throw new Error('[product-production-service] 正式制作需要唯一文本 capability requirement')
  const textCapability = await resolveConfiguredTextCapabilityV1({
    projectId: scope.projectId, category: 'product-production', requirementKey: textRequirements[0].requirementKey,
    ...(creatorContracts ? {
      expectedProviderIdentity: {
        provider: creatorContracts.start.preflight.providerBinding.provider,
        model: creatorContracts.start.preflight.providerBinding.model,
        endpointOrigin: creatorContracts.start.preflight.providerBinding.endpointOrigin,
        endpointRouteHash: creatorContracts.start.preflight.providerBinding.endpointRouteHash,
        temperature: creatorContracts.start.preflight.providerBinding.temperature,
        configuredMaxTokens: creatorContracts.start.preflight.providerBinding.maxTokens,
        contextWindow: creatorContracts.start.preflight.providerBinding.contextWindow,
      },
    } : {}),
  })
  const capabilityBindings: ProductProductionCapabilityBindingV1[] = [{
    requirementKey: textRequirements[0].requirementKey,
    adapterId: textCapability.receipt.adapterId,
    bindingHash: textCapability.receipt.capabilityHash,
    provider: textCapability.receipt.provider,
    model: textCapability.receipt.model,
  }]
  const mediaCapabilities = new Map<string, ResolvedProductMediaCapabilityV1>()
  const relayUrl = configuredMediaRelayUrlV1()
  const authoredImagePackUrl = configuredAuthoredImagePackUrlV1()
  const authoredImagePackReadiness = inspectAuthoredImagePackConfigurationV1({ manifestUrl: authoredImagePackUrl })
  const agnesImageReadiness = inspectConfiguredAgnesImageCapabilityV1({ projectId: scope.projectId })
  const creatorMediaPlan = creatorAuthority?.media?.authorization.plan ?? null
  const useExternalMedia = brief.qualityProfile !== 'prototype'
    || creatorMediaPlan?.mode === 'provider-generate'
  for (const requirement of brief.capabilityRequirements) {
    if (!['image', 'music', 'sfx'].includes(requirement.mediaClass)) continue
    if (requirement.mediaClass === 'image'
      && creatorMediaPlan?.mode === 'author-import'
      && creatorMediaPlan.capability.requirementKey === requirement.requirementKey) {
      capabilityBindings.push({
        requirementKey: creatorMediaPlan.capability.requirementKey,
        adapterId: creatorMediaPlan.capability.adapterId,
        bindingHash: creatorMediaPlan.capability.bindingHash,
      })
    } else if (requirement.mediaClass === 'image'
      && creatorMediaPlan?.mode === 'provider-generate'
      && creatorMediaPlan.capability.requirementKey === requirement.requirementKey) {
      const resolved = creatorMediaPlan.capability.adapterId === 'agnes.image-2.1-flash.v1'
        ? await resolveConfiguredAgnesImageCapabilityV1({ projectId: scope.projectId, requirement })
        : await resolveTrustedRelayMediaCapabilityV1({ requirement, relayUrl })
      if (resolved.binding.adapterId !== creatorMediaPlan.capability.adapterId
        || resolved.binding.bindingHash !== creatorMediaPlan.capability.bindingHash) {
        throw new Error('[product-production-service] Creator 图片 Provider 身份已变化，请重新预览并授权媒资 Build')
      }
      mediaCapabilities.set(requirement.requirementKey, resolved)
      capabilityBindings.push(resolved.binding)
    } else if (requirement.mediaClass === 'image'
      && brief.intent.productType === 'ai-town'
      && brief.qualityProfile === 'internal'
      && authoredImagePackUrl != null
      && authoredImagePackReadiness.ready) {
      const resolved = await resolveAuthoredImagePackCapabilityV1({ requirement, manifestUrl: authoredImagePackUrl })
      mediaCapabilities.set(requirement.requirementKey, resolved)
      capabilityBindings.push(resolved.binding)
    } else if (requirement.mediaClass === 'image' && useExternalMedia && agnesImageReadiness.ready) {
      const resolved = await resolveConfiguredAgnesImageCapabilityV1({ projectId: scope.projectId, requirement })
      mediaCapabilities.set(requirement.requirementKey, resolved)
      capabilityBindings.push(resolved.binding)
    } else if (useExternalMedia && relayUrl != null) {
      const resolved = await resolveTrustedRelayMediaCapabilityV1({ requirement, relayUrl })
      mediaCapabilities.set(requirement.requirementKey, resolved)
      capabilityBindings.push(resolved.binding)
    } else if (brief.qualityProfile === 'commercial-candidate') {
      throw new Error(`[product-production-service] capability-unbound: ${requirement.mediaClass === 'image'
        ? agnesImageReadiness.issue || '全局 Agnes 图片能力尚未就绪。'
        : '商业音乐与音效可信中继尚未绑定。'}`)
    } else if (requirement.mediaClass === 'image') {
      capabilityBindings.push(await createBuiltInProductionCapabilityBindingV1({
        requirementKey: requirement.requirementKey, adapterId: 'storyforge.procedural-svg.v1',
      }))
    } else {
      capabilityBindings.push(await createBuiltInProductionCapabilityBindingV1({
        requirementKey: requirement.requirementKey, adapterId: 'storyforge.procedural-audio.v1',
      }))
    }
  }
  const executor = brief.intent.productType === 'text-open-world'
    ? createTextOpenWorldProductionExecutorV1({
      production: details.production, brief, mediaCapabilities,
      textCapabilityReceipt: textCapability.receipt,
    })
    : createConfiguredProductProductionExecutorV1({
      production: details.production, brief, mediaCapabilities,
    })
  const projection = await runProductProductionUntilBlockedV1({
    scope, productionId: input.productionId, executor, capabilityBindings, signal: input.signal,
    async onDurableBoundary() {
      if (input.onProgress) await input.onProgress(await projectProductProductionSchedulerV1({
        scope, productionId: input.productionId,
      }))
    },
  })
  if (input.onProgress) await input.onProgress(projection)
  if (projection.buildStatus === 'failed' || projection.buildStatus === 'recovery-required') {
    const build = await db.productBuilds.get(projection.buildId)
    let detail = ''
    try {
      const failure = JSON.parse(build?.failureJson ?? '{}') as { detail?: unknown; taskKey?: unknown }
      detail = typeof failure.detail === 'string'
        ? `${typeof failure.taskKey === 'string' ? `${failure.taskKey}: ` : ''}${failure.detail}` : ''
    } catch { /* corrupted failureJson is reported by the status fallback */ }
    throw new Error(detail || `自动制作停在 ${projection.buildStatus}，请查看任务阻塞信息。`)
  }
  return projection
}

export async function publishProductProductionV1(input: {
  scope: WorkspaceScope
  productionId: number
}) {
  const prepared = await prepareProductProductionAdoption(input)
  if (prepared.creatorRelease) {
    throw new Error('文字开放世界 Creator Build 必须经过专属作者发布确认，不能调用通用发布入口。')
  }
  const receipt = await publishProductProductionBuild({
    ...input,
    command: {
      type: 'publish', commandId: commandId('publish'),
      expectedStateRevision: prepared.intent.expectedStateRevision,
      buildNumber: prepared.intent.buildNumber,
      expectedManifestHash: prepared.intent.manifestHash,
      adoptionIntentHash: prepared.adoptionIntentHash,
    },
  })
  return { prepared, receipt }
}

/**
 * Starts a real player session from the immutable Build Preview. The author
 * command proves that opening the preview was user-triggered; the session is
 * bound to the exact preview hash and never requires publishing first.
 */
export async function startProductProductionPreviewV1(input: {
  scope: WorkspaceScope
  productionId: number
  worldGroupId?: number | null
}): Promise<{ sessionId: number; productType: ProductProductionBriefV3['intent']['productType'] }> {
  const details = await readProductProductionDetailsV1(input.scope, input.productionId)
  if (!details.brief || !details.build || !details.build.previewHash) {
    throw new Error('[product-production-service] 当前 Production 尚无可验证 Build Preview')
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: details.production.id!,
    command: {
      type: 'request-preview', commandId: commandId('preview'),
      expectedStateRevision: details.production.stateRevision,
      buildNumber: details.build.buildNumber,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? 'Preview 请求失败'))
  const previewHash = typeof receipt.result.previewHash === 'string' ? receipt.result.previewHash : ''
  if (previewHash !== details.build.previewHash) {
    throw new Error('[product-production-service] Preview command 返回的 hash 已过期')
  }
  const brief = details.executionBrief
  if (!brief) throw new Error('[product-production-service] 当前 Build 缺少可验证执行 Brief')
  const session = await createProductRuntimeInstanceFromSource({
    scope: input.scope,
    source: { kind: 'build', productBuildId: details.build.id!, expectedPreviewHash: previewHash },
    title: `${details.production.title} · Build #${details.build.buildNumber} 预览`,
    worldGroupId: input.worldGroupId ?? null,
  })
  if (brief.intent.productType === 'ai-town') {
    await startAiTownInitialSceneV1({
      sessionId: session.id!,
      commandId: `product-preview:ai-town-scene:${session.id}`,
    })
  }
  return { sessionId: session.id!, productType: brief.intent.productType }
}

/** Creates the next reviewable Brief from an explicit author evolution goal. */
export async function beginProductProductionEvolutionV1(input: {
  scope: WorkspaceScope
  productionId: number
  userText: string
  affectedLanes?: ProductEvolutionAffectedLaneV1[]
  expectedStateRevision?: number
  commandId?: string
}): Promise<{ briefRevision: number }> {
  const userText = input.userText.trim()
  if (!userText) throw new Error('[product-production-service] 请先填写本轮演化目标')
  const scope = await resolveScope({ scope: input.scope })
  const affectedLanes = [...new Set(input.affectedLanes ?? ['content', 'product', 'visual', 'audio'])]
  if (!affectedLanes.length) throw new Error('[product-production-service] 演化至少影响一个生产 lane')
  if (affectedLanes.includes('world-source')) {
    throw new Error('[product-production-service] 世界来源升级必须先选择并确认新的 WorldRelease，不能在普通演化中静默替换')
  }
  const details = await readProductProductionDetailsV1(scope, input.productionId)
  if (input.expectedStateRevision != null && details.production.stateRevision !== input.expectedStateRevision) throw new Error('制作版本已变化，请重新读取')
  if (!details.build) throw new Error('[product-production-service] 演化需要一个可验证的 Preview 或 Release 基线')
  let base: ProductEvolutionBaseV1
  const budgetRecovery = affectedLanes.length === 1 && affectedLanes[0] === 'production-budget'
  const planUpgradeRecovery = affectedLanes.length === 1 && affectedLanes[0] === 'execution-plan'
  const currentTextAdventureRecovery = details.production.productType === 'text-adventure'
    && details.production.status === 'producing'
    && details.build.status === 'recovery-required'
  const visualLaneOnly = affectedLanes.length === 1 && affectedLanes[0] === 'visual'
  const rejectedAnchorRecoveryCandidate = visualLaneOnly
    && details.production.productType === 'text-adventure'
    && details.production.status === 'stopped'
    && details.build.status === 'cancelled'
    && canReviseTextAdventureVisualContractFromRecoveryV1(details.build)
  // `visual`, `content+visual`, and `runtime` are ordinary author evolution
  // lanes when the baseline is already preview-ready/released. They become
  // special recovery lanes only while the current text-adventure Build is at
  // its governed recovery boundary (or the author explicitly rejected a
  // character anchor). Classifying from the lane name alone made legitimate
  // cross-Build reassembly/evolution impossible for every product.
  const visualContractRecovery = visualLaneOnly
    && (currentTextAdventureRecovery || rejectedAnchorRecoveryCandidate)
  const preMediaContentRecovery = currentTextAdventureRecovery
    && affectedLanes.length === 2
    && affectedLanes.includes('content') && affectedLanes.includes('visual')
  const runtimeCopyRecovery = currentTextAdventureRecovery
    && affectedLanes.length === 1 && affectedLanes[0] === 'runtime'
  const recoveryEvolution = budgetRecovery || planUpgradeRecovery || visualContractRecovery
    || preMediaContentRecovery || runtimeCopyRecovery
  if (recoveryEvolution) {
    const rejectedAnchorRecovery = rejectedAnchorRecoveryCandidate
    if (details.production.productType !== 'text-adventure'
      || (!rejectedAnchorRecovery && (details.production.status !== 'producing'
        || details.build.status !== 'recovery-required'))
      || !details.build.briefHash || !details.build.planHash) {
      throw new Error('[product-production-service] 当前状态不能创建文字冒险恢复 Build')
    }
    const brief = parseProductProductionBriefV3(details.brief?.briefJson ?? '')
    const floor = textAdventureProductionBudgetFloorV1(brief)
    if (budgetRecovery && !isTextAdventureBuildLifetimeBudgetExhaustedV1(details.build)
      && brief.productionBudget.maximumModelCalls >= floor.minimumModelCalls
      && brief.productionBudget.maximumInputTokens >= floor.minimumInputTokens
      && brief.productionBudget.maximumOutputTokens >= floor.minimumOutputTokens
      && brief.productionBudget.maximumDurationMs >= floor.minimumDurationMs) {
      throw new Error('[product-production-service] 当前 Brief 已满足专业生产预算底线，请检查实际 blocker 后重试')
    }
    if (planUpgradeRecovery && (!canUpgradeTextAdventureExecutionPlanV1(details.build)
      || (isLegacyOversizedTextAdventureQualityReviewPlanV1(details.build)
        && await hasPassedTextAdventureQualityReviewForExecutionPlanUpgradeV1(details.build)))) {
      throw new Error('[product-production-service] 当前 Build 没有可验证的执行计划升级证据，或叙事质量审查已经通过')
    }
    if (visualContractRecovery && !canReviseTextAdventureVisualContractFromRecoveryV1(details.build)) {
      throw new Error('[product-production-service] 当前 Build 没有可验证的视觉合同或媒资质量阻断')
    }
    if (runtimeCopyRecovery && !canReviseTextAdventureRuntimeCopyFromRecoveryV1(details.build)) {
      throw new Error('[product-production-service] 当前 Build 没有可验证的文字冒险公开文案质量阻断')
    }
    if (preMediaContentRecovery && !canReviseTextAdventureContentBeforeMediaV1(details.build)) {
      throw new Error('[product-production-service] 当前 Build 不在可返修正文的生成图片前作者闸门')
    }
    const recoveryControlEpoch = rejectedAnchorRecovery
      ? parseProductProductionPlanV3(details.build.planJson).controlEpoch
      : details.build.controlEpoch
    base = {
      kind: 'recovery-build', buildNumber: details.build.buildNumber,
      briefHash: details.build.briefHash, planHash: details.build.planHash,
      controlEpoch: recoveryControlEpoch,
    }
  } else if (details.production.status === 'released' && details.production.currentProductReleaseId != null) {
    const release = await db.productReleases.get(details.production.currentProductReleaseId)
    if (!release || !await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })) {
      throw new Error('[product-production-service] 当前 ProductRelease 基线缺失或跨 Work')
    }
    base = { kind: 'release', productReleaseId: release.id!, contentHash: release.contentHash }
  } else {
    if (!['preview-ready', 'release-ready', 'released'].includes(details.build.status) || !details.build.manifestHash) {
      throw new Error('[product-production-service] 当前 Build 尚不能作为演化基线')
    }
    base = {
      kind: 'build', buildNumber: details.build.buildNumber, manifestHash: details.build.manifestHash,
    }
  }
  const receipt = await executeProductProductionCommand({
    scope, productionId: details.production.id!,
    command: {
      type: 'evolve', commandId: input.commandId ?? commandId('evolve'),
      expectedStateRevision: details.production.stateRevision, base, userText, affectedLanes,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '演化 Brief 创建失败'))
  const briefRevision = receipt.result.briefRevision
  if (typeof briefRevision !== 'number') throw new Error('[product-production-service] 演化命令未返回 Brief revision')
  return { briefRevision }
}

/** Creates a reviewable Brief that upgrades a frozen execution plan without changing product content. */
export async function upgradeTextAdventureProductionPlanV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<{ briefRevision: number }> {
  const scope = await resolveScope({ scope: input.scope })
  const details = await readProductProductionDetailsV1(scope, input.productionId)
  if (!details.build?.id) {
    throw new Error('[product-production-service] 执行计划升级缺少当前 Build')
  }
  const upgradeCommandId = [
    'execution-plan-upgrade', details.build.id, details.build.controlEpoch, details.build.planHash,
  ].join('.')
  const prior = await db.productProductionCommands
    .where('[productionId+commandId]').equals([input.productionId, upgradeCommandId]).first()
  if (prior?.status === 'succeeded') {
    const result = JSON.parse(prior.resultJson) as { briefRevision?: unknown }
    if (typeof result.briefRevision !== 'number') {
      throw new Error('[product-production-service] 已完成的执行计划升级回执缺少 Brief revision')
    }
    return { briefRevision: result.briefRevision }
  }
  return beginProductProductionEvolutionV1({
    scope, productionId: input.productionId, commandId: upgradeCommandId,
    userText: '依据当前 Build 的可验证失败回执升级执行计划：采用现行逐任务合同、实测时长与 token 预留、有界重试和持久化回执；继承所有可证明未变化且已签收的正文与媒资，不修改剧情、玩法、世界来源、图片内容或媒资范围。',
    affectedLanes: ['execution-plan'],
  })
}

import Dexie from 'dexie'
import { db } from '../db/schema'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { canonicalStringify as canonicalAgentRunJsonV1 } from '../agent/run/hash'
import type {
  AgentRunCheckpointRecord,
  AgentRunEventRecord,
  AgentRunRecord,
  MediaBlobObjectRecordV1,
  ProductBuildArtifactKindV1,
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionPlanTaskV3,
  ProductProductionPlanV3,
  ProductProductionBriefV3,
  ProductProductionBriefRecordV1,
  ProductProductionRecordV1,
  ProductTaskBudgetReservationV1,
  TextOpenWorldSourcePinBundleV1,
  WorkspaceScope,
} from '../types'
import { isProductBuildArtifactKindV1 } from '../types/product-production'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'
import { parseProductBuildManifestV1, parseProductBuildQualityReportV1 } from './adoption'
import { parseProductProductionBriefV3 } from './contracts'
import { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } from '../open-world/creator-derived-authority'
import { readVerifiedMediaBlobObjectData } from './media-blob-store'
import { parseProductProductionPlanV3 } from './plan'
import {
  createProductBuildRootTerminalReceiptV1,
  verifyProductBuildRootTerminalReceiptV1,
} from './receipts'
import { productProductionTerminalArtifactKeysV1 } from './runtime-package'
import {
  hashProductProductionCarriedCandidateV1,
  hashProductProductionCarriedReceiptV1,
  hashProductProductionParentArtifactProofV1,
  hashProductProductionPortableRootSealV1,
  hashProductProductionSealedParentArtifactProofV1,
  parseProductProductionPortableTaskLedgerV1,
  hashProductProductionTaskCandidateV1,
  hashProductProductionTaskReceiptV1,
  type ProductProductionPortableTaskLedgerEntryV1,
  type ProductProductionParentRunWitnessV1,
} from './task-evidence'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const PRODUCER_PROOF_CACHE_SIZE = 2
const TERMINAL_SAME_BUILD_LINEAGE_DEPTH_LIMIT = 64
const TERMINAL_SAME_BUILD_SIBLING_LIMIT = 20_001

type ProductBuildArtifactAcceptanceInputV1 = {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
  artifactKey: string
  requirementKey?: string | null
  kind: ProductBuildArtifactKindV1
  mediaKind?: ProductBuildArtifactRecordV1['mediaKind']
  payload: unknown
  metadata?: unknown
  quality?: unknown
  rights?: unknown
  contentHash?: string
  blobObjectId?: number | null
  mimeType?: string | null
  byteSize?: number
  producerRunId?: number | null
  producerReceiptHash?: string | null
  inputHash: string
  /** Internal P0 bundle witness. Direct callers cannot write one unit without
   * presenting the complete author-authorized closure. */
  sourcePinBundleProof?: TextOpenWorldSourcePinBundleV1
}

interface PreparedArtifactAcceptanceV1 {
  artifactKey: string
  requirementKey: string | null
  kind: ProductBuildArtifactKindV1
  mediaKind: ProductBuildArtifactRecordV1['mediaKind']
  payloadJson: string
  metadataJson: string
  qualityJson: string
  rightsJson: string
  contentHash: string
  blobObjectId: number | null
  mimeType: string | null
  byteSize: number
}

interface DirectSourceAcceptanceProofV1 {
  productionId: number
  productionKey: string
  briefRowJson: string
  startCommandMatch: {
    buildNumber: number
    briefRevision: number
    briefHash: string
    sourcePlanHash: string
    startHash: string
    expectedStateRevision: number
  }
  matchingStartCommandsJson: string
  activePinRowsJson: string
}

interface ProducerCheckpointFingerprintV1 {
  runId: number
  projectId: number
  worldGroupId: number | null
  workId: number | null
  productBuildId: number | null
  parentRunId: number | null
  parentRelation: string | null
  status: string
  contractHash: string
  generation: number
  lastSequence: number
  projectionHash: string
  terminalReceiptHash: string | null
  updatedAt: number
  contractJsonHash: string
  projectionJsonHash: string
  eventStreamHash: string
  checkpointId: number
  checkpointProjectId: number
  checkpointWorldGroupId: number | null
  checkpointHash: string
  throughSequence: number
  checkpointGeneration: number
  checkpointContractHash: string
  checkpointProjectionHash: string
  checkpointProjectionJsonHash: string
  checkpointResumePayloadJsonHash: string | null
  resumePayloadHash: string | null
}

interface ProducerRootFingerprintV1 {
  runId: number
  projectId: number
  worldGroupId: number | null
  workId: number | null
  productBuildId: number | null
  parentRunId: number | null
  parentRelation: string | null
  status: string
  contractHash: string
  generation: number
  lastSequence: number
  projectionHash: string
  terminalReceiptHash: string | null
  updatedAt: number
  contractJsonHash: string
  projectionJsonHash: string
  eventStreamHash: string
}

interface ProducerBuildFingerprintV1 {
  buildId: number
  productionId: number
  projectId: number
  worldId: number
  workId: number
  buildNumber: number
  briefRevision: number
  briefHash: string
  controlEpoch: number
  planRevision: number
  planHash: string
  planJsonHash: string
  rootRunId: number
}

interface VerifiedProducerCandidateV1 {
  cacheKey: string
  buildFingerprint: ProducerBuildFingerprintV1
  fingerprint: ProducerCheckpointFingerprintV1
  rootFingerprint: ProducerRootFingerprintV1
  task: ProductProductionPlanTaskV3
  attempt: number
  inputHash: string
  candidateHash: string
  receiptHash: string
  passedGateIds: string[]
  usage: unknown
  importedScopeRebound: boolean
  artifacts: Map<string, PreparedArtifactAcceptanceV1>
  remainingArtifactKeys: Set<string>
}

function hasImportedScopeRevalidationV1(snapshot: AgentRunSnapshotV1): boolean {
  let staleIndex = -1
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    if (snapshot.events[index].type === 'verification.staled') {
      staleIndex = index
      break
    }
  }
  if (staleIndex < 0) return false
  const stale = snapshot.events[staleIndex]
  if (stale.type !== 'verification.staled'
    || stale.payload.reason !== 'project-import-scope-rebound') return false
  const rebound = snapshot.events.slice(staleIndex + 1)
  const startedIndex = rebound.findIndex(event => event.type === 'verification.started'
    && event.payload.verifierSetVersion === 'product-production-task-import-rebind-v1')
  if (startedIndex < 0) return false
  return rebound.slice(startedIndex + 1).some(event => event.type === 'verification.accepted'
    && event.payload.receiptHash === snapshot.projection.terminalReceiptHash)
}

function samePreparedProducerArtifactV1(input: {
  expected: PreparedArtifactAcceptanceV1
  actual: PreparedArtifactAcceptanceV1 | undefined
  importedScopeRebound: boolean
}): boolean {
  if (!input.actual) return false
  if (canonicalProductProductionJsonV2(input.expected)
    === canonicalProductProductionJsonV2(input.actual)) return true
  // Candidate v1 historically included the local Blob row id. A strict
  // project import remaps that storage locator while preserving contentHash,
  // mime type, byte size and verified bytes. Only the exact import-revalidation
  // event tail may therefore compare the portable envelope without that id.
  if (!input.importedScopeRebound
    || input.expected.blobObjectId == null
    || input.actual.blobObjectId == null) return false
  return canonicalProductProductionJsonV2({ ...input.expected, blobObjectId: null })
    === canonicalProductProductionJsonV2({ ...input.actual, blobObjectId: null })
}

const producerProofCache = new Map<string, Promise<VerifiedProducerCandidateV1>>()

function parentRunWitness(row: AgentRunRecord): ProductProductionParentRunWitnessV1 {
  let boundary: ProductProductionParentRunWitnessV1['boundary'] | null = null
  try {
    const contract = JSON.parse(row.contractJson) as {
      scope?: { productProduction?: ProductProductionParentRunWitnessV1['boundary'] & { productBuildId?: number } }
    }
    const candidate = contract.scope?.productProduction
    if (candidate && Number.isSafeInteger(candidate.buildNumber)
      && Number.isSafeInteger(candidate.controlEpoch)
      && isSha256Hash(candidate.planHash) && typeof candidate.taskKey === 'string') {
      boundary = {
        buildNumber: candidate.buildNumber,
        controlEpoch: candidate.controlEpoch,
        planHash: candidate.planHash,
        taskKey: candidate.taskKey,
      }
    }
  } catch { /* rejected below */ }
  if (!boundary) throw new Error('[product-production-artifact] carry-forward Run 缺少可移植生产边界')
  return {
    parentRelation: row.parentRelation ?? null,
    status: row.status,
    terminalReceiptHash: row.terminalReceiptHash ?? null,
    boundary,
  }
}

async function frozenParentProofHash(input: {
  source: ProductBuildArtifactRecordV1
  expectedBuildId: number
  scope: WorkspaceScope
}): Promise<string> {
  if (input.source.producerRunId == null) {
    throw new Error(`[product-production-artifact] carry-forward 父证明不完整:${input.source.artifactKey}`)
  }
  const producer = await readAgentRunV1(input.scope, input.source.producerRunId)
  const producerBoundary = producer.contract.scope.productProduction
  if (producer.run.parentRunId == null) {
    throw new Error(`[product-production-artifact] carry-forward 父证明不完整:${input.source.artifactKey}`)
  }
  const root = await readAgentRunV1(input.scope, producer.run.parentRunId)
  const rootBoundary = root.contract.scope.productProduction
  if (producer.run.status !== 'completed' || producer.projection.state !== 'completed'
    || producer.run.projectId !== input.scope.projectId || producer.run.workId !== input.scope.workId
    || producer.run.productBuildId !== input.expectedBuildId
    || producer.run.terminalReceiptHash !== input.source.producerReceiptHash
    || producer.projection.terminalReceiptHash !== input.source.producerReceiptHash
    || producer.run.parentRelation == null
    || producerBoundary?.productBuildId !== input.expectedBuildId
    || producerBoundary.buildNumber !== rootBoundary?.buildNumber
    || producerBoundary.controlEpoch !== input.source.controlEpoch
    || producerBoundary.planHash !== rootBoundary?.planHash
    || producerBoundary.taskKey === '$root'
    || producer.run.parentRelation !== `task:${producerBoundary.taskKey}`
    || root.run.projectId !== input.scope.projectId || root.run.workId !== input.scope.workId
    || root.run.productBuildId !== input.expectedBuildId
    || root.run.id !== producer.run.parentRunId
    || root.run.parentRunId != null || root.run.parentRelation != null
    || rootBoundary?.productBuildId !== input.expectedBuildId
    || rootBoundary.taskKey !== '$root'
    || rootBoundary.controlEpoch !== input.source.controlEpoch) {
    throw new Error(`[product-production-artifact] carry-forward 父证明不完整:${input.source.artifactKey}`)
  }
  const producerWitness = parentRunWitness(producer.run)
  const rootWitness = parentRunWitness(root.run)
  return hashProductProductionParentArtifactProofV1({
    // Project explicitly: the helper's Pick type is erased at runtime and
    // passing a database row would accidentally bind mutable status/timestamps.
    artifact: {
      artifactKey: input.source.artifactKey,
      version: input.source.version,
      controlEpoch: input.source.controlEpoch,
      inputHash: input.source.inputHash,
      contentHash: input.source.contentHash,
      producerReceiptHash: input.source.producerReceiptHash,
      parentArtifactHash: input.source.parentArtifactHash,
      carriedFrom: input.source.carriedFrom,
    },
    producer: producerWitness,
    root: rootWitness,
  })
}

interface SameBuildCarryParentReadSetV1 {
  runRows: Array<AgentRunRecord & { id: number }>
  eventRows: Array<AgentRunEventRecord & { id: number }>
  checkpointRows: Array<AgentRunCheckpointRecord & { id: number }>
}

function sameBuildCarryParentReadSetJsonV1(readSet: SameBuildCarryParentReadSetV1): string {
  return canonicalProductProductionJsonV2({
    runRows: [...readSet.runRows].sort((left, right) => left.id - right.id),
    eventRows: [...readSet.eventRows].sort((left, right) => left.id - right.id),
    checkpointRows: [...readSet.checkpointRows].sort((left, right) => left.id - right.id),
  })
}

/** Freeze every raw row consumed by the producer/root proof. The proof hash is
 * intentionally portable and therefore projects only stable witnesses; this
 * local read set closes the stronger same-database CAS around event and
 * checkpoint evidence that must not change between verification and carry. */
async function collectSameBuildCarryParentReadSetV1(
  sourceRows: ProductBuildArtifactRecordV1[],
): Promise<SameBuildCarryParentReadSetV1> {
  const producerRunIds = [...new Set(sourceRows.map(row => row.producerRunId))]
  if (producerRunIds.some(id => id == null) || producerRunIds.length === 0) {
    throw new Error('[product-production-artifact] carry-forward 父证明 Run 集合不完整')
  }
  const producers = await db.agentRuns.bulkGet(producerRunIds as number[])
  if (producers.some(row => row?.id == null || row.parentRunId == null)) {
    throw new Error('[product-production-artifact] carry-forward 父证明 Run 集合不完整')
  }
  const runIds = [...new Set([
    ...(producerRunIds as number[]),
    ...producers.map(row => row!.parentRunId!),
  ])].sort((left, right) => left - right)
  const rows = await db.agentRuns.bulkGet(runIds)
  if (rows.length !== runIds.length || rows.some(row => row?.id == null)) {
    throw new Error('[product-production-artifact] carry-forward 父证明 Run 集合不完整')
  }
  const runRows = rows as Array<AgentRunRecord & { id: number }>
  const eventRows: Array<AgentRunEventRecord & { id: number }> = []
  const checkpointRows: Array<AgentRunCheckpointRecord & { id: number }> = []
  for (const runId of runIds) {
    const [events, checkpoints] = await Promise.all([
      db.agentRunEvents.where('runId').equals(runId).toArray(),
      db.agentRunCheckpoints.where('runId').equals(runId).toArray(),
    ])
    if (events.some(row => row.id == null) || checkpoints.some(row => row.id == null)) {
      throw new Error('[product-production-artifact] carry-forward 父证明事件或 checkpoint 缺少 ID')
    }
    eventRows.push(...events as Array<AgentRunEventRecord & { id: number }>)
    checkpointRows.push(...checkpoints as Array<AgentRunCheckpointRecord & { id: number }>)
  }
  return {
    runRows: runRows.sort((left, right) => left.id - right.id),
    eventRows: eventRows.sort((left, right) => left.id - right.id),
    checkpointRows: checkpointRows.sort((left, right) => left.id - right.id),
  }
}

/** Must run inside the same rw transaction that writes carried Artifacts. */
async function assertSameBuildCarryParentReadSetUnchangedV1(
  expected: SameBuildCarryParentReadSetV1,
): Promise<void> {
  const runIds = expected.runRows.map(row => row.id)
  const rows = await db.agentRuns.bulkGet(runIds)
  if (rows.length !== runIds.length || rows.some(row => row?.id == null)) {
    throw new Error('[product-production-artifact] carry-forward 父证明 Run 已变化')
  }
  const current: SameBuildCarryParentReadSetV1 = {
    runRows: rows as Array<AgentRunRecord & { id: number }>,
    eventRows: [],
    checkpointRows: [],
  }
  for (const runId of runIds) {
    const [events, checkpoints] = await Promise.all([
      db.agentRunEvents.where('runId').equals(runId).toArray(),
      db.agentRunCheckpoints.where('runId').equals(runId).toArray(),
    ])
    if (events.some(row => row.id == null) || checkpoints.some(row => row.id == null)) {
      throw new Error('[product-production-artifact] carry-forward 父证明事件或 checkpoint 已变化')
    }
    current.eventRows.push(...events as Array<AgentRunEventRecord & { id: number }>)
    current.checkpointRows.push(...checkpoints as Array<AgentRunCheckpointRecord & { id: number }>)
  }
  if (sameBuildCarryParentReadSetJsonV1(current)
    !== sameBuildCarryParentReadSetJsonV1(expected)) {
    throw new Error('[product-production-artifact] carry-forward 父证明读取后已变化')
  }
}

interface SealedBuildProofContextV1 {
  production: ProductProductionRecordV1
  build: ProductBuildRecordV1 & { id: number }
  plan: ProductProductionPlanV3
  portableTaskLedger: ProductProductionPortableTaskLedgerEntryV1[]
  portableRootSealHash: string
  manifestReceipts: Map<string, {
    artifactKey: string
    version: number
    contentHash: string
    producerReceiptHash: string | null
  }>
  blobProofs: Map<number, MediaBlobObjectRecordV1 & { id: number }>
}

async function sealedBuildProofContextV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
  build: ProductBuildRecordV1 & { id: number }
  activeRows: ProductBuildArtifactRecordV1[]
}): Promise<SealedBuildProofContextV1> {
  const { production, build } = input
  if (!['preview-ready', 'release-ready', 'released'].includes(build.status)
    || !isSha256Hash(build.rootTerminalReceiptHash)) {
    throw new Error('[product-production-artifact] cross-build 来源 Build 尚未封存')
  }
  const plan = parseProductProductionPlanV3(build.planJson, undefined, build.briefHash)
  const manifest = parseProductBuildManifestV1(build.manifestJson)
  const quality = parseProductBuildQualityReportV1(build.qualityReportJson)
  if (canonicalProductProductionJsonV2(plan) !== build.planJson
    || canonicalProductProductionJsonV2(manifest) !== build.manifestJson
    || canonicalProductProductionJsonV2(quality) !== build.qualityReportJson
    || await hashProductProductionValueV2(plan) !== build.planHash
    || await hashProductProductionValueV2(manifest) !== build.manifestHash
    || await hashProductProductionValueV2(quality) !== build.qualityReportHash
    || plan.productType !== production.productType
    || plan.buildNumber !== build.buildNumber || plan.briefHash !== build.briefHash
    || plan.controlEpoch !== build.controlEpoch
    || manifest.productionKey !== production.productionKey
    || manifest.buildNumber !== build.buildNumber || manifest.briefRevision !== build.briefRevision
    || manifest.briefHash !== build.briefHash || manifest.planHash !== build.planHash
    || manifest.controlEpoch !== build.controlEpoch || manifest.runtimePackageHash !== build.packageHash
    || quality.buildNumber !== build.buildNumber || quality.packageHash !== build.packageHash) {
    throw new Error('[product-production-artifact] cross-build 来源 Build Plan/Manifest/Quality 不闭合')
  }
  const activeRows = [...input.activeRows]
    .filter(row => row.controlEpoch === build.controlEpoch && ['accepted', 'carried-forward'].includes(row.status))
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
  if (!activeRows.length || activeRows.some(row => row.buildId !== build.id
    || row.projectId !== build.projectId || row.worldId !== build.worldId || row.workId !== build.workId)
    || new Set(activeRows.map(row => row.artifactKey)).size !== activeRows.length) {
    throw new Error('[product-production-artifact] cross-build 来源 active Artifact 不完整或重复')
  }
  const planOutputKeys = plan.tasks.flatMap(task => task.outputArtifactKeys).sort()
  const activeKeys = activeRows.map(row => row.artifactKey).sort()
  if (planOutputKeys.length !== activeKeys.length
    || planOutputKeys.some((key, index) => key !== activeKeys[index])) {
    throw new Error('[product-production-artifact] cross-build 来源 active Artifact 未精确覆盖 Plan 输出')
  }
  const receipts = activeRows.map(row => ({
    artifactKey: row.artifactKey,
    version: row.version,
    contentHash: row.contentHash,
    producerReceiptHash: row.producerReceiptHash,
  }))
  if (canonicalProductProductionJsonV2(receipts)
    !== canonicalProductProductionJsonV2(manifest.artifactReceipts)) {
    throw new Error('[product-production-artifact] cross-build 来源 Manifest 未精确封存 active Artifacts')
  }
  const terminalKeys = productProductionTerminalArtifactKeysV1(production.productType)
  const runtime = activeRows.filter(row => row.artifactKey === terminalKeys.runtimePackage)
  const qualityRows = activeRows.filter(row => row.artifactKey === terminalKeys.qualityReport)
  if (runtime.length !== 1 || qualityRows.length !== 1
    || runtime[0].contentHash !== build.packageHash
    || qualityRows[0].contentHash !== build.qualityReportHash) {
    throw new Error('[product-production-artifact] cross-build 来源终端 Artifact 指针不闭合')
  }
  const rootReceiptInput = {
    planHash: build.planHash,
    manifestHash: build.manifestHash,
    packageHash: build.packageHash,
    qualityReportHash: build.qualityReportHash,
    controlEpoch: build.controlEpoch,
    budgetLedgerJson: build.budgetLedgerJson,
    artifacts: activeRows,
  }
  const rootReceipt = await createProductBuildRootTerminalReceiptV1(rootReceiptInput)
  if (rootReceipt !== build.rootTerminalReceiptHash) {
    const compatibility = await verifyProductBuildRootTerminalReceiptV1({
      ...rootReceiptInput,
      expectedReceiptHash: build.rootTerminalReceiptHash ?? '',
    })
    if (compatibility.valid && compatibility.version === 1) {
      throw new Error('[product-production-artifact] legacy v1 Build 必须重新生产为 v2 envelope seal 后才能跨 Build 复用')
    }
    throw new Error('[product-production-artifact] cross-build 来源 root terminal receipt 损坏')
  }
  const portableTaskLedger = parseProductProductionPortableTaskLedgerV1({
    budgetLedgerJson: build.budgetLedgerJson,
    plan,
  })
  // The root seal represents the complete active Build, so its physical media
  // closure must be readable as well. This keeps direct carry, terminal
  // revalidation and Creator governance from disagreeing when an unrelated
  // parent media sibling has gone missing or corrupt.
  const blobProofs = await verifiedBlobProofsV1({
    scope: input.scope,
    artifacts: activeRows,
    label: 'cross-build sealed source',
  })
  const portableRootSealHash = await hashProductProductionPortableRootSealV1({
    planHash: build.planHash,
    manifestHash: build.manifestHash,
    packageHash: build.packageHash,
    qualityReportHash: build.qualityReportHash,
    rootTerminalReceiptHash: build.rootTerminalReceiptHash,
    controlEpoch: build.controlEpoch,
    portableTaskLedger,
  })
  return {
    production,
    build,
    plan,
    portableTaskLedger,
    portableRootSealHash,
    manifestReceipts: new Map(manifest.artifactReceipts.map(row => [row.artifactKey, row])),
    blobProofs,
  }
}

async function sealedParentProofHashV1(input: {
  context: SealedBuildProofContextV1
  source: ProductBuildArtifactRecordV1
  blobContentHash: string | null
}): Promise<string> {
  const ownerTasks = input.context.plan.tasks
    .filter(task => task.outputArtifactKeys.includes(input.source.artifactKey))
  const ownerTask = ownerTasks[0]
  const ownerLedger = ownerTask == null ? null
    : input.context.portableTaskLedger.find(row => row.taskKey === ownerTask.taskKey)
  const manifestMember = input.context.manifestReceipts.get(input.source.artifactKey)
  if (ownerTasks.length !== 1 || !ownerTask || !ownerLedger || !manifestMember
    || ownerLedger.idempotencyKey !== input.source.inputHash
    || ownerLedger.terminalReceiptHash !== input.source.producerReceiptHash
    || ownerTask.acceptanceGateIds.some(gate => !ownerLedger.passedGateIds.includes(gate))
    || manifestMember.version !== input.source.version
    || manifestMember.contentHash !== input.source.contentHash
    || manifestMember.producerReceiptHash !== input.source.producerReceiptHash) {
    throw new Error(`[product-production-artifact] cross-build 来源 owner/ledger/manifest 不闭合:${input.source.artifactKey}`)
  }
  return hashProductProductionSealedParentArtifactProofV1({
    productionKey: input.context.production.productionKey,
    productType: input.context.production.productType,
    build: input.context.build,
    portableTaskLedger: input.context.portableTaskLedger,
    portableRootSealHash: input.context.portableRootSealHash,
    ownerTask,
    manifestMember,
    artifact: input.source,
    blobContentHash: input.blobContentHash,
  })
}

interface CrossBuildCarryAuthorizationV1 {
  plan: ProductProductionPlanV3
  brief: ProductProductionBriefV3
  briefRowJson: string
  repairCommands: Array<{ id: number; rowJson: string }>
  reuseImpact: string[]
}

async function crossBuildCarryAuthorizationV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1 & { id: number }
  sourceBuild: ProductBuildRecordV1 & { id: number }
  targetBuild: ProductBuildRecordV1 & { id: number }
  sources: ProductBuildArtifactRecordV1[]
  artifactKeys: string[]
}): Promise<CrossBuildCarryAuthorizationV1> {
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]')
    .equals([input.targetBuild.productionId, input.targetBuild.briefRevision])
    .first()
  if (!briefRow || briefRow.id == null
    || !await assertRecordInScope(input.scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.productionId !== input.production.id
    || briefRow.briefHash !== input.targetBuild.briefHash) {
    throw new Error('[product-production-artifact] cross-build 目标 Brief 不存在或未授权')
  }
  const creatorAuthority = briefRow.briefKind === 'text-open-world-creator-v1'
    ? await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
        scope: input.scope,
        buildId: input.targetBuild.id,
      })
    : null
  const brief = creatorAuthority?.contracts.executionBrief ?? parseProductProductionBriefV3(briefRow.briefJson)
  const plan = creatorAuthority?.productionPlan ?? parseProductProductionPlanV3(
    input.targetBuild.planJson,
    brief,
    input.targetBuild.briefHash,
  )
  const reuseImpact = creatorAuthority?.repair?.authorization.impactPlan.targetTaskKeys
    ?? creatorAuthority?.media?.authorization.plan.targetTaskKeys
    ?? brief.evolution?.affectedLanes
  if (canonicalProductProductionJsonV2(plan) !== input.targetBuild.planJson
    || await hashProductProductionValueV2(plan) !== input.targetBuild.planHash
    || plan.productType !== input.production.productType
    || plan.buildNumber !== input.targetBuild.buildNumber
    || plan.controlEpoch !== input.targetBuild.controlEpoch
    || input.targetBuild.parentBuildNumber !== input.sourceBuild.buildNumber
    || !reuseImpact) {
    throw new Error('[product-production-artifact] cross-build 目标 Plan/Brief 未冻结复用授权')
  }
  const sourceByKey = new Map(input.sources.map(row => [row.artifactKey, row]))
  const requested = new Set(input.artifactKeys)
  const ownerTasks = new Map<string, ProductProductionPlanTaskV3>()
  for (const artifactKey of requested) {
    const owners = plan.tasks.filter(task => task.outputArtifactKeys.includes(artifactKey))
    if (owners.length !== 1) {
      throw new Error(`[product-production-artifact] cross-build Artifact owner 不唯一:${artifactKey}`)
    }
    ownerTasks.set(owners[0].taskKey, owners[0])
  }
  for (const task of ownerTasks.values()) {
    const expectedKeys = [...task.outputArtifactKeys].sort()
    const requestedTaskKeys = expectedKeys.filter(key => requested.has(key))
    if (requestedTaskKeys.length !== expectedKeys.length
      || expectedKeys.some(key => !sourceByKey.has(key))) {
      throw new Error(`[product-production-artifact] cross-build 必须完整复用 task siblings:${task.taskKey}`)
    }
    const reuse = task.reuse
    const sources = task.outputArtifactKeys.map(key => sourceByKey.get(key)!)
    const representative = sources[0]
    if (!reuse || reuse.sourceBuildNumber !== input.sourceBuild.buildNumber
      || reuse.sourceArtifactKey !== representative.artifactKey
      || reuse.sourceContentHash !== representative.contentHash
      || reuse.requiresRevalidation !== true) {
      throw new Error(`[product-production-artifact] cross-build task 缺少精确 reuse 授权:${task.taskKey}`)
    }
    const expectedReuseKey = await hashProductProductionValueV2({
      schema: 'storyforge.product-production-cross-build-reuse',
      version: 1,
      sourceBuildNumber: input.sourceBuild.buildNumber,
      targetBuildNumber: input.targetBuild.buildNumber,
      taskKey: task.taskKey,
      userImpact: reuseImpact,
      artifacts: sources.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
    })
    if (reuse.reuseKey !== expectedReuseKey) {
      throw new Error(`[product-production-artifact] cross-build reuseKey 不闭合:${task.taskKey}`)
    }
  }
  return {
    plan,
    brief,
    briefRowJson: canonicalProductProductionJsonV2(briefRow),
    repairCommands: creatorAuthority?.commandChain.map(command => ({
      id: command.id,
      rowJson: canonicalProductProductionJsonV2(command),
    })) ?? [],
    reuseImpact: [...reuseImpact],
  }
}

function sameArrayBufferV1(left: ArrayBuffer | null, right: ArrayBuffer | null): boolean {
  if (left === right) return true
  if (!left || !right || left.byteLength !== right.byteLength) return false
  const leftBytes = new Uint8Array(left)
  const rightBytes = new Uint8Array(right)
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false
  }
  return true
}

function cloneBlobProofRowV1(
  row: MediaBlobObjectRecordV1 & { id: number },
): MediaBlobObjectRecordV1 & { id: number } {
  return { ...row, data: row.data?.slice(0) ?? null }
}

function sameCarriedArtifactEnvelopeV1(
  carried: ProductBuildArtifactRecordV1,
  source: ProductBuildArtifactRecordV1,
): boolean {
  return carried.artifactKey === source.artifactKey
    && carried.requirementKey === source.requirementKey
    && carried.kind === source.kind && carried.mediaKind === source.mediaKind
    && carried.contentHash === source.contentHash && carried.payloadJson === source.payloadJson
    && carried.metadataJson === source.metadataJson && carried.qualityJson === source.qualityJson
    && carried.rightsJson === source.rightsJson && carried.blobObjectId === source.blobObjectId
    && carried.mimeType === source.mimeType && carried.byteSize === source.byteSize
    && carried.parentArtifactHash === source.contentHash
    && carried.carriedFrom?.artifactKey === source.artifactKey
    && carried.carriedFrom.version === source.version
    && carried.carriedFrom.contentHash === source.contentHash
}

async function verifiedBlobProofsV1(input: {
  scope: WorkspaceScope
  artifacts: ProductBuildArtifactRecordV1[]
  label: string
}): Promise<Map<number, MediaBlobObjectRecordV1 & { id: number }>> {
  const proofs = new Map<number, MediaBlobObjectRecordV1 & { id: number }>()
  for (const artifact of input.artifacts) {
    if (artifact.blobObjectId == null) continue
    const prior = proofs.get(artifact.blobObjectId)
    if (prior) {
      if (prior.contentHash !== artifact.contentHash || prior.mimeType !== artifact.mimeType
        || prior.byteSize !== artifact.byteSize) {
        throw new Error(`[product-production-artifact] ${input.label} 媒资引用冲突:${artifact.artifactKey}`)
      }
      continue
    }
    const blob = await db.mediaBlobObjects.get(artifact.blobObjectId)
    if (!blob || blob.id == null
      || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' })
      || blob.storageState !== 'ready' || blob.contentHash !== artifact.contentHash
      || blob.mimeType !== artifact.mimeType || blob.byteSize !== artifact.byteSize) {
      throw new Error(`[product-production-artifact] ${input.label} 媒资对象损坏:${artifact.artifactKey}`)
    }
    await readVerifiedMediaBlobObjectData(blob)
    proofs.set(blob.id, cloneBlobProofRowV1(
      blob as MediaBlobObjectRecordV1 & { id: number },
    ))
  }
  return proofs
}

async function refreshVerifiedBlobProofsV1(input: {
  scope: WorkspaceScope
  expected: Map<number, MediaBlobObjectRecordV1 & { id: number }>
  label: string
}): Promise<Map<number, MediaBlobObjectRecordV1 & { id: number }>> {
  const refreshed = new Map<number, MediaBlobObjectRecordV1 & { id: number }>()
  for (const [blobId, prior] of input.expected) {
    const current = await db.mediaBlobObjects.get(blobId)
    if (!current || current.id == null
      || !await assertRecordInScope(input.scope, 'mediaBlobObjects', current, { owner: 'work' })
      || !sameBlobProofMetadataV1(prior, current as MediaBlobObjectRecordV1 & { id: number })
      || prior.backend === 'indexeddb' && !sameArrayBufferV1(prior.data, current.data)) {
      throw new Error(`[product-production-artifact] ${input.label} 媒资证明读取后已变化`)
    }
    await readVerifiedMediaBlobObjectData(current)
    refreshed.set(blobId, cloneBlobProofRowV1(
      current as MediaBlobObjectRecordV1 & { id: number },
    ))
  }
  return refreshed
}

function mergeBlobProofRowsV1(input: {
  target: Map<number, MediaBlobObjectRecordV1 & { id: number }>
  source: ReadonlyMap<number, MediaBlobObjectRecordV1 & { id: number }>
  label: string
}): void {
  for (const [blobId, source] of input.source) {
    const prior = input.target.get(blobId)
    if ((prior && !sameBlobProofMetadataV1(prior, source))
      || (prior?.backend === 'indexeddb' && !sameArrayBufferV1(prior.data, source.data))) {
      throw new Error(`[product-production-artifact] ${input.label} 媒资证明集合冲突:${blobId}`)
    }
    if (!prior) input.target.set(blobId, cloneBlobProofRowV1(source))
  }
}

function stableKey(value: string, label: string): string {
  const normalized = value.trim()
  if (!STABLE_KEY.test(normalized)) throw new Error(`[product-production-artifact] ${label} 无效`)
  return normalized
}

function boundedJson(value: unknown, label: string, maximumChars = 2_000_000): string {
  const json = canonicalProductProductionJsonV2(value)
  if (json.length > maximumChars) {
    throw new Error(`[product-production-artifact] ${label} 超出 ${Math.floor(maximumChars / 1_000_000)}MB 上限`)
  }
  return json
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[product-production-artifact] ${label} 必须是对象`)
  }
  const row = value as Record<string, unknown>
  const actual = Object.keys(row).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`[product-production-artifact] ${label} 字段不精确`)
  }
  return row
}

function safeUsageWithinBudget(value: unknown, budget: ProductTaskBudgetReservationV1): void {
  const usage = exactRecord(value, [
    'modelCalls', 'inputTokens', 'outputTokens', 'mediaCalls', 'costUsd',
    'durationMs', 'storageBytes',
  ], 'producer candidate usage')
  const integerFields = [
    'modelCalls', 'inputTokens', 'outputTokens', 'mediaCalls', 'durationMs', 'storageBytes',
  ] as const
  for (const field of integerFields) {
    if (!Number.isSafeInteger(usage[field]) || Number(usage[field]) < 0) {
      throw new Error(`[product-production-artifact] producer candidate usage.${field} 无效`)
    }
  }
  const cost = usage.costUsd
  if (cost !== null && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)) {
    throw new Error('[product-production-artifact] producer candidate usage.costUsd 无效')
  }
  if (Number(usage.modelCalls) > budget.modelCalls
    || Number(usage.inputTokens) > budget.inputTokens
    || Number(usage.outputTokens) > budget.outputTokens
    || Number(usage.mediaCalls) > budget.mediaCalls
    || Number(usage.durationMs) > budget.durationMs
    || Number(usage.storageBytes) > budget.storageBytes
    || (budget.maximumCostUsd != null
      && Number(cost ?? 0) > budget.maximumCostUsd)) {
    throw new Error('[product-production-artifact] producer candidate usage 超出 Plan 预算')
  }
}

function prepareArtifactAcceptanceV1(
  input: Pick<ProductBuildArtifactAcceptanceInputV1,
    | 'artifactKey' | 'requirementKey' | 'kind' | 'mediaKind' | 'payload'
    | 'metadata' | 'quality' | 'rights' | 'contentHash' | 'blobObjectId'
    | 'mimeType' | 'byteSize'>,
): PreparedArtifactAcceptanceV1 {
  const artifactKey = stableKey(input.artifactKey, 'artifactKey')
  const requirementKey = input.requirementKey == null ? null : stableKey(input.requirementKey, 'requirementKey')
  if (!isProductBuildArtifactKindV1(input.kind)) {
    throw new Error('[product-production-artifact] kind 未登记')
  }
  const payloadJson = boundedJson(
    input.payload,
    'payload',
    input.kind === 'text-open-world.source-pin' ? 16_000_000 : 2_000_000,
  )
  const metadataJson = boundedJson(input.metadata ?? {}, 'metadata')
  const qualityJson = boundedJson(input.quality ?? {}, 'quality')
  const rightsJson = boundedJson(input.rights ?? {}, 'rights')
  const contentHash = input.contentHash ?? ''
  const blobObjectId = input.blobObjectId ?? null
  const mimeType = input.mimeType ?? null
  const byteSize = input.byteSize ?? new TextEncoder().encode(payloadJson).byteLength
  if (contentHash && !isSha256Hash(contentHash)) {
    throw new Error('[product-production-artifact] contentHash 无效')
  }
  if (!Number.isInteger(byteSize) || byteSize < 0 || byteSize > 100 * 1024 * 1024) {
    throw new Error('[product-production-artifact] byteSize 无效')
  }
  if (blobObjectId == null && mimeType != null) {
    throw new Error('[product-production-artifact] 非媒资 Artifact 不能声明 mimeType')
  }
  const binaryArtifact = input.kind === 'image' || input.kind === 'audio'
  if (binaryArtifact !== (blobObjectId != null)
    || binaryArtifact !== (input.mediaKind != null)
    || binaryArtifact !== (mimeType != null)) {
    throw new Error('[product-production-artifact] image/audio 必须且只能绑定完整媒资包络')
  }
  return {
    artifactKey, requirementKey, kind: input.kind, mediaKind: input.mediaKind ?? null,
    payloadJson, metadataJson, qualityJson, rightsJson, contentHash,
    blobObjectId, mimeType, byteSize,
  }
}

async function finalizePreparedContentHashV1(
  prepared: PreparedArtifactAcceptanceV1,
): Promise<PreparedArtifactAcceptanceV1> {
  if (prepared.contentHash) return prepared
  return {
    ...prepared,
    contentHash: await hashProductProductionValueV2(JSON.parse(prepared.payloadJson)),
  }
}

async function assertPreparedContentHashV1(
  prepared: PreparedArtifactAcceptanceV1,
): Promise<void> {
  if (prepared.blobObjectId != null) return
  const payload = JSON.parse(prepared.payloadJson) as unknown
  if (prepared.kind === 'text-open-world.source-pin') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('[product-production-artifact] SourcePin payload 必须是对象')
    }
    const pin = payload as Record<string, unknown>
    if (pin.pinHash !== prepared.contentHash || !isSha256Hash(pin.pinHash)) {
      throw new Error('[product-production-artifact] SourcePin contentHash 与 pinHash 不一致')
    }
    const body = { ...pin }
    delete body.pinHash
    if (await hashProductProductionValueV2(body) !== prepared.contentHash) {
      throw new Error('[product-production-artifact] SourcePin contentHash 与 payload 不一致')
    }
    return
  }
  if (await hashProductProductionValueV2(payload) !== prepared.contentHash) {
    throw new Error('[product-production-artifact] contentHash 与 payload 不一致')
  }
}

async function assertDirectTextOpenWorldSourceArtifactV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1 & { id: number }
  prepared: PreparedArtifactAcceptanceV1
  bundle: TextOpenWorldSourcePinBundleV1 | undefined
  bundleAlreadyValidated?: boolean
}): Promise<DirectSourceAcceptanceProofV1> {
  const production = await db.productProductions.get(input.build.productionId)
  if (!production || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'text-open-world') {
    throw new Error('[product-production-artifact] SourcePin Build 不属于文字开放世界生产')
  }
  const sourcePin = await import('../open-world/source-pin')
  if (!input.bundle) {
    throw new Error('[product-production-artifact] SourcePin 直写缺少完整冻结 Bundle 证明')
  }
  const bundle = input.bundleAlreadyValidated
    ? input.bundle
    : await sourcePin.validateTextOpenWorldSourcePinBundleV1(input.bundle)
  const pin = bundle.pin
  if (pin.productInstanceKey !== production.productionKey) {
    throw new Error('[product-production-artifact] SourcePin Bundle 与 Production 不闭合')
  }
  const brief = await db.productProductionBriefs
    .where('[productionId+revision]')
    .equals([production.id!, input.build.briefRevision])
    .first()
  if (!brief || brief.id == null
    || !await assertRecordInScope(input.scope, 'productProductionBriefs', brief, { owner: 'work' })
    || brief.productionId !== production.id || brief.status !== 'authorized'
    || brief.briefKind !== 'text-open-world-creator-v1'
    || brief.briefHash !== input.build.briefHash) {
    throw new Error('[product-production-artifact] SourcePin 缺少当前 Build 的已授权 Creator Brief')
  }
  let sourcePlan: Record<string, unknown>
  let start: Record<string, unknown>
  try {
    sourcePlan = JSON.parse(brief.sourcePlanJson) as Record<string, unknown>
    start = JSON.parse(brief.confirmedBriefJson) as Record<string, unknown>
  } catch {
    throw new Error('[product-production-artifact] SourcePin 的 Creator 冻结合同损坏')
  }
  const { planHash: sourcePlanHash, ...sourcePlanBody } = sourcePlan
  const { startHash, ...startBody } = start
  const unitKeys = pin.units.map(item => item.artifactKey)
  const sourceSelection = sourcePlan.selection as Record<string, unknown> | undefined
  const selectionClosed = pin.source.kind === 'world-release'
    ? sourceSelection?.kind === 'world-release'
      && Array.isArray(sourceSelection.resourceKeys)
      && canonicalProductProductionJsonV2(sourceSelection.resourceKeys)
        === canonicalProductProductionJsonV2(pin.source.selection.selectedResourceKeys)
    : sourceSelection?.kind === 'novel'
      && sourceSelection.sourceUnitCount === unitKeys.length
  const expectedAuthorizationNonceHash = typeof start.authorizationNonceHash === 'string'
    ? await hashProductProductionValueV2({
        nonce: start.authorizationNonceHash,
        productInstanceKey: pin.productInstanceKey,
        sourceKind: pin.sourceKind,
        sourceVersionHash: pin.sourceVersionHash,
        sourceBoundaryHash: pin.sourceBoundaryHash,
        briefRevision: input.build.briefRevision,
        authorStartRevision: start.authorStartRevision,
      })
    : null
  if (sourcePlan.schema !== 'storyforge.text-open-world-creator-production-source-plan'
    || sourcePlan.productInstanceKey !== production.productionKey
    || sourcePlan.sourceKind !== pin.sourceKind
    || sourcePlan.sourceVersionHash !== pin.sourceVersionHash
    || sourcePlan.expectedSourceBoundaryHash !== pin.sourceBoundaryHash
    || !Array.isArray(sourcePlan.sourceUnitArtifactKeys)
    || canonicalProductProductionJsonV2(sourcePlan.sourceUnitArtifactKeys)
      !== canonicalProductProductionJsonV2(unitKeys)
    || !isSha256Hash(sourcePlanHash)
    || await hashProductProductionValueV2(sourcePlanBody) !== sourcePlanHash
    || brief.sourcePlanHash !== sourcePlanHash
    || !selectionClosed
    || start.schema !== 'storyforge.text-open-world-creator-production-start'
    || start.productInstanceKey !== production.productionKey
    || start.briefRevision !== input.build.briefRevision
    || start.briefHash !== input.build.briefHash
    || start.sourcePlanHash !== sourcePlanHash
    || !isSha256Hash(startHash)
    || await hashProductProductionValueV2(startBody) !== startHash
    || brief.confirmedBriefHash !== startHash
    || brief.authorizedAt !== start.authorizedAt
    || pin.authorization.briefRevision !== input.build.briefRevision
    || pin.authorization.briefHash !== input.build.briefHash
    || pin.authorization.authorStartRevision !== start.authorStartRevision
    || pin.authorization.authorizationNonceHash !== expectedAuthorizationNonceHash
    || pin.authorization.rightsBasis !== start.rightsBasis
    || pin.authorization.rightsNote !== start.rightsNote
    || pin.authorization.authorizedAt !== start.authorizedAt) {
    throw new Error('[product-production-artifact] SourcePin 与 Creator Brief/SourcePlan/Start 授权不闭合；来源变化必须创建新 Build')
  }
  const commands = await db.productProductionCommands
    .where('[productionId+status]')
    .equals([production.id!, 'succeeded'])
    .filter(row => row.type === 'authorize-text-open-world-creator-start')
    .toArray()
  const matchingCommands = commands.filter(command => {
    try {
      const result = JSON.parse(command.resultJson) as Record<string, unknown>
      return result.buildNumber === input.build.buildNumber
        && result.briefRevision === input.build.briefRevision
        && result.briefHash === input.build.briefHash
        && result.sourcePlanHash === sourcePlanHash
        && result.startHash === startHash
        && command.expectedStateRevision === start.authorStartRevision
    } catch {
      return false
    }
  })
  if (matchingCommands.length !== 1 || matchingCommands[0].id == null
    || !await assertRecordInScope(
      input.scope, 'productProductionCommands', matchingCommands[0], { owner: 'work' },
    )) {
    throw new Error('[product-production-artifact] SourcePin 缺少唯一成功的 Creator Start 命令回执')
  }
  const activePinRows = (await db.productBuildArtifacts.where('buildId').equals(input.build.id).toArray())
    .filter(row => row.controlEpoch === input.build.controlEpoch
      && row.status === 'accepted' && row.kind === 'text-open-world.source-pin')
  if (activePinRows.length > 1
    || activePinRows.length === 1 && activePinRows[0].contentHash !== pin.pinHash) {
    throw new Error('[product-production-artifact] 同一 Build 的 SourcePin 已冻结；来源变化必须创建新 Build')
  }
  const payload = JSON.parse(input.prepared.payloadJson) as unknown
  const expectedCandidate = sourcePin.createTextOpenWorldSourcePinCandidateArtifactsV1(bundle)
    .find(artifact => artifact.artifactKey === input.prepared.artifactKey)
  if (!expectedCandidate) {
    throw new Error('[product-production-artifact] SourcePin Artifact 不属于冻结整包')
  }
  const expectedPrepared = await finalizePreparedContentHashV1(
    prepareArtifactAcceptanceV1(expectedCandidate),
  )
  if (canonicalProductProductionJsonV2(expectedPrepared)
    !== canonicalProductProductionJsonV2(input.prepared)) {
    throw new Error('[product-production-artifact] SourcePin 治理包络与唯一 P0 candidate 合同不一致')
  }
  if (input.prepared.kind === 'text-open-world.source-pin-unit') {
    const unit = await sourcePin.validateTextOpenWorldSourcePinUnitV1(payload)
    if (unit.productInstanceKey !== production.productionKey
      || unit.artifactKey !== input.prepared.artifactKey) {
      throw new Error('[product-production-artifact] SourcePinUnit 与 Production/Artifact key 不闭合')
    }
  } else if (input.prepared.kind === 'text-open-world.source-pin') {
    const preparedPin = await sourcePin.validateTextOpenWorldSourcePinV1(payload)
    if (preparedPin.pinHash !== pin.pinHash
      || canonicalProductProductionJsonV2(preparedPin) !== canonicalProductProductionJsonV2(pin)
      || pin.productInstanceKey !== production.productionKey) {
      throw new Error('[product-production-artifact] SourcePin 与 Production/Artifact key 不闭合')
    }
  } else {
    throw new Error('[product-production-artifact] 非来源 Artifact 缺少 producer proof')
  }
  return {
    productionId: input.build.productionId,
    productionKey: production.productionKey,
    briefRowJson: canonicalProductProductionJsonV2(brief),
    startCommandMatch: {
      buildNumber: input.build.buildNumber,
      briefRevision: input.build.briefRevision,
      briefHash: input.build.briefHash,
      sourcePlanHash,
      startHash,
      expectedStateRevision: start.authorStartRevision,
    },
    matchingStartCommandsJson: canonicalProductProductionJsonV2(
      matchingCommands.sort((left, right) => (left.id ?? 0) - (right.id ?? 0)),
    ),
    activePinRowsJson: canonicalProductProductionJsonV2(activePinRows),
  }
}

function ledgerRootRunIdV1(budgetLedgerJson: string): number {
  let parsed: unknown
  try { parsed = JSON.parse(budgetLedgerJson) } catch {
    throw new Error('[product-production-artifact] budget ledger JSON 损坏')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('[product-production-artifact] budget ledger 必须是对象')
  }
  const rootRunId = (parsed as Record<string, unknown>).rootRunId
  if (!Number.isSafeInteger(rootRunId) || Number(rootRunId) < 1) {
    throw new Error('[product-production-artifact] budget ledger 缺少 rootRunId')
  }
  return Number(rootRunId)
}

function eventStreamRowsFromSnapshotV1(snapshot: AgentRunSnapshotV1): unknown[] {
  return snapshot.events.map(event => ({
    projectId: event.projectId,
    worldGroupId: event.worldGroupId ?? null,
    runId: event.runId,
    sequence: event.sequence,
    generation: event.generation,
    contractHash: event.contractHash,
    type: event.type,
    payloadJson: canonicalAgentRunJsonV1(event.payload),
    createdAt: event.createdAt,
  }))
}

async function eventStreamHashV1(
  runId: number,
  expectedSnapshot?: AgentRunSnapshotV1,
): Promise<string> {
  const rows = await db.agentRunEvents
    .where('[runId+sequence]')
    .between([runId, Dexie.minKey], [runId, Dexie.maxKey])
    .toArray()
  const materialized = rows.map(row => ({
    projectId: row.projectId,
    worldGroupId: row.worldGroupId ?? null,
    runId: row.runId,
    sequence: row.sequence,
    generation: row.generation,
    contractHash: row.contractHash,
    type: row.type,
    payloadJson: row.payloadJson,
    createdAt: row.createdAt,
  }))
  const hash = await hashProductProductionValueV2(materialized)
  if (expectedSnapshot
    && hash !== await hashProductProductionValueV2(eventStreamRowsFromSnapshotV1(expectedSnapshot))) {
    throw new Error('[product-production-artifact] producer Run events 在验证期间发生变化')
  }
  return hash
}

async function checkpointFingerprintV1(input: {
  run: AgentRunRecord & { id: number }
  checkpoint: AgentRunCheckpointRecord & { id: number }
  eventStreamHash: string
}): Promise<ProducerCheckpointFingerprintV1> {
  return {
    runId: input.run.id,
    projectId: input.run.projectId,
    worldGroupId: input.run.worldGroupId ?? null,
    workId: input.run.workId ?? null,
    productBuildId: input.run.productBuildId ?? null,
    parentRunId: input.run.parentRunId ?? null,
    parentRelation: input.run.parentRelation ?? null,
    status: input.run.status,
    contractHash: input.run.contractHash,
    generation: input.run.generation,
    lastSequence: input.run.lastSequence,
    projectionHash: input.run.projectionHash,
    terminalReceiptHash: input.run.terminalReceiptHash ?? null,
    updatedAt: input.run.updatedAt,
    contractJsonHash: await hashProductProductionValueV2(input.run.contractJson),
    projectionJsonHash: await hashProductProductionValueV2(input.run.projectionJson),
    eventStreamHash: input.eventStreamHash,
    checkpointId: input.checkpoint.id,
    checkpointProjectId: input.checkpoint.projectId,
    checkpointWorldGroupId: input.checkpoint.worldGroupId ?? null,
    checkpointHash: input.checkpoint.checkpointHash,
    throughSequence: input.checkpoint.throughSequence,
    checkpointGeneration: input.checkpoint.generation,
    checkpointContractHash: input.checkpoint.contractHash,
    checkpointProjectionHash: input.checkpoint.projectionHash,
    checkpointProjectionJsonHash: await hashProductProductionValueV2(input.checkpoint.projectionJson),
    checkpointResumePayloadJsonHash: input.checkpoint.resumePayloadJson == null
      ? null : await hashProductProductionValueV2(input.checkpoint.resumePayloadJson),
    resumePayloadHash: input.checkpoint.resumePayloadHash ?? null,
  }
}

async function rootFingerprintV1(input: {
  run: AgentRunRecord & { id: number }
  eventStreamHash: string
}): Promise<ProducerRootFingerprintV1> {
  return {
    runId: input.run.id,
    projectId: input.run.projectId,
    worldGroupId: input.run.worldGroupId ?? null,
    workId: input.run.workId ?? null,
    productBuildId: input.run.productBuildId ?? null,
    parentRunId: input.run.parentRunId ?? null,
    parentRelation: input.run.parentRelation ?? null,
    status: input.run.status,
    contractHash: input.run.contractHash,
    generation: input.run.generation,
    lastSequence: input.run.lastSequence,
    projectionHash: input.run.projectionHash,
    terminalReceiptHash: input.run.terminalReceiptHash ?? null,
    updatedAt: input.run.updatedAt,
    contractJsonHash: await hashProductProductionValueV2(input.run.contractJson),
    projectionJsonHash: await hashProductProductionValueV2(input.run.projectionJson),
    eventStreamHash: input.eventStreamHash,
  }
}

function sameProducerFingerprintV1(
  left: ProducerCheckpointFingerprintV1,
  right: ProducerCheckpointFingerprintV1,
): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

function sameRootFingerprintV1(
  left: ProducerRootFingerprintV1,
  right: ProducerRootFingerprintV1,
): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

async function producerBuildFingerprintV1(
  build: ProductBuildRecordV1 & { id: number },
): Promise<ProducerBuildFingerprintV1> {
  return {
    buildId: build.id,
    productionId: build.productionId,
    projectId: build.projectId,
    worldId: build.worldId,
    workId: build.workId,
    buildNumber: build.buildNumber,
    briefRevision: build.briefRevision,
    briefHash: build.briefHash,
    controlEpoch: build.controlEpoch,
    planRevision: build.planRevision,
    planHash: build.planHash,
    planJsonHash: await hashProductProductionValueV2(build.planJson),
    rootRunId: ledgerRootRunIdV1(build.budgetLedgerJson),
  }
}

function sameBuildFingerprintV1(
  left: ProducerBuildFingerprintV1,
  right: ProducerBuildFingerprintV1,
): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

function producerProofCacheKeyV1(input: {
  scope: WorkspaceScope
  buildFingerprint: ProducerBuildFingerprintV1
  producerRunId: number
  producerReceiptHash: string
  inputHash: string
}): string {
  return [
    input.scope.projectId, input.scope.worldId, input.scope.workId,
    input.buildFingerprint.buildId, input.buildFingerprint.buildNumber,
    input.buildFingerprint.controlEpoch, input.buildFingerprint.planRevision,
    input.buildFingerprint.briefHash, input.buildFingerprint.planHash,
    input.buildFingerprint.planJsonHash, input.buildFingerprint.rootRunId,
    input.producerRunId,
    input.producerReceiptHash, input.inputHash,
  ].join(':')
}

async function createVerifiedProducerCandidateV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1 & { id: number }
  producerRunId: number
  producerReceiptHash: string
  inputHash: string
  cacheKey: string
  buildFingerprint: ProducerBuildFingerprintV1
}): Promise<VerifiedProducerCandidateV1> {
  const plan = parseProductProductionPlanV3(input.build.planJson, undefined, input.build.briefHash)
  if (canonicalProductProductionJsonV2(plan) !== input.build.planJson
    || await hashProductProductionValueV2(plan) !== input.build.planHash
    || plan.buildNumber !== input.build.buildNumber
    || plan.controlEpoch !== input.build.controlEpoch) {
    throw new Error('[product-production-artifact] producer Plan 不闭合')
  }
  const verified = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.producerRunId)
  if (!verified || verified.resumePayload == null) {
    throw new Error('[product-production-artifact] producer Run 缺少已验证 candidate checkpoint')
  }
  const snapshot = verified.snapshot
  const boundary = snapshot.contract.scope.productProduction
  const task = boundary == null ? null : plan.tasks.find(row => row.taskKey === boundary.taskKey)
  if (!boundary || !task || snapshot.run.status !== 'completed' || snapshot.projection.state !== 'completed'
    || snapshot.run.productBuildId !== input.build.id
    || snapshot.run.projectId !== input.scope.projectId || snapshot.run.workId !== input.scope.workId
    || boundary.productBuildId !== input.build.id
    || boundary.buildNumber !== input.build.buildNumber
    || boundary.controlEpoch !== input.build.controlEpoch
    || boundary.planHash !== input.build.planHash
    || snapshot.run.parentRunId == null
    || snapshot.run.parentRelation !== `task:${task.taskKey}`
    || snapshot.projection.terminalReceiptHash !== input.producerReceiptHash
    || snapshot.run.terminalReceiptHash !== input.producerReceiptHash) {
    throw new Error('[product-production-artifact] producer Run 与 Build/Plan/receipt 不闭合')
  }
  const rootRunId = ledgerRootRunIdV1(input.build.budgetLedgerJson)
  if (snapshot.run.parentRunId !== rootRunId) {
    throw new Error('[product-production-artifact] producer Run 未绑定 ledger root')
  }
  const rootSnapshot = await readAgentRunV1(input.scope, rootRunId)
  const rootBoundary = rootSnapshot.contract.scope.productProduction
  if (!rootBoundary || rootBoundary.taskKey !== '$root'
    || rootSnapshot.run.parentRunId != null || rootSnapshot.run.parentRelation != null
    || !['running', 'verifying', 'completed'].includes(rootSnapshot.run.status)
    || rootSnapshot.run.projectId !== input.scope.projectId
    || rootSnapshot.run.workId !== input.scope.workId
    || rootSnapshot.run.productBuildId !== input.build.id
    || rootBoundary.productBuildId !== input.build.id
    || rootBoundary.buildNumber !== input.build.buildNumber
    || rootBoundary.controlEpoch !== input.build.controlEpoch
    || rootBoundary.planHash !== input.build.planHash) {
    throw new Error('[product-production-artifact] ledger root Run 与 Build/Plan 不闭合')
  }
  const [producerEventStreamHash, rootEventStreamHash] = await Promise.all([
    eventStreamHashV1(snapshot.run.id, snapshot),
    eventStreamHashV1(rootSnapshot.run.id, rootSnapshot),
  ])
  const candidate = exactRecord(verified.resumePayload, [
    'schema', 'version', 'taskKey', 'attempt', 'controlEpoch',
    'inputHash', 'candidateHash', 'result',
  ], 'producer candidate')
  if (candidate.schema !== 'storyforge.product-production-task-candidate'
    || candidate.version !== 1 || candidate.taskKey !== task.taskKey
    || !Number.isSafeInteger(candidate.attempt) || Number(candidate.attempt) < 1
    || Number(candidate.attempt) > task.maxAttempts
    || candidate.controlEpoch !== input.build.controlEpoch
    || candidate.inputHash !== input.inputHash
    || !isSha256Hash(candidate.candidateHash)) {
    throw new Error('[product-production-artifact] producer candidate 边界无效')
  }
  const result = exactRecord(candidate.result, ['artifacts', 'passedGateIds', 'usage'], 'producer result')
  if (!Array.isArray(result.artifacts) || !Array.isArray(result.passedGateIds)) {
    throw new Error('[product-production-artifact] producer candidate artifacts/gates 无效')
  }
  const passedGateIds = result.passedGateIds as unknown[]
  if (passedGateIds.some(gate => typeof gate !== 'string' || !gate.trim())
    || new Set(passedGateIds).size !== passedGateIds.length
    || task.acceptanceGateIds.some(gate => !passedGateIds.includes(gate))) {
    throw new Error('[product-production-artifact] producer candidate acceptance gates 无效')
  }
  const normalizedGateIds = passedGateIds as string[]
  safeUsageWithinBudget(result.usage, task.budgetReservation)
  const candidateHash = await hashProductProductionTaskCandidateV1(result)
  if (candidateHash !== candidate.candidateHash) {
    throw new Error('[product-production-artifact] producer candidate hash 不匹配')
  }
  const receiptHash = await hashProductProductionTaskReceiptV1({
    taskKey: task.taskKey,
    attempt: Number(candidate.attempt),
    inputHash: input.inputHash,
    candidateHash,
    passedGateIds: normalizedGateIds,
    usage: result.usage,
    controlEpoch: input.build.controlEpoch,
  })
  const checkpointStep = verified.projection.steps[task.taskKey]
  const terminalStep = snapshot.projection.steps[task.taskKey]
  if (receiptHash !== input.producerReceiptHash
    || checkpointStep?.attempt !== Number(candidate.attempt)
    || checkpointStep.candidateHash !== candidateHash
    || terminalStep?.status !== 'succeeded'
    || terminalStep.attempt !== Number(candidate.attempt)
    || terminalStep.candidateHash !== candidateHash
    || terminalStep.outputHash !== candidateHash) {
    throw new Error('[product-production-artifact] producer checkpoint/terminal proof 不闭合')
  }
  const artifacts = new Map<string, PreparedArtifactAcceptanceV1>()
  for (const rawArtifact of result.artifacts) {
    if (!rawArtifact || typeof rawArtifact !== 'object' || Array.isArray(rawArtifact)) {
      throw new Error('[product-production-artifact] producer artifact 必须是对象')
    }
    const row = rawArtifact as Record<string, unknown>
    const allowedArtifactKeys = [
      'artifactKey', 'requirementKey', 'kind', 'mediaKind', 'payload', 'metadata',
      'quality', 'rights', 'contentHash', 'blobObjectId', 'mimeType', 'byteSize',
    ]
    if (!('artifactKey' in row) || !('kind' in row) || !('payload' in row)
      || Object.keys(row).some(key => !allowedArtifactKeys.includes(key))) {
      throw new Error('[product-production-artifact] producer artifact 字段无效')
    }
    const prepared = await finalizePreparedContentHashV1(prepareArtifactAcceptanceV1({
      artifactKey: row.artifactKey as string,
      requirementKey: row.requirementKey as string | null | undefined,
      kind: row.kind as ProductBuildArtifactKindV1,
      mediaKind: row.mediaKind as ProductBuildArtifactRecordV1['mediaKind'] | undefined,
      payload: row.payload,
      metadata: row.metadata,
      quality: row.quality,
      rights: row.rights,
      contentHash: row.contentHash as string | undefined,
      blobObjectId: row.blobObjectId as number | null | undefined,
      mimeType: row.mimeType as string | null | undefined,
      byteSize: row.byteSize as number | undefined,
    }))
    await assertPreparedContentHashV1(prepared)
    if (artifacts.has(prepared.artifactKey)) {
      throw new Error('[product-production-artifact] producer candidate Artifact key 重复')
    }
    artifacts.set(prepared.artifactKey, prepared)
  }
  const expectedKeys = [...task.outputArtifactKeys].sort()
  const actualKeys = [...artifacts.keys()].sort()
  if (expectedKeys.length !== actualKeys.length
    || expectedKeys.some((key, index) => key !== actualKeys[index])) {
    throw new Error('[product-production-artifact] producer candidate 未精确覆盖 Plan 输出')
  }
  return {
    cacheKey: input.cacheKey,
    buildFingerprint: input.buildFingerprint,
    fingerprint: await checkpointFingerprintV1({
      run: snapshot.run,
      checkpoint: verified.checkpoint,
      eventStreamHash: producerEventStreamHash,
    }),
    rootFingerprint: await rootFingerprintV1({
      run: rootSnapshot.run,
      eventStreamHash: rootEventStreamHash,
    }),
    task,
    attempt: Number(candidate.attempt),
    inputHash: input.inputHash,
    candidateHash,
    receiptHash,
    passedGateIds: normalizedGateIds,
    usage: result.usage,
    importedScopeRebound: hasImportedScopeRevalidationV1(snapshot),
    artifacts,
    remainingArtifactKeys: new Set(actualKeys),
  }
}

async function verifiedProducerCandidateV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1 & { id: number }
  producerRunId: number
  producerReceiptHash: string
  inputHash: string
  fresh?: boolean
}): Promise<VerifiedProducerCandidateV1> {
  const buildFingerprint = await producerBuildFingerprintV1(input.build)
  const cacheKey = producerProofCacheKeyV1({ ...input, buildFingerprint })
  let pending = input.fresh ? undefined : producerProofCache.get(cacheKey)
  if (!pending) {
    if (producerProofCache.size >= PRODUCER_PROOF_CACHE_SIZE) producerProofCache.clear()
    pending = createVerifiedProducerCandidateV1({ ...input, cacheKey, buildFingerprint })
    producerProofCache.set(cacheKey, pending)
  }
  try { return await pending } catch (error) {
    producerProofCache.delete(cacheKey)
    throw error
  }
}

async function latestCheckpointForFingerprintV1(
  runId: number,
): Promise<(AgentRunCheckpointRecord & { id: number }) | null> {
  const row = await db.agentRunCheckpoints
    .where('[runId+throughSequence]')
    .between([runId, Dexie.minKey], [runId, Dexie.maxKey])
    .last()
  return row == null ? null : row as AgentRunCheckpointRecord & { id: number }
}

function parseCanonicalArtifactJsonV1(json: string, label: string): unknown {
  let value: unknown
  try { value = JSON.parse(json) } catch {
    throw new Error(`[product-production-artifact] terminal ${label} 不是合法 JSON`)
  }
  if (canonicalProductProductionJsonV2(value) !== json) {
    throw new Error(`[product-production-artifact] terminal ${label} 不是规范 JSON`)
  }
  return value
}

async function preparedStoredArtifactV1(
  row: ProductBuildArtifactRecordV1,
): Promise<PreparedArtifactAcceptanceV1> {
  const prepared = prepareArtifactAcceptanceV1({
    artifactKey: row.artifactKey,
    requirementKey: row.requirementKey,
    kind: row.kind,
    mediaKind: row.mediaKind,
    payload: parseCanonicalArtifactJsonV1(row.payloadJson, `${row.artifactKey}.payloadJson`),
    metadata: parseCanonicalArtifactJsonV1(row.metadataJson, `${row.artifactKey}.metadataJson`),
    quality: parseCanonicalArtifactJsonV1(row.qualityJson, `${row.artifactKey}.qualityJson`),
    rights: parseCanonicalArtifactJsonV1(row.rightsJson, `${row.artifactKey}.rightsJson`),
    contentHash: row.contentHash,
    blobObjectId: row.blobObjectId,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
  })
  if (prepared.payloadJson !== row.payloadJson || prepared.metadataJson !== row.metadataJson
    || prepared.qualityJson !== row.qualityJson || prepared.rightsJson !== row.rightsJson) {
    throw new Error(`[product-production-artifact] terminal Artifact JSON 包络不规范:${row.artifactKey}`)
  }
  if (row.blobObjectId == null) {
    await assertPreparedContentHashV1(prepared)
    if (new TextEncoder().encode(row.payloadJson).byteLength !== row.byteSize) {
      throw new Error(`[product-production-artifact] terminal Artifact byteSize 与完整 payload 不一致:${row.artifactKey}`)
    }
  }
  return prepared
}

function historicalTaskSiblingsV1(input: {
  task: ProductProductionPlanTaskV3
  anchor: ProductBuildArtifactRecordV1
  allBuildRows: ProductBuildArtifactRecordV1[]
}): ProductBuildArtifactRecordV1[] {
  const rows = input.allBuildRows.filter(row => row.controlEpoch === input.anchor.controlEpoch
    && row.status === 'invalid'
    && row.producerRunId === input.anchor.producerRunId)
  const expected = [...input.task.outputArtifactKeys].sort()
  const actual = rows.map(row => row.artifactKey).sort()
  if (expected.length > TERMINAL_SAME_BUILD_SIBLING_LIMIT
    || rows.length !== expected.length || expected.some((key, index) => key !== actual[index])) {
    throw new Error(`[product-production-artifact] terminal historical task siblings 不闭合:${input.task.taskKey}`)
  }
  return input.task.outputArtifactKeys.map(key => rows.find(row => row.artifactKey === key)!)
}

async function verifyHistoricalAcceptedTaskV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1 & { id: number }
  task: ProductProductionPlanTaskV3
  siblings: ProductBuildArtifactRecordV1[]
}): Promise<void> {
  const anchor = input.siblings[0]
  if (anchor.producerRunId == null || anchor.producerReceiptHash == null
    || input.siblings.some(row => row.carriedFrom !== null || row.parentArtifactHash !== null
      || row.inputHash !== anchor.inputHash
      || row.producerReceiptHash !== anchor.producerReceiptHash)) {
    throw new Error(`[product-production-artifact] terminal historical accepted identity 不闭合:${input.task.taskKey}`)
  }
  const verified = await readLatestVerifiedAgentRunCheckpointV1(input.scope, anchor.producerRunId)
  if (!verified?.resumePayload) {
    throw new Error(`[product-production-artifact] terminal historical accepted checkpoint 缺失:${input.task.taskKey}`)
  }
  const snapshot = verified.snapshot
  const boundary = snapshot.contract.scope.productProduction
  if (snapshot.run.status !== 'completed' || snapshot.projection.state !== 'completed'
    || snapshot.run.productBuildId !== input.build.id
    || snapshot.run.projectId !== input.scope.projectId || snapshot.run.workId !== input.scope.workId
    || snapshot.run.parentRunId == null || snapshot.run.parentRelation !== `task:${input.task.taskKey}`
    || snapshot.run.terminalReceiptHash !== anchor.producerReceiptHash
    || snapshot.projection.terminalReceiptHash !== anchor.producerReceiptHash
    || boundary?.productBuildId !== input.build.id || boundary.buildNumber !== input.build.buildNumber
    || boundary.controlEpoch !== anchor.controlEpoch || boundary.taskKey !== input.task.taskKey) {
    throw new Error(`[product-production-artifact] terminal historical accepted Run 不闭合:${input.task.taskKey}`)
  }
  const root = await readAgentRunV1(input.scope, snapshot.run.parentRunId)
  const rootBoundary = root.contract.scope.productProduction
  if (root.run.productBuildId !== input.build.id || root.run.parentRunId != null
    || root.run.parentRelation != null || rootBoundary?.productBuildId !== input.build.id
    || rootBoundary.buildNumber !== input.build.buildNumber || rootBoundary.taskKey !== '$root'
    || rootBoundary.controlEpoch !== anchor.controlEpoch || rootBoundary.planHash !== boundary.planHash) {
    throw new Error(`[product-production-artifact] terminal historical accepted root 不闭合:${input.task.taskKey}`)
  }
  const candidate = exactRecord(verified.resumePayload, [
    'schema', 'version', 'taskKey', 'attempt', 'controlEpoch',
    'inputHash', 'candidateHash', 'result',
  ], 'historical producer candidate')
  if (candidate.schema !== 'storyforge.product-production-task-candidate'
    || candidate.version !== 1 || candidate.taskKey !== input.task.taskKey
    || !Number.isSafeInteger(candidate.attempt) || Number(candidate.attempt) < 1
    || Number(candidate.attempt) > input.task.maxAttempts
    || candidate.controlEpoch !== anchor.controlEpoch || candidate.inputHash !== anchor.inputHash
    || !isSha256Hash(candidate.candidateHash)) {
    throw new Error(`[product-production-artifact] terminal historical accepted candidate 无效:${input.task.taskKey}`)
  }
  const result = exactRecord(candidate.result, ['artifacts', 'passedGateIds', 'usage'], 'historical producer result')
  if (!Array.isArray(result.artifacts) || !Array.isArray(result.passedGateIds)
    || result.passedGateIds.some(gate => typeof gate !== 'string' || !gate.trim())
    || new Set(result.passedGateIds).size !== result.passedGateIds.length
    || input.task.acceptanceGateIds.some(gate => !(result.passedGateIds as unknown[]).includes(gate))) {
    throw new Error(`[product-production-artifact] terminal historical accepted gates 无效:${input.task.taskKey}`)
  }
  safeUsageWithinBudget(result.usage, input.task.budgetReservation)
  const candidateHash = await hashProductProductionTaskCandidateV1(result)
  const receiptHash = await hashProductProductionTaskReceiptV1({
    taskKey: input.task.taskKey,
    attempt: Number(candidate.attempt),
    inputHash: anchor.inputHash,
    candidateHash,
    passedGateIds: result.passedGateIds as string[],
    usage: result.usage,
    controlEpoch: anchor.controlEpoch,
  })
  const checkpointStep = verified.projection.steps[input.task.taskKey]
  const terminalStep = snapshot.projection.steps[input.task.taskKey]
  if (candidateHash !== candidate.candidateHash || receiptHash !== anchor.producerReceiptHash
    || checkpointStep?.attempt !== Number(candidate.attempt)
    || checkpointStep.candidateHash !== candidateHash
    || terminalStep?.status !== 'succeeded' || terminalStep.attempt !== Number(candidate.attempt)
    || terminalStep.candidateHash !== candidateHash || terminalStep.outputHash !== candidateHash) {
    throw new Error(`[product-production-artifact] terminal historical accepted receipt 不闭合:${input.task.taskKey}`)
  }
  const prepared = new Map<string, PreparedArtifactAcceptanceV1>()
  if (result.artifacts.length !== input.task.outputArtifactKeys.length
    || result.artifacts.length > TERMINAL_SAME_BUILD_SIBLING_LIMIT) {
    throw new Error(`[product-production-artifact] terminal historical candidate sibling 数量无效:${input.task.taskKey}`)
  }
  for (const rawArtifact of result.artifacts) {
    if (!rawArtifact || typeof rawArtifact !== 'object' || Array.isArray(rawArtifact)) {
      throw new Error(`[product-production-artifact] terminal historical candidate Artifact 无效:${input.task.taskKey}`)
    }
    const row = rawArtifact as Record<string, unknown>
    const allowedArtifactKeys = [
      'artifactKey', 'requirementKey', 'kind', 'mediaKind', 'payload', 'metadata',
      'quality', 'rights', 'contentHash', 'blobObjectId', 'mimeType', 'byteSize',
    ]
    if (!('artifactKey' in row) || !('kind' in row) || !('payload' in row)
      || Object.keys(row).some(key => !allowedArtifactKeys.includes(key))) {
      throw new Error(`[product-production-artifact] terminal historical candidate Artifact 字段无效:${input.task.taskKey}`)
    }
    const next = await finalizePreparedContentHashV1(prepareArtifactAcceptanceV1({
      artifactKey: row.artifactKey as string,
      requirementKey: row.requirementKey as string | null | undefined,
      kind: row.kind as ProductBuildArtifactKindV1,
      mediaKind: row.mediaKind as ProductBuildArtifactRecordV1['mediaKind'] | undefined,
      payload: row.payload,
      metadata: row.metadata,
      quality: row.quality,
      rights: row.rights,
      contentHash: row.contentHash as string | undefined,
      blobObjectId: row.blobObjectId as number | null | undefined,
      mimeType: row.mimeType as string | null | undefined,
      byteSize: row.byteSize as number | undefined,
    }))
    if (prepared.has(next.artifactKey)) {
      throw new Error(`[product-production-artifact] terminal historical candidate Artifact key 重复:${input.task.taskKey}`)
    }
    prepared.set(next.artifactKey, next)
  }
  if (prepared.size !== input.task.outputArtifactKeys.length
    || input.siblings.some(row => {
      const expected = prepared.get(row.artifactKey)
      return !expected || canonicalProductProductionJsonV2(expected)
        !== canonicalProductProductionJsonV2({
          artifactKey: row.artifactKey,
          requirementKey: row.requirementKey,
          kind: row.kind,
          mediaKind: row.mediaKind,
          payloadJson: row.payloadJson,
          metadataJson: row.metadataJson,
          qualityJson: row.qualityJson,
          rightsJson: row.rightsJson,
          contentHash: row.contentHash,
          blobObjectId: row.blobObjectId,
          mimeType: row.mimeType,
          byteSize: row.byteSize,
        } satisfies PreparedArtifactAcceptanceV1)
    })) {
    throw new Error(`[product-production-artifact] terminal historical accepted payload 不闭合:${input.task.taskKey}`)
  }
  await verifiedBlobProofsV1({ scope: input.scope, artifacts: input.siblings, label: 'terminal historical accepted' })
}

async function verifyHistoricalCarriedTaskV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1 & { id: number }
  plan: ProductProductionPlanV3
  task: ProductProductionPlanTaskV3
  siblings: ProductBuildArtifactRecordV1[]
  allBuildRows: ProductBuildArtifactRecordV1[]
}): Promise<void> {
  const anchor = input.siblings[0]
  if (anchor.producerRunId == null || anchor.producerReceiptHash == null
    || input.siblings.some(row => row.carriedFrom == null
      || row.inputHash !== anchor.inputHash
      || row.producerReceiptHash !== anchor.producerReceiptHash)) {
    throw new Error(`[product-production-artifact] terminal historical carried identity 不闭合:${input.task.taskKey}`)
  }
  const dependencies = input.task.dependsOn.map(taskKey => {
    const dependency = input.plan.tasks.find(task => task.taskKey === taskKey)!
    const rows = input.allBuildRows.filter(row => row.controlEpoch === anchor.controlEpoch
      && row.status === 'invalid' && dependency.outputArtifactKeys.includes(row.artifactKey))
    const receipts = new Set(rows.map(row => row.producerReceiptHash))
    if (rows.length !== dependency.outputArtifactKeys.length || receipts.size !== 1
      || receipts.has(null) || new Set(rows.map(row => row.artifactKey)).size !== rows.length) {
      throw new Error(`[product-production-artifact] terminal historical carried dependency 不闭合:${taskKey}`)
    }
    return { taskKey, receiptHash: rows[0].producerReceiptHash! }
  })
  const candidateHash = await hashProductProductionCarriedCandidateV1(input.siblings)
  const receiptHash = await hashProductProductionCarriedReceiptV1({
    taskKey: input.task.taskKey,
    inputHash: anchor.inputHash,
    candidateHash,
    dependencies,
    passedGateIds: input.task.acceptanceGateIds,
    controlEpoch: anchor.controlEpoch,
  })
  const snapshot = await readAgentRunV1(input.scope, anchor.producerRunId)
  const boundary = snapshot.contract.scope.productProduction
  const terminalStep = snapshot.projection.steps[input.task.taskKey]
  const checkpoint = await latestCheckpointForFingerprintV1(anchor.producerRunId)
  if (receiptHash !== anchor.producerReceiptHash
    || snapshot.run.status !== 'completed' || snapshot.projection.state !== 'completed'
    || snapshot.run.productBuildId !== input.build.id
    || snapshot.run.parentRunId == null || snapshot.run.parentRelation !== `task:${input.task.taskKey}`
    || snapshot.run.terminalReceiptHash !== receiptHash
    || snapshot.projection.terminalReceiptHash !== receiptHash
    || boundary?.productBuildId !== input.build.id || boundary.buildNumber !== input.build.buildNumber
    || boundary.controlEpoch !== anchor.controlEpoch || boundary.taskKey !== input.task.taskKey
    || terminalStep?.status !== 'succeeded' || terminalStep.attempt !== 1
    || terminalStep.candidateHash != null || terminalStep.outputHash !== candidateHash
    || checkpoint !== null) {
    throw new Error(`[product-production-artifact] terminal historical carried receipt 不闭合:${input.task.taskKey}`)
  }
  const root = await readAgentRunV1(input.scope, snapshot.run.parentRunId)
  const rootBoundary = root.contract.scope.productProduction
  if (root.run.productBuildId !== input.build.id || root.run.parentRunId != null
    || root.run.parentRelation != null || rootBoundary?.productBuildId !== input.build.id
    || rootBoundary.buildNumber !== input.build.buildNumber || rootBoundary.taskKey !== '$root'
    || rootBoundary.controlEpoch !== anchor.controlEpoch || rootBoundary.planHash !== boundary.planHash) {
    throw new Error(`[product-production-artifact] terminal historical carried root 不闭合:${input.task.taskKey}`)
  }
  await verifiedBlobProofsV1({ scope: input.scope, artifacts: input.siblings, label: 'terminal historical carried' })
}

async function verifySameBuildCarriedLineageV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1 & { id: number }
  plan: ProductProductionPlanV3
  target: ProductBuildArtifactRecordV1
  allBuildRows: ProductBuildArtifactRecordV1[]
}): Promise<void> {
  let current = input.target
  const visited = new Set<string>()
  for (let depth = 0; depth < TERMINAL_SAME_BUILD_LINEAGE_DEPTH_LIMIT; depth += 1) {
    const ref = current.carriedFrom
    const locator = `${current.artifactKey}:${current.version}:${current.controlEpoch}`
    if (!ref || ref.buildNumber !== input.build.buildNumber || visited.has(locator)) {
      throw new Error(`[product-production-artifact] terminal same-build lineage cycle/boundary 无效:${input.target.artifactKey}`)
    }
    visited.add(locator)
    const parents = input.allBuildRows.filter(row => row.artifactKey === ref.artifactKey
      && row.version === ref.version && row.contentHash === ref.contentHash)
    if (parents.length !== 1) {
      throw new Error(`[product-production-artifact] terminal same-build source 缺失或不唯一:${current.artifactKey}`)
    }
    const parent = parents[0]
    if (parent.id == null || parent.buildId !== input.build.id
      || parent.projectId !== input.scope.projectId || parent.worldId !== input.scope.worldId
      || parent.workId !== input.scope.workId || parent.status !== 'invalid'
      || parent.version >= current.version || parent.controlEpoch >= current.controlEpoch
      || !sameCarriedArtifactEnvelopeV1(current, parent)) {
      throw new Error(`[product-production-artifact] terminal same-build envelope/status 不闭合:${current.artifactKey}`)
    }
    const ownerTasks = input.plan.tasks.filter(task => task.outputArtifactKeys.includes(parent.artifactKey))
    if (ownerTasks.length !== 1) {
      throw new Error(`[product-production-artifact] terminal same-build owner 不唯一:${parent.artifactKey}`)
    }
    const task = ownerTasks[0]
    const siblings = historicalTaskSiblingsV1({ task, anchor: parent, allBuildRows: input.allBuildRows })
    const expectedProofHash = await frozenParentProofHash({
      source: parent,
      expectedBuildId: input.build.id,
      scope: input.scope,
    })
    if (ref.proofHash !== expectedProofHash) {
      throw new Error(`[product-production-artifact] terminal same-build proof 已变化:${current.artifactKey}`)
    }
    if (parent.carriedFrom == null) {
      await verifyHistoricalAcceptedTaskV1({
        scope: input.scope,
        build: input.build,
        task,
        siblings,
      })
      return
    }
    await verifyHistoricalCarriedTaskV1({
      scope: input.scope,
      build: input.build,
      plan: input.plan,
      task,
      siblings,
      allBuildRows: input.allBuildRows,
    })
    current = parent
  }
  throw new Error(`[product-production-artifact] terminal same-build lineage 超过 ${TERMINAL_SAME_BUILD_LINEAGE_DEPTH_LIMIT} 层安全上限`)
}

function terminalLedgerRunIdV1(budgetLedgerJson: string, taskKey: string): number {
  const parsed = JSON.parse(budgetLedgerJson) as { tasks?: Record<string, { runId?: unknown }> }
  const runId = parsed.tasks?.[taskKey]?.runId
  if (!Number.isSafeInteger(runId) || Number(runId) < 1) {
    throw new Error(`[product-production-artifact] terminal ledger 缺少 task Run:${taskKey}`)
  }
  return Number(runId)
}

interface TerminalRawLedgerTaskV1 {
  runId: number
  attempt: number
  status: 'settled'
  idempotencyKey: string
  candidateHash: string
  terminalReceiptHash: string
  passedGateIds: string[]
  usage: ProductProductionPortableTaskLedgerEntryV1['usage']
  errorCode: null
}

function terminalRawLedgerTaskV1(
  budgetLedgerJson: string,
  taskKey: string,
): TerminalRawLedgerTaskV1 {
  const parsed = JSON.parse(budgetLedgerJson) as { tasks?: Record<string, unknown> }
  const value = parsed.tasks?.[taskKey]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[product-production-artifact] terminal ledger task 缺失:${taskKey}`)
  }
  return value as TerminalRawLedgerTaskV1
}

function isZeroPortableUsageV1(value: ProductProductionPortableTaskLedgerEntryV1['usage']): boolean {
  return value.modelCalls === 0 && value.inputTokens === 0 && value.outputTokens === 0
    && value.mediaCalls === 0 && value.costUsd === 0
    && value.durationMs === 0 && value.storageBytes === 0
}

interface ProductBuildTerminalArtifactGroupV1 {
  buildId: number
  rows: ProductBuildArtifactRecordV1[]
}

/** Raw rows that make the terminal proof true. Hashing the verifier result is
 * not a CAS: the scheduler must re-read these exact rows in the same IndexedDB
 * transaction that takes/finalizes the terminal claim. */
export interface ProductBuildTerminalCasReadSetV1 {
  targetBuildId: number
  targetRootRunId: number
  productionRow: ProductProductionRecordV1 & { id: number }
  buildRows: Array<ProductBuildRecordV1 & { id: number }>
  briefRows: Array<ProductProductionBriefRecordV1 & { id: number }>
  artifactGroups: ProductBuildTerminalArtifactGroupV1[]
  runRows: Array<AgentRunRecord & { id: number }>
  eventRows: Array<AgentRunEventRecord & { id: number }>
  checkpointRows: Array<AgentRunCheckpointRecord & { id: number }>
  blobRows: Array<MediaBlobObjectRecordV1 & { id: number }>
}

function recordRowsJsonV1(rows: unknown[]): string {
  return canonicalProductProductionJsonV2([...rows].sort((left, right) => {
    const leftId = Number((left as { id?: unknown }).id ?? 0)
    const rightId = Number((right as { id?: unknown }).id ?? 0)
    return leftId - rightId
  }))
}

function blobMetadataForCasV1(row: MediaBlobObjectRecordV1 & { id: number }): unknown {
  return { ...row, data: null, indexeddbDataByteLength: row.data?.byteLength ?? null }
}

function sameExactBlobRowV1(
  expected: MediaBlobObjectRecordV1 & { id: number },
  actual: MediaBlobObjectRecordV1 & { id: number },
): boolean {
  return canonicalProductProductionJsonV2(blobMetadataForCasV1(expected))
      === canonicalProductProductionJsonV2(blobMetadataForCasV1(actual))
    && sameArrayBufferV1(expected.data, actual.data)
}

async function collectTerminalCasReadSetV1(input: {
  production: ProductProductionRecordV1 & { id: number }
  build: ProductBuildRecordV1 & { id: number }
  allBuildRows: ProductBuildArtifactRecordV1[]
  rootRunId: number
}): Promise<ProductBuildTerminalCasReadSetV1> {
  const buildRows = (await db.productBuilds.where('productionId').equals(input.production.id).toArray())
    .filter((row): row is ProductBuildRecordV1 & { id: number } => row.id != null)
    .sort((left, right) => left.id - right.id)
  const buildByNumber = new Map(buildRows.map(row => [row.buildNumber, row]))
  const relevantBuildIds = new Set<number>([input.build.id])
  if (input.build.parentBuildNumber != null) {
    const parent = buildByNumber.get(input.build.parentBuildNumber)
    if (parent) relevantBuildIds.add(parent.id)
  }
  for (const row of input.allBuildRows) {
    const sourceBuildNumber = row.carriedFrom?.buildNumber
    if (sourceBuildNumber == null || sourceBuildNumber === input.build.buildNumber) continue
    const source = buildByNumber.get(sourceBuildNumber)
    if (source) relevantBuildIds.add(source.id)
  }
  const artifactGroups: ProductBuildTerminalArtifactGroupV1[] = []
  for (const buildId of [...relevantBuildIds].sort((left, right) => left - right)) {
    const rows = buildId === input.build.id
      ? input.allBuildRows
      : await db.productBuildArtifacts.where('buildId').equals(buildId).toArray()
    artifactGroups.push({ buildId, rows: [...rows].sort((left, right) => (left.id ?? 0) - (right.id ?? 0)) })
  }
  const briefRows = (await db.productProductionBriefs.where('productionId').equals(input.production.id).toArray())
    .filter((row): row is ProductProductionBriefRecordV1 & { id: number } => row.id != null)
    .sort((left, right) => left.id - right.id)
  const runRows = (await db.agentRuns.where('productBuildId').equals(input.build.id).toArray())
    .filter((row): row is AgentRunRecord & { id: number } => row.id != null)
    .sort((left, right) => left.id - right.id)
  const eventRows: Array<AgentRunEventRecord & { id: number }> = []
  const checkpointRows: Array<AgentRunCheckpointRecord & { id: number }> = []
  for (const run of runRows) {
    const [events, checkpoints] = await Promise.all([
      db.agentRunEvents.where('runId').equals(run.id).toArray(),
      db.agentRunCheckpoints.where('runId').equals(run.id).toArray(),
    ])
    eventRows.push(...events.filter((row): row is AgentRunEventRecord & { id: number } => row.id != null))
    checkpointRows.push(...checkpoints.filter((row): row is AgentRunCheckpointRecord & { id: number } => row.id != null))
  }
  eventRows.sort((left, right) => left.id - right.id)
  checkpointRows.sort((left, right) => left.id - right.id)
  const blobIds = [...new Set(artifactGroups.flatMap(group => group.rows)
    .map(row => row.blobObjectId)
    .filter((id): id is number => id != null))].sort((left, right) => left - right)
  const blobRows: Array<MediaBlobObjectRecordV1 & { id: number }> = []
  for (const blobId of blobIds) {
    const row = await db.mediaBlobObjects.get(blobId)
    if (row?.id != null) blobRows.push(row as MediaBlobObjectRecordV1 & { id: number })
  }
  return {
    targetBuildId: input.build.id,
    targetRootRunId: input.rootRunId,
    productionRow: input.production,
    buildRows,
    briefRows,
    artifactGroups,
    runRows,
    eventRows,
    checkpointRows,
    blobRows,
  }
}

function terminalCasReadSetFingerprintJsonV1(readSet: ProductBuildTerminalCasReadSetV1): string {
  return canonicalProductProductionJsonV2({
    targetBuildId: readSet.targetBuildId,
    targetRootRunId: readSet.targetRootRunId,
    productionRow: readSet.productionRow,
    buildRows: readSet.buildRows,
    briefRows: readSet.briefRows,
    artifactGroups: readSet.artifactGroups,
    runRows: readSet.runRows,
    eventRows: readSet.eventRows,
    checkpointRows: readSet.checkpointRows,
    blobRows: readSet.blobRows.map(blobMetadataForCasV1),
  })
}

/** Must be called from the terminal claim/commit transaction. It performs no
 * WebCrypto, OPFS access or nested verified-run reads; only exact raw-row CAS. */
export async function assertProductBuildTerminalReadSetUnchangedV1(input: {
  readSet: ProductBuildTerminalCasReadSetV1
  mutableTargetBuild?: boolean
  mutableRunIds?: number[]
}): Promise<void> {
  const mutableRuns = new Set(input.mutableRunIds ?? [])
  const expectedProduction = input.readSet.productionRow
  const currentProduction = await db.productProductions.get(expectedProduction.id)
  if (!currentProduction
    || canonicalProductProductionJsonV2(currentProduction)
      !== canonicalProductProductionJsonV2(expectedProduction)) {
    throw new Error('[product-production-artifact] terminal CAS Production 已变化')
  }
  const currentBuildRows = (await db.productBuilds.where('productionId')
    .equals(expectedProduction.id).toArray())
    .filter(row => !(input.mutableTargetBuild && row.id === input.readSet.targetBuildId))
  const expectedBuildRows = input.readSet.buildRows
    .filter(row => !(input.mutableTargetBuild && row.id === input.readSet.targetBuildId))
  if (recordRowsJsonV1(currentBuildRows) !== recordRowsJsonV1(expectedBuildRows)) {
    throw new Error('[product-production-artifact] terminal CAS Build proof set 已变化')
  }
  const currentBriefRows = await db.productProductionBriefs.where('productionId')
    .equals(expectedProduction.id).toArray()
  if (recordRowsJsonV1(currentBriefRows) !== recordRowsJsonV1(input.readSet.briefRows)) {
    throw new Error('[product-production-artifact] terminal CAS Brief proof set 已变化')
  }
  for (const group of input.readSet.artifactGroups) {
    const currentRows = await db.productBuildArtifacts.where('buildId').equals(group.buildId).toArray()
    if (recordRowsJsonV1(currentRows) !== recordRowsJsonV1(group.rows)) {
      throw new Error(`[product-production-artifact] terminal CAS Artifact proof set 已变化:${group.buildId}`)
    }
  }
  const currentRunRows = (await db.agentRuns.where('productBuildId')
    .equals(input.readSet.targetBuildId).toArray()).filter(row => !mutableRuns.has(row.id!))
  const expectedRunRows = input.readSet.runRows.filter(row => !mutableRuns.has(row.id))
  if (recordRowsJsonV1(currentRunRows) !== recordRowsJsonV1(expectedRunRows)) {
    throw new Error('[product-production-artifact] terminal CAS Run proof set 已变化')
  }
  for (const run of input.readSet.runRows) {
    if (mutableRuns.has(run.id)) continue
    const [currentEvents, currentCheckpoints] = await Promise.all([
      db.agentRunEvents.where('runId').equals(run.id).toArray(),
      db.agentRunCheckpoints.where('runId').equals(run.id).toArray(),
    ])
    const expectedEvents = input.readSet.eventRows.filter(row => row.runId === run.id)
    const expectedCheckpoints = input.readSet.checkpointRows.filter(row => row.runId === run.id)
    if (recordRowsJsonV1(currentEvents) !== recordRowsJsonV1(expectedEvents)
      || recordRowsJsonV1(currentCheckpoints) !== recordRowsJsonV1(expectedCheckpoints)) {
      throw new Error(`[product-production-artifact] terminal CAS Run events/checkpoints 已变化:${run.id}`)
    }
  }
  for (const expectedBlob of input.readSet.blobRows) {
    const currentBlob = await db.mediaBlobObjects.get(expectedBlob.id)
    if (!currentBlob || currentBlob.id == null
      || !sameExactBlobRowV1(expectedBlob, currentBlob as MediaBlobObjectRecordV1 & { id: number })) {
      throw new Error(`[product-production-artifact] terminal CAS Blob proof 已变化:${expectedBlob.id}`)
    }
  }
}

export interface VerifiedProductBuildTerminalArtifactSetV1 {
  artifacts: ProductBuildArtifactRecordV1[]
  /** Exact active rows consumed by the terminal verifier. The scheduler must
   * compare this at both claim and commit before publishing the v2 seal. */
  artifactReadSetJson: string
  verificationReadSetJson: string
  casReadSet: ProductBuildTerminalCasReadSetV1
  /** Physical-byte closure read while proving this terminal state. It covers
   * current active Artifacts plus every active Artifact in a sealed parent
   * Build used by cross-Build carry. Publication must refresh this whole map
   * immediately before its write transaction; runtime presentation assets are
   * only one consumer-facing subset. */
  physicalBlobProofRows: Map<number, MediaBlobObjectRecordV1 & { id: number }>
}

/**
 * Re-verifies the complete active Artifact closure immediately before the root
 * terminal seal is created. Acceptance-time proof is necessary but not
 * sufficient: IndexedDB rows remain mutable storage and therefore every active
 * sibling must still match its Plan owner, producer/synthetic receipt, ledger,
 * payload bytes and carry lineage at terminal join.
 */
export async function verifyProductBuildTerminalArtifactSetV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  expectedControlEpoch: number
  expectedPlanHash: string
}): Promise<VerifiedProductBuildTerminalArtifactSetV1> {
  const scope = await resolveScope({ scope: input.scope })
  const [productionRow, buildRow] = await Promise.all([
    db.productProductions.get(input.productionId),
    db.productBuilds.get(input.buildId),
  ])
  if (!productionRow || productionRow.id == null || !buildRow || buildRow.id == null
    || !await assertRecordInScope(scope, 'productProductions', productionRow, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productBuilds', buildRow, { owner: 'work' })
    || buildRow.productionId !== productionRow.id
    || buildRow.controlEpoch !== input.expectedControlEpoch
    || buildRow.planHash !== input.expectedPlanHash
    || !['building', 'validating', 'preview-ready', 'release-ready', 'released'].includes(buildRow.status)) {
    throw new Error('[product-production-artifact] terminal Build/Production authority 已过期')
  }
  const production = productionRow as ProductProductionRecordV1 & { id: number }
  const build = buildRow as ProductBuildRecordV1 & { id: number }
  const plan = parseProductProductionPlanV3(build.planJson, undefined, build.briefHash)
  if (canonicalProductProductionJsonV2(plan) !== build.planJson
    || await hashProductProductionValueV2(plan) !== build.planHash
    || plan.productType !== production.productType
    || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch) {
    throw new Error('[product-production-artifact] terminal Plan/Build 不闭合')
  }
  const allBuildRows = await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
  const artifacts = allBuildRows
    .filter(row => row.controlEpoch === build.controlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'))
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
  const expectedKeys = plan.tasks.flatMap(task => task.outputArtifactKeys).sort()
  const actualKeys = artifacts.map(row => row.artifactKey).sort()
  if (expectedKeys.length !== actualKeys.length
    || expectedKeys.some((key, index) => key !== actualKeys[index])) {
    throw new Error('[product-production-artifact] terminal active Artifact 未精确覆盖 Plan outputs')
  }
  if (artifacts.some(row => row.id == null || row.buildId !== build.id
    || row.projectId !== scope.projectId || row.worldId !== scope.worldId || row.workId !== scope.workId
    || row.controlEpoch !== build.controlEpoch || !Number.isSafeInteger(row.version) || row.version < 1)) {
    throw new Error('[product-production-artifact] terminal Artifact scope/build/epoch 包络无效')
  }
  const preparedByKey = new Map<string, PreparedArtifactAcceptanceV1>()
  for (const artifact of artifacts) {
    preparedByKey.set(artifact.artifactKey, await preparedStoredArtifactV1(artifact))
  }
  const portableLedger = parseProductProductionPortableTaskLedgerV1({
    budgetLedgerJson: build.budgetLedgerJson,
    plan,
  })
  const ledgerByTask = new Map(portableLedger.map(row => [row.taskKey, row]))
  const rootRunId = ledgerRootRunIdV1(build.budgetLedgerJson)
  const casReadSet = await collectTerminalCasReadSetV1({
    production,
    build,
    allBuildRows,
    rootRunId,
  })
  const rootSnapshot = await readAgentRunV1(scope, rootRunId)
  const rootBoundary = rootSnapshot.contract.scope.productProduction
  if (rootSnapshot.run.productBuildId !== build.id
    || rootSnapshot.run.projectId !== scope.projectId || rootSnapshot.run.workId !== scope.workId
    || rootSnapshot.run.parentRunId != null || rootSnapshot.run.parentRelation != null
    || !rootBoundary || rootBoundary.productBuildId !== build.id
    || rootBoundary.buildNumber !== build.buildNumber
    || rootBoundary.controlEpoch !== build.controlEpoch
    || rootBoundary.planHash !== build.planHash || rootBoundary.taskKey !== '$root'
    || casReadSet.runRows.filter(row => row.id === rootRunId).length !== 1
    || casReadSet.checkpointRows.some(row => row.runId === rootRunId)) {
    throw new Error('[product-production-artifact] terminal root Run 边界或 checkpoint 不合法')
  }
  const physicalBlobProofRows = await verifiedBlobProofsV1({ scope, artifacts, label: 'terminal' })
  const proofMembers: unknown[] = []
  for (const task of plan.tasks) {
    const siblings = task.outputArtifactKeys.map(key => artifacts.find(row => row.artifactKey === key)!)
    const statuses = new Set(siblings.map(row => row.status))
    const ledger = ledgerByTask.get(task.taskKey)!
    const rawLedger = terminalRawLedgerTaskV1(build.budgetLedgerJson, task.taskKey)
    const ledgerRunId = terminalLedgerRunIdV1(build.budgetLedgerJson, task.taskKey)
    if (statuses.size !== 1
      || task.acceptanceGateIds.some(gate => !ledger.passedGateIds.includes(gate))) {
      throw new Error(`[product-production-artifact] terminal task siblings/ledger 不闭合:${task.taskKey}`)
    }
    if (siblings[0].status === 'accepted') {
      const producerRunIds = new Set(siblings.map(row => row.producerRunId))
      const receiptHashes = new Set(siblings.map(row => row.producerReceiptHash))
      const inputHashes = new Set(siblings.map(row => row.inputHash))
      const producerRunId = siblings[0].producerRunId
      const receiptHash = siblings[0].producerReceiptHash
      const inputHash = siblings[0].inputHash
      if (producerRunIds.size !== 1 || receiptHashes.size !== 1 || inputHashes.size !== 1
        || siblings.some(row => row.carriedFrom !== null || row.parentArtifactHash !== null)
        || producerRunId == null || receiptHash == null
        || producerRunId !== ledgerRunId || receiptHash !== ledger.terminalReceiptHash
        || inputHash !== ledger.idempotencyKey) {
        throw new Error(`[product-production-artifact] terminal accepted sibling producer/ledger 不闭合:${task.taskKey}`)
      }
      const matchingChildren = await db.agentRuns.where('[parentRunId+parentRelation]')
        .equals([rootRunId, `task:${task.taskKey}`]).toArray()
      if (matchingChildren.length !== 1 || matchingChildren[0].id !== producerRunId) {
        throw new Error(`[product-production-artifact] terminal accepted task producer 不唯一:${task.taskKey}`)
      }
      const proof = await verifiedProducerCandidateV1({
        scope,
        build,
        producerRunId,
        producerReceiptHash: receiptHash,
        inputHash,
        fresh: true,
      })
      const mismatchedArtifacts = siblings.filter(row => {
          const expected = proof.artifacts.get(row.artifactKey)
          return !expected || !samePreparedProducerArtifactV1({
            expected,
            actual: preparedByKey.get(row.artifactKey),
            importedScopeRebound: proof.importedScopeRebound,
          })
        })
      const mismatchCodes = [
        proof.task.taskKey !== task.taskKey ? 'task' : null,
        proof.attempt !== ledger.attempt ? 'attempt' : null,
        proof.candidateHash !== ledger.candidateHash ? 'candidate' : null,
        proof.receiptHash !== ledger.terminalReceiptHash ? 'receipt' : null,
        canonicalProductProductionJsonV2(proof.passedGateIds)
          !== canonicalProductProductionJsonV2(rawLedger.passedGateIds) ? 'gates' : null,
        canonicalProductProductionJsonV2(proof.usage)
          !== canonicalProductProductionJsonV2(ledger.usage) ? 'usage' : null,
        mismatchedArtifacts.length > 0 ? `artifacts(${mismatchedArtifacts.map(row => row.artifactKey).join(',')})` : null,
      ].filter((code): code is string => code != null)
      if (mismatchCodes.length > 0) {
        throw new Error(`[product-production-artifact] terminal accepted candidate/receipt/ledger 不闭合:${task.taskKey}:${mismatchCodes.join('|')}`)
      }
      proofMembers.push({
        taskKey: task.taskKey,
        status: 'accepted',
        producerRunId,
        inputHash,
        candidateHash: proof.candidateHash,
        receiptHash,
      })
      continue
    }

    const producerRunIds = new Set(siblings.map(row => row.producerRunId))
    const receiptHashes = new Set(siblings.map(row => row.producerReceiptHash))
    const inputHashes = new Set(siblings.map(row => row.inputHash))
    const producerRunId = siblings[0].producerRunId
    const receiptHash = siblings[0].producerReceiptHash
    const inputHash = siblings[0].inputHash
    const lineageBuildNumbers = new Set(siblings.map(row => row.carriedFrom?.buildNumber))
    if (producerRunIds.size !== 1 || receiptHashes.size !== 1 || inputHashes.size !== 1
      || producerRunId == null || receiptHash == null || producerRunId !== ledgerRunId
      || receiptHash !== ledger.terminalReceiptHash || inputHash !== ledger.idempotencyKey
      || rawLedger.attempt !== 1
      || canonicalProductProductionJsonV2(rawLedger.passedGateIds)
        !== canonicalProductProductionJsonV2(task.acceptanceGateIds)
      || !isZeroPortableUsageV1(ledger.usage) || lineageBuildNumbers.size !== 1
      || lineageBuildNumbers.has(undefined)
      || (lineageBuildNumbers.has(build.buildNumber)
        ? task.executionMode === 'deterministic' || task.reuse !== null
        : task.reuse == null || task.reuse.requiresRevalidation !== true)) {
      throw new Error(`[product-production-artifact] terminal carried sibling producer/ledger 不闭合:${task.taskKey}`)
    }
    const dependencies = task.dependsOn.map(taskKey => ({
      taskKey,
      receiptHash: ledgerByTask.get(taskKey)!.terminalReceiptHash,
    }))
    const candidateHash = await hashProductProductionCarriedCandidateV1(siblings)
    const expectedReceiptHash = await hashProductProductionCarriedReceiptV1({
      taskKey: task.taskKey,
      inputHash,
      candidateHash,
      dependencies,
      passedGateIds: task.acceptanceGateIds,
      controlEpoch: build.controlEpoch,
    })
    const snapshot = await readAgentRunV1(scope, producerRunId)
    const boundary = snapshot.contract.scope.productProduction
    const matchingChildren = await db.agentRuns.where('[parentRunId+parentRelation]')
      .equals([rootRunId, `task:${task.taskKey}`]).toArray()
    const terminalStep = snapshot.projection.steps[task.taskKey]
    const carriedCheckpoint = await latestCheckpointForFingerprintV1(producerRunId)
    if (candidateHash !== ledger.candidateHash || expectedReceiptHash !== receiptHash
      || matchingChildren.length !== 1 || matchingChildren[0].id !== producerRunId
      || snapshot.run.parentRunId !== rootRunId || snapshot.run.parentRelation !== `task:${task.taskKey}`
      || snapshot.run.productBuildId !== build.id || snapshot.run.status !== 'completed'
      || snapshot.projection.state !== 'completed' || snapshot.projection.terminalReceiptHash !== receiptHash
      || snapshot.run.terminalReceiptHash !== receiptHash
      || terminalStep?.status !== 'succeeded' || terminalStep.attempt !== 1
      || terminalStep.candidateHash != null || terminalStep.outputHash !== candidateHash
      || carriedCheckpoint !== null
      || !boundary || boundary.productBuildId !== build.id || boundary.buildNumber !== build.buildNumber
      || boundary.controlEpoch !== build.controlEpoch || boundary.planHash !== build.planHash
      || boundary.taskKey !== task.taskKey) {
      throw new Error(`[product-production-artifact] terminal carried synthetic receipt 不闭合:${task.taskKey}`)
    }
    proofMembers.push({
      taskKey: task.taskKey,
      status: 'carried-forward',
      producerRunId,
      inputHash,
      candidateHash,
      receiptHash,
      lineage: siblings.map(row => row.carriedFrom),
    })
  }

  const carried = artifacts.filter(row => row.status === 'carried-forward')
  const crossBuildNumbers = [...new Set(carried.map(row => row.carriedFrom?.buildNumber)
    .filter((value): value is number => value != null && value !== build.buildNumber))]
  for (const sourceBuildNumber of crossBuildNumbers) {
    const sourceBuildRow = await db.productBuilds.where('[productionId+buildNumber]')
      .equals([build.productionId, sourceBuildNumber]).first()
    if (!sourceBuildRow || sourceBuildRow.id == null
      || !await assertRecordInScope(scope, 'productBuilds', sourceBuildRow, { owner: 'work' })) {
      throw new Error('[product-production-artifact] terminal carried source Build 缺失')
    }
    const sourceBuild = sourceBuildRow as ProductBuildRecordV1 & { id: number }
    const sourceRows = await db.productBuildArtifacts.where('buildId').equals(sourceBuild.id).toArray()
    const activeSourceRows = sourceRows.filter(row => row.controlEpoch === sourceBuild.controlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'))
    const targetRows = carried.filter(row => row.carriedFrom?.buildNumber === sourceBuildNumber)
    const sources = targetRows.map(target => sourceRows.find(source => (
      source.artifactKey === target.carriedFrom?.artifactKey
        && source.version === target.carriedFrom.version
        && source.contentHash === target.carriedFrom.contentHash
        && source.controlEpoch === sourceBuild.controlEpoch
        && (source.status === 'accepted' || source.status === 'carried-forward')
    ))).filter((row): row is ProductBuildArtifactRecordV1 => row != null)
    if (sources.length !== targetRows.length) {
      throw new Error('[product-production-artifact] terminal carried source Artifact 缺失')
    }
    await crossBuildCarryAuthorizationV1({
      scope,
      production,
      sourceBuild,
      targetBuild: build,
      sources,
      artifactKeys: targetRows.map(row => row.artifactKey),
    })
    const context = await sealedBuildProofContextV1({
      scope,
      production,
      build: sourceBuild,
      activeRows: activeSourceRows,
    })
    mergeBlobProofRowsV1({
      target: physicalBlobProofRows,
      source: context.blobProofs,
      label: `terminal parent Build #${sourceBuildNumber}`,
    })
    for (let index = 0; index < targetRows.length; index += 1) {
      const target = targetRows[index]
      const source = sources[index]
      const expectedProofHash = await sealedParentProofHashV1({
        context,
        source,
        blobContentHash: source.blobObjectId == null
          ? null : context.blobProofs.get(source.blobObjectId)?.contentHash ?? null,
      })
      if (!sameCarriedArtifactEnvelopeV1(target, source)
        || target.carriedFrom?.proofHash !== expectedProofHash) {
        throw new Error(`[product-production-artifact] terminal cross-build lineage 不闭合:${target.artifactKey}`)
      }
    }
  }
  for (const target of carried.filter(row => row.carriedFrom?.buildNumber === build.buildNumber)) {
    await verifySameBuildCarriedLineageV1({
      scope,
      build,
      plan,
      target,
      allBuildRows,
    })
  }
  if (carried.some(row => !row.carriedFrom || !isSha256Hash(row.carriedFrom.proofHash)
    || row.carriedFrom.artifactKey !== row.artifactKey
    || row.carriedFrom.contentHash !== row.contentHash
    || row.parentArtifactHash !== row.contentHash)) {
    throw new Error('[product-production-artifact] terminal carried lineage 包络无效')
  }
  const artifactReadSetJson = canonicalProductProductionJsonV2(
    artifacts.map(row => ({ ...row, id: row.id ?? null })),
  )
  return {
    artifacts,
    artifactReadSetJson,
    verificationReadSetJson: canonicalProductProductionJsonV2({
      buildId: build.id,
      controlEpoch: build.controlEpoch,
      planHash: build.planHash,
      budgetLedgerJson: build.budgetLedgerJson,
      artifacts: JSON.parse(artifactReadSetJson),
      proofMembers,
      physicalBlobProofIds: [...physicalBlobProofRows.keys()].sort((left, right) => left - right),
      casReadSet: JSON.parse(terminalCasReadSetFingerprintJsonV1(casReadSet)),
    }),
    casReadSet,
    physicalBlobProofRows,
  }
}

/**
 * The only deterministic/candidate-to-Build adoption boundary. It verifies the
 * Build epoch and stores an immutable accepted version; formal tables remain
 * untouched until package adoption.
 */
export async function acceptProductBuildArtifact(
  input: ProductBuildArtifactAcceptanceInputV1,
): Promise<ProductBuildArtifactRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  if (!isSha256Hash(input.inputHash)) throw new Error('[product-production-artifact] inputHash 无效')
  if (input.producerReceiptHash != null && !isSha256Hash(input.producerReceiptHash)) {
    throw new Error('[product-production-artifact] producerReceiptHash 无效')
  }
  if ((input.producerRunId == null) !== (input.producerReceiptHash == null)) {
    throw new Error('[product-production-artifact] producer Run/receipt 必须同时存在或同时为空')
  }
  const prepared = await finalizePreparedContentHashV1(prepareArtifactAcceptanceV1(input))
  await assertPreparedContentHashV1(prepared)
  const preliminaryBuild = await db.productBuilds.get(input.buildId)
  if (!preliminaryBuild || preliminaryBuild.id == null
    || !await assertRecordInScope(scope, 'productBuilds', preliminaryBuild, { owner: 'work' })) {
    throw new Error('[product-production-artifact] Build 不存在或跨 Work')
  }
  if (preliminaryBuild.controlEpoch !== input.controlEpoch
    || !['authorized', 'building'].includes(preliminaryBuild.status)) {
    throw new Error('[product-production-artifact] Build epoch 已过期或不可写')
  }
  if (['text-open-world.source-pin', 'text-open-world.source-pin-unit'].includes(prepared.kind)) {
    throw new Error('[product-production-artifact] SourcePin 必须通过整包原子验收入口写入')
  }
  let producerProof: VerifiedProducerCandidateV1 | null = null
  if (input.producerRunId != null && input.producerReceiptHash != null) {
    producerProof = await verifiedProducerCandidateV1({
      scope,
      build: preliminaryBuild as ProductBuildRecordV1 & { id: number },
      producerRunId: input.producerRunId,
      producerReceiptHash: input.producerReceiptHash,
      inputHash: input.inputHash,
    })
    const expected = producerProof.artifacts.get(prepared.artifactKey)
    if (!expected || canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(prepared)) {
      throw new Error('[product-production-artifact] Artifact 与 producer checkpoint candidate 不一致')
    }
  } else {
    throw new Error('[product-production-artifact] 普通 Artifact 必须携带已验证 producer checkpoint')
  }
  const stored = await db.transaction('rw', scopeTransactionTables(
    db.productProductions, db.productProductionBriefs, db.productProductionCommands,
    db.productBuilds, db.productBuildArtifacts, db.mediaBlobObjects,
    db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints,
  ), async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) {
      throw new Error('[product-production-artifact] Build 不存在或跨 Work')
    }
    if (build.controlEpoch !== input.controlEpoch
      || !['authorized', 'building'].includes(build.status)) {
      throw new Error('[product-production-artifact] Build epoch 已过期或不可写')
    }
    if (build.buildNumber !== preliminaryBuild.buildNumber
      || build.briefHash !== preliminaryBuild.briefHash
      || build.planHash !== preliminaryBuild.planHash
      || build.planJson !== preliminaryBuild.planJson) {
      throw new Error('[product-production-artifact] Build/Plan 在验收期间发生变化')
    }
    if (producerProof) {
      const currentRootRunId = ledgerRootRunIdV1(build.budgetLedgerJson)
      const run = await db.agentRuns.get(producerProof.fingerprint.runId)
      const rootRun = await db.agentRuns.get(producerProof.rootFingerprint.runId)
      const checkpoint = await latestCheckpointForFingerprintV1(producerProof.fingerprint.runId)
      const producerEventStreamHash = await eventStreamHashV1(producerProof.fingerprint.runId)
      const rootEventStreamHash = await eventStreamHashV1(producerProof.rootFingerprint.runId)
      if (!run || run.id == null || !rootRun || rootRun.id == null || !checkpoint
        || currentRootRunId !== producerProof.rootFingerprint.runId
        || !sameBuildFingerprintV1(
          producerProof.buildFingerprint,
          await producerBuildFingerprintV1(build as ProductBuildRecordV1 & { id: number }),
        )
        || !sameProducerFingerprintV1(
          producerProof.fingerprint,
          await checkpointFingerprintV1({
            run: run as AgentRunRecord & { id: number }, checkpoint, eventStreamHash: producerEventStreamHash,
          }),
        )
        || !sameRootFingerprintV1(
          producerProof.rootFingerprint,
          await rootFingerprintV1({
            run: rootRun as AgentRunRecord & { id: number }, eventStreamHash: rootEventStreamHash,
          }),
        )) {
        producerProofCache.delete(producerProof.cacheKey)
        throw new Error('[product-production-artifact] producer proof 在验收期间已变化')
      }
    }
    if (prepared.blobObjectId != null) {
      const blob = await db.mediaBlobObjects.get(prepared.blobObjectId)
      if (!blob || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' })
        || blob.storageState !== 'ready' || blob.contentHash !== prepared.contentHash
        || blob.byteSize !== prepared.byteSize || blob.mimeType !== prepared.mimeType) {
        throw new Error('[product-production-artifact] 媒资对象与 Artifact 不一致')
      }
    }
    const rows = await db.productBuildArtifacts
      .where('[buildId+artifactKey+version]')
      .between(
        [build.id!, prepared.artifactKey, Dexie.minKey],
        [build.id!, prepared.artifactKey, Dexie.maxKey],
      )
      .toArray()
    const same = rows.find(row => row.artifactKey === prepared.artifactKey && row.contentHash === prepared.contentHash
      && row.status === 'accepted' && row.controlEpoch === input.controlEpoch)
    if (same) {
      if (same.requirementKey !== prepared.requirementKey
        || same.kind !== prepared.kind || same.mediaKind !== prepared.mediaKind
        || same.producerRunId !== (input.producerRunId ?? null)
        || same.producerReceiptHash !== (input.producerReceiptHash ?? null)
        || same.inputHash !== input.inputHash || same.payloadJson !== prepared.payloadJson
        || same.metadataJson !== prepared.metadataJson || same.qualityJson !== prepared.qualityJson
        || same.rightsJson !== prepared.rightsJson || same.blobObjectId !== prepared.blobObjectId
        || same.mimeType !== prepared.mimeType || same.byteSize !== prepared.byteSize
        || same.parentArtifactHash !== null || same.carriedFrom !== null) {
        throw new Error('[product-production-artifact] 幂等 Artifact 的治理字段发生冲突')
      }
      return same
    }
    const priorAcceptedIds = rows
      .filter(row => row.artifactKey === prepared.artifactKey
        && (row.status === 'accepted' || row.status === 'carried-forward') && row.id != null)
      .map(row => row.id!)
    const version = Math.max(
      0,
      ...rows.filter(row => row.artifactKey === prepared.artifactKey).map(row => row.version),
    ) + 1
    const now = Date.now()
    const artifact = stampNewRecord(scope, 'productBuildArtifacts', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      buildId: build.id!, artifactKey: prepared.artifactKey, requirementKey: prepared.requirementKey,
      version, kind: prepared.kind, mediaKind: prepared.mediaKind, status: 'accepted' as const,
      producerRunId: input.producerRunId ?? null, producerReceiptHash: input.producerReceiptHash ?? null,
      controlEpoch: input.controlEpoch, inputHash: input.inputHash, contentHash: prepared.contentHash,
      payloadJson: prepared.payloadJson, metadataJson: prepared.metadataJson,
      qualityJson: prepared.qualityJson, rightsJson: prepared.rightsJson,
      blobObjectId: prepared.blobObjectId, mimeType: prepared.mimeType, byteSize: prepared.byteSize,
      parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now,
    } satisfies ProductBuildArtifactRecordV1, { owner: 'work' })
    const id = await db.productBuildArtifacts.add(artifact) as number
    if (priorAcceptedIds.length > 0) {
      await db.productBuildArtifacts.where('id').anyOf(priorAcceptedIds).modify({ status: 'invalid', updatedAt: now })
    }
    return { ...artifact, id }
  })
  if (producerProof) {
    producerProof.remainingArtifactKeys.delete(prepared.artifactKey)
    if (producerProof.remainingArtifactKeys.size === 0) producerProofCache.delete(producerProof.cacheKey)
  }
  return stored
}

function sourcePinPreparedMatchesStoredV1(
  row: ProductBuildArtifactRecordV1,
  prepared: PreparedArtifactAcceptanceV1,
  inputHash: string,
  controlEpoch: number,
  producerRunId: number | null,
  producerReceiptHash: string | null,
): boolean {
  return row.artifactKey === prepared.artifactKey
    && row.requirementKey === prepared.requirementKey
    && row.kind === prepared.kind && row.mediaKind === prepared.mediaKind
    && row.status === 'accepted' && row.producerRunId === producerRunId
    && row.producerReceiptHash === producerReceiptHash
    && row.controlEpoch === controlEpoch && row.inputHash === inputHash
    && row.contentHash === prepared.contentHash && row.payloadJson === prepared.payloadJson
    && row.metadataJson === prepared.metadataJson && row.qualityJson === prepared.qualityJson
    && row.rightsJson === prepared.rightsJson && row.blobObjectId === prepared.blobObjectId
    && row.mimeType === prepared.mimeType && row.byteSize === prepared.byteSize
    && row.parentArtifactHash == null && row.carriedFrom == null
}

/**
 * The sole direct P0 source persistence boundary. The complete author-bound
 * bundle is verified once, then every unit and the closure marker are written
 * in one transaction. Generic single-Artifact acceptance deliberately rejects
 * these kinds so a failure can never leave a newly-created partial SourcePin.
 */
export async function acceptTextOpenWorldSourcePinBundleArtifactsV1(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
  bundle: TextOpenWorldSourcePinBundleV1
  producer?: {
    runId: number
    receiptHash: string
    inputHash: string
  }
}): Promise<{ pinArtifact: ProductBuildArtifactRecordV1; unitArtifacts: ProductBuildArtifactRecordV1[] }> {
  const scope = await resolveScope({ scope: input.scope })
  const sourcePin = await import('../open-world/source-pin')
  const bundle = await sourcePin.validateTextOpenWorldSourcePinBundleV1(input.bundle)
  const acceptanceInputs: ProductBuildArtifactAcceptanceInputV1[] =
    sourcePin.createTextOpenWorldSourcePinCandidateArtifactsV1(bundle).map(artifact => ({
      ...artifact,
      scope,
      buildId: input.buildId,
      controlEpoch: input.controlEpoch,
      inputHash: input.producer?.inputHash ?? bundle.pin.authorization.authorizationHash,
    }))
  const preparedRows: PreparedArtifactAcceptanceV1[] = []
  for (const acceptance of acceptanceInputs) {
    const prepared = await finalizePreparedContentHashV1(prepareArtifactAcceptanceV1(acceptance))
    await assertPreparedContentHashV1(prepared)
    preparedRows.push(prepared)
  }
  const preliminaryBuild = await db.productBuilds.get(input.buildId)
  if (!preliminaryBuild || preliminaryBuild.id == null
    || !await assertRecordInScope(scope, 'productBuilds', preliminaryBuild, { owner: 'work' })
    || preliminaryBuild.controlEpoch !== input.controlEpoch
    || !['authorized', 'building'].includes(preliminaryBuild.status)) {
    throw new Error('[product-production-artifact] SourcePin Build 不存在、过期或不可写')
  }
  if (input.producer && (!Number.isSafeInteger(input.producer.runId)
    || input.producer.runId < 1 || !isSha256Hash(input.producer.receiptHash)
    || !isSha256Hash(input.producer.inputHash))) {
    throw new Error('[product-production-artifact] SourcePin producer proof 输入无效')
  }
  const producerProof = input.producer
    ? await verifiedProducerCandidateV1({
        scope,
        build: preliminaryBuild as ProductBuildRecordV1 & { id: number },
        producerRunId: input.producer.runId,
        producerReceiptHash: input.producer.receiptHash,
        inputHash: input.producer.inputHash,
      })
    : null
  if (producerProof) {
    for (const prepared of preparedRows) {
      const expected = producerProof.artifacts.get(prepared.artifactKey)
      if (!expected || canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(prepared)) {
        producerProofCache.delete(producerProof.cacheKey)
        throw new Error('[product-production-artifact] SourcePin 整包与 producer checkpoint candidate 不一致')
      }
    }
  }
  const directProof = await assertDirectTextOpenWorldSourceArtifactV1({
    scope,
    build: preliminaryBuild as ProductBuildRecordV1 & { id: number },
    prepared: preparedRows[0],
    bundle,
    bundleAlreadyValidated: true,
  })
  const stored = await db.transaction('rw', scopeTransactionTables(
    db.productProductions, db.productProductionBriefs, db.productProductionCommands,
    db.productBuilds, db.productBuildArtifacts,
    db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints,
  ), async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
      || build.controlEpoch !== input.controlEpoch
      || !['authorized', 'building'].includes(build.status)
      || build.buildNumber !== preliminaryBuild.buildNumber
      || build.briefRevision !== preliminaryBuild.briefRevision
      || build.briefHash !== preliminaryBuild.briefHash
      || build.planHash !== preliminaryBuild.planHash
      || build.planJson !== preliminaryBuild.planJson) {
      throw new Error('[product-production-artifact] SourcePin Build/Plan 在整包验收期间变化')
    }
    if (producerProof) {
      const currentRootRunId = ledgerRootRunIdV1(build.budgetLedgerJson)
      const run = await db.agentRuns.get(producerProof.fingerprint.runId)
      const rootRun = await db.agentRuns.get(producerProof.rootFingerprint.runId)
      const checkpoint = await latestCheckpointForFingerprintV1(producerProof.fingerprint.runId)
      const producerEventStreamHash = await eventStreamHashV1(producerProof.fingerprint.runId)
      const rootEventStreamHash = await eventStreamHashV1(producerProof.rootFingerprint.runId)
      if (!run || run.id == null || !rootRun || rootRun.id == null || !checkpoint
        || currentRootRunId !== producerProof.rootFingerprint.runId
        || !sameBuildFingerprintV1(
          producerProof.buildFingerprint,
          await producerBuildFingerprintV1(build as ProductBuildRecordV1 & { id: number }),
        )
        || !sameProducerFingerprintV1(
          producerProof.fingerprint,
          await checkpointFingerprintV1({
            run: run as AgentRunRecord & { id: number }, checkpoint, eventStreamHash: producerEventStreamHash,
          }),
        )
        || !sameRootFingerprintV1(
          producerProof.rootFingerprint,
          await rootFingerprintV1({
            run: rootRun as AgentRunRecord & { id: number }, eventStreamHash: rootEventStreamHash,
          }),
        )) {
        producerProofCache.delete(producerProof.cacheKey)
        throw new Error('[product-production-artifact] SourcePin producer proof 在整包验收期间已变化')
      }
    }
    const [production, brief, commandRows, allRows] = await Promise.all([
      db.productProductions.get(build.productionId),
      db.productProductionBriefs.where('[productionId+revision]')
        .equals([build.productionId, build.briefRevision]).first(),
      db.productProductionCommands.where('[productionId+status]')
        .equals([build.productionId, 'succeeded'])
        .filter(row => row.type === 'authorize-text-open-world-creator-start').toArray(),
      db.productBuildArtifacts.where('buildId').equals(build.id!).toArray(),
    ])
    const activePinRows = allRows.filter(row => row.controlEpoch === build.controlEpoch
      && row.status === 'accepted' && row.kind === 'text-open-world.source-pin')
    const matchingStartCommands = commandRows.filter(command => {
      try {
        const result = JSON.parse(command.resultJson) as Record<string, unknown>
        return result.buildNumber === directProof.startCommandMatch.buildNumber
          && result.briefRevision === directProof.startCommandMatch.briefRevision
          && result.briefHash === directProof.startCommandMatch.briefHash
          && result.sourcePlanHash === directProof.startCommandMatch.sourcePlanHash
          && result.startHash === directProof.startCommandMatch.startHash
          && command.expectedStateRevision === directProof.startCommandMatch.expectedStateRevision
      } catch {
        return false
      }
    }).sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
    const matchingStartCommandsInScope = await Promise.all(matchingStartCommands.map(row => (
      assertRecordInScope(scope, 'productProductionCommands', row, { owner: 'work' })
    )))
    if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
      || production.productType !== 'text-open-world'
      || build.productionId !== directProof.productionId
      || production.productionKey !== directProof.productionKey
      || !brief || canonicalProductProductionJsonV2(brief) !== directProof.briefRowJson
      || matchingStartCommands.length !== 1
      || matchingStartCommandsInScope.some(inScope => !inScope)
      || canonicalProductProductionJsonV2(matchingStartCommands)
        !== directProof.matchingStartCommandsJson
      || canonicalProductProductionJsonV2(activePinRows) !== directProof.activePinRowsJson) {
      throw new Error('[product-production-artifact] SourcePin Production 在整包验收期间变化')
    }
    const activeSourceRows = allRows.filter(row => row.controlEpoch === build.controlEpoch
      && row.status === 'accepted'
      && ['text-open-world.source-pin', 'text-open-world.source-pin-unit'].includes(row.kind))
    if (activePinRows.length > 0) {
      const preparedByKey = new Map(preparedRows.map(row => [row.artifactKey, row]))
      if (activeSourceRows.length !== preparedRows.length
        || activeSourceRows.some(row => {
          const prepared = preparedByKey.get(row.artifactKey)
          return !prepared || !sourcePinPreparedMatchesStoredV1(
            row, prepared, input.producer?.inputHash ?? bundle.pin.authorization.authorizationHash,
            input.controlEpoch, input.producer?.runId ?? null, input.producer?.receiptHash ?? null,
          )
        })) {
        throw new Error('[product-production-artifact] 已冻结 SourcePin 与重放整包不一致')
      }
      const pinArtifact = activeSourceRows.find(row => row.kind === 'text-open-world.source-pin')!
      return {
        pinArtifact,
        unitArtifacts: activeSourceRows.filter(row => row.kind === 'text-open-world.source-pin-unit')
          .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)),
      }
    }
    if (activeSourceRows.length > 0) {
      throw new Error('[product-production-artifact] Build 存在无 closure marker 的历史半包 SourcePin')
    }
    const now = Date.now()
    const inserted: ProductBuildArtifactRecordV1[] = []
    for (const prepared of preparedRows) {
      const priorRows = allRows.filter(row => row.artifactKey === prepared.artifactKey)
      const version = Math.max(0, ...priorRows.map(row => row.version)) + 1
      const artifact = stampNewRecord(scope, 'productBuildArtifacts', {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        buildId: build.id!, artifactKey: prepared.artifactKey,
        requirementKey: prepared.requirementKey, version, kind: prepared.kind,
        mediaKind: prepared.mediaKind, status: 'accepted' as const,
        producerRunId: input.producer?.runId ?? null,
        producerReceiptHash: input.producer?.receiptHash ?? null,
        controlEpoch: input.controlEpoch,
        inputHash: input.producer?.inputHash ?? bundle.pin.authorization.authorizationHash,
        contentHash: prepared.contentHash, payloadJson: prepared.payloadJson,
        metadataJson: prepared.metadataJson, qualityJson: prepared.qualityJson,
        rightsJson: prepared.rightsJson, blobObjectId: null, mimeType: null,
        byteSize: prepared.byteSize, parentArtifactHash: null, carriedFrom: null,
        createdAt: now, updatedAt: now,
      } satisfies ProductBuildArtifactRecordV1, { owner: 'work' })
      const id = await db.productBuildArtifacts.add(artifact) as number
      inserted.push({ ...artifact, id })
    }
    return {
      pinArtifact: inserted.find(row => row.kind === 'text-open-world.source-pin')!,
      unitArtifacts: inserted.filter(row => row.kind === 'text-open-world.source-pin-unit'),
    }
  })
  if (producerProof) {
    for (const prepared of preparedRows) producerProof.remainingArtifactKeys.delete(prepared.artifactKey)
    producerProofCache.delete(producerProof.cacheKey)
  }
  return stored
}

export async function readAcceptedBuildArtifacts(input: {
  scope: WorkspaceScope
  buildId: number
}): Promise<ProductBuildArtifactRecordV1[]> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.buildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) {
    throw new Error('[product-production-artifact] Build 不存在或跨 Work')
  }
  const rows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  return rows.filter(row => row.status === 'accepted' || row.status === 'carried-forward')
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
}

/**
 * Rebinds already accepted, immutable outputs to a new control epoch after an
 * author pause/resume. Binary objects and payload bytes are reused; a new
 * carried-forward Artifact version preserves the old provenance until the new
 * scheduler root signs a current-epoch reuse receipt.
 */
export async function carryForwardProductBuildArtifactsToEpochV1(input: {
  scope: WorkspaceScope
  buildId: number
  fromControlEpoch: number
  toControlEpoch: number
  artifactKeys: string[]
}): Promise<ProductBuildArtifactRecordV1[]> {
  const scope = await resolveScope({ scope: input.scope })
  if (!Number.isInteger(input.fromControlEpoch) || !Number.isInteger(input.toControlEpoch)
    || input.fromControlEpoch < 0 || input.toControlEpoch <= input.fromControlEpoch) {
    throw new Error('[product-production-artifact] carry-forward epoch 无效')
  }
  const keys = [...new Set(input.artifactKeys.map(value => stableKey(value, 'artifactKey')))]
  if (keys.length !== input.artifactKeys.length) throw new Error('[product-production-artifact] carry-forward keys 重复')
  if (keys.length === 0) return []
  const buildRow = await db.productBuilds.get(input.buildId)
  if (!buildRow || buildRow.id == null
    || !await assertRecordInScope(scope, 'productBuilds', buildRow, { owner: 'work' })
    || buildRow.controlEpoch !== input.toControlEpoch
    || !['authorized', 'building'].includes(buildRow.status)) {
    throw new Error('[product-production-artifact] carry-forward Build/epoch 不可写')
  }
  const build = buildRow as ProductBuildRecordV1 & { id: number }
  const plan = parseProductProductionPlanV3(build.planJson, undefined, build.briefHash)
  if (canonicalProductProductionJsonV2(plan) !== build.planJson
    || await hashProductProductionValueV2(plan) !== build.planHash
    || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch) {
    throw new Error('[product-production-artifact] carry-forward 目标 Plan 未持久化或损坏')
  }
  const requested = new Set(keys)
  const ownerTasks = new Map<string, ProductProductionPlanTaskV3>()
  for (const key of keys) {
    const owners = plan.tasks.filter(task => task.outputArtifactKeys.includes(key))
    if (owners.length !== 1) throw new Error(`[product-production-artifact] carry-forward owner 不唯一:${key}`)
    ownerTasks.set(owners[0].taskKey, owners[0])
  }
  for (const task of ownerTasks.values()) {
    if (task.executionMode === 'deterministic' || task.reuse !== null
      || task.outputArtifactKeys.some(key => !requested.has(key))) {
      throw new Error(`[product-production-artifact] carry-forward task 未授权完整 epoch reuse:${task.taskKey}`)
    }
  }
  const allRows = await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
  const sourceRows = allRows.filter(row => keys.includes(row.artifactKey)
    && row.controlEpoch === input.fromControlEpoch
    && (row.status === 'accepted' || row.status === 'carried-forward'))
  if (sourceRows.length !== keys.length || sourceRows.some(row => row.id == null || row.buildId !== build.id
    || row.projectId !== scope.projectId || row.worldId !== scope.worldId || row.workId !== scope.workId)
    || new Set(sourceRows.map(row => row.artifactKey)).size !== sourceRows.length) {
    throw new Error('[product-production-artifact] carry-forward 来源 key 不完整或不唯一')
  }
  const initialParentReadSet = await collectSameBuildCarryParentReadSetV1(sourceRows)
  const blobProofs = await verifiedBlobProofsV1({ scope, artifacts: sourceRows, label: 'carry-forward' })
  const proofHashes = new Map<string, string>()
  for (const source of sourceRows) proofHashes.set(source.artifactKey, await frozenParentProofHash({
    source,
    expectedBuildId: build.id,
    scope,
  }))
  for (const source of sourceRows) {
    if (proofHashes.get(source.artifactKey) !== await frozenParentProofHash({
      source,
      expectedBuildId: build.id,
      scope,
    })) throw new Error('[product-production-artifact] carry-forward producer proof 在提交前已变化')
  }
  const commitParentReadSet = await collectSameBuildCarryParentReadSetV1(sourceRows)
  if (sameBuildCarryParentReadSetJsonV1(initialParentReadSet)
    !== sameBuildCarryParentReadSetJsonV1(commitParentReadSet)) {
    throw new Error('[product-production-artifact] carry-forward 父证明读取期间已变化')
  }
  const commitBlobProofs = await refreshVerifiedBlobProofsV1({
    scope,
    expected: blobProofs,
    label: 'carry-forward',
  })
  const frozenBuildJson = canonicalProductProductionJsonV2(build)
  return db.transaction('rw', scopeTransactionTables(
    db.productBuilds, db.productBuildArtifacts, db.mediaBlobObjects,
    db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints,
  ), async () => {
    const [currentBuild, currentRows] = await Promise.all([
      db.productBuilds.get(build.id),
      db.productBuildArtifacts.where('buildId').equals(build.id).toArray(),
    ])
    if (!currentBuild || canonicalProductProductionJsonV2(currentBuild) !== frozenBuildJson
      || !sameStoredArtifactRowsV1(allRows, currentRows)) {
      throw new Error('[product-production-artifact] carry-forward 证明读取后 Build 或 Artifact 已变化')
    }
    await assertSameBuildCarryParentReadSetUnchangedV1(commitParentReadSet)
    for (const [blobId, expectedBlob] of commitBlobProofs) {
      const currentBlob = await db.mediaBlobObjects.get(blobId)
      if (!currentBlob || currentBlob.id == null
        || !sameBlobProofMetadataV1(expectedBlob, currentBlob as MediaBlobObjectRecordV1 & { id: number })
        || expectedBlob.backend === 'indexeddb' && !sameArrayBufferV1(expectedBlob.data, currentBlob.data)) {
        throw new Error('[product-production-artifact] carry-forward 媒资证明读取后已变化')
      }
    }
    const carried: ProductBuildArtifactRecordV1[] = []
    const now = Date.now()
    for (const source of sourceRows) {
      const current = currentRows.find(row => row.artifactKey === source.artifactKey
        && row.controlEpoch === input.toControlEpoch
        && (row.status === 'accepted' || row.status === 'carried-forward'))
      const version = Math.max(0, ...currentRows.filter(row => row.artifactKey === source.artifactKey)
        .map(row => row.version)) + 1
      const proofHash = proofHashes.get(source.artifactKey)!
      if (current) {
        const ref = current.carriedFrom
        const identityClosed = current.producerRunId == null
          ? current.producerReceiptHash === source.producerReceiptHash && current.inputHash === source.inputHash
          : isSha256Hash(current.producerReceiptHash) && isSha256Hash(current.inputHash)
        if (current.status !== 'carried-forward'
          || current.requirementKey !== source.requirementKey
          || current.kind !== source.kind || current.mediaKind !== source.mediaKind
          || !identityClosed || current.contentHash !== source.contentHash
          || current.payloadJson !== source.payloadJson || current.metadataJson !== source.metadataJson
          || current.qualityJson !== source.qualityJson || current.rightsJson !== source.rightsJson
          || current.blobObjectId !== source.blobObjectId || current.mimeType !== source.mimeType
          || current.byteSize !== source.byteSize || current.parentArtifactHash !== source.contentHash
          || ref?.buildNumber !== build.buildNumber || ref.artifactKey !== source.artifactKey
          || ref.version !== source.version || ref.contentHash !== source.contentHash
          || ref.proofHash !== proofHash) {
          throw new Error(`[product-production-artifact] carry-forward 当前 epoch 内容冲突:${source.artifactKey}`)
        }
        carried.push(current)
        continue
      }
      const next = stampNewRecord(scope, 'productBuildArtifacts', {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        buildId: build.id!, artifactKey: source.artifactKey, requirementKey: source.requirementKey,
        version, kind: source.kind, mediaKind: source.mediaKind, status: 'carried-forward' as const,
        producerRunId: null, producerReceiptHash: source.producerReceiptHash,
        controlEpoch: input.toControlEpoch, inputHash: source.inputHash, contentHash: source.contentHash,
        payloadJson: source.payloadJson, metadataJson: source.metadataJson,
        qualityJson: source.qualityJson, rightsJson: source.rightsJson,
        blobObjectId: source.blobObjectId, mimeType: source.mimeType, byteSize: source.byteSize,
        parentArtifactHash: source.contentHash,
        carriedFrom: {
          buildNumber: build.buildNumber, artifactKey: source.artifactKey,
          version: source.version, contentHash: source.contentHash, proofHash,
        },
        createdAt: now, updatedAt: now,
      } satisfies ProductBuildArtifactRecordV1, { owner: 'work' })
      const id = await db.productBuildArtifacts.add(next) as number
      await db.productBuildArtifacts.update(source.id!, { status: 'invalid', updatedAt: now })
      const stored = { ...next, id }
      currentRows.push(stored)
      carried.push(stored)
    }
    return carried.sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
  })
}

/**
 * Copies proven-unaffected immutable outputs from the immediately preceding
 * Build into a newly authorized evolution Build. The source Build is never
 * mutated; deterministic integration and QA always run again in the target.
 */
function sameStoredArtifactRowV1(
  left: ProductBuildArtifactRecordV1,
  right: ProductBuildArtifactRecordV1,
): boolean {
  return left.id === right.id
    && left.projectId === right.projectId && left.worldId === right.worldId && left.workId === right.workId
    && left.buildId === right.buildId && left.artifactKey === right.artifactKey
    && left.requirementKey === right.requirementKey && left.version === right.version
    && left.kind === right.kind && left.mediaKind === right.mediaKind && left.status === right.status
    && left.producerRunId === right.producerRunId && left.producerReceiptHash === right.producerReceiptHash
    && left.controlEpoch === right.controlEpoch && left.inputHash === right.inputHash
    && left.contentHash === right.contentHash && left.payloadJson === right.payloadJson
    && left.metadataJson === right.metadataJson && left.qualityJson === right.qualityJson
    && left.rightsJson === right.rightsJson && left.blobObjectId === right.blobObjectId
    && left.mimeType === right.mimeType && left.byteSize === right.byteSize
    && left.parentArtifactHash === right.parentArtifactHash
    && canonicalProductProductionJsonV2(left.carriedFrom) === canonicalProductProductionJsonV2(right.carriedFrom)
    && left.createdAt === right.createdAt && left.updatedAt === right.updatedAt
}

function sameStoredArtifactRowsV1(
  expected: ProductBuildArtifactRecordV1[],
  actual: ProductBuildArtifactRecordV1[],
): boolean {
  if (expected.length !== actual.length) return false
  const actualById = new Map(actual.map(row => [row.id, row]))
  return expected.every(row => row.id != null
    && actualById.has(row.id)
    && sameStoredArtifactRowV1(row, actualById.get(row.id)!))
}

function sameBlobProofMetadataV1(
  left: MediaBlobObjectRecordV1 & { id: number },
  right: MediaBlobObjectRecordV1 & { id: number },
): boolean {
  return left.id === right.id
    && left.projectId === right.projectId && left.worldId === right.worldId && left.workId === right.workId
    && left.contentHash === right.contentHash && left.mimeType === right.mimeType
    && left.byteSize === right.byteSize && left.backend === right.backend
    && left.storageState === right.storageState && left.opfsPath === right.opfsPath
    && left.leaseOwner === right.leaseOwner && left.leaseExpiresAt === right.leaseExpiresAt
    && left.lastVerifiedAt === right.lastVerifiedAt && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
}

export async function carryForwardProductBuildArtifactsAcrossBuildsV1(input: {
  scope: WorkspaceScope
  sourceBuildId: number
  targetBuildId: number
  targetControlEpoch: number
  artifactKeys: string[]
}): Promise<ProductBuildArtifactRecordV1[]> {
  const scope = await resolveScope({ scope: input.scope })
  if (input.sourceBuildId === input.targetBuildId || !Number.isInteger(input.targetControlEpoch)
    || input.targetControlEpoch < 0) {
    throw new Error('[product-production-artifact] cross-build carry-forward 参数无效')
  }
  const keys = [...new Set(input.artifactKeys.map(value => stableKey(value, 'artifactKey')))]
  if (!keys.length || keys.length !== input.artifactKeys.length) {
    throw new Error('[product-production-artifact] cross-build carry-forward keys 为空或重复')
  }
  const [sourceBuildRow, targetBuildRow] = await Promise.all([
    db.productBuilds.get(input.sourceBuildId), db.productBuilds.get(input.targetBuildId),
  ])
  if (!sourceBuildRow || sourceBuildRow.id == null || !targetBuildRow || targetBuildRow.id == null
    || !await assertRecordInScope(scope, 'productBuilds', sourceBuildRow, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productBuilds', targetBuildRow, { owner: 'work' })
    || sourceBuildRow.productionId !== targetBuildRow.productionId
    || targetBuildRow.parentBuildNumber !== sourceBuildRow.buildNumber
    || targetBuildRow.controlEpoch !== input.targetControlEpoch
    || !['preview-ready', 'release-ready', 'released'].includes(sourceBuildRow.status)
    || !['authorized', 'building'].includes(targetBuildRow.status)) {
    throw new Error('[product-production-artifact] cross-build 来源/目标关系不可复用')
  }
  const sourceBuild = sourceBuildRow as ProductBuildRecordV1 & { id: number }
  const targetBuild = targetBuildRow as ProductBuildRecordV1 & { id: number }
  const [sourceRows, targetRows, productionRow] = await Promise.all([
    db.productBuildArtifacts.where('buildId').equals(sourceBuild.id).toArray(),
    db.productBuildArtifacts.where('buildId').equals(targetBuild.id).toArray(),
    db.productProductions.get(sourceBuild.productionId),
  ])
  if (!productionRow || productionRow.id == null
    || !await assertRecordInScope(scope, 'productProductions', productionRow, { owner: 'work' })) {
    throw new Error('[product-production-artifact] cross-build Production 不存在或跨 Work')
  }
  const production = productionRow as ProductProductionRecordV1 & { id: number }
  // All WebCrypto and complete sealed-Build proof work happens before the rw
  // transaction. The transaction below performs only exact DB CAS plus writes.
  const sealedContext = await sealedBuildProofContextV1({
    scope,
    production,
    build: sourceBuild,
    activeRows: sourceRows,
  })
  const sources = sourceRows.filter(row => keys.includes(row.artifactKey)
    && row.controlEpoch === sourceBuild.controlEpoch
    && (row.status === 'accepted' || row.status === 'carried-forward'))
  if (sources.length !== keys.length || sources.some(row => row.id == null || row.buildId !== sourceBuild.id
    || row.projectId !== scope.projectId || row.worldId !== scope.worldId || row.workId !== scope.workId)
    || new Set(sources.map(row => row.artifactKey)).size !== keys.length) {
    throw new Error('[product-production-artifact] cross-build 来源 Artifact 不完整或不唯一')
  }
  const authorization = await crossBuildCarryAuthorizationV1({
    scope,
    production,
    sourceBuild,
    targetBuild,
    sources,
    artifactKeys: keys,
  })
  const blobProofs = sealedContext.blobProofs
  const proofHashes = new Map<string, string>()
  for (const source of sources) {
    proofHashes.set(source.artifactKey, await sealedParentProofHashV1({
      context: sealedContext,
      source,
      blobContentHash: source.blobObjectId == null
        ? null : blobProofs.get(source.blobObjectId)?.contentHash ?? null,
    }))
  }
  // Re-read and physically verify each object immediately before opening the
  // write transaction. OPFS I/O is deliberately kept outside IndexedDB; the
  // transaction below then CASes metadata and IndexedDB bytes synchronously.
  const commitBlobProofs = await refreshVerifiedBlobProofsV1({
    scope,
    expected: blobProofs,
    label: 'cross-build',
  })
  const frozenSourceBuildJson = canonicalProductProductionJsonV2(sourceBuild)
  const frozenTargetBuildJson = canonicalProductProductionJsonV2(targetBuild)
  const frozenProductionJson = canonicalProductProductionJsonV2(production)
  return db.transaction('rw', scopeTransactionTables(
    db.productProductions, db.productProductionBriefs, db.productBuilds,
    db.productBuildArtifacts, db.mediaBlobObjects, db.productProductionCommands,
  ), async () => {
    const [currentSourceBuild, currentTargetBuild, currentProduction, currentBrief, currentSourceRows, currentTargetRows, currentRepairCommands] = await Promise.all([
      db.productBuilds.get(sourceBuild.id),
      db.productBuilds.get(targetBuild.id),
      db.productProductions.get(production.id),
      db.productProductionBriefs.where('[productionId+revision]')
        .equals([targetBuild.productionId, targetBuild.briefRevision]).first(),
      db.productBuildArtifacts.where('buildId').equals(sourceBuild.id).toArray(),
      db.productBuildArtifacts.where('buildId').equals(targetBuild.id).toArray(),
      Promise.all(authorization.repairCommands.map(command => (
        db.productProductionCommands.get(command.id)
      ))),
    ])
    if (!currentSourceBuild || !currentTargetBuild || !currentProduction || !currentBrief
      || canonicalProductProductionJsonV2(currentSourceBuild) !== frozenSourceBuildJson
      || canonicalProductProductionJsonV2(currentTargetBuild) !== frozenTargetBuildJson
      || canonicalProductProductionJsonV2(currentProduction) !== frozenProductionJson
      || canonicalProductProductionJsonV2(currentBrief) !== authorization.briefRowJson
      || currentRepairCommands.length !== authorization.repairCommands.length
      || currentRepairCommands.some((row, index) => (
        canonicalProductProductionJsonV2(row) !== authorization.repairCommands[index]!.rowJson
      ))
      || !sameStoredArtifactRowsV1(sourceRows, currentSourceRows)
      || !sameStoredArtifactRowsV1(targetRows, currentTargetRows)) {
      throw new Error('[product-production-artifact] cross-build 证明读取后来源或目标已变化')
    }
    for (const [blobId, expectedBlob] of commitBlobProofs) {
      const currentBlob = await db.mediaBlobObjects.get(blobId)
      if (!currentBlob || currentBlob.id == null
        || !sameBlobProofMetadataV1(expectedBlob, currentBlob as MediaBlobObjectRecordV1 & { id: number })
        || expectedBlob.backend === 'indexeddb' && !sameArrayBufferV1(expectedBlob.data, currentBlob.data)) {
        throw new Error('[product-production-artifact] cross-build 媒资证明读取后已变化')
      }
    }
    const carried: ProductBuildArtifactRecordV1[] = []
    const now = Date.now()
    for (const source of sources) {
      const existing = currentTargetRows.find(row => row.artifactKey === source.artifactKey
        && row.controlEpoch === targetBuild.controlEpoch
        && (row.status === 'accepted' || row.status === 'carried-forward'))
      const version = Math.max(0, ...currentTargetRows.filter(row => row.artifactKey === source.artifactKey)
        .map(row => row.version)) + 1
      const proofHash = proofHashes.get(source.artifactKey)!
      if (existing) {
        const ref = existing.carriedFrom
        const identityClosed = existing.producerRunId == null
          ? existing.producerReceiptHash === source.producerReceiptHash && existing.inputHash === source.inputHash
          : isSha256Hash(existing.producerReceiptHash) && isSha256Hash(existing.inputHash)
        if (existing.status !== 'carried-forward'
          || existing.requirementKey !== source.requirementKey
          || existing.kind !== source.kind || existing.mediaKind !== source.mediaKind
          || !identityClosed || existing.contentHash !== source.contentHash
          || existing.payloadJson !== source.payloadJson || existing.metadataJson !== source.metadataJson
          || existing.qualityJson !== source.qualityJson || existing.rightsJson !== source.rightsJson
          || existing.blobObjectId !== source.blobObjectId || existing.mimeType !== source.mimeType
          || existing.byteSize !== source.byteSize || existing.parentArtifactHash !== source.contentHash
          || ref?.buildNumber !== sourceBuild.buildNumber || ref.artifactKey !== source.artifactKey
          || ref.version !== source.version || ref.contentHash !== source.contentHash
          || ref.proofHash !== proofHash) {
          throw new Error(`[product-production-artifact] cross-build 当前内容冲突:${source.artifactKey}`)
        }
        carried.push(existing)
        continue
      }
      const next = stampNewRecord(scope, 'productBuildArtifacts', {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        buildId: targetBuild.id!, artifactKey: source.artifactKey, requirementKey: source.requirementKey,
        version, kind: source.kind, mediaKind: source.mediaKind, status: 'carried-forward' as const,
        producerRunId: null, producerReceiptHash: source.producerReceiptHash,
        controlEpoch: targetBuild.controlEpoch, inputHash: source.inputHash, contentHash: source.contentHash,
        payloadJson: source.payloadJson, metadataJson: source.metadataJson,
        qualityJson: source.qualityJson, rightsJson: source.rightsJson,
        blobObjectId: source.blobObjectId, mimeType: source.mimeType, byteSize: source.byteSize,
        parentArtifactHash: source.contentHash,
        carriedFrom: {
          buildNumber: sourceBuild.buildNumber, artifactKey: source.artifactKey,
          version: source.version, contentHash: source.contentHash, proofHash,
        },
        createdAt: now, updatedAt: now,
      } satisfies ProductBuildArtifactRecordV1, { owner: 'work' })
      const id = await db.productBuildArtifacts.add(next) as number
      const stored = { ...next, id }
      currentTargetRows.push(stored)
      carried.push(stored)
    }
    return carried.sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
  })
}

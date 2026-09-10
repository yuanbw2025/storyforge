import type {
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductBuildManifestV1,
  ProductProductionPlanTaskV3,
  ProductProductionPlanV3,
} from '../types'
import { hashProductProductionValueV2, isSha256Hash } from './hash'

export interface ProductProductionParentRunWitnessV1 {
  parentRelation: string | null
  status: string
  terminalReceiptHash: string | null
  boundary: {
    buildNumber: number
    controlEpoch: number
    planHash: string
    taskKey: string
  }
}

export interface ProductProductionPortableTaskLedgerEntryV1 {
  taskKey: string
  attempt: number
  status: 'settled'
  idempotencyKey: string
  candidateHash: string
  terminalReceiptHash: string
  passedGateIds: string[]
  usage: ProductProductionPortableTaskUsageV1
  errorCode: null
}

export interface ProductProductionPortableTaskUsageV1 {
  modelCalls: number
  inputTokens: number
  outputTokens: number
  mediaCalls: number
  costUsd: number | null
  durationMs: number
  storageBytes: number
}

function evidenceRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[product-production-evidence] ${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function safeNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`[product-production-evidence] ${label} 必须是非负整数`)
  }
  return Number(value)
}

function portableUsage(value: unknown, label: string): ProductProductionPortableTaskUsageV1 {
  const row = evidenceRecord(value, label)
  const exact = [
    'modelCalls', 'inputTokens', 'outputTokens', 'mediaCalls', 'costUsd', 'durationMs', 'storageBytes',
  ]
  if (Object.keys(row).some(key => !exact.includes(key)) || exact.some(key => !(key in row))) {
    throw new Error(`[product-production-evidence] ${label} 字段不精确`)
  }
  const costUsd = row.costUsd
  if (costUsd !== null && (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0)) {
    throw new Error(`[product-production-evidence] ${label}.costUsd 无效`)
  }
  return {
    modelCalls: safeNonNegativeInteger(row.modelCalls, `${label}.modelCalls`),
    inputTokens: safeNonNegativeInteger(row.inputTokens, `${label}.inputTokens`),
    outputTokens: safeNonNegativeInteger(row.outputTokens, `${label}.outputTokens`),
    mediaCalls: safeNonNegativeInteger(row.mediaCalls, `${label}.mediaCalls`),
    costUsd: costUsd as number | null,
    durationMs: safeNonNegativeInteger(row.durationMs, `${label}.durationMs`),
    storageBytes: safeNonNegativeInteger(row.storageBytes, `${label}.storageBytes`),
  }
}

/**
 * Removes physical Run ids from the terminal task ledger while preserving all
 * task outcomes that affect a sealed Build. The result remains stable after a
 * project export/import rebinds local primary keys.
 */
export function parseProductProductionPortableTaskLedgerV1(input: {
  budgetLedgerJson: string
  plan: ProductProductionPlanV3
}): ProductProductionPortableTaskLedgerEntryV1[] {
  let parsed: unknown
  try { parsed = JSON.parse(input.budgetLedgerJson) } catch {
    throw new Error('[product-production-evidence] budget ledger JSON 损坏')
  }
  const ledger = evidenceRecord(parsed, 'budget ledger')
  if (ledger.schema !== 'storyforge.product-production-budget-ledger'
    || ![1, 2].includes(Number(ledger.version))) {
    throw new Error('[product-production-evidence] budget ledger 版本无效')
  }
  const tasks = evidenceRecord(ledger.tasks, 'budget ledger.tasks')
  const planKeys = [...input.plan.tasks.map(task => task.taskKey)].sort()
  const ledgerKeys = Object.keys(tasks).sort()
  if (JSON.stringify(planKeys) !== JSON.stringify(ledgerKeys)) {
    throw new Error('[product-production-evidence] terminal ledger 未精确覆盖 Plan tasks')
  }
  return planKeys.map(taskKey => {
    const row = evidenceRecord(tasks[taskKey], `budget ledger.tasks.${taskKey}`)
    const expectedKeys = [
      'runId', 'attempt', 'status', 'idempotencyKey', 'candidateHash', 'terminalReceiptHash',
      'passedGateIds', 'usage', 'errorCode',
    ]
    if (Object.keys(row).some(key => !expectedKeys.includes(key))
      || expectedKeys.some(key => !(key in row))
      || !Number.isSafeInteger(row.runId) || Number(row.runId) < 1
      || row.status !== 'settled' || row.errorCode !== null
      || !isSha256Hash(row.idempotencyKey) || !isSha256Hash(row.candidateHash)
      || !isSha256Hash(row.terminalReceiptHash)
      || !Array.isArray(row.passedGateIds)
      || row.passedGateIds.some(gate => typeof gate !== 'string' || !gate.trim())
      || new Set(row.passedGateIds).size !== row.passedGateIds.length) {
      throw new Error(`[product-production-evidence] terminal ledger task 无效:${taskKey}`)
    }
    return {
      taskKey,
      attempt: safeNonNegativeInteger(row.attempt, `budget ledger.tasks.${taskKey}.attempt`),
      status: 'settled' as const,
      idempotencyKey: row.idempotencyKey,
      candidateHash: row.candidateHash,
      terminalReceiptHash: row.terminalReceiptHash,
      passedGateIds: [...row.passedGateIds].sort(),
      usage: portableUsage(row.usage, `budget ledger.tasks.${taskKey}.usage`),
      errorCode: null,
    }
  })
}

export interface ProductProductionTaskReceiptInputV1 {
  taskKey: string
  attempt: number
  inputHash: string
  candidateHash: string
  passedGateIds: string[]
  usage: unknown
  controlEpoch: number
}

export interface ProductProductionCarriedDependencyV1 {
  taskKey: string
  receiptHash: string
}

export interface ProductProductionCarriedReceiptInputV1 {
  taskKey: string
  inputHash: string
  candidateHash: string
  dependencies: ProductProductionCarriedDependencyV1[]
  passedGateIds: string[]
  controlEpoch: number
}

/** Shared proof primitive for a normal task candidate checkpoint. */
export function hashProductProductionTaskCandidateV1(result: unknown): Promise<string> {
  return hashProductProductionValueV2(result)
}

/** Shared proof primitive for the normal task terminal receipt. */
export function hashProductProductionTaskReceiptV1(
  input: ProductProductionTaskReceiptInputV1,
): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.product-production-task-receipt',
    version: 1,
    taskKey: input.taskKey,
    attempt: input.attempt,
    inputHash: input.inputHash,
    candidateHash: input.candidateHash,
    passedGateIds: input.passedGateIds,
    usage: input.usage,
    controlEpoch: input.controlEpoch,
  })
}

/**
 * Shared proof primitive for a synthetic carried task. The order is part of
 * the scheduler contract, so callers may pass rows in any order.
 */
export function hashProductProductionCarriedCandidateV1(
  rows: ReadonlyArray<Pick<
    ProductBuildArtifactRecordV1,
    'artifactKey' | 'contentHash' | 'carriedFrom' | 'parentArtifactHash'
  >>,
): Promise<string> {
  return hashProductProductionValueV2(rows.map(row => ({
    artifactKey: row.artifactKey,
    contentHash: row.contentHash,
    carriedFrom: row.carriedFrom,
    parentArtifactHash: row.parentArtifactHash,
  })).sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)))
}

/** Shared proof primitive for the synthetic carried task terminal receipt. */
export function hashProductProductionCarriedReceiptV1(
  input: ProductProductionCarriedReceiptInputV1,
): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.product-production-carried-task-receipt',
    version: 1,
    taskKey: input.taskKey,
    inputHash: input.inputHash,
    candidateHash: input.candidateHash,
    dependencies: input.dependencies,
    passedGateIds: input.passedGateIds,
    controlEpoch: input.controlEpoch,
  })
}

/**
 * Freezes the exact parent row plus the materialized producer/root evidence at
 * carry time. A later epoch therefore cannot silently rewrite the historical
 * plan/run lineage and re-present the copied bytes as verified.
 */
export function hashProductProductionParentArtifactProofV1(input: {
  artifact: Pick<ProductBuildArtifactRecordV1,
    | 'artifactKey' | 'version' | 'controlEpoch' | 'inputHash'
    | 'contentHash' | 'producerReceiptHash'
    | 'parentArtifactHash' | 'carriedFrom'>
  producer: ProductProductionParentRunWitnessV1
  root: ProductProductionParentRunWitnessV1
}): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.product-production-parent-artifact-proof',
    version: 1,
    // `Pick<>` is compile-time only. Project the portable contract explicitly
    // so callers may safely pass a full IndexedDB row without accidentally
    // binding mutable status/timestamps/local ids into the lineage proof.
    artifact: {
      artifactKey: input.artifact.artifactKey,
      version: input.artifact.version,
      controlEpoch: input.artifact.controlEpoch,
      inputHash: input.artifact.inputHash,
      contentHash: input.artifact.contentHash,
      producerReceiptHash: input.artifact.producerReceiptHash,
      parentArtifactHash: input.artifact.parentArtifactHash,
      carriedFrom: input.artifact.carriedFrom,
    },
    producer: input.producer,
    root: input.root,
  })
}

export function hashProductProductionPortableRootSealV1(input: {
  planHash: string
  manifestHash: string
  packageHash: string
  qualityReportHash: string
  rootTerminalReceiptHash: string
  controlEpoch: number
  portableTaskLedger: ProductProductionPortableTaskLedgerEntryV1[]
}): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.product-production-portable-root-seal',
    version: 2,
    planHash: input.planHash,
    manifestHash: input.manifestHash,
    packageHash: input.packageHash,
    qualityReportHash: input.qualityReportHash,
    rootTerminalReceiptHash: input.rootTerminalReceiptHash,
    controlEpoch: input.controlEpoch,
    taskLedger: [...input.portableTaskLedger].sort((left, right) => left.taskKey.localeCompare(right.taskKey)),
  })
}

/**
 * Portable seal for a parent Artifact copied from a terminal Build. It binds
 * the exact immutable row to the complete Plan owner, terminal ledger,
 * manifest member and Build pointers without embedding local database ids.
 */
export async function hashProductProductionSealedParentArtifactProofV1(input: {
  productionKey: string
  productType: string
  build: Pick<ProductBuildRecordV1,
    | 'buildNumber' | 'parentBuildNumber' | 'briefRevision' | 'briefHash'
    | 'controlEpoch' | 'planHash' | 'manifestHash' | 'packageHash'
    | 'qualityReportHash' | 'rootTerminalReceiptHash'>
  portableTaskLedger: ProductProductionPortableTaskLedgerEntryV1[]
  portableRootSealHash: string
  ownerTask: ProductProductionPlanTaskV3
  manifestMember: ProductBuildManifestV1['artifactReceipts'][number]
  artifact: ProductBuildArtifactRecordV1
  blobContentHash: string | null
}): Promise<string> {
  const [planTaskHash, payloadJsonHash, metadataJsonHash,
    qualityJsonHash, rightsJsonHash] = await Promise.all([
    hashProductProductionValueV2(input.ownerTask),
    hashProductProductionValueV2(input.artifact.payloadJson),
    hashProductProductionValueV2(input.artifact.metadataJson),
    hashProductProductionValueV2(input.artifact.qualityJson),
    hashProductProductionValueV2(input.artifact.rightsJson),
  ])
  const ownerLedger = input.portableTaskLedger.find(row => row.taskKey === input.ownerTask.taskKey)
  return hashProductProductionValueV2({
    schema: 'storyforge.product-production-sealed-parent-artifact-proof',
    version: 1,
    sourceIdentity: {
      productType: input.productType,
      productionKey: input.productionKey,
    },
    buildSeal: {
      buildNumber: input.build.buildNumber,
      parentBuildNumber: input.build.parentBuildNumber,
      briefRevision: input.build.briefRevision,
      briefHash: input.build.briefHash,
      controlEpoch: input.build.controlEpoch,
      planHash: input.build.planHash,
      manifestHash: input.build.manifestHash,
      packageHash: input.build.packageHash,
      qualityReportHash: input.build.qualityReportHash,
      rootTerminalReceiptHash: input.build.rootTerminalReceiptHash,
      portableRootSealHash: input.portableRootSealHash,
    },
    owner: {
      taskKey: input.ownerTask.taskKey,
      planTaskHash,
      inputHash: input.artifact.inputHash,
      candidateHash: ownerLedger?.candidateHash ?? null,
      terminalReceiptHash: ownerLedger?.terminalReceiptHash ?? null,
    },
    manifestMember: input.manifestMember,
    artifactEnvelope: {
      artifactKey: input.artifact.artifactKey,
      version: input.artifact.version,
      status: input.artifact.status,
      requirementKey: input.artifact.requirementKey,
      kind: input.artifact.kind,
      mediaKind: input.artifact.mediaKind,
      controlEpoch: input.artifact.controlEpoch,
      inputHash: input.artifact.inputHash,
      contentHash: input.artifact.contentHash,
      payloadJsonHash,
      metadataJsonHash,
      qualityJsonHash,
      rightsJsonHash,
      mimeType: input.artifact.mimeType,
      byteSize: input.artifact.byteSize,
      blobContentHash: input.blobContentHash,
      parentArtifactHash: input.artifact.parentArtifactHash,
      carriedFrom: input.artifact.carriedFrom,
    },
  })
}

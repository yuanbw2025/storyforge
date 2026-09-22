import type { ProductBuildArtifactRecordV1 } from '../types'
import { hashProductProductionValueV2, isSha256Hash } from './hash'

export interface ProductBuildRootTerminalReceiptInputV1 {
  planHash: string
  manifestHash: string
  packageHash: string
  qualityReportHash: string
  controlEpoch: number
  budgetLedgerJson: string
  artifacts: Array<Pick<ProductBuildArtifactRecordV1,
    | 'artifactKey' | 'requirementKey' | 'version' | 'kind' | 'mediaKind' | 'status'
    | 'producerReceiptHash' | 'controlEpoch' | 'inputHash' | 'contentHash'
    | 'payloadJson' | 'metadataJson' | 'qualityJson' | 'rightsJson'
    | 'blobObjectId' | 'mimeType' | 'byteSize' | 'parentArtifactHash' | 'carriedFrom'>>
}

export async function createProductBuildRootTerminalReceiptV1(
  input: ProductBuildRootTerminalReceiptInputV1,
): Promise<string> {
  if (![input.planHash, input.manifestHash, input.packageHash, input.qualityReportHash].every(isSha256Hash)
    || !Number.isInteger(input.controlEpoch) || input.controlEpoch < 0) {
    throw new Error('[product-production-receipt] Build terminal 指针无效')
  }
  let budgetLedger: unknown
  try { budgetLedger = JSON.parse(input.budgetLedgerJson) } catch {
    throw new Error('[product-production-receipt] budget ledger 不是合法 JSON')
  }
  const orderedArtifacts = [...input.artifacts]
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
  if (new Set(orderedArtifacts.map(row => row.artifactKey)).size !== orderedArtifacts.length) {
    throw new Error('[product-production-receipt] Artifact key 不唯一')
  }
  const artifactEnvelopes: Array<{
    artifactKey: string
    requirementKey: string | null
    version: number
    kind: ProductBuildArtifactRecordV1['kind']
    mediaKind: ProductBuildArtifactRecordV1['mediaKind']
    status: ProductBuildArtifactRecordV1['status']
    controlEpoch: number
    inputHash: string
    contentHash: string
    producerReceiptHash: string | null
    payloadJsonHash: string
    metadataJsonHash: string
    qualityJsonHash: string
    rightsJsonHash: string
    hasBlob: boolean
    mimeType: string | null
    byteSize: number
    parentArtifactHash: string | null
    carriedFrom: ProductBuildArtifactRecordV1['carriedFrom']
  }> = []
  // WebCrypto promises inside one Dexie transaction each install a keepalive.
  // Hash sequentially so a source with hundreds of frozen units cannot create
  // thousands of competing waitFor loops and starve the transaction.
  for (const row of orderedArtifacts) artifactEnvelopes.push({
      artifactKey: row.artifactKey,
      requirementKey: row.requirementKey,
      version: row.version,
      kind: row.kind,
      mediaKind: row.mediaKind,
      status: row.status,
      controlEpoch: row.controlEpoch,
      inputHash: row.inputHash,
      contentHash: row.contentHash,
      producerReceiptHash: row.producerReceiptHash,
      payloadJsonHash: await hashProductProductionValueV2(row.payloadJson),
      metadataJsonHash: await hashProductProductionValueV2(row.metadataJson),
      qualityJsonHash: await hashProductProductionValueV2(row.qualityJson),
      rightsJsonHash: await hashProductProductionValueV2(row.rightsJson),
      hasBlob: row.blobObjectId != null,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      parentArtifactHash: row.parentArtifactHash,
      carriedFrom: row.carriedFrom,
    })
  if (artifactEnvelopes.some(row => !row.artifactKey || !Number.isInteger(row.version) || row.version < 1
    || !['accepted', 'carried-forward'].includes(row.status)
    || row.controlEpoch !== input.controlEpoch
    || !isSha256Hash(row.inputHash) || !isSha256Hash(row.contentHash)
    || (row.producerReceiptHash != null && !isSha256Hash(row.producerReceiptHash)))) {
    throw new Error('[product-production-receipt] Artifact receipt 无效')
  }
  return hashProductProductionValueV2({
    schema: 'storyforge.product-build-root-terminal-receipt',
    version: 2,
    planHash: input.planHash,
    manifestHash: input.manifestHash,
    packageHash: input.packageHash,
    qualityReportHash: input.qualityReportHash,
    controlEpoch: input.controlEpoch,
    budgetLedger,
    artifactEnvelopes,
  })
}

/**
 * Reproduces the terminal receipt emitted before the full Artifact-envelope
 * seal was introduced. It is verification-only: all new writes must use
 * createProductBuildRootTerminalReceiptV1(), which emits schema version 2.
 */
export async function createLegacyProductBuildRootTerminalReceiptV1(
  input: ProductBuildRootTerminalReceiptInputV1,
): Promise<string> {
  if (![input.planHash, input.manifestHash, input.packageHash, input.qualityReportHash].every(isSha256Hash)
    || !Number.isInteger(input.controlEpoch) || input.controlEpoch < 0) {
    throw new Error('[product-production-receipt] Build terminal 指针无效')
  }
  let budgetLedger: unknown
  try { budgetLedger = JSON.parse(input.budgetLedgerJson) } catch {
    throw new Error('[product-production-receipt] budget ledger 不是合法 JSON')
  }
  const artifactReceipts = [...input.artifacts]
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
    .map(row => ({
      artifactKey: row.artifactKey,
      version: row.version,
      contentHash: row.contentHash,
      producerReceiptHash: row.producerReceiptHash,
    }))
  if (artifactReceipts.some(row => !row.artifactKey || !Number.isInteger(row.version) || row.version < 1
    || !isSha256Hash(row.contentHash)
    || (row.producerReceiptHash != null && !isSha256Hash(row.producerReceiptHash)))) {
    throw new Error('[product-production-receipt] legacy Artifact receipt 无效')
  }
  return hashProductProductionValueV2({
    schema: 'storyforge.product-build-root-terminal-receipt',
    version: 1,
    planHash: input.planHash,
    manifestHash: input.manifestHash,
    packageHash: input.packageHash,
    qualityReportHash: input.qualityReportHash,
    controlEpoch: input.controlEpoch,
    budgetLedger,
    artifactReceipts,
  })
}

export async function verifyProductBuildRootTerminalReceiptV1(
  input: ProductBuildRootTerminalReceiptInputV1 & { expectedReceiptHash: string },
): Promise<{ valid: true; version: 2 | 1 } | { valid: false; version: null }> {
  if (!isSha256Hash(input.expectedReceiptHash)) return { valid: false, version: null }
  const current = await createProductBuildRootTerminalReceiptV1(input)
  if (current === input.expectedReceiptHash) return { valid: true, version: 2 }
  const legacy = await createLegacyProductBuildRootTerminalReceiptV1(input)
  return legacy === input.expectedReceiptHash
    ? { valid: true, version: 1 }
    : { valid: false, version: null }
}

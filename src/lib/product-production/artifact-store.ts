import { db } from '../db/schema'
import type {
  ProductBuildArtifactKindV1,
  ProductBuildArtifactRecordV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function stableKey(value: string, label: string): string {
  const normalized = value.trim()
  if (!STABLE_KEY.test(normalized)) throw new Error(`[product-production-artifact] ${label} 无效`)
  return normalized
}

function boundedJson(value: unknown, label: string): string {
  const json = canonicalProductProductionJsonV2(value)
  if (json.length > 2_000_000) throw new Error(`[product-production-artifact] ${label} 超出 2MB 上限`)
  return json
}

/**
 * The only deterministic/candidate-to-Build adoption boundary. It verifies the
 * Build epoch and stores an immutable accepted version; formal tables remain
 * untouched until package adoption.
 */
export async function acceptProductBuildArtifact(input: {
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
}): Promise<ProductBuildArtifactRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const artifactKey = stableKey(input.artifactKey, 'artifactKey')
  const requirementKey = input.requirementKey == null ? null : stableKey(input.requirementKey, 'requirementKey')
  if (!isSha256Hash(input.inputHash)) throw new Error('[product-production-artifact] inputHash 无效')
  if (input.producerReceiptHash != null && !isSha256Hash(input.producerReceiptHash)) {
    throw new Error('[product-production-artifact] producerReceiptHash 无效')
  }
  const payloadJson = boundedJson(input.payload, 'payload')
  const metadataJson = boundedJson(input.metadata ?? {}, 'metadata')
  const qualityJson = boundedJson(input.quality ?? {}, 'quality')
  const rightsJson = boundedJson(input.rights ?? {}, 'rights')
  const contentHash = input.contentHash ?? await hashProductProductionValueV2(JSON.parse(payloadJson))
  if (!isSha256Hash(contentHash)) throw new Error('[product-production-artifact] contentHash 无效')
  const byteSize = input.byteSize ?? new TextEncoder().encode(payloadJson).byteLength
  if (!Number.isInteger(byteSize) || byteSize < 0 || byteSize > 100 * 1024 * 1024) {
    throw new Error('[product-production-artifact] byteSize 无效')
  }
  return db.transaction('rw', scopeTransactionTables(
    db.productBuilds, db.productBuildArtifacts, db.mediaBlobObjects, db.agentRuns,
  ), async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) {
      throw new Error('[product-production-artifact] Build 不存在或跨 Work')
    }
    if (build.controlEpoch !== input.controlEpoch || ['paused', 'cancelled', 'failed', 'archived', 'released'].includes(build.status)) {
      throw new Error('[product-production-artifact] Build epoch 已过期或不可写')
    }
    if (input.producerRunId != null) {
      const run = await db.agentRuns.get(input.producerRunId)
      let runControlEpoch: unknown = null
      try {
        const contract = run ? JSON.parse(run.contractJson) as {
          scope?: { productProduction?: { controlEpoch?: unknown } }
        } : null
        runControlEpoch = contract?.scope?.productProduction?.controlEpoch ?? null
      } catch { /* malformed contracts are rejected below */ }
      if (!run || run.productBuildId !== build.id || run.projectId !== scope.projectId
        || run.workId !== scope.workId || runControlEpoch !== input.controlEpoch) {
        throw new Error('[product-production-artifact] producer Run 不属于当前 Build/epoch')
      }
    }
    if (input.blobObjectId != null) {
      const blob = await db.mediaBlobObjects.get(input.blobObjectId)
      if (!blob || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' })
        || blob.storageState !== 'ready' || blob.contentHash !== contentHash
        || blob.byteSize !== byteSize || blob.mimeType !== input.mimeType) {
        throw new Error('[product-production-artifact] 媒资对象与 Artifact 不一致')
      }
    } else if (input.mimeType != null) {
      throw new Error('[product-production-artifact] 非媒资 Artifact 不能声明 mimeType')
    }
    const rows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
    const same = rows.find(row => row.artifactKey === artifactKey && row.contentHash === contentHash
      && row.status === 'accepted' && row.controlEpoch === input.controlEpoch)
    if (same) return same
    const priorAcceptedIds = rows
      .filter(row => row.artifactKey === artifactKey && row.status === 'accepted' && row.id != null)
      .map(row => row.id!)
    const version = Math.max(0, ...rows.filter(row => row.artifactKey === artifactKey).map(row => row.version)) + 1
    const now = Date.now()
    const artifact = stampNewRecord(scope, 'productBuildArtifacts', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      buildId: build.id!, artifactKey, requirementKey, version, kind: input.kind,
      mediaKind: input.mediaKind ?? null, status: 'accepted' as const,
      producerRunId: input.producerRunId ?? null, producerReceiptHash: input.producerReceiptHash ?? null,
      controlEpoch: input.controlEpoch, inputHash: input.inputHash, contentHash,
      payloadJson, metadataJson, qualityJson, rightsJson,
      blobObjectId: input.blobObjectId ?? null, mimeType: input.mimeType ?? null, byteSize,
      parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now,
    } satisfies ProductBuildArtifactRecordV1, { owner: 'work' })
    const id = await db.productBuildArtifacts.add(artifact) as number
    if (priorAcceptedIds.length > 0) {
      await db.productBuildArtifacts.where('id').anyOf(priorAcceptedIds).modify({ status: 'invalid', updatedAt: now })
    }
    return { ...artifact, id }
  })
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
  return db.transaction('rw', scopeTransactionTables(
    db.productBuilds, db.productBuildArtifacts, db.mediaBlobObjects,
  ), async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
      || build.controlEpoch !== input.toControlEpoch
      || ['cancelled', 'failed', 'archived', 'released'].includes(build.status)) {
      throw new Error('[product-production-artifact] carry-forward Build/epoch 不可写')
    }
    const allRows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
    const sourceRows = allRows.filter(row => keys.includes(row.artifactKey)
      && row.controlEpoch === input.fromControlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'))
    if (new Set(sourceRows.map(row => row.artifactKey)).size !== sourceRows.length) {
      throw new Error('[product-production-artifact] carry-forward 来源 key 不唯一')
    }
    const carried: ProductBuildArtifactRecordV1[] = []
    const now = Date.now()
    for (const source of sourceRows) {
      const current = allRows.find(row => row.artifactKey === source.artifactKey
        && row.controlEpoch === input.toControlEpoch
        && (row.status === 'accepted' || row.status === 'carried-forward'))
      if (current) {
        if (current.contentHash !== source.contentHash) {
          throw new Error(`[product-production-artifact] carry-forward 当前 epoch 内容冲突:${source.artifactKey}`)
        }
        carried.push(current)
        continue
      }
      if (source.blobObjectId != null) {
        const blob = await db.mediaBlobObjects.get(source.blobObjectId)
        if (!blob || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' })
          || blob.storageState !== 'ready' || blob.contentHash !== source.contentHash
          || blob.mimeType !== source.mimeType || blob.byteSize !== source.byteSize) {
          throw new Error(`[product-production-artifact] carry-forward 媒资对象损坏:${source.artifactKey}`)
        }
      }
      const version = Math.max(0, ...allRows.filter(row => row.artifactKey === source.artifactKey)
        .map(row => row.version)) + 1
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
          version: source.version, contentHash: source.contentHash,
        },
        createdAt: now, updatedAt: now,
      } satisfies ProductBuildArtifactRecordV1, { owner: 'work' })
      const id = await db.productBuildArtifacts.add(next) as number
      await db.productBuildArtifacts.update(source.id!, { status: 'invalid', updatedAt: now })
      carried.push({ ...next, id })
    }
    return carried.sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
  })
}

/**
 * Copies proven-unaffected immutable outputs from the immediately preceding
 * Build into a newly authorized evolution Build. The source Build is never
 * mutated; deterministic integration and QA always run again in the target.
 */
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
  return db.transaction('rw', scopeTransactionTables(
    db.productBuilds, db.productBuildArtifacts, db.mediaBlobObjects,
  ), async () => {
    const [sourceBuild, targetBuild] = await Promise.all([
      db.productBuilds.get(input.sourceBuildId), db.productBuilds.get(input.targetBuildId),
    ])
    if (!sourceBuild || !targetBuild
      || !await assertRecordInScope(scope, 'productBuilds', sourceBuild, { owner: 'work' })
      || !await assertRecordInScope(scope, 'productBuilds', targetBuild, { owner: 'work' })
      || sourceBuild.productionId !== targetBuild.productionId
      || targetBuild.parentBuildNumber !== sourceBuild.buildNumber
      || targetBuild.controlEpoch !== input.targetControlEpoch
      || !['preview-ready', 'release-ready', 'released'].includes(sourceBuild.status)
      || ['cancelled', 'failed', 'archived', 'released'].includes(targetBuild.status)) {
      throw new Error('[product-production-artifact] cross-build 来源/目标关系不可复用')
    }
    const [sourceRows, targetRows] = await Promise.all([
      db.productBuildArtifacts.where('buildId').equals(sourceBuild.id!).toArray(),
      db.productBuildArtifacts.where('buildId').equals(targetBuild.id!).toArray(),
    ])
    const sources = sourceRows.filter(row => keys.includes(row.artifactKey)
      && row.controlEpoch === sourceBuild.controlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'))
    if (sources.length !== keys.length || new Set(sources.map(row => row.artifactKey)).size !== keys.length) {
      throw new Error('[product-production-artifact] cross-build 来源 Artifact 不完整或不唯一')
    }
    const carried: ProductBuildArtifactRecordV1[] = []
    const now = Date.now()
    for (const source of sources) {
      const existing = targetRows.find(row => row.artifactKey === source.artifactKey
        && row.controlEpoch === targetBuild.controlEpoch
        && (row.status === 'accepted' || row.status === 'carried-forward'))
      if (existing) {
        if (existing.contentHash !== source.contentHash || existing.parentArtifactHash !== source.contentHash) {
          throw new Error(`[product-production-artifact] cross-build 当前内容冲突:${source.artifactKey}`)
        }
        carried.push(existing)
        continue
      }
      if (source.blobObjectId != null) {
        const blob = await db.mediaBlobObjects.get(source.blobObjectId)
        if (!blob || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' })
          || blob.storageState !== 'ready' || blob.contentHash !== source.contentHash
          || blob.mimeType !== source.mimeType || blob.byteSize !== source.byteSize) {
          throw new Error(`[product-production-artifact] cross-build 媒资对象损坏:${source.artifactKey}`)
        }
      }
      const version = Math.max(0, ...targetRows.filter(row => row.artifactKey === source.artifactKey)
        .map(row => row.version)) + 1
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
          version: source.version, contentHash: source.contentHash,
        },
        createdAt: now, updatedAt: now,
      } satisfies ProductBuildArtifactRecordV1, { owner: 'work' })
      const id = await db.productBuildArtifacts.add(next) as number
      const stored = { ...next, id }
      targetRows.push(stored)
      carried.push(stored)
    }
    return carried.sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
  })
}

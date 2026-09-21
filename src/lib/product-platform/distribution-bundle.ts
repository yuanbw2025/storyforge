import { db } from '../db/schema'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import {
  discardUnreferencedMediaBlobObjectsV1,
  putMediaBlobObject,
  sha256MediaData,
} from '../product-production/media-blob-store'
import { readProductReleaseMediaBytes } from '../product-production/release-media'
import { verifyProductReleaseManifestV1 } from '../product-production/runtime-package'
import type {
  FrozenRuntimeMediaAssetV2,
  ProductRelease,
  ProductReleaseManifestV1,
  ProductMediaAsset,
  ProductMediaBlob,
  ProductReleaseDistributionProvenanceV1,
  ProductReleaseMarketplaceProvenanceV1,
  ProductReleaseLocalFileProvenanceV1,
  WorkspaceScope,
} from '../types'
import { assertProductReleaseUnchanged } from '../product/releases'
import { transactionTablesForReferenceCascade } from '../registry/lifecycle'
import { sanitizeSvgWithReportV1 } from '../utils/sanitize-svg'
import { cascadeRegisteredReferences } from '../workspace/lifecycle'
import {
  assertRecordInScope,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from '../workspace/scope'

export interface ProductDistributionMediaV2 {
  asset: FrozenRuntimeMediaAssetV2
  dataBase64: string
}

/**
 * Self-contained upper-product distribution contract.
 *
 * The source world is provenance only. A distribution package never embeds,
 * recreates or dereferences WorldRelease tables; runtime truth is the frozen
 * ProductRelease manifest and its product-owned media.
 */
export interface ProductDistributionBundleV2 {
  schema: 'storyforge.product-distribution-bundle'
  version: 2
  productRelease: { contentHash: string; manifest: ProductReleaseManifestV1 }
  sourceWorld: { contentHash: string }
  media: ProductDistributionMediaV2[]
  bundleHash: string
}

export interface MarketplaceImportProvenanceV2 {
  listingId: string
  orderId: string | null
  entitlementId: string | null
  license: ProductReleaseMarketplaceProvenanceV1['license']
  attribution: string[]
  localCopyPreserved: boolean
  acquiredAt: number
}

export interface LocalFileImportProvenanceV1 {
  candidatePackageHash: string
  originalReleaseHash: string
  candidateStatus: 'eligible-for-community-submission'
}

export const DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1 = 'delete-imported-product-release-copy'

export interface DeleteImportedProductReleaseResultV1 {
  productReleaseId: number
  source: ProductReleaseDistributionProvenanceV1['source']
  deletedSessionCount: number
  deletedMediaAssetCount: number
  deletedMediaBindingCount: number
  reclaimedBlobObjectIds: number[]
  retainedBlobObjectIds: number[]
}

const MAXIMUM_DISTRIBUTION_BYTES = 256 * 1024 * 1024

function encodeBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function decodeBase64(value: unknown, expectedBytes: number): ArrayBuffer {
  if (typeof value !== 'string'
    || value.length > Math.ceil(expectedBytes / 3) * 4 + 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('[distribution] 媒资 base64 无效或超限')
  }
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new Error('[distribution] 媒资 base64 无法解码')
  }
  if (binary.length !== expectedBytes) {
    throw new Error('[distribution] 媒资解码大小与清单不一致')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function assertDistributionSvgAlreadySanitized(data: ArrayBuffer, assetKey: string): void {
  let raw: string
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    throw new Error(`[distribution] SVG 不是有效 UTF-8:${assetKey}`)
  }
  const report = sanitizeSvgWithReportV1(raw)
  if (!report.sanitized || report.removedUnsafeContent) {
    throw new Error(`[distribution] SVG 未经受治理净化或包含不安全内容:${assetKey}`)
  }
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value)
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) {
    throw new Error(`[distribution] ${label} 字段不符合合同`)
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[distribution] ${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

async function verifiedBundle(value: unknown): Promise<{
  bundle: ProductDistributionBundleV2
  decodedMedia: Array<{ asset: FrozenRuntimeMediaAssetV2; data: ArrayBuffer; sanitizedSvg: boolean }>
}> {
  const raw = record(value, 'bundle')
  exactKeys(raw, ['schema', 'version', 'productRelease', 'sourceWorld', 'media', 'bundleHash'], 'bundle')
  if (raw.schema !== 'storyforge.product-distribution-bundle'
    || raw.version !== 2
    || !isSha256Hash(raw.bundleHash)
    || !Array.isArray(raw.media)) {
    throw new Error('[distribution] 分发包结构无效')
  }
  const game = record(raw.productRelease, 'productRelease')
  const sourceWorld = record(raw.sourceWorld, 'sourceWorld')
  exactKeys(game, ['contentHash', 'manifest'], 'productRelease')
  exactKeys(sourceWorld, ['contentHash'], 'sourceWorld')
  if (!isSha256Hash(game.contentHash) || !isSha256Hash(sourceWorld.contentHash)) {
    throw new Error('[distribution] Release contentHash 无效')
  }
  const productManifest = await verifyProductReleaseManifestV1(game.manifest)
  if (await hashProductProductionValueV2(productManifest) !== game.contentHash) {
    throw new Error('[distribution] ProductRelease contentHash 不一致')
  }
  if (productManifest.sourceWorldRelease.contentHash !== sourceWorld.contentHash) {
    throw new Error('[distribution] ProductRelease 世界来源证明不一致')
  }

  const expectedAssets = productManifest.runtimePackage.presentation?.assets ?? []
  if (raw.media.length !== expectedAssets.length) {
    throw new Error('[distribution] 分发媒资数量不闭合')
  }
  const expectedByKey = new Map(
    expectedAssets.map(asset => [`${asset.assetKey}\u0000${asset.version}`, asset]),
  )
  const decodedMedia: Array<{
    asset: FrozenRuntimeMediaAssetV2
    data: ArrayBuffer
    sanitizedSvg: boolean
  }> = []
  let totalBytes = 0
  for (const item of raw.media) {
    const media = record(item, 'media')
    exactKeys(media, ['asset', 'dataBase64'], 'media')
    const asset = media.asset as FrozenRuntimeMediaAssetV2
    const expected = expectedByKey.get(`${asset?.assetKey}\u0000${asset?.version}`)
    if (!expected || canonicalProductProductionJsonV2(asset) !== canonicalProductProductionJsonV2(expected)) {
      throw new Error('[distribution] 媒资元数据未被 RuntimePackage 冻结')
    }
    if (!Number.isInteger(asset.byteSize) || asset.byteSize < 1) {
      throw new Error('[distribution] 媒资 byteSize 无效')
    }
    totalBytes += asset.byteSize
    if (totalBytes > MAXIMUM_DISTRIBUTION_BYTES) {
      throw new Error('[distribution] 分发包媒资超过 256MiB')
    }
    const data = decodeBase64(media.dataBase64, asset.byteSize)
    if (await sha256MediaData(data) !== asset.blobContentHash
      || asset.contentHash !== asset.blobContentHash) {
      throw new Error(`[distribution] 媒资哈希不一致:${asset.assetKey}`)
    }
    const sanitizedSvg = asset.mimeType === 'image/svg+xml'
    if (sanitizedSvg) assertDistributionSvgAlreadySanitized(data, asset.assetKey)
    decodedMedia.push({ asset: structuredClone(asset), data, sanitizedSvg })
    expectedByKey.delete(`${asset.assetKey}\u0000${asset.version}`)
  }
  if (expectedByKey.size) {
    throw new Error('[distribution] RuntimePackage 媒资未完整交付')
  }
  const payload = {
    schema: raw.schema,
    version: raw.version,
    productRelease: { contentHash: game.contentHash, manifest: productManifest },
    sourceWorld: { contentHash: sourceWorld.contentHash },
    media: raw.media,
  }
  if (await hashProductProductionValueV2(payload) !== raw.bundleHash) {
    throw new Error('[distribution] 分发包 bundleHash 不一致')
  }
  return {
    bundle: { ...payload, bundleHash: raw.bundleHash } as ProductDistributionBundleV2,
    decodedMedia,
  }
}

export async function verifyProductDistributionBundleV2(value: unknown): Promise<ProductDistributionBundleV2> {
  return (await verifiedBundle(value)).bundle
}

export async function exportProductDistributionBundleV2(input: {
  scope: WorkspaceScope
  productReleaseId: number
}): Promise<ProductDistributionBundleV2> {
  const scope = await resolveScope({ scope: input.scope })
  const release = await db.productReleases.get(input.productReleaseId)
  if (!release || !await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })) {
    throw new Error('[distribution] ProductRelease 不存在或跨 Work')
  }
  await assertProductReleaseUnchanged(release.id!)
  const manifest = await verifyProductReleaseManifestV1(release.manifestJson)
  const media: ProductDistributionMediaV2[] = []
  for (const asset of manifest.runtimePackage.presentation?.assets ?? []) {
    const data = await readProductReleaseMediaBytes({
      scope,
      productReleaseId: release.id!,
      asset,
    })
    media.push({ asset: structuredClone(asset), dataBase64: encodeBase64(data) })
  }
  const payload = {
    schema: 'storyforge.product-distribution-bundle' as const,
    version: 2 as const,
    productRelease: { contentHash: release.contentHash, manifest },
    sourceWorld: { contentHash: manifest.sourceWorldRelease.contentHash },
    media,
  }
  const bundle = { ...payload, bundleHash: await hashProductProductionValueV2(payload) }
  await verifyProductDistributionBundleV2(bundle)
  return bundle
}

function validateProvenance(value: MarketplaceImportProvenanceV2): MarketplaceImportProvenanceV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => ![
      'listingId', 'orderId', 'entitlementId', 'license', 'attribution',
      'localCopyPreserved', 'acquiredAt',
    ].includes(key))
    || !value.license || typeof value.license !== 'object' || Array.isArray(value.license)
    || Object.keys(value.license).length !== 7
    || Object.keys(value.license).some(key => ![
      'licenseId', 'licenseVersion', 'allowOfflineExport', 'allowRemix',
      'commercialReuse', 'requiresAttribution', 'termsUrl',
    ].includes(key))
    || value.license.allowOfflineExport !== true
    || ['allowRemix', 'commercialReuse', 'requiresAttribution']
      .some(key => typeof value.license[key as keyof typeof value.license] !== 'boolean')
    || value.localCopyPreserved !== true
    || !Number.isInteger(value.acquiredAt)
    || value.acquiredAt < 0
    || !Array.isArray(value.attribution)
    || value.attribution.length > 100
    || !/^listing\.[A-Za-z0-9._:-]+$/.test(value.listingId)
    || (value.orderId != null && !/^order\.[A-Za-z0-9._:-]+$/.test(value.orderId))
    || (value.entitlementId != null && !/^entitlement\.[A-Za-z0-9._:-]+$/.test(value.entitlementId))
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.license.licenseId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.license.licenseVersion)) {
    throw new Error('[distribution] 市场导入许可或来源回执无效')
  }
  let termsUrl: URL
  try {
    termsUrl = new URL(value.license.termsUrl)
  } catch {
    throw new Error('[distribution] 市场许可条款 URL 无效')
  }
  if (termsUrl.protocol !== 'https:' || value.license.termsUrl.length > 2_000) {
    throw new Error('[distribution] 市场许可条款必须使用 HTTPS')
  }
  const attribution = value.attribution.map((item, index) => {
    if (typeof item !== 'string' || !item.trim() || item.length > 1_000) {
      throw new Error(`[distribution] attribution[${index}] 无效`)
    }
    return item.trim().normalize('NFC')
  })
  if (new Set(attribution).size !== attribution.length) {
    throw new Error('[distribution] attribution 不能重复')
  }
  if (value.license.requiresAttribution && attribution.length === 0) {
    throw new Error('[distribution] 当前许可要求归因信息')
  }
  return { ...structuredClone(value), attribution }
}

export async function importMarketplaceProductDistributionV2(input: {
  scope: WorkspaceScope
  bundle: unknown
  provenance: MarketplaceImportProvenanceV2
}): Promise<ProductRelease> {
  const scope = await resolveScope({ scope: input.scope })
  const verified = await verifiedBundle(input.bundle)
  const provenance = validateProvenance(input.provenance)
  return importVerifiedProductDistributionV2({
    scope,
    verified,
    productionKeyPrefix: 'marketplace',
    labelSuffix: '市场副本',
    distributionProvenance: {
      source: 'marketplace',
      ...provenance,
      importedAt: Date.now(),
    },
  })
}

export async function importLocalProductDistributionV2(input: {
  scope: WorkspaceScope
  bundle: unknown
  provenance: LocalFileImportProvenanceV1
}): Promise<ProductRelease> {
  const scope = await resolveScope({ scope: input.scope })
  const verified = await verifiedBundle(input.bundle)
  if (!isSha256Hash(input.provenance?.candidatePackageHash)
    || input.provenance?.originalReleaseHash !== verified.bundle.productRelease.contentHash
    || input.provenance?.candidateStatus !== 'eligible-for-community-submission') {
    throw new Error('[distribution] 本地文字冒险候选包来源无效')
  }
  return importVerifiedProductDistributionV2({
    scope,
    verified,
    productionKeyPrefix: 'local-file',
    labelSuffix: '本地导入副本',
    distributionProvenance: {
      source: 'local-file',
      candidatePackageHash: input.provenance.candidatePackageHash,
      originalReleaseHash: input.provenance.originalReleaseHash,
      candidateStatus: input.provenance.candidateStatus,
      remoteCreatorIdentityVerified: false,
      localCopyPreserved: true,
      importedAt: Date.now(),
    },
  })
}

export async function listImportedProductReleasesV1(input: {
  scope: WorkspaceScope
  productType?: ProductRelease['productType']
}): Promise<ProductRelease[]> {
  const scope = await resolveScope({ scope: input.scope })
  const rows = await db.productReleases.where('workId').equals(scope.workId).toArray()
  const imported: ProductRelease[] = []
  for (const row of rows) {
    if (!row.distributionProvenance || (input.productType && row.productType !== input.productType)) continue
    if (!await assertRecordInScope(scope, 'productReleases', row, { owner: 'work' })) {
      throw new Error('[distribution] 导入 ProductRelease 越过当前 Work')
    }
    imported.push(row)
  }
  return imported.sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
}

/**
 * Remove one imported local copy and the product-private runtime state that was
 * created from it. The cascade topology is derived from PROJECT_TABLES; the
 * content-addressed Blob objects are reclaimed only after every registered
 * release/build binding has disappeared.
 */
export async function deleteImportedProductReleaseV1(input: {
  scope: WorkspaceScope
  productReleaseId: number
  confirmation: typeof DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1
}): Promise<DeleteImportedProductReleaseResultV1> {
  if (input.confirmation !== DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1) {
    throw new Error('[distribution] 删除导入副本需要明确确认')
  }
  if (!Number.isInteger(input.productReleaseId) || input.productReleaseId <= 0) {
    throw new Error('[distribution] ProductRelease id 无效')
  }
  const scope = await resolveScope({ scope: input.scope })
  const cascadeTables = transactionTablesForReferenceCascade('productReleases')
  const deleted = await db.transaction('rw', scopeTransactionTables(
    ...cascadeTables,
    db.productBuilds,
    db.productProductions,
  ), async () => {
    const release = await db.productReleases.get(input.productReleaseId)
    if (!release || !await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })) {
      throw new Error('[distribution] 导入 ProductRelease 不存在或跨 Work')
    }
    if (!release.distributionProvenance) {
      throw new Error('[distribution] 原创 ProductRelease 不允许通过导入副本入口删除')
    }
    const [releasedBuild, sourceBuild, currentProduction] = await Promise.all([
      db.productBuilds.where('releasedProductReleaseId').equals(release.id!).first(),
      db.productBuilds.where('sourceProductReleaseId').equals(release.id!).first(),
      db.productProductions.where('currentProductReleaseId').equals(release.id!).first(),
    ])
    if (releasedBuild || sourceBuild || currentProduction) {
      throw new Error('[distribution] ProductRelease 已进入本地生产血缘，必须先处理引用它的 Production/Build')
    }

    const sessions = await db.productRuntimeSessions.where('productReleaseId').equals(release.id!).toArray()
    const sessionIds = sessions.map(row => row.id).filter((id): id is number => id != null)
    const releaseAssets = await db.productMediaAssets.where('productReleaseId').equals(release.id!).toArray()
    const sessionAssets = sessionIds.length
      ? await db.productMediaAssets.where('productRuntimeSessionId').anyOf(sessionIds).toArray()
      : []
    const mediaAssets = [...releaseAssets, ...sessionAssets]
    const mediaAssetIds = [...new Set(mediaAssets.map(row => row.id).filter((id): id is number => id != null))]
    const mediaBindings = mediaAssetIds.length
      ? await db.productMediaBlobs.where('mediaAssetId').anyOf(mediaAssetIds).toArray()
      : []
    const blobObjectIds = [...new Set(mediaBindings.map(row => row.blobObjectId))]

    await cascadeRegisteredReferences('productReleases', release.id!)
    await db.productReleases.delete(release.id!)
    return {
      source: release.distributionProvenance.source,
      deletedSessionCount: sessions.length,
      deletedMediaAssetCount: mediaAssetIds.length,
      deletedMediaBindingCount: mediaBindings.length,
      blobObjectIds,
    }
  })
  const reclaimedBlobObjectIds = await discardUnreferencedMediaBlobObjectsV1({
    scope,
    blobObjectIds: deleted.blobObjectIds,
  })
  const reclaimed = new Set(reclaimedBlobObjectIds)
  return {
    productReleaseId: input.productReleaseId,
    source: deleted.source,
    deletedSessionCount: deleted.deletedSessionCount,
    deletedMediaAssetCount: deleted.deletedMediaAssetCount,
    deletedMediaBindingCount: deleted.deletedMediaBindingCount,
    reclaimedBlobObjectIds,
    retainedBlobObjectIds: deleted.blobObjectIds.filter(id => !reclaimed.has(id)),
  }
}

async function importVerifiedProductDistributionV2(input: {
  scope: WorkspaceScope
  verified: Awaited<ReturnType<typeof verifiedBundle>>
  productionKeyPrefix: 'marketplace' | 'local-file'
  labelSuffix: string
  distributionProvenance: ProductReleaseMarketplaceProvenanceV1 | ProductReleaseLocalFileProvenanceV1
}): Promise<ProductRelease> {
  const { scope, verified, distributionProvenance } = input
  const { bundle, decodedMedia } = verified
  const stagedIds: number[] = []
  const blobObjects: Array<Awaited<ReturnType<typeof putMediaBlobObject>>> = []

  try {
    // Stage sequentially so a failure cannot race the scoped rollback while
    // sibling writes are still completing in the background.
    for (const item of decodedMedia) {
      const existed = await db.mediaBlobObjects
        .where('[workId+contentHash]').equals([scope.workId, item.asset.blobContentHash]).first()
      try {
        const row = await putMediaBlobObject({
          scope,
          data: item.data,
          mimeType: item.asset.mimeType,
          expectedContentHash: item.asset.blobContentHash,
          sanitizedSvg: item.sanitizedSvg,
        })
        if (!existed && row.id != null) stagedIds.push(row.id)
        blobObjects.push(row)
      } catch (cause) {
        const failed = !existed ? await db.mediaBlobObjects
          .where('[workId+contentHash]').equals([scope.workId, item.asset.blobContentHash]).first() : null
        if (failed?.id != null) stagedIds.push(failed.id)
        throw cause
      }
    }
    return await db.transaction('rw', scopeTransactionTables(
      db.productReleases,
      db.productMediaAssets,
      db.productMediaBlobs,
      db.mediaBlobObjects,
    ), async () => {
    const manifest = bundle.productRelease.manifest
    const productKey = manifest.runtimePackage.definition.productKey
    const productionKey = manifest.productionProvenance?.productionKey
      ?? `${input.productionKeyPrefix}:${productKey}:${bundle.productRelease.contentHash.slice(0, 16)}`
    let release = await db.productReleases.where('contentHash')
      .equals(bundle.productRelease.contentHash)
      .filter(row => row.workId === scope.workId)
      .first()
    if (release) {
      if (!await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })
        || release.productType !== manifest.productType || release.productionKey !== productionKey) {
        throw new Error('[distribution] 已有 ProductRelease 身份与分发包冲突')
      }
    } else {
      const prior = (await db.productReleases.where('workId').equals(scope.workId).toArray())
        .filter(row => row.productionKey === productionKey)
      const importedAt = distributionProvenance.importedAt
      const releaseRow = stampNewRecord(scope, 'productReleases', {
        projectId: scope.projectId,
        worldId: scope.worldId,
        workId: scope.workId,
        productionKey,
        productType: manifest.productType,
        worldReleaseId: null,
        version: Math.max(0, ...prior.map(candidate => candidate.version)) + 1,
        label: `${manifest.runtimePackage.definition.title} · ${input.labelSuffix}`,
        manifestJson: canonicalProductProductionJsonV2(manifest),
        contentHash: bundle.productRelease.contentHash,
        createdAt: importedAt,
        distributionProvenance,
      } satisfies ProductRelease, { owner: 'work' })
      const id = await db.productReleases.add(releaseRow) as number
      release = { ...releaseRow, id }
    }

    for (let index = 0; index < decodedMedia.length; index += 1) {
      const { asset } = decodedMedia[index]
      const existing = await db.productMediaAssets
        .where('[productReleaseId+assetKey+version]')
        .equals([release.id!, asset.assetKey, asset.version])
        .first()
      let assetId: number
      if (existing) {
        if (!await assertRecordInScope(scope, 'productMediaAssets', existing, { owner: 'work' })
          || existing.contentHash !== asset.contentHash
          || existing.mimeType !== asset.mimeType
          || existing.byteSize !== asset.byteSize
          || existing.ownerKind !== 'release'
          || existing.productRuntimeSessionId !== null
          || existing.productType !== manifest.productType) {
          throw new Error(`[distribution] 本地媒资版本冲突:${asset.assetKey}@${asset.version}`)
        }
        assetId = existing.id!
      } else {
        const { blobContentHash: _blobContentHash, ...frozenAsset } = asset
        const mediaRow = stampNewRecord(scope, 'productMediaAssets', {
          projectId: scope.projectId,
          worldId: scope.worldId,
          workId: scope.workId,
          ownerKind: 'release',
          productType: manifest.productType,
          productReleaseId: release.id!,
          productRuntimeSessionId: null,
          ...frozenAsset,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } satisfies ProductMediaAsset, { owner: 'work' })
        assetId = await db.productMediaAssets.add(mediaRow) as number
      }
      const existingBlob = await db.productMediaBlobs.where('mediaAssetId').equals(assetId).first()
      if (existingBlob) {
        if (!await assertRecordInScope(scope, 'productMediaBlobs', existingBlob, { owner: 'work' })
          || existingBlob.blobObjectId !== blobObjects[index].id) {
          throw new Error(`[distribution] 本地媒资二进制绑定冲突:${asset.assetKey}`)
        }
      } else {
        await db.productMediaBlobs.add(stampNewRecord(scope, 'productMediaBlobs', {
          projectId: scope.projectId,
          worldId: scope.worldId,
          workId: scope.workId,
          mediaAssetId: assetId,
          blobObjectId: blobObjects[index].id!,
          data: null,
          createdAt: Date.now(),
        } satisfies ProductMediaBlob, { owner: 'work' }))
      }
    }

      return release
    })
  } catch (cause) {
    await discardUnreferencedMediaBlobObjectsV1({ scope, blobObjectIds: stagedIds }).catch(() => undefined)
    throw cause
  }
}

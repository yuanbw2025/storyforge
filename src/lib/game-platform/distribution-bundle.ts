import { db } from '../db/schema'
import {
  canonicalGameProductionJsonV2,
  hashGameProductionValueV2,
  isSha256Hash,
} from '../game-production/hash'
import {
  putMediaBlobObject,
  sha256MediaData,
} from '../game-production/media-blob-store'
import { readProductReleaseMediaBytes } from '../game-production/release-media'
import { verifyGameReleaseManifestV2 } from '../game-production/runtime-package'
import type {
  FrozenRuntimeMediaAssetV2,
  GameRelease,
  GameReleaseManifestV2,
  ProductMediaAsset,
  ProductMediaBlob,
  WorkspaceScope,
} from '../types'
import { assertGameReleaseUnchanged } from '../text-game/releases'
import {
  assertRecordInScope,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from '../world-engine/scope'

export interface GameDistributionMediaV2 {
  asset: FrozenRuntimeMediaAssetV2
  dataBase64: string
}

/**
 * Self-contained upper-product distribution contract.
 *
 * The source world is provenance only. A distribution package never embeds,
 * recreates or dereferences WorldRelease tables; runtime truth is the frozen
 * GameRelease manifest and its product-owned media.
 */
export interface GameDistributionBundleV2 {
  schema: 'storyforge.game-distribution-bundle'
  version: 2
  gameRelease: { contentHash: string; manifest: GameReleaseManifestV2 }
  sourceWorld: { contentHash: string }
  media: GameDistributionMediaV2[]
  bundleHash: string
}

export interface MarketplaceImportProvenanceV2 {
  listingId: string
  orderId: string | null
  entitlementId: string | null
  license: NonNullable<GameRelease['distributionProvenance']>['license']
  attribution: string[]
  localCopyPreserved: boolean
  acquiredAt: number
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
  bundle: GameDistributionBundleV2
  decodedMedia: Array<{ asset: FrozenRuntimeMediaAssetV2; data: ArrayBuffer }>
}> {
  const raw = record(value, 'bundle')
  exactKeys(raw, ['schema', 'version', 'gameRelease', 'sourceWorld', 'media', 'bundleHash'], 'bundle')
  if (raw.schema !== 'storyforge.game-distribution-bundle'
    || raw.version !== 2
    || !isSha256Hash(raw.bundleHash)
    || !Array.isArray(raw.media)) {
    throw new Error('[distribution] 分发包结构无效')
  }
  const game = record(raw.gameRelease, 'gameRelease')
  const sourceWorld = record(raw.sourceWorld, 'sourceWorld')
  exactKeys(game, ['contentHash', 'manifest'], 'gameRelease')
  exactKeys(sourceWorld, ['contentHash'], 'sourceWorld')
  if (!isSha256Hash(game.contentHash) || !isSha256Hash(sourceWorld.contentHash)) {
    throw new Error('[distribution] Release contentHash 无效')
  }
  const gameManifest = await verifyGameReleaseManifestV2(game.manifest)
  if (await hashGameProductionValueV2(gameManifest) !== game.contentHash) {
    throw new Error('[distribution] GameRelease contentHash 不一致')
  }
  if (gameManifest.sourceWorldRelease.contentHash !== sourceWorld.contentHash) {
    throw new Error('[distribution] GameRelease 世界来源证明不一致')
  }

  const expectedAssets = gameManifest.runtimePackage.presentation?.assets ?? []
  if (raw.media.length !== expectedAssets.length) {
    throw new Error('[distribution] 分发媒资数量不闭合')
  }
  const expectedByKey = new Map(
    expectedAssets.map(asset => [`${asset.assetKey}\u0000${asset.version}`, asset]),
  )
  const decodedMedia: Array<{ asset: FrozenRuntimeMediaAssetV2; data: ArrayBuffer }> = []
  let totalBytes = 0
  for (const item of raw.media) {
    const media = record(item, 'media')
    exactKeys(media, ['asset', 'dataBase64'], 'media')
    const asset = media.asset as FrozenRuntimeMediaAssetV2
    const expected = expectedByKey.get(`${asset?.assetKey}\u0000${asset?.version}`)
    if (!expected || canonicalGameProductionJsonV2(asset) !== canonicalGameProductionJsonV2(expected)) {
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
    decodedMedia.push({ asset: structuredClone(asset), data })
    expectedByKey.delete(`${asset.assetKey}\u0000${asset.version}`)
  }
  if (expectedByKey.size) {
    throw new Error('[distribution] RuntimePackage 媒资未完整交付')
  }
  const payload = {
    schema: raw.schema,
    version: raw.version,
    gameRelease: { contentHash: game.contentHash, manifest: gameManifest },
    sourceWorld: { contentHash: sourceWorld.contentHash },
    media: raw.media,
  }
  if (await hashGameProductionValueV2(payload) !== raw.bundleHash) {
    throw new Error('[distribution] 分发包 bundleHash 不一致')
  }
  return {
    bundle: { ...payload, bundleHash: raw.bundleHash } as GameDistributionBundleV2,
    decodedMedia,
  }
}

export async function verifyGameDistributionBundleV2(value: unknown): Promise<GameDistributionBundleV2> {
  return (await verifiedBundle(value)).bundle
}

export async function exportGameDistributionBundleV2(input: {
  scope: WorkspaceScope
  gameReleaseId: number
}): Promise<GameDistributionBundleV2> {
  const scope = await resolveScope({ scope: input.scope })
  const release = await db.gameReleases.get(input.gameReleaseId)
  if (!release || !await assertRecordInScope(scope, 'gameReleases', release, { owner: 'work' })) {
    throw new Error('[distribution] GameRelease 不存在或跨 Work')
  }
  await assertGameReleaseUnchanged(release.id!)
  const manifest = await verifyGameReleaseManifestV2(release.manifestJson)
  const media: GameDistributionMediaV2[] = []
  for (const asset of manifest.runtimePackage.presentation?.assets ?? []) {
    const data = await readProductReleaseMediaBytes({ scope, asset })
    media.push({ asset: structuredClone(asset), dataBase64: encodeBase64(data) })
  }
  const payload = {
    schema: 'storyforge.game-distribution-bundle' as const,
    version: 2 as const,
    gameRelease: { contentHash: release.contentHash, manifest },
    sourceWorld: { contentHash: manifest.sourceWorldRelease.contentHash },
    media,
  }
  const bundle = { ...payload, bundleHash: await hashGameProductionValueV2(payload) }
  await verifyGameDistributionBundleV2(bundle)
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

export async function importMarketplaceGameDistributionV2(input: {
  scope: WorkspaceScope
  bundle: unknown
  provenance: MarketplaceImportProvenanceV2
}): Promise<GameRelease> {
  const scope = await resolveScope({ scope: input.scope })
  const { bundle, decodedMedia } = await verifiedBundle(input.bundle)
  const provenance = validateProvenance(input.provenance)
  const blobObjects = await Promise.all(decodedMedia.map(item => putMediaBlobObject({
    scope,
    data: item.data,
    mimeType: item.asset.mimeType,
    expectedContentHash: item.asset.blobContentHash,
  })))

  return db.transaction('rw', scopeTransactionTables(
    db.gameReleases,
    db.productMediaAssets,
    db.productMediaBlobs,
    db.mediaBlobObjects,
  ), async () => {
    for (let index = 0; index < decodedMedia.length; index += 1) {
      const { asset } = decodedMedia[index]
      const existing = await db.productMediaAssets
        .where('[workId+assetKey+version]')
        .equals([scope.workId, asset.assetKey, asset.version])
        .first()
      let assetId: number
      if (existing) {
        if (!await assertRecordInScope(scope, 'productMediaAssets', existing, { owner: 'work' })
          || existing.contentHash !== asset.contentHash
          || existing.mimeType !== asset.mimeType
          || existing.byteSize !== asset.byteSize) {
          throw new Error(`[distribution] 本地媒资版本冲突:${asset.assetKey}@${asset.version}`)
        }
        assetId = existing.id!
      } else {
        const { blobContentHash: _blobContentHash, ...frozenAsset } = asset
        const mediaRow = stampNewRecord(scope, 'productMediaAssets', {
          projectId: scope.projectId,
          worldId: scope.worldId,
          workId: scope.workId,
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

    const existingRelease = await db.gameReleases.where('contentHash')
      .equals(bundle.gameRelease.contentHash)
      .filter(row => row.workId === scope.workId)
      .first()
    if (existingRelease) return existingRelease

    const manifest = bundle.gameRelease.manifest
    const gameKey = manifest.runtimePackage.definition.gameKey
    const productionKey = manifest.productionProvenance?.productionKey
      ?? `marketplace:${gameKey}:${bundle.gameRelease.contentHash.slice(0, 16)}`
    const prior = (await db.gameReleases.where('workId').equals(scope.workId).toArray())
      .filter(row => row.productionKey === productionKey)
    const importedAt = Date.now()
    const releaseRow = stampNewRecord(scope, 'gameReleases', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      productionKey,
      worldReleaseId: null,
      version: Math.max(0, ...prior.map(release => release.version)) + 1,
      label: `${manifest.runtimePackage.definition.title} · 市场副本`,
      manifestJson: canonicalGameProductionJsonV2(manifest),
      contentHash: bundle.gameRelease.contentHash,
      createdAt: importedAt,
      distributionProvenance: {
        source: 'marketplace' as const,
        ...provenance,
        importedAt,
      },
    } satisfies GameRelease, { owner: 'work' })
    const id = await db.gameReleases.add(releaseRow) as number
    return { ...releaseRow, id }
  })
}

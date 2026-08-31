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
import { verifyGameReleaseManifestV2 } from '../game-production/runtime-package'
import { readAvgReleaseMediaBytes } from '../avg/media'
import { NARRATIVE_MODULE_KINDS } from '../types'
import { WORLD_CAPABILITY_AREAS } from '../registry/types'
import type {
  FrozenRuntimeMediaAssetV2,
  GameRelease,
  GameReleaseManifestV2,
  WorldReleaseManifestV2,
  WorkspaceScope,
} from '../types'
import { assertGameReleaseUnchanged } from '../text-game/releases'
import {
  assertRecordInScope,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from '../world-engine/scope'

export interface GameDistributionMediaV1 {
  asset: FrozenRuntimeMediaAssetV2
  dataBase64: string
}

export interface GameDistributionBundleV1 {
  schema: 'storyforge.game-distribution-bundle'
  version: 1
  gameRelease: { contentHash: string; manifest: GameReleaseManifestV2 }
  worldRelease: { contentHash: string; manifest: WorldReleaseManifestV2 }
  media: GameDistributionMediaV1[]
  bundleHash: string
}

export interface MarketplaceImportProvenanceV1 {
  listingId: string
  orderId: string | null
  entitlementId: string | null
  license: NonNullable<GameRelease['distributionProvenance']>['license']
  attribution: string[]
  localCopyPreserved: boolean
  acquiredAt: number
}

const MAXIMUM_DISTRIBUTION_BYTES = 256 * 1024 * 1024

function legacyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${legacyJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function legacyHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(legacyJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function encodeBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function decodeBase64(value: unknown, expectedBytes: number): ArrayBuffer {
  if (typeof value !== 'string' || value.length > Math.ceil(expectedBytes / 3) * 4 + 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('[distribution] 媒资 base64 无效或超限')
  }
  let binary: string
  try { binary = atob(value) } catch { throw new Error('[distribution] 媒资 base64 无法解码') }
  if (binary.length !== expectedBytes) throw new Error('[distribution] 媒资解码大小与清单不一致')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
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

function boundedText(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`[distribution] ${label} 无效`)
  }
  return value
}

async function verifyWorldManifest(value: unknown, expectedContentHash: string): Promise<WorldReleaseManifestV2> {
  const raw = record(value, 'worldRelease.manifest')
  exactKeys(raw, [
    'schema', 'version', 'semanticContract', 'worldCode', 'worldName', 'workTitle',
    'selectedTables', 'selectedNarrativeModules', 'dependencies', 'records',
    'portableProject', 'capabilityProfile', 'resourceCatalog', 'sourceManifest',
  ], 'worldRelease.manifest')
  if (raw.schema !== 'storyforge.world-package' || raw.version !== 2 || raw.semanticContract !== 3
    || !Array.isArray(raw.selectedTables) || raw.selectedTables.length > 300
    || !Array.isArray(raw.selectedNarrativeModules) || raw.selectedNarrativeModules.length !== 0
    || !Array.isArray(raw.dependencies) || raw.dependencies.length > 300
    || !Array.isArray(raw.capabilityProfile)
    || !Array.isArray(raw.resourceCatalog) || raw.resourceCatalog.length > 300) {
    throw new Error('[distribution] WorldRelease manifest 结构无效')
  }
  boundedText(raw.worldCode, 'worldCode', 500)
  boundedText(raw.worldName, 'worldName')
  if (typeof raw.workTitle !== 'string' || raw.workTitle.length > 2_000) {
    throw new Error('[distribution] workTitle 无效')
  }
  const selectedTables = raw.selectedTables.map((name, index) => boundedText(name, `selectedTables[${index}]`, 200))
  if (new Set(selectedTables).size !== selectedTables.length) {
    throw new Error('[distribution] selectedTables 不能重复')
  }
  const records = record(raw.records, 'records')
  if (Object.keys(records).length !== selectedTables.length
    || Object.keys(records).some(name => !selectedTables.includes(name))
    || Object.entries(records).some(([, rows]) => !Array.isArray(rows) || rows.length > 1_000_000)) {
    throw new Error('[distribution] WorldRelease records 与 selectedTables 不闭合')
  }
  const dependencyNames = new Set<string>()
  for (let index = 0; index < raw.dependencies.length; index += 1) {
    const dependency = record(raw.dependencies[index], `dependencies[${index}]`)
    exactKeys(dependency, ['table', 'rowCount', 'contentHash'], `dependencies[${index}]`)
    const table = boundedText(dependency.table, `dependencies[${index}].table`, 200)
    if (!selectedTables.includes(table) || dependencyNames.has(table)
      || !Number.isInteger(dependency.rowCount) || Number(dependency.rowCount) < 0
      || !isSha256Hash(dependency.contentHash)) {
      throw new Error('[distribution] WorldRelease dependency 无效')
    }
    const rows = records[table] as unknown[]
    if (rows.length !== dependency.rowCount || await legacyHash(rows) !== dependency.contentHash) {
      throw new Error(`[distribution] WorldRelease dependency 哈希不一致:${table}`)
    }
    dependencyNames.add(table)
  }
  if (dependencyNames.size !== selectedTables.length) {
    throw new Error('[distribution] WorldRelease dependencies 不完整')
  }
  // semanticContract=3 never carries executable narrative modules. Keep the
  // kind import exercised as an explicit legacy-schema guard rather than
  // silently accepting a future product graph here.
  if (raw.selectedNarrativeModules.some(item => (
    !NARRATIVE_MODULE_KINDS.includes(record(item, 'selectedNarrativeModules').kind as typeof NARRATIVE_MODULE_KINDS[number])
  ))) {
    throw new Error('[distribution] selectedNarrativeModules 无效')
  }

  const capabilityAreas = new Set<string>()
  for (let index = 0; index < raw.capabilityProfile.length; index += 1) {
    const item = record(raw.capabilityProfile[index], `capabilityProfile[${index}]`)
    exactKeys(item, [
      'area', 'resourceCount', 'rowCount', 'status', 'selectionStatus',
      'selectedResourceCount', 'omittedResourceCount', 'confirmedRowCount',
      'candidateRowCount', 'conflictRowCount', 'omittedRowCount', 'latestRevision',
      'originalEvidenceAvailable', 'queryableIndexAvailable',
    ], `capabilityProfile[${index}]`)
    const area = boundedText(item.area, `capabilityProfile[${index}].area`, 100)
    const numericFields = [
      'resourceCount', 'rowCount', 'selectedResourceCount', 'omittedResourceCount',
      'confirmedRowCount', 'candidateRowCount', 'conflictRowCount', 'omittedRowCount',
    ]
    if (!WORLD_CAPABILITY_AREAS.includes(area as typeof WORLD_CAPABILITY_AREAS[number])
      || capabilityAreas.has(area)
      || numericFields.some(field => !Number.isInteger(item[field]) || Number(item[field]) < 0)
      || !['missing', 'partial', 'available'].includes(String(item.status))
      || !['selected', 'partial-selection', 'omitted'].includes(String(item.selectionStatus))
      || (item.latestRevision != null && (!Number.isFinite(item.latestRevision) || Number(item.latestRevision) < 0))
      || typeof item.originalEvidenceAvailable !== 'boolean'
      || typeof item.queryableIndexAvailable !== 'boolean') {
      throw new Error('[distribution] capabilityProfile 无效')
    }
    capabilityAreas.add(area)
  }
  if (capabilityAreas.size !== WORLD_CAPABILITY_AREAS.length) {
    throw new Error('[distribution] capabilityProfile 不完整')
  }

  const resourceIds = new Set<string>()
  const resourceTables = new Set<string>()
  for (let index = 0; index < raw.resourceCatalog.length; index += 1) {
    const item = record(raw.resourceCatalog[index], `resourceCatalog[${index}]`)
    exactKeys(item, [
      'resourceId', 'resourceKind', 'area', 'table', 'rowCount', 'contentHash',
      'confirmedRowCount', 'candidateRowCount', 'conflictRowCount',
      'omittedRowCount', 'latestRevision',
    ], `resourceCatalog[${index}]`)
    const resourceId = boundedText(item.resourceId, `resourceCatalog[${index}].resourceId`, 1_000)
    const table = boundedText(item.table, `resourceCatalog[${index}].table`, 200)
    const area = boundedText(item.area, `resourceCatalog[${index}].area`, 100)
    boundedText(item.resourceKind, `resourceCatalog[${index}].resourceKind`, 200)
    const dependency = raw.dependencies.find(candidate => (
      record(candidate, 'dependency').table === table
    )) as Record<string, unknown> | undefined
    const countFields = ['rowCount', 'confirmedRowCount', 'candidateRowCount', 'conflictRowCount', 'omittedRowCount']
    if (resourceIds.has(resourceId) || resourceTables.has(table) || !selectedTables.includes(table)
      || !WORLD_CAPABILITY_AREAS.includes(area as typeof WORLD_CAPABILITY_AREAS[number])
      || countFields.some(field => !Number.isInteger(item[field]) || Number(item[field]) < 0)
      || !isSha256Hash(item.contentHash)
      || dependency?.contentHash !== item.contentHash || dependency?.rowCount !== item.rowCount
      || (item.latestRevision != null && (!Number.isFinite(item.latestRevision) || Number(item.latestRevision) < 0))) {
      throw new Error('[distribution] resourceCatalog 无效')
    }
    resourceIds.add(resourceId)
    resourceTables.add(table)
  }
  if (resourceTables.size !== selectedTables.length) {
    throw new Error('[distribution] resourceCatalog 与 selectedTables 不闭合')
  }

  const sourceManifest = record(raw.sourceManifest, 'sourceManifest')
  exactKeys(sourceManifest, [
    'sourceKind', 'sourceWorkspaceUid', 'sourceWorldCode', 'sourceWorkCode',
    'selectedResourceIds', 'omittedResourceIds', 'contentHash',
  ], 'sourceManifest')
  if (!['world-draft', 'independent-work-derivation'].includes(String(sourceManifest.sourceKind))
    || boundedText(sourceManifest.sourceWorldCode, 'sourceManifest.sourceWorldCode', 500) !== raw.worldCode
    || !Array.isArray(sourceManifest.selectedResourceIds)
    || !Array.isArray(sourceManifest.omittedResourceIds)
    || !isSha256Hash(sourceManifest.contentHash)) {
    throw new Error('[distribution] sourceManifest 无效')
  }
  boundedText(sourceManifest.sourceWorkspaceUid, 'sourceManifest.sourceWorkspaceUid', 1_000)
  boundedText(sourceManifest.sourceWorkCode, 'sourceManifest.sourceWorkCode', 1_000)
  const selectedResourceIds = sourceManifest.selectedResourceIds.map((item, index) => (
    boundedText(item, `sourceManifest.selectedResourceIds[${index}]`, 1_000)
  ))
  const omittedResourceIds = sourceManifest.omittedResourceIds.map((item, index) => (
    boundedText(item, `sourceManifest.omittedResourceIds[${index}]`, 1_000)
  ))
  if (new Set(selectedResourceIds).size !== selectedResourceIds.length
    || new Set(omittedResourceIds).size !== omittedResourceIds.length
    || selectedResourceIds.some(item => omittedResourceIds.includes(item))
    || resourceIds.size !== selectedResourceIds.length
    || selectedResourceIds.some(item => !resourceIds.has(item))) {
    throw new Error('[distribution] sourceManifest 资源集合不闭合')
  }
  const { contentHash: _sourceHash, ...sourceManifestBody } = sourceManifest
  if (await legacyHash(sourceManifestBody) !== sourceManifest.contentHash) {
    throw new Error('[distribution] sourceManifest contentHash 不一致')
  }
  record(raw.portableProject, 'portableProject')
  // Reject non-JSON numbers, undefined, cycles, sparse arrays and ambiguous Unicode keys
  // before the legacy WorldRelease hash is evaluated.
  canonicalGameProductionJsonV2(raw)
  if (await legacyHash(raw) !== expectedContentHash) {
    throw new Error('[distribution] WorldRelease contentHash 不一致')
  }
  return structuredClone(raw) as unknown as WorldReleaseManifestV2
}

async function verifiedBundle(value: unknown): Promise<{
  bundle: GameDistributionBundleV1
  decodedMedia: Array<{ asset: FrozenRuntimeMediaAssetV2; data: ArrayBuffer }>
}> {
  const raw = record(value, 'bundle')
  exactKeys(raw, ['schema', 'version', 'gameRelease', 'worldRelease', 'media', 'bundleHash'], 'bundle')
  if (raw.schema !== 'storyforge.game-distribution-bundle' || raw.version !== 1
    || !isSha256Hash(raw.bundleHash) || !Array.isArray(raw.media)) {
    throw new Error('[distribution] 分发包结构无效')
  }
  const game = record(raw.gameRelease, 'gameRelease')
  const world = record(raw.worldRelease, 'worldRelease')
  exactKeys(game, ['contentHash', 'manifest'], 'gameRelease')
  exactKeys(world, ['contentHash', 'manifest'], 'worldRelease')
  if (!isSha256Hash(game.contentHash) || !isSha256Hash(world.contentHash)) {
    throw new Error('[distribution] Release contentHash 无效')
  }
  const gameManifest = await verifyGameReleaseManifestV2(game.manifest)
  if (await hashGameProductionValueV2(gameManifest) !== game.contentHash) {
    throw new Error('[distribution] GameRelease contentHash 不一致')
  }
  const worldManifest = await verifyWorldManifest(world.manifest, world.contentHash)
  if (gameManifest.sourceWorldRelease.contentHash !== world.contentHash) {
    throw new Error('[distribution] WorldRelease 无效或未被 GameRelease 绑定')
  }
  const expectedAssets = gameManifest.runtimePackage.presentation?.assets ?? []
  if (raw.media.length !== expectedAssets.length) throw new Error('[distribution] 分发媒资数量不闭合')
  const expectedByKey = new Map(expectedAssets.map(asset => [`${asset.assetKey}\u0000${asset.version}`, asset]))
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
    if (!Number.isInteger(asset.byteSize) || asset.byteSize < 1) throw new Error('[distribution] 媒资 byteSize 无效')
    totalBytes += asset.byteSize
    if (totalBytes > MAXIMUM_DISTRIBUTION_BYTES) throw new Error('[distribution] 分发包媒资超过 256MiB')
    const data = decodeBase64(media.dataBase64, asset.byteSize)
    if (await sha256MediaData(data) !== asset.blobContentHash || asset.contentHash !== asset.blobContentHash) {
      throw new Error(`[distribution] 媒资哈希不一致:${asset.assetKey}`)
    }
    decodedMedia.push({ asset: structuredClone(asset), data })
    expectedByKey.delete(`${asset.assetKey}\u0000${asset.version}`)
  }
  if (expectedByKey.size) throw new Error('[distribution] RuntimePackage 媒资未完整交付')
  const payload = {
    schema: raw.schema,
    version: raw.version,
    gameRelease: { contentHash: game.contentHash, manifest: gameManifest },
    worldRelease: { contentHash: world.contentHash, manifest: worldManifest },
    media: raw.media,
  }
  if (await hashGameProductionValueV2(payload) !== raw.bundleHash) {
    throw new Error('[distribution] 分发包 bundleHash 不一致')
  }
  return {
    bundle: { ...payload, bundleHash: raw.bundleHash } as GameDistributionBundleV1,
    decodedMedia,
  }
}

export async function verifyGameDistributionBundleV1(value: unknown): Promise<GameDistributionBundleV1> {
  return (await verifiedBundle(value)).bundle
}

export async function exportGameDistributionBundleV1(input: {
  scope: WorkspaceScope
  gameReleaseId: number
}): Promise<GameDistributionBundleV1> {
  const scope = await resolveScope({ scope: input.scope })
  const release = await db.gameReleases.get(input.gameReleaseId)
  if (!release || !await assertRecordInScope(scope, 'gameReleases', release, { owner: 'work' })) {
    throw new Error('[distribution] GameRelease 不存在或跨 Work')
  }
  await assertGameReleaseUnchanged(release.id!)
  const manifest = await verifyGameReleaseManifestV2(release.manifestJson)
  const worldRelease = await db.worldReleases.get(release.worldReleaseId)
  if (!worldRelease || !await assertRecordInScope(scope, 'worldReleases', worldRelease, { owner: 'world' })) {
    throw new Error('[distribution] GameRelease 绑定的 WorldRelease 不存在或跨 World')
  }
  const worldManifest = JSON.parse(worldRelease.manifestJson) as WorldReleaseManifestV2
  const media: GameDistributionMediaV1[] = []
  for (const asset of manifest.runtimePackage.presentation?.assets ?? []) {
    const data = await readAvgReleaseMediaBytes({ scope, asset })
    media.push({ asset: structuredClone(asset), dataBase64: encodeBase64(data) })
  }
  const payload = {
    schema: 'storyforge.game-distribution-bundle' as const,
    version: 1 as const,
    gameRelease: { contentHash: release.contentHash, manifest },
    worldRelease: { contentHash: worldRelease.contentHash, manifest: worldManifest },
    media,
  }
  const bundle = { ...payload, bundleHash: await hashGameProductionValueV2(payload) }
  await verifyGameDistributionBundleV1(bundle)
  return bundle
}

function validateProvenance(value: MarketplaceImportProvenanceV1): MarketplaceImportProvenanceV1 {
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
    || value.localCopyPreserved !== true || !Number.isInteger(value.acquiredAt) || value.acquiredAt < 0
    || !Array.isArray(value.attribution) || value.attribution.length > 100
    || !/^listing\.[A-Za-z0-9._:-]+$/.test(value.listingId)
    || (value.orderId != null && !/^order\.[A-Za-z0-9._:-]+$/.test(value.orderId))
    || (value.entitlementId != null && !/^entitlement\.[A-Za-z0-9._:-]+$/.test(value.entitlementId))
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.license.licenseId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.license.licenseVersion)) {
    throw new Error('[distribution] 市场导入许可或来源回执无效')
  }
  let termsUrl: URL
  try { termsUrl = new URL(value.license.termsUrl) } catch {
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

export async function importMarketplaceGameDistributionV1(input: {
  scope: WorkspaceScope
  bundle: unknown
  provenance: MarketplaceImportProvenanceV1
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
    db.worldRevisions, db.worldReleases, db.gameReleases,
    db.avgMediaAssets, db.avgMediaBlobs, db.mediaBlobObjects,
  ), async () => {
    for (let index = 0; index < decodedMedia.length; index += 1) {
      const { asset } = decodedMedia[index]
      const existing = await db.avgMediaAssets.where('[workId+assetKey+version]')
        .equals([scope.workId, asset.assetKey, asset.version]).first()
      let assetId: number
      if (existing) {
        if (!await assertRecordInScope(scope, 'avgMediaAssets', existing, { owner: 'work' })
          || existing.contentHash !== asset.contentHash || existing.mimeType !== asset.mimeType
          || existing.byteSize !== asset.byteSize) {
          throw new Error(`[distribution] 本地媒资版本冲突:${asset.assetKey}@${asset.version}`)
        }
        assetId = existing.id!
      } else {
        const { blobContentHash: _blobContentHash, ...frozenAsset } = asset
        const row = stampNewRecord(scope, 'avgMediaAssets', {
          projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
          ...frozenAsset, createdAt: Date.now(), updatedAt: Date.now(),
        }, { owner: 'work' })
        assetId = await db.avgMediaAssets.add(row) as number
      }
      const existingBlob = await db.avgMediaBlobs.where('mediaAssetId').equals(assetId).first()
      if (existingBlob) {
        if (existingBlob.blobObjectId !== blobObjects[index].id) {
          throw new Error(`[distribution] 本地媒资二进制绑定冲突:${asset.assetKey}`)
        }
      } else {
        await db.avgMediaBlobs.add(stampNewRecord(scope, 'avgMediaBlobs', {
          projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
          mediaAssetId: assetId, blobObjectId: blobObjects[index].id!, data: null, createdAt: Date.now(),
        }, { owner: 'work' }))
      }
    }

    let worldRelease = await db.worldReleases.where('contentHash').equals(bundle.worldRelease.contentHash)
      .filter(row => row.worldId === scope.worldId).first()
    if (!worldRelease) {
      const revisionNumber = Math.max(0, ...(await db.worldRevisions.where('worldId').equals(scope.worldId).toArray())
        .map(row => row.revision)) + 1
      const now = Date.now()
      const revisionId = await db.worldRevisions.add(stampNewRecord(scope, 'worldRevisions', {
        projectId: scope.projectId, worldId: scope.worldId, parentRevisionId: null,
        revision: revisionNumber, label: `市场来源 · ${bundle.worldRelease.manifest.worldName}`,
        manifestJson: legacyJson(bundle.worldRelease.manifest),
        contentHash: bundle.worldRelease.contentHash, createdAt: now, updatedAt: now,
      }, { owner: 'world' })) as number
      const version = Math.max(0, ...(await db.worldReleases.where('worldId').equals(scope.worldId).toArray())
        .map(row => row.version)) + 1
      const id = await db.worldReleases.add(stampNewRecord(scope, 'worldReleases', {
        projectId: scope.projectId, worldId: scope.worldId, revisionId, version,
        label: `市场来源 · ${bundle.worldRelease.manifest.worldName}`,
        manifestJson: legacyJson(bundle.worldRelease.manifest),
        contentHash: bundle.worldRelease.contentHash,
        sourceWorldCode: bundle.worldRelease.manifest.worldCode,
        createdAt: now,
      }, { owner: 'world' })) as number
      worldRelease = (await db.worldReleases.get(id))!
    }
    const existingRelease = await db.gameReleases.where('contentHash').equals(bundle.gameRelease.contentHash)
      .filter(row => row.workId === scope.workId).first()
    if (existingRelease) return existingRelease
    const gameKey = bundle.gameRelease.manifest.runtimePackage.definition.gameKey
    const prior = (await db.gameReleases.where('workId').equals(scope.workId).toArray()).filter(row => {
      try {
        const manifest = JSON.parse(row.manifestJson) as { runtimePackage?: { definition?: { gameKey?: string } } }
        return manifest.runtimePackage?.definition?.gameKey === gameKey
      } catch { return false }
    })
    const importedAt = Date.now()
    const row = stampNewRecord(scope, 'gameReleases', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      gameDefinitionId: null, worldReleaseId: worldRelease.id!,
      version: Math.max(0, ...prior.map(release => release.version)) + 1,
      label: `${bundle.gameRelease.manifest.runtimePackage.definition.title} · 市场副本`,
      manifestJson: canonicalGameProductionJsonV2(bundle.gameRelease.manifest),
      contentHash: bundle.gameRelease.contentHash, createdAt: importedAt,
      distributionProvenance: {
        source: 'marketplace' as const,
        ...provenance,
        importedAt,
      },
    } satisfies GameRelease, { owner: 'work' })
    const id = await db.gameReleases.add(row) as number
    return { ...row, id }
  })
}

import { db } from '../db/schema'
import type { ProductMediaAsset, ProductMediaBlob, ProductMediaKind, WorkspaceScope } from '../types'
import { PRODUCT_MEDIA_KINDS } from '../types'
import { sanitizeSvg } from '../utils/sanitize-svg'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../world-engine/scope'
import { sha256BinaryV1 } from '../media/blob-store'
import { putMediaBlobObject } from './media-blob-store'

const STABLE_ASSET_KEY = /^[a-zA-Z0-9._:-]+$/

function assetKey(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 200 || !STABLE_ASSET_KEY.test(normalized)) {
    throw new Error('[media-asset-library] assetKey 无效')
  }
  return normalized
}

/**
 * Product-owned media asset import boundary shared by production and runtime
 * media workers. The function owns bytes and versions for the current Work; it
 * has no dependency on a world draft or WorldRelease physical manifest.
 */
export async function importProductMediaAssetV1(input: {
  scope: WorkspaceScope
  assetKey: string
  kind: ProductMediaKind
  name: string
  blob: Blob
  altText?: string
  source?: string
  license?: string
  width?: number | null
  height?: number | null
  durationMs?: number | null
  characterTag?: string
  sceneTag?: string
  forceLatest?: boolean
}): Promise<ProductMediaAsset> {
  const scope = await resolveScope({ scope: input.scope })
  const stableKey = assetKey(input.assetKey)
  if (!PRODUCT_MEDIA_KINDS.includes(input.kind) || !input.name.trim() || input.blob.size > 100 * 1024 * 1024) {
    throw new Error('[media-asset-library] 媒资输入无效或超过 100MB')
  }
  const rawData = await input.blob.arrayBuffer()
  const isSvg = input.blob.type.toLowerCase() === 'image/svg+xml'
  const data = isSvg
    ? (() => {
        const sanitized = sanitizeSvg(new TextDecoder().decode(rawData))
        if (!sanitized) throw new Error('[media-asset-library] SVG 媒资无法安全解析')
        return new TextEncoder().encode(sanitized).buffer
      })()
    : rawData
  const contentHash = await sha256BinaryV1(data)
  const existing = await db.productMediaAssets.where('workId').equals(scope.workId)
    .filter(row => row.assetKey === stableKey).toArray()
  const duplicate = existing.find(row => row.contentHash === contentHash)
  const latestVersion = Math.max(0, ...existing.map(row => row.version))
  if (duplicate && (!input.forceLatest || duplicate.version === latestVersion)) return duplicate

  const blobObject = await putMediaBlobObject({
    scope,
    data,
    mimeType: input.blob.type.toLowerCase() || 'application/octet-stream',
    expectedContentHash: contentHash,
    sanitizedSvg: isSvg,
  })
  const version = latestVersion + 1
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(db.productMediaAssets, db.productMediaBlobs, db.mediaBlobObjects), async () => {
    const currentBlobObject = await db.mediaBlobObjects.get(blobObject.id!)
    if (!currentBlobObject || currentBlobObject.workId !== scope.workId || currentBlobObject.storageState !== 'ready') {
      throw new Error('[media-asset-library] 共享媒资在绑定前丢失或不可用')
    }
    const row = stampNewRecord(scope, 'productMediaAssets', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      assetKey: stableKey,
      version,
      kind: input.kind,
      name: input.name.trim(),
      mimeType: input.blob.type.toLowerCase() || 'application/octet-stream',
      byteSize: data.byteLength,
      width: input.width ?? null,
      height: input.height ?? null,
      durationMs: input.durationMs ?? null,
      contentHash,
      source: input.source?.trim() ?? '',
      license: input.license?.trim() ?? '',
      altText: input.altText?.trim() ?? '',
      characterTag: input.characterTag?.trim() ?? '',
      sceneTag: input.sceneTag?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    } satisfies ProductMediaAsset, { owner: 'work' })
    const id = await db.productMediaAssets.add(row) as number
    await db.productMediaBlobs.add(stampNewRecord(scope, 'productMediaBlobs', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      mediaAssetId: id,
      blobObjectId: currentBlobObject.id!,
      data: null,
      createdAt: now,
    } satisfies ProductMediaBlob, { owner: 'work' }))
    return { ...row, id }
  })
}

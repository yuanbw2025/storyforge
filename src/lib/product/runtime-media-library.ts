import { db } from '../db/schema'
import type { ProductMediaAsset, ProductMediaBlob, ProductMediaKind, WorkspaceScope } from '../types'
import { PRODUCT_MEDIA_KINDS } from '../types'
import { sanitizeSvg } from '../utils/sanitize-svg'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { sha256BinaryV1 } from '../media/blob-store'
import { putMediaBlobObject } from '../product-production/media-blob-store'

const STABLE_ASSET_KEY = /^[a-zA-Z0-9._:-]+$/

function assetKey(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 200 || !STABLE_ASSET_KEY.test(normalized)) {
    throw new Error('[product-runtime-media] assetKey 无效')
  }
  return normalized
}

/**
 * Runtime-owned media import boundary. Release media is materialized by the
 * ProductRelease publisher instead; runtime media can never leak into another
 * product instance merely because both instances share one Work.
 */
export async function importProductRuntimeMediaAssetV1(input: {
  scope: WorkspaceScope
  productRuntimeSessionId: number
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
  const session = await db.productRuntimeSessions.get(input.productRuntimeSessionId)
  if (!session || session.workId !== scope.workId || session.worldId !== scope.worldId
    || session.projectId !== scope.projectId || session.status === 'archived') {
    throw new Error('[product-runtime-media] 运行实例不存在、已归档或不属于当前 Work')
  }
  const stableKey = assetKey(input.assetKey)
  if (!PRODUCT_MEDIA_KINDS.includes(input.kind) || !input.name.trim() || input.blob.size > 100 * 1024 * 1024) {
    throw new Error('[product-runtime-media] 媒资输入无效或超过 100MB')
  }
  const rawData = await input.blob.arrayBuffer()
  const isSvg = input.blob.type.toLowerCase() === 'image/svg+xml'
  const data = isSvg
    ? (() => {
        const sanitized = sanitizeSvg(new TextDecoder().decode(rawData))
        if (!sanitized) throw new Error('[product-runtime-media] SVG 媒资无法安全解析')
        return new TextEncoder().encode(sanitized).buffer
      })()
    : rawData
  const contentHash = await sha256BinaryV1(data)
  const existing = await db.productMediaAssets
    .where('productRuntimeSessionId').equals(input.productRuntimeSessionId)
    .filter(row => row.ownerKind === 'runtime' && row.assetKey === stableKey).toArray()
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
  return db.transaction('rw', scopeTransactionTables(
    db.productRuntimeSessions, db.productMediaAssets, db.productMediaBlobs, db.mediaBlobObjects,
  ), async () => {
    const currentSession = await db.productRuntimeSessions.get(input.productRuntimeSessionId)
    if (!currentSession || currentSession.workId !== scope.workId || currentSession.worldId !== scope.worldId
      || currentSession.projectId !== scope.projectId || currentSession.status === 'archived'
      || currentSession.kind !== session.kind) {
      throw new Error('[product-runtime-media] 运行实例在媒资绑定前失效')
    }
    const currentBlobObject = await db.mediaBlobObjects.get(blobObject.id!)
    if (!currentBlobObject || currentBlobObject.workId !== scope.workId || currentBlobObject.storageState !== 'ready') {
      throw new Error('[product-runtime-media] 内容寻址对象在绑定前丢失或不可用')
    }
    const row = stampNewRecord(scope, 'productMediaAssets', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      ownerKind: 'runtime',
      productType: currentSession.kind,
      productReleaseId: null,
      productRuntimeSessionId: currentSession.id!,
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

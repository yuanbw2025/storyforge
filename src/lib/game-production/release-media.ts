import { db } from '../db/schema'
import type { FrozenProductMediaAsset, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../world-engine/scope'
import { readProductMediaBlobData } from './media-blob-store'

function encodeBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

/** Resolve immutable product media through the product-owned binding and content-addressed object. */
export async function readProductReleaseMediaBytes(input: {
  scope: WorkspaceScope
  asset: Pick<FrozenProductMediaAsset, 'assetKey' | 'version' | 'contentHash' | 'mimeType' | 'byteSize'>
}): Promise<ArrayBuffer> {
  const scope = await resolveScope({ scope: input.scope })
  const asset = await db.productMediaAssets
    .where('[workId+assetKey+version]')
    .equals([scope.workId, input.asset.assetKey, input.asset.version])
    .first()
  if (!asset
    || !await assertRecordInScope(scope, 'productMediaAssets', asset, { owner: 'work' })
    || asset.contentHash !== input.asset.contentHash
    || asset.mimeType !== input.asset.mimeType
    || asset.byteSize !== input.asset.byteSize) {
    throw new Error(`[product-media] 冻结媒资版本缺失或元数据不匹配:${input.asset.assetKey}@${input.asset.version}`)
  }
  const blob = await db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).first()
  if (!blob || !await assertRecordInScope(scope, 'productMediaBlobs', blob, { owner: 'work' })) {
    throw new Error(`[product-media] 冻结媒资二进制缺失:${input.asset.assetKey}@${input.asset.version}`)
  }
  return readProductMediaBlobData({
    scope,
    blob,
    expected: {
      contentHash: input.asset.contentHash,
      byteSize: input.asset.byteSize,
      mimeType: input.asset.mimeType,
    },
  })
}

export async function readProductReleaseMediaDataUrl(input: {
  scope: WorkspaceScope
  asset: FrozenProductMediaAsset
}): Promise<string> {
  const data = await readProductReleaseMediaBytes(input)
  return `data:${input.asset.mimeType};base64,${encodeBase64(data)}`
}

export async function preloadProductReleaseMedia(input: {
  scope: WorkspaceScope
  assets: FrozenProductMediaAsset[]
  maximumBytes?: number
}): Promise<{
  urls: Record<string, string>
  failures: Array<{ assetKey: string; reason: string }>
}> {
  const maximumBytes = input.maximumBytes ?? 64 * 1024 * 1024
  const urls: Record<string, string> = {}
  const failures: Array<{ assetKey: string; reason: string }> = []
  let usedBytes = 0
  for (const asset of input.assets) {
    if (usedBytes + asset.byteSize > maximumBytes) {
      failures.push({ assetKey: asset.assetKey, reason: '预加载容量预算已满' })
      continue
    }
    try {
      urls[asset.assetKey] = await readProductReleaseMediaDataUrl({ scope: input.scope, asset })
      usedBytes += asset.byteSize
    } catch (cause) {
      failures.push({
        assetKey: asset.assetKey,
        reason: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
  return { urls, failures }
}

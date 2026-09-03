import { PRODUCT_MEDIA_KINDS } from '../types'
import type { FrozenProductMediaAsset, ProductMediaAsset } from '../types'

const STABLE_ASSET_KEY = /^[a-zA-Z0-9._:-]+$/

function stableAssetKey(value: string): string {
  const key = value.trim()
  if (!key || key.length > 200 || !STABLE_ASSET_KEY.test(key)) {
    throw new Error('[product-media] assetKey 无效')
  }
  return key
}

/** Validate and strip local identity from product-owned media metadata. */
export function freezeProductMediaAsset(
  asset: ProductMediaAsset | FrozenProductMediaAsset,
): FrozenProductMediaAsset {
  if (!PRODUCT_MEDIA_KINDS.includes(asset.kind)
    || !asset.name.trim()
    || !/^[a-f0-9]{64}$/.test(asset.contentHash)
    || !Number.isInteger(asset.version)
    || asset.version < 1
    || !Number.isInteger(asset.byteSize)
    || asset.byteSize < 0) {
    throw new Error(`[product-media] 媒资元数据无效:${asset.assetKey}`)
  }
  return {
    assetKey: stableAssetKey(asset.assetKey),
    version: asset.version,
    kind: asset.kind,
    name: asset.name.trim(),
    mimeType: asset.mimeType.trim().toLowerCase(),
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    contentHash: asset.contentHash,
    source: asset.source.trim(),
    license: asset.license.trim(),
    altText: asset.altText.trim(),
    characterTag: asset.characterTag.trim(),
    sceneTag: asset.sceneTag.trim(),
  }
}

import manifest from '../../content/mist-harbor/media.json'
import { putMediaBlobObject } from '../product-production/media-blob-store'
import type {
  ProductProductionTaskArtifactV1,
  ProductProductionTaskExecutionInputV1,
} from '../product-production/scheduler'
import type { FrozenRuntimeMediaAssetV2, ProductMediaKind } from '../types'

export const mistMediaKeys = manifest.assets.map((asset) => asset.assetKey)
export async function loadMistHarborMedia(
  task: ProductProductionTaskExecutionInputV1,
): Promise<ProductProductionTaskArtifactV1[]> {
  const artifacts: ProductProductionTaskArtifactV1[] = []
  for (const asset of manifest.assets) {
    const response = await fetch(`${import.meta.env.BASE_URL}demo-assets/mist-harbor/${asset.file}`, {
      signal: task.signal,
    })
    if (!response.ok) throw new Error(`雾港美术读取失败：${asset.name} (${response.status})`)
    const blob = await putMediaBlobObject({
      scope: task.scope,
      data: await response.arrayBuffer(),
      mimeType: 'image/webp',
      expectedContentHash: asset.contentHash,
    })
    artifacts.push({
      artifactKey: asset.assetKey,
      kind: 'image',
      mediaKind: asset.kind as ProductMediaKind,
      payload: { assetKey: asset.assetKey },
      metadata: {
        ...asset,
        durationMs: null,
        characterTag: 'characterTag' in asset ? asset.characterTag : '',
        sceneTag: 'sceneTag' in asset ? asset.sceneTag : '',
        source: manifest.source,
        license: manifest.license,
      },
      rights: {
        commercialUse: true,
        usageScope: 'StoryForge project demo and product use only, per bundled manifest',
        origin: 'authored-project-pack',
        source: manifest.source,
        license: manifest.license,
      },
      contentHash: blob.contentHash,
      blobObjectId: blob.id!,
      mimeType: blob.mimeType,
      byteSize: blob.byteSize,
    })
  }
  return artifacts
}
export function frozenMistMedia(
  artifacts: ProductProductionTaskExecutionInputV1['inputArtifacts'],
): FrozenRuntimeMediaAssetV2[] {
  return manifest.assets.map((asset) => {
    const artifact = artifacts.find((item) => item.artifactKey === asset.assetKey)
    if (!artifact || artifact.contentHash !== asset.contentHash)
      throw new Error(`雾港美术证据不匹配：${asset.assetKey}`)
    return {
      assetKey: asset.assetKey,
      version: 1,
      kind: asset.kind as ProductMediaKind,
      name: asset.name,
      mimeType: 'image/webp',
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      durationMs: null,
      contentHash: asset.contentHash,
      blobContentHash: asset.contentHash,
      source: manifest.source,
      license: manifest.license,
      altText: asset.altText,
      characterTag: 'characterTag' in asset ? String(asset.characterTag) : '',
      sceneTag: 'sceneTag' in asset ? String(asset.sceneTag) : '',
    }
  })
}

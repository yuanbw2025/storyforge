export const PRODUCT_MEDIA_KINDS = [
  'background',
  'character-pose',
  'character-expression',
  'cg',
  'ui',
  'bgm',
  'ambience',
  'sfx',
  'voice',
] as const

export type ProductMediaKind = typeof PRODUCT_MEDIA_KINDS[number]

/** Product-owned immutable media metadata. It is never part of WorldRelease. */
export interface ProductMediaAsset {
  id?: number
  projectId: number
  worldId: number
  workId: number
  assetKey: string
  version: number
  kind: ProductMediaKind
  name: string
  mimeType: string
  byteSize: number
  width: number | null
  height: number | null
  durationMs: number | null
  contentHash: string
  source: string
  license: string
  altText: string
  characterTag: string
  sceneTag: string
  createdAt: number
  updatedAt: number
}

/** Product media-to-content-addressed-blob binding. */
export interface ProductMediaBlob {
  id?: number
  projectId: number
  worldId: number
  workId: number
  mediaAssetId: number
  blobObjectId: number
  data: null
  createdAt: number
}

/** Portable metadata frozen into a Build or ProductRelease. */
export interface FrozenProductMediaAsset {
  assetKey: string
  version: number
  kind: ProductMediaKind
  name: string
  mimeType: string
  byteSize: number
  width: number | null
  height: number | null
  durationMs: number | null
  contentHash: string
  source: string
  license: string
  altText: string
  characterTag: string
  sceneTag: string
}

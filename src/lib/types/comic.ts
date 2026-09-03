import type { MediaBlobObjectRecordV1 } from './product-production'

export interface ComicNormalizedFrameV1 {
  x: number
  y: number
  width: number
  height: number
}

export interface ComicShotV1 {
  size: 'extreme-wide' | 'wide' | 'full' | 'medium' | 'close-up' | 'extreme-close-up' | 'insert'
  angle: 'eye-level' | 'high' | 'low' | 'overhead' | 'dutch'
  movement: 'static' | 'pan' | 'tilt' | 'track' | 'zoom' | 'handheld'
  composition: string
}

export interface ComicContinuityRefV1 {
  subjectKey: string
  note: string
}

export type ComicLetteringKindV1 = 'speech' | 'thought' | 'caption' | 'sfx'

export interface ComicLetteringItemV1 {
  id: string
  kind: ComicLetteringKindV1
  text: string
  frame: ComicNormalizedFrameV1
  direction: 'horizontal' | 'vertical'
  fontFamily: 'storyforge-sans' | 'storyforge-serif'
  fontSize: number
  textColor: string
  fillColor: string
  strokeColor: string
  strokeWidth: number
  tail: { x: number; y: number } | null
  zIndex: number
}

export interface ComicImageTransformV1 {
  fit: 'cover' | 'contain'
  scale: number
  offsetX: number
  offsetY: number
  rotation: number
}

export type ComicPageStatus = 'planned' | 'storyboarded' | 'reviewed' | 'locked'
export type ComicPanelStatus = 'draft' | 'reviewed' | 'locked'

export interface ComicPage {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  stableKey: string
  chapterNumber: number
  order: number
  allowPanelOverlap: boolean
  summary: string
  status: ComicPageStatus
  revision: number
  createdAt: number
  updatedAt: number
}

export interface ComicPanel {
  id?: number
  projectId: number
  workId: number
  pageId: number
  stableKey: string
  order: number
  frame: ComicNormalizedFrameV1
  sourceUnitIds: number[]
  sourceReviewManifestVersion: number
  shot: ComicShotV1
  action: string
  visualPrompt: string
  negativePrompt: string
  continuityRefs: ComicContinuityRefV1[]
  lettering: ComicLetteringItemV1[]
  selectedMediaAssetKey: string | null
  imageTransform: ComicImageTransformV1
  status: ComicPanelStatus
  revision: number
  createdAt: number
  updatedAt: number
}

export type ComicVisualSubjectKind = 'character' | 'location' | 'prop' | 'style'

export interface ComicVisualSubjectDesignV1 {
  description: string
  silhouette: string
  facialFeatures: string
  hairAndCostume: string
  palette: string[]
  materials: string[]
  distinguishingMarks: string[]
  prohibitedChanges: string[]
}

export interface ComicVisualSubject {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  stableKey: string
  kind: ComicVisualSubjectKind
  characterId: number | null
  locationRefKey: string | null
  label: string
  design: ComicVisualSubjectDesignV1
  sourceUnitIds: number[]
  sourceReviewManifestVersion: number
  selectedMediaAssetKey: string | null
  status: ComicPanelStatus
  revision: number
  createdAt: number
  updatedAt: number
}

export type ComicMediaAssetRole = 'panel-render' | 'character-sheet' | 'location-sheet' | 'prop-sheet' | 'style-reference'

export interface MediaProviderReceiptV1 {
  version: 1
  provider: string
  model: string
  requestId: string | null
  createdAt: number
  capabilitySnapshotHash: string
}

export interface MediaRightsV1 {
  version: 1
  source: 'author-upload' | 'provider-generated'
  commercialUse: 'allowed' | 'restricted' | 'unknown'
  redistribution: 'allowed' | 'restricted' | 'unknown'
  attribution: string
  declaration: string
  declaredAt: number
}

export interface ComicRenderQualityV1 {
  width: number
  height: number
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  hasTextWarning: boolean
  continuityWarnings: string[]
  cropWarnings: string[]
}

export interface ComicMediaAsset {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  stableKey: string
  role: ComicMediaAssetRole
  panelId: number | null
  subjectKey: string | null
  blobObjectId: number
  origin: 'generated' | 'uploaded'
  candidateIndex: number
  requestHash: string | null
  promptHash: string | null
  referenceAssetKeys: string[]
  providerReceipt: MediaProviderReceiptV1 | null
  rights: MediaRightsV1
  quality: ComicRenderQualityV1
  disposition: 'available' | 'rejected'
  createdAt: number
  updatedAt: number
}

export interface MediaBlobObject extends MediaBlobObjectRecordV1 {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  data: ArrayBuffer
  disposition: 'available' | 'pending-delete'
  deleteRequestedAt: number | null
  deleteReceiptHash: string | null
}

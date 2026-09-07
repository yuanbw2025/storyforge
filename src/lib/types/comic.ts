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

export interface ComicSubjectStateV1 {
  subjectKey: string
  costume: string
  condition: string
  props: string[]
  position: string
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
  pagePlanKey?: string
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
  nextPanelKey?: string | null
  frame: ComicNormalizedFrameV1
  sourceUnitIds: number[]
  sourceReviewManifestVersion: number
  shot: ComicShotV1
  /** The storytelling job of this panel: establish, reveal, reaction, turn, transition, etc. */
  narrativeFunction?: string
  /** One drawable frozen instant; never a stack of sequential actions. */
  moment?: string
  action: string
  visualPrompt: string
  negativePrompt: string
  continuityRefs: ComicContinuityRefV1[]
  subjectStates?: ComicSubjectStateV1[]
  protectedAreas?: ComicNormalizedFrameV1[]
  lettering: ComicLetteringItemV1[]
  selectedMediaAssetKey: string | null
  imageTransform: ComicImageTransformV1
  status: ComicPanelStatus
  narrativeReviewRevision?: number | null
  visualReviewRevision?: number | null
  /** How the pixels selected for this revision were actually inspected. */
  visualReviewBasis?: 'author-visual' | 'model-multimodal' | null
  visualReviewedAt?: number | null
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

/** Author-confirmed visual writing beat between source decisions and pagination. */
export interface ComicScriptBeatV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  sectionKey: string
  chapterNumber: number
  order: number
  narrativeFunction: 'establish' | 'develop' | 'reveal' | 'reaction' | 'turn' | 'climax' | 'resolution' | 'transition'
  visualAction: string
  dialogueIntent: string
  emotion: string
  causalFactKeys: string[]
  decisionKeys: string[]
  sourceUnitKeys: string[]
  estimatedPanels: number
  authorStatus: 'confirmed'
  revision: number
  createdAt: number
  updatedAt: number
}

/** Page-turn and text-capacity contract. It is not a screenplay scene. */
export interface ComicPagePlanV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  chapterNumber: number
  pageNumber: number
  order: number
  goal: string
  beatKeys: string[]
  endReveal: string
  pageTurn: 'none' | 'setup' | 'reveal-after-turn' | 'cliffhanger'
  expectedPanelCount: number
  textBudget: number
  authorStatus: 'confirmed'
  revision: number
  createdAt: number
  updatedAt: number
}

export type ComicReviewCategoryV1 = 'narrative' | 'reading-order' | 'lettering' | 'continuity' | 'rights' | 'media-integrity'
export type ComicReviewSeverityV1 = 'critical' | 'major' | 'minor'

export interface ComicReviewIssueV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  category: ComicReviewCategoryV1
  severity: ComicReviewSeverityV1
  pageKey: string
  panelKey: string | null
  subjectKey: string | null
  assetKey: string | null
  evidence: string
  problem: string
  suggestion: string
  sourceUnitKeys: string[]
  reviewedPanelRevision: number | null
  status: 'open' | 'resolved' | 'dismissed'
  createdAt: number
  updatedAt: number
}

export type ComicScriptBeatCandidateV1 = Pick<ComicScriptBeatV1,
  'stableKey' | 'sectionKey' | 'chapterNumber' | 'order' | 'narrativeFunction' | 'visualAction'
  | 'dialogueIntent' | 'emotion' | 'causalFactKeys' | 'decisionKeys' | 'sourceUnitKeys' | 'estimatedPanels'
>
export type ComicPagePlanCandidateV1 = Pick<ComicPagePlanV1,
  'stableKey' | 'chapterNumber' | 'pageNumber' | 'order' | 'goal' | 'beatKeys' | 'endReveal'
  | 'pageTurn' | 'expectedPanelCount' | 'textBudget'
>

export interface ComicPanelPlanCandidateV1 {
  pagePlanKey: string
  stableKey: string
  order: number
  nextPanelKey: string | null
  frame: ComicNormalizedFrameV1
  narrativeFunction: string
  moment: string
  shot: ComicShotV1
  subjectStates: ComicSubjectStateV1[]
  protectedAreas: ComicNormalizedFrameV1[]
  continuityRefs: ComicContinuityRefV1[]
  lettering: ComicLetteringItemV1[]
  sourceUnitKeys: string[]
}

export interface ComicVisualSubjectCandidateV1 {
  stableKey: string
  kind: ComicVisualSubjectKind
  label: string
  design: ComicVisualSubjectDesignV1
  sourceUnitKeys: string[]
}

export interface ComicVisualBibleCandidateV1 {
  global: import('./adaptation').ComicGlobalVisualBibleV1
  subjects: ComicVisualSubjectCandidateV1[]
}

export interface ComicImageRequestCandidateV1 {
  panelKey: string
  expectedPanelRevision: number
  visualPrompt: string
  negativePrompt: string
  referenceSubjectKeys: string[]
  protectedAreas: ComicNormalizedFrameV1[]
}

export type ComicReviewIssueCandidateV1 = Pick<ComicReviewIssueV1,
  'stableKey' | 'category' | 'severity' | 'pageKey' | 'panelKey' | 'subjectKey' | 'assetKey'
  | 'evidence' | 'problem' | 'suggestion' | 'sourceUnitKeys'
>

export interface ComicRepairRequestCandidateV1 extends ComicImageRequestCandidateV1 {
  issueKeys: string[]
  preserveSubjectKeys: string[]
  repairMode: 'inpaint' | 'image-edit' | 'full-regenerate'
}

/** Strong release-to-blob reference. Draft asset cleanup must not break a release. */
export interface CreationReleaseAssetV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  releaseId: number
  assetKey: string
  role: ComicMediaAssetRole
  pageKey: string | null
  panelKey: string | null
  blobObjectId: number
  contentHash: string
  referenceAssetKeys: string[]
  createdAt: number
}

export type ComicReleaseTierV1 = 'storyboard' | 'visual'

export interface ComicReleaseManifestV1 {
  schema: 'storyforge.comic-release'
  version: 1
  productKind: 'comic'
  tier: ComicReleaseTierV1
  work: { code: string; title: string; description: string; genres: string[] }
  adaptation: {
    revision: number
    targetSpec: import('./adaptation').ComicTargetSpecV1
    brief: import('./adaptation').AdaptationBriefV1
    sourceManifestVersion: number
    sourceManifestHash: string
  }
  sourceUnits: Array<{ sourceUnitKey: string; label: string; order: number; contentHash: string; wordCount: number }>
  facts: Array<Record<string, unknown>>
  causalEdges: Array<Record<string, unknown>>
  decisions: Array<Record<string, unknown>>
  scriptBeats: Array<Record<string, unknown>>
  pagePlans: Array<Record<string, unknown>>
  pages: Array<Record<string, unknown>>
  visualBible: import('./adaptation').ComicGlobalVisualBibleV1
  visualSubjects: Array<Record<string, unknown>>
  reviewIssues: Array<Record<string, unknown>>
  assets: Array<Record<string, unknown>>
  verification: { blockers: string[]; warnings: string[]; reviewedAt: number }
  createdAt: number
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

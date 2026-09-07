export type AdaptationMedium = 'screenplay' | 'comic'
export type AdaptationStatus =
  | 'source-frozen'
  | 'brief-review'
  | 'planning'
  | 'producing'
  | 'review'
  | 'complete'

export type AdaptationSourceSelectionV1 =
  | { mode: 'entire-work' }
  | { mode: 'outline-subtree'; outlineNodeId: number }
  | { mode: 'chapter-range'; startChapterId: number; endChapterId: number }
  | { mode: 'chapters'; chapterIds: number[] }

export interface AdaptationBriefV1 {
  version: 1
  coreTheme: string
  dominantEmotion: string
  mustKeep: string[]
  mayCut: string[]
  mayMerge: string[]
  mayReorder: string[]
  allowedAdditions: string[]
  audience: string
  rating: string
  targetScale: string
  narrativePerspective: string
  timeBudget: string
  costLimit: string
  deviationNotes: string
  unresolvedQuestions: string[]
  assumptions: string[]
}

export interface AdaptationPlanSectionV1 {
  stableKey: string
  title: string
  summary: string
  order: number
  episodeNumber: number | null
  sourceUnitKeys: string[]
}

export interface AdaptationPlanV1 {
  version: 1
  premise: string
  sections: AdaptationPlanSectionV1[]
  globalAssumptions: string[]
}

export interface ScreenplayTargetSpecV1 {
  format: 'film' | 'series' | 'short-drama'
  language: 'zh-CN'
  episodeCount: number | null
  targetMinutesPerEpisode: number
  rating: string
  dialogueDensity: 'low' | 'balanced' | 'high'
  productionScale: 'contained' | 'standard' | 'large'
  preserveVoiceOver: boolean
  titlePage: {
    creditLine: string
    authorDisplayName: string
    contactText: string
    copyrightNotice: string
    draftLabel: string
  }
  exportDefaults: Array<'fountain' | 'fdx' | 'pdf'>
}

export interface ComicPageSizeV1 {
  width: number
  height: number
  unit: 'px' | 'mm'
  bleed: number
}

export interface MediaCapabilityRequirementV1 {
  referenceImage: boolean
  deterministicSeed: boolean
  inpainting: boolean
  commercialUseRequired: boolean
  minimumWidth: number
  minimumHeight: number
}

export interface ComicTargetSpecV1 {
  format: 'page-comic'
  audience: string
  readingDirection: 'ltr' | 'rtl'
  chapterCount: number
  targetPagesPerChapter: number
  pageSize: ComicPageSizeV1
  colorMode: 'color' | 'grayscale' | 'monochrome'
  artStyleBrief: string
  renderCandidatesPerPanel: 2 | 3 | 4
  imageCapabilityRequirement: MediaCapabilityRequirementV1
}

export interface ComicGlobalVisualBibleV1 {
  version: 1
  artDirection: string
  linework: string
  palette: string[]
  lighting: string
  periodAndMaterials: string
  cameraLanguage: string[]
  prohibitedDepictions: string[]
}

interface AdaptationProjectBase {
  id?: number
  projectId: number
  worldId: number
  /** Target Work. */
  workId: number
  /** Linked source Work; null after source deletion or explicit detach. */
  sourceWorkId: number | null
  lineageMode: 'linked' | 'detached'
  status: AdaptationStatus
  sourceSelectionMode: AdaptationSourceSelectionV1['mode']
  sourceOutlineRootId: number | null
  sourceStartChapterId: number | null
  sourceEndChapterId: number | null
  sourceCoverage: 'full-text' | 'outline-only'
  brief: AdaptationBriefV1 | null
  plan: AdaptationPlanV1 | null
  activeSourceManifestVersion: number
  activeSourceManifestHash: string
  briefSourceManifestVersion: number | null
  planSourceManifestVersion: number | null
  revision: number
  createdAt: number
  updatedAt: number
}

export type AdaptationProject = AdaptationProjectBase & (
  | {
      medium: 'screenplay'
      targetSpec: ScreenplayTargetSpecV1
      visualBibleSourceManifestVersion: null
      visualBible?: null
    }
  | {
      medium: 'comic'
      targetSpec: ComicTargetSpecV1
      visualBibleSourceManifestVersion: number | null
      visualBible: ComicGlobalVisualBibleV1 | null
    }
)

export type AdaptationSourceUnitKind = 'work' | 'outline-node' | 'chapter'

export interface AdaptationSourceUnit {
  id?: number
  projectId: number
  /** Target Work owner, repeated for indexed scope reads. */
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  sourceKind: AdaptationSourceUnitKind
  sourceOutlineNodeId: number | null
  sourceChapterId: number | null
  sourceUnitKey: string
  order: number
  label: string
  contentHash: string
  summary: string
  wordCount: number
  sourceUpdatedAt: number | null
  createdAt: number
}

export type AdaptationSourceFactKindV1 =
  | 'event'
  | 'character-state'
  | 'relationship'
  | 'location'
  | 'object'
  | 'motif'

export type AdaptationAuthorStatusV1 = 'confirmed' | 'rejected'

/**
 * A portable, author-reviewed assertion about the frozen source. Candidates
 * remain CreativeArtifacts; only an explicit review action creates this row.
 */
export interface AdaptationSourceFactV1 {
  id?: number
  projectId: number
  /** Target Work owner, never the source Work. */
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  kind: AdaptationSourceFactKindV1
  statement: string
  subjectKeys: string[]
  sourceUnitKeys: string[]
  confidence: number
  authorStatus: AdaptationAuthorStatusV1
  createdAt: number
  updatedAt: number
}

export type AdaptationCausalRelationV1 =
  | 'cause'
  | 'enables'
  | 'motivates'
  | 'reveals'
  | 'prevents'

/** A directed, evidenced relationship between two source-fact stable keys. */
export interface AdaptationCausalEdgeV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  fromFactKey: string
  toFactKey: string
  relation: AdaptationCausalRelationV1
  rationale: string
  sourceUnitKeys: string[]
  authorStatus: AdaptationAuthorStatusV1
  createdAt: number
  updatedAt: number
}

export type AdaptationDecisionActionV1 =
  | 'keep'
  | 'cut'
  | 'merge'
  | 'reorder'
  | 'externalize'
  | 'add'

/**
 * An explicit adaptation choice. `add` is the only action that may have no
 * sourceFactKeys; it must still carry a rationale and an author decision.
 */
export interface AdaptationDecisionV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  action: AdaptationDecisionActionV1
  sourceFactKeys: string[]
  targetKeys: string[]
  rationale: string
  authorStatus: AdaptationAuthorStatusV1
  createdAt: number
  updatedAt: number
}

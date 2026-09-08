/** Short-form fiction is an independent authoring product, not a WorldRelease runtime. */
export type ShortNovelProductionPhaseV1 =
  | 'intent'
  | 'design'
  | 'planning'
  | 'drafting'
  | 'review'
  | 'release-ready'
  | 'complete'

export interface ShortNovelBriefV1 {
  version: 1
  premise: string
  coreChange: string
  dominantEmotion: string
  pointOfView: 'first-person' | 'third-limited' | 'third-omniscient'
  tense: 'past' | 'present'
  audience: string
  storyPromise: string
  mustKeep: string[]
  forbidden: string[]
  targetWordCount: number
  chapterCount: number
}

export interface ShortNovelStoryDesignV1 {
  version: 1
  protagonist: string
  desire: string
  pressure: string
  escalation: string[]
  irreversibleTurn: string
  climaxChoice: string
  endingImage: string
  aftertaste: string
  thematicQuestion: string
}

export interface ShortNovelChapterPlanV1 {
  stableKey: string
  order: number
  title: string
  purpose: string
  viewpoint: string
  openingPressure: string
  conflict: string
  turn: string
  exitState: string
  targetWordCount: number
}

export type ShortNovelReviewSeverityV1 = 'critical' | 'major' | 'minor'
export type ShortNovelReviewCategoryV1 =
  | 'causality'
  | 'character'
  | 'continuity'
  | 'pacing'
  | 'point-of-view'
  | 'promise-payoff'
  | 'prose'

export interface ShortNovelReviewIssueV1 {
  stableKey: string
  severity: ShortNovelReviewSeverityV1
  category: ShortNovelReviewCategoryV1
  chapterKeys: string[]
  evidence: string
  problem: string
  suggestion: string
  status: 'open' | 'resolved' | 'dismissed'
}

export interface ShortNovelReviewV1 {
  version: 1
  summary: string
  strengths: string[]
  issues: ShortNovelReviewIssueV1[]
}

export interface ShortNovelChapterDraftV1 {
  version: 1
  chapterKey: string
  title: string
  content: string
}

export interface ShortNovelProductionV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  phase: ShortNovelProductionPhaseV1
  revision: number
  brief: ShortNovelBriefV1 | null
  briefConfirmedAt: number | null
  storyDesign: ShortNovelStoryDesignV1 | null
  designConfirmedAt: number | null
  latestReview: ShortNovelReviewV1 | null
  reviewedManuscriptHash: string | null
  currentReleaseId: number | null
  createdAt: number
  updatedAt: number
}

export interface ShortNovelFrozenChapterV1 {
  stableKey: string
  order: number
  title: string
  summary: string
  contentHtml: string
  wordCount: number
  contentHash: string
}

export interface ShortNovelReleaseManifestV1 {
  schema: 'storyforge.short-novel-release'
  version: 1
  productKind: 'short-novel'
  work: {
    code: string
    title: string
    description: string
    genres: string[]
    targetWordCount: number
  }
  production: {
    revision: number
    brief: ShortNovelBriefV1
    storyDesign: ShortNovelStoryDesignV1
    review: ShortNovelReviewV1
    reviewedManuscriptHash: string
  }
  chapters: ShortNovelFrozenChapterV1[]
  manuscriptHash: string
  createdAt: number
}

export type CreationProductKindV1 = 'short-novel' | 'screenplay' | 'comic' | 'motion-drama'

/** Shared append-only envelope. Every product supplies its own closed manifest codec. */
export interface CreationReleaseV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productKind: CreationProductKindV1
  version: number
  label: string
  parentReleaseId: number | null
  sourceRevision: number
  manifestJson: string
  contentHash: string
  createdAt: number
}

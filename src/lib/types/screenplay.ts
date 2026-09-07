export type ScreenplayCharacterExtension = 'V.O.' | 'O.S.' | 'O.C.' | "CONT'D"

export type ScreenplayBlock =
  | { id: string; type: 'action'; text: string }
  | { id: string; type: 'character'; characterId?: number | null; name: string; extension?: ScreenplayCharacterExtension; dualDialogue?: boolean }
  | { id: string; type: 'parenthetical'; text: string }
  | { id: string; type: 'dialogue'; text: string }
  | { id: string; type: 'transition'; text: string }
  | { id: string; type: 'shot'; text: string }
  | { id: string; type: 'note'; text: string }

export type ScreenplaySceneStatus = 'card' | 'draft' | 'reviewed' | 'locked'

export interface ScreenplayScene {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  stableKey: string
  planSectionKey: string
  episodeNumber: number
  sceneNumber: number
  order: number
  intExt: 'INT' | 'EXT' | 'INT_EXT'
  location: string
  timeOfDay: string
  summary: string
  estimatedSeconds: number
  sourceUnitIds: number[]
  sourceReviewManifestVersion: number
  /** Content revision last checked against the frozen novel source. */
  groundingReviewRevision?: number | null
  /** Content revision last checked for scene function and dramatic craft. */
  dramaturgyReviewRevision?: number | null
  blocks: ScreenplayBlock[]
  status: ScreenplaySceneStatus
  revision: number
  createdAt: number
  updatedAt: number
}

export type ScreenplayBeatScopeV1 = 'act' | 'sequence' | 'episode'

/** Author-confirmed structural beat. Model candidates never supply owner/status/revision fields. */
export interface ScreenplayBeatV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  sectionKey: string
  sectionTitle: string
  scope: ScreenplayBeatScopeV1
  episodeNumber: number
  order: number
  objective: string
  conflict: string
  turn: string
  outcome: string
  causalFactKeys: string[]
  decisionKeys: string[]
  sourceUnitKeys: string[]
  estimatedSeconds: number
  authorStatus: 'confirmed'
  revision: number
  createdAt: number
  updatedAt: number
}

/** A scene card is the causal contract for one scene, not screenplay prose. */
export interface ScreenplaySceneCardV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  beatKey: string
  episodeNumber: number
  sceneNumber: number
  order: number
  purpose: string
  conflict: string
  entryState: string
  exitState: string
  visibleAction: string
  informationReveal: string
  sourceUnitKeys: string[]
  estimatedSeconds: number
  authorStatus: 'confirmed'
  revision: number
  createdAt: number
  updatedAt: number
}

export type ScreenplayReviewCategoryV1 = 'grounding' | 'continuity' | 'dramaturgy' | 'format'
export type ScreenplayReviewSeverityV1 = 'critical' | 'major' | 'minor'

/** Persisted editorial finding. It always targets a stable scene and the reviewed scene revision. */
export interface ScreenplayReviewIssueV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  category: ScreenplayReviewCategoryV1
  severity: ScreenplayReviewSeverityV1
  sceneKey: string
  blockId: string | null
  evidence: string
  problem: string
  suggestion: string
  sourceUnitKeys: string[]
  reviewedSceneRevision: number
  status: 'open' | 'resolved' | 'dismissed'
  createdAt: number
  updatedAt: number
}

export type ScreenplayBeatCandidateV1 = Pick<ScreenplayBeatV1,
  | 'stableKey' | 'sectionKey' | 'sectionTitle' | 'scope' | 'episodeNumber' | 'order'
  | 'objective' | 'conflict' | 'turn' | 'outcome' | 'causalFactKeys' | 'decisionKeys'
  | 'sourceUnitKeys' | 'estimatedSeconds'
>

export type ScreenplaySceneCardCandidateV1 = Pick<ScreenplaySceneCardV1,
  | 'stableKey' | 'beatKey' | 'episodeNumber' | 'sceneNumber' | 'order' | 'purpose'
  | 'conflict' | 'entryState' | 'exitState' | 'visibleAction' | 'informationReveal'
  | 'sourceUnitKeys' | 'estimatedSeconds'
>

export type ScreenplayReviewIssueCandidateV1 = Pick<ScreenplayReviewIssueV1,
  | 'stableKey' | 'category' | 'severity' | 'sceneKey' | 'blockId' | 'evidence'
  | 'problem' | 'suggestion' | 'sourceUnitKeys'
>

export interface ScreenplayRewritePatchCandidateV1 {
  sceneKey: string
  expectedSceneRevision: number
  issueKeys: string[]
  summary: string
  blocks: ScreenplayBlock[]
}

export interface ScreenplayFrozenSourceUnitV1 {
  sourceUnitKey: string
  label: string
  order: number
  contentHash: string
  wordCount: number
}

export type ScreenplayFrozenBlockV1 =
  | Exclude<ScreenplayBlock, { type: 'character' }>
  | Omit<Extract<ScreenplayBlock, { type: 'character' }>, 'characterId'>

export type ScreenplayFrozenBeatV1 = Omit<ScreenplayBeatV1, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'createdAt' | 'updatedAt'>
export type ScreenplayFrozenSceneCardV1 = Omit<ScreenplaySceneCardV1, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'createdAt' | 'updatedAt'>
export type ScreenplayFrozenReviewIssueV1 = Omit<ScreenplayReviewIssueV1, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'createdAt' | 'updatedAt'>
export type ScreenplayFrozenSourceFactV1 = Omit<import('./adaptation').AdaptationSourceFactV1, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'createdAt' | 'updatedAt'>
export type ScreenplayFrozenCausalEdgeV1 = Omit<import('./adaptation').AdaptationCausalEdgeV1, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'createdAt' | 'updatedAt'>
export type ScreenplayFrozenDecisionV1 = Omit<import('./adaptation').AdaptationDecisionV1, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'createdAt' | 'updatedAt'>

export interface ScreenplayFrozenSceneV1 extends Omit<ScreenplayScene,
  'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'sourceUnitIds' | 'blocks' | 'createdAt' | 'updatedAt'
> {
  sourceUnitKeys: string[]
  blocks: ScreenplayFrozenBlockV1[]
}

export interface ScreenplayReleaseManifestV1 {
  schema: 'storyforge.screenplay-release'
  version: 1
  productKind: 'screenplay'
  work: { code: string; title: string; description: string; genres: string[] }
  adaptation: {
    revision: number
    targetSpec: import('./adaptation').ScreenplayTargetSpecV1
    brief: import('./adaptation').AdaptationBriefV1
    sourceManifestVersion: number
    sourceManifestHash: string
  }
  sourceUnits: ScreenplayFrozenSourceUnitV1[]
  facts: ScreenplayFrozenSourceFactV1[]
  causalEdges: ScreenplayFrozenCausalEdgeV1[]
  decisions: ScreenplayFrozenDecisionV1[]
  beats: ScreenplayFrozenBeatV1[]
  sceneCards: ScreenplayFrozenSceneCardV1[]
  scenes: ScreenplayFrozenSceneV1[]
  reviewIssues: ScreenplayFrozenReviewIssueV1[]
  verification: {
    blockers: string[]
    warnings: string[]
    totalEstimatedSeconds: number
    targetEstimatedSeconds: number
    reviewedAt: number
  }
  createdAt: number
}

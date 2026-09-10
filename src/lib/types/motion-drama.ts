import type { MediaRightsV1 } from './comic'

export const MOTION_DRAMA_PROVIDER_TARGETS_V1 = ['seedance', 'runway', 'ltx', 'generic'] as const
export type MotionDramaProviderTargetV1 = typeof MOTION_DRAMA_PROVIDER_TARGETS_V1[number]

export interface MotionDramaTargetSpecV1 {
  format: 'motion-drama'
  language: 'zh-CN'
  episodeCount: number
  targetSecondsPerEpisode: number
  aspectRatio: '9:16' | '16:9' | '1:1'
  narrativeMode: 'animated-comic' | 'illustrated-motion' | 'hybrid'
  audience: string
  rating: string
  dialogueDensity: 'low' | 'balanced' | 'high'
  artDirection: string
  providerTargets: MotionDramaProviderTargetV1[]
}

export type MotionDramaProductionPhaseV1 =
  | 'source'
  | 'series-bible'
  | 'asset-bible'
  | 'episode-outline'
  | 'script'
  | 'storyboard'
  | 'prompt-pack'
  | 'review'
  | 'release-ready'
  | 'complete'

export type MotionDramaAuthorStatusV1 = 'confirmed'

export interface MotionDramaSeriesBibleV1 {
  version: 1
  titlePromise: string
  logline: string
  coreTheme: string
  emotionalPromise: string
  audiencePromise: string
  storyEngine: string
  worldRules: string[]
  seasonArc: string
  protagonistArc: string
  relationshipArcs: string[]
  episodeArchitecture: string
  hookPatterns: string[]
  visualLanguage: string[]
  soundLanguage: string[]
  continuityRules: string[]
  productionConstraints: string[]
}

export interface MotionDramaProductionV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  adaptationProjectId: number
  phase: MotionDramaProductionPhaseV1
  activeSeriesBibleVersion: number | null
  currentEpisodeNumber: number
  currentReleaseId: number | null
  revision: number
  createdAt: number
  updatedAt: number
}

export interface MotionDramaSeriesBibleRecordV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  version: number
  sourceManifestVersion: number
  bible: MotionDramaSeriesBibleV1
  contentHash: string
  createdAt: number
}

export interface MotionDramaEpisodeBeatV1 {
  stableKey: string
  order: number
  function: 'hook' | 'setup' | 'pressure' | 'reveal' | 'reversal' | 'climax' | 'cliffhanger' | 'resolution'
  visibleAction: string
  conflict: string
  turn: string
  targetSeconds: number
  sourceUnitKeys: string[]
}

export interface MotionDramaEpisodeV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  episodeNumber: number
  title: string
  logline: string
  synopsis: string
  openingHook: string
  beats: MotionDramaEpisodeBeatV1[]
  endHook: string
  continuityIn: string[]
  continuityOut: string[]
  sourceUnitKeys: string[]
  authorStatus: MotionDramaAuthorStatusV1
  revision: number
  createdAt: number
  updatedAt: number
}

export interface MotionDramaDialogueLineV1 {
  speakerKey: string
  text: string
  delivery: string
  estimatedSeconds: number
}

export interface MotionDramaSoundCueV1 {
  kind: 'voice' | 'ambience' | 'sfx' | 'music'
  cue: string
  timing: string
  subjectKey: string | null
}

export interface MotionDramaScriptSceneV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  episodeNumber: number
  sceneNumber: number
  order: number
  heading: string
  location: string
  timeOfDay: string
  dramaticPurpose: string
  entryState: string
  exitState: string
  visibleAction: string
  dialogue: MotionDramaDialogueLineV1[]
  narration: string
  soundCues: MotionDramaSoundCueV1[]
  emotionalTurn: string
  estimatedSeconds: number
  characterKeys: string[]
  sourceUnitKeys: string[]
  authorStatus: MotionDramaAuthorStatusV1
  revision: number
  createdAt: number
  updatedAt: number
}

export type MotionDramaAssetKindV1 = 'character' | 'costume' | 'location' | 'prop' | 'style' | 'voice' | 'sound'

export interface MotionDramaAssetSubjectV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  kind: MotionDramaAssetKindV1
  label: string
  identity: string
  appearance: string
  palette: string[]
  materials: string[]
  continuityLocks: string[]
  prohibitedChanges: string[]
  basePrompt: string
  negativePrompt: string
  referenceBrief: string
  sourceUnitKeys: string[]
  selectedVersionKey: string | null
  authorStatus: MotionDramaAuthorStatusV1
  revision: number
  createdAt: number
  updatedAt: number
}

export interface MotionDramaAssetVersionV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  adaptationProjectId: number
  subjectKey: string
  stableKey: string
  version: number
  prompt: string
  negativePrompt: string
  referenceNotes: string
  blobObjectId: number | null
  origin: 'prompt-only' | 'author-upload' | 'provider-generated'
  provider: string | null
  model: string | null
  rights: MediaRightsV1 | null
  contentHash: string
  createdAt: number
  updatedAt: number
}

export interface MotionDramaShotV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  episodeNumber: number
  sceneKey: string
  shotNumber: number
  order: number
  narrativeFunction: string
  targetSeconds: number
  shotSize: 'extreme-wide' | 'wide' | 'full' | 'medium' | 'close-up' | 'extreme-close-up' | 'insert'
  cameraAngle: 'eye-level' | 'high' | 'low' | 'overhead' | 'dutch' | 'pov'
  cameraMovement: 'static' | 'pan' | 'tilt' | 'track' | 'dolly' | 'orbit' | 'zoom' | 'handheld'
  composition: string
  visibleAction: string
  performance: string
  lighting: string
  transitionIn: string
  transitionOut: string
  dialogue: string
  narration: string
  soundPlan: MotionDramaSoundCueV1[]
  subjectKeys: string[]
  sourceUnitKeys: string[]
  imagePrompt: string
  negativeImagePrompt: string
  firstFramePrompt: string
  keyFramePrompt: string
  lastFramePrompt: string
  videoPrompt: string
  negativeVideoPrompt: string
  authorStatus: MotionDramaAuthorStatusV1
  revision: number
  createdAt: number
  updatedAt: number
}

export type MotionDramaReferenceRoleV1 =
  | 'character'
  | 'costume'
  | 'location'
  | 'prop'
  | 'style'
  | 'voice'
  | 'start-frame'
  | 'key-frame'
  | 'end-frame'

export interface MotionDramaShotReferenceV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  adaptationProjectId: number
  shotKey: string
  stableKey: string
  role: MotionDramaReferenceRoleV1
  subjectKey: string | null
  assetVersionId: number | null
  blobObjectId: number | null
  timing: string
  note: string
  rights: MediaRightsV1 | null
  selected: boolean
  createdAt: number
  updatedAt: number
}

export interface MotionDramaAssetBindingV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  episodeNumber: number
  shotKey: string | null
  subjectKey: string
  assetVersionKey: string | null
  usage: string
  createdAt: number
  updatedAt: number
}

export const MOTION_DRAMA_PROMPT_STAGES_V1 = [
  'series-bible',
  'asset-bible',
  'episode-outline',
  'episode-script',
  'shot-design',
  'image-prompts',
  'video-prompts',
  'quality-review',
] as const
export type MotionDramaPromptStageV1 = typeof MOTION_DRAMA_PROMPT_STAGES_V1[number]

export interface MotionDramaPromptOverrideV1 {
  id?: number
  projectId: number
  workId: number
  stage: MotionDramaPromptStageV1
  scope: 'work' | 'episode'
  episodeNumber: number | null
  instruction: string
  revision: number
  createdAt: number
  updatedAt: number
}

export type MotionDramaPromptPackMaturityV1 = 'prompt-only' | 'reference-ready'

export interface MotionDramaPromptPackV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  episodeNumber: number
  provider: MotionDramaProviderTargetV1
  version: number
  maturity: MotionDramaPromptPackMaturityV1
  sourceManifestVersion: number
  sourceRevision: number
  promptVersions: Record<MotionDramaPromptStageV1, string>
  manifestJson: string
  contentHash: string
  createdAt: number
}

export interface MotionDramaReviewIssueV1 {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  manifestVersion: number
  stableKey: string
  episodeNumber: number
  sceneKey: string | null
  shotKey: string | null
  subjectKey: string | null
  category: 'story' | 'continuity' | 'visual' | 'motion' | 'prompt' | 'sound' | 'rights' | 'provider-capability'
  severity: 'critical' | 'major' | 'minor'
  evidence: string
  problem: string
  suggestion: string
  status: 'open' | 'resolved' | 'dismissed'
  reviewedRevision: number
  createdAt: number
  updatedAt: number
}

export interface MotionDramaReleaseManifestV1 {
  schema: 'storyforge.motion-drama-release'
  version: 1
  productKind: 'motion-drama'
  tier: MotionDramaPromptPackMaturityV1
  releaseScope: { episodeNumbers: number[]; providers: MotionDramaProviderTargetV1[] }
  work: { code: string; title: string; description: string; genres: string[] }
  adaptation: {
    revision: number
    targetSpec: MotionDramaTargetSpecV1
    sourceManifestVersion: number
    sourceManifestHash: string
  }
  seriesBible: MotionDramaSeriesBibleV1
  assets: Array<Record<string, unknown>>
  episodes: Array<Record<string, unknown>>
  scenes: Array<Record<string, unknown>>
  shots: Array<Record<string, unknown>>
  promptPacks: Array<Record<string, unknown>>
  reviewIssues: Array<Record<string, unknown>>
  verification: { blockers: string[]; warnings: string[]; reviewedAt: number }
  createdAt: number
}

export type MotionDramaSeriesBibleCandidateV1 = MotionDramaSeriesBibleV1
export type MotionDramaEpisodeCandidateV1 = Omit<MotionDramaEpisodeV1, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'manifestVersion' | 'authorStatus' | 'revision' | 'createdAt' | 'updatedAt'>
export type MotionDramaScriptSceneCandidateV1 = Omit<MotionDramaScriptSceneV1, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'manifestVersion' | 'authorStatus' | 'revision' | 'createdAt' | 'updatedAt'>
export type MotionDramaAssetSubjectCandidateV1 = Omit<MotionDramaAssetSubjectV1, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'manifestVersion' | 'selectedVersionKey' | 'authorStatus' | 'revision' | 'createdAt' | 'updatedAt'>
export type MotionDramaShotCandidateV1 = Omit<MotionDramaShotV1, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'manifestVersion' | 'authorStatus' | 'revision' | 'createdAt' | 'updatedAt'>
export type MotionDramaReviewIssueCandidateV1 = Omit<MotionDramaReviewIssueV1, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'manifestVersion' | 'status' | 'reviewedRevision' | 'createdAt' | 'updatedAt'>

export interface MotionDramaImagePromptCandidateV1 {
  shotKey: string
  expectedRevision: number
  imagePrompt: string
  negativeImagePrompt: string
  firstFramePrompt: string
  keyFramePrompt: string
  lastFramePrompt: string
}

export interface MotionDramaVideoPromptCandidateV1 {
  shotKey: string
  expectedRevision: number
  videoPrompt: string
  negativeVideoPrompt: string
}

export const AVG_MEDIA_KINDS = [
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
export type AvgMediaKind = typeof AVG_MEDIA_KINDS[number]

export interface AvgMediaAsset {
  id?: number
  projectId: number
  worldId: number
  workId: number
  assetKey: string
  version: number
  kind: AvgMediaKind
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

export interface AvgMediaBlob {
  id?: number
  projectId: number
  worldId: number
  workId: number
  mediaAssetId: number
  /** Structured-clone-safe binary; callers materialize a Blob with the asset mimeType. */
  data: ArrayBuffer
  createdAt: number
}

export interface AvgPresentationModule {
  id?: number
  projectId: number
  worldId: number
  workId: number
  gameDefinitionId: number
  contentJson: string
  createdAt: number
  updatedAt: number
}

export const AVG_STAGE_LAYERS = [
  'background', 'environment', 'actor-back', 'actor-front', 'effect', 'dialogue', 'overlay',
] as const
export type AvgStageLayer = typeof AVG_STAGE_LAYERS[number]

export const AVG_CUE_TYPES = [
  'set-background', 'clear-background', 'set-overlay', 'clear-overlay', 'show-actor', 'hide-actor', 'show-cg', 'clear-cg',
  'move-actor', 'set-tone', 'play-audio', 'stop-audio', 'transition', 'wait', 'camera',
  'shake', 'flash', 'mask', 'restore-snapshot',
] as const
export type AvgCueType = typeof AVG_CUE_TYPES[number]
export type AvgCuePhase = 'before' | 'during' | 'after'

/** A declarative, code-free cue. Parameters are interpreted through a strict type whitelist. */
export interface AvgPresentationCue {
  cueKey: string
  beatKey: string
  phase: AvgCuePhase
  type: AvgCueType
  assetKey?: string | null
  actorKey?: string | null
  slot?: string | null
  layer?: AvgStageLayer | null
  x?: number | null
  y?: number | null
  scale?: number | null
  opacity?: number | null
  tone?: string | null
  durationMs: number
  easing: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'
  volume?: number | null
  loop?: boolean
  snapshotKey?: string | null
  order: number
}

export interface AvgPresentationContentV1 {
  version: 1
  cues: AvgPresentationCue[]
}

export interface FrozenAvgMediaAsset {
  assetKey: string
  version: number
  kind: AvgMediaKind
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

export interface AvgActorStageState {
  actorKey: string
  assetKey: string
  slot: string
  layer: 'actor-back' | 'actor-front'
  x: number
  y: number
  scale: number
  opacity: number
}

export interface AvgStageState {
  backgroundAssetKey: string | null
  cgAssetKey: string | null
  actors: AvgActorStageState[]
  overlayAssetKey: string | null
  tone: string
  camera: { x: number; y: number; scale: number }
  activeAudio: Array<{ channel: 'bgm' | 'ambience' | 'sfx' | 'voice'; assetKey: string; volume: number; loop: boolean }>
  mask: string | null
  lastTransition: string | null
}

export interface SimulationAvgPresentationState {
  schema: 'storyforge.avg-presentation'
  version: 1
  contentHash: string
  assets: FrozenAvgMediaAsset[]
  cues: AvgPresentationCue[]
  currentNodeKey: string
  currentBeatKey: string | null
  reachedBeatKeys: string[]
  readBeatKeys: string[]
  stage: AvgStageState
  snapshots: Record<string, AvgStageState>
  mediaFailures: Array<{ assetKey: string; reason: string; eventSequence: number }>
}

export interface AvgValidationReport {
  valid: boolean
  errors: string[]
  warnings: string[]
  missingAssetKeys: string[]
  orphanAssetKeys: string[]
  orphanCueKeys: string[]
  unsupportedMimeAssetKeys: string[]
  missingAltTextAssetKeys: string[]
  longWaitCueKeys: string[]
}

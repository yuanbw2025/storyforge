import type { FrozenProductMediaAsset } from './product-media'

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

export interface AvgRuntimePresentationState {
  schema: 'storyforge.avg-presentation'
  version: 1
  contentHash: string
  assets: FrozenProductMediaAsset[]
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

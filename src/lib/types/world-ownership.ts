import type { CommunityWorldOrigin, WorkStatus } from './project'

/** Author-owned policy for work that may follow prose adoption. */
export type PostAdoptionPolicyV1 = 'off' | 'suggest' | 'auto-with-budget'

export type PostAdoptionTaskTypeV1 =
  | 'organization'
  | 'memory'
  | 'retrieval'
  | 'consistency'

export interface PostAdoptionBudgetV1 {
  maxModelCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  maxCostUsd: number
  /** Free/unknown-price providers must be explicitly authorized for auto mode. */
  allowUnknownCost: boolean
}

export type WorkKind = 'novel' | 'screenplay' | 'comic'
export type NovelWorkflowProfile = 'short' | 'long'

/**
 * ARCH-01: an internal scope root is not a shareable world product.
 * `world-draft` is the only identity that may appear in the world library or
 * be frozen into a WorldRelease.
 */
export type WorldIdentityKind = 'workspace-scope' | 'world-draft'

/** WORLD-2C: a stable world root inside one local workspace. */
export interface World {
  id?: number
  projectId: number
  identityKind: WorldIdentityKind
  code: string
  name: string
  description: string
  currentVersion: number
  communityOrigin?: CommunityWorldOrigin
  createdAt: number
  updatedAt: number
}

/** WORLD-2C: one authored work based on exactly one World. */
export interface Work {
  id?: number
  projectId: number
  worldId: number
  /** MEMORY-1: immutable portable identity; titles and local numeric ids may change. */
  code: string
  kind: WorkKind
  /** `null` is required for non-novel works. */
  novelProfile: NovelWorkflowProfile | null
  title: string
  description: string
  genres: string[]
  customGenre?: string
  status: WorkStatus
  targetWordCount: number
  currentWordCount: number
  coverImage?: string
  writingStyleId?: string
  methodologyId?: string
  /** 把作者确认的正文修炼进度注入后续 AI 写作；默认关闭。 */
  includeCultivationProgressInAI: boolean
  activeCharacterDrivenPlanId: number | null
  activeNarrativeModuleId: number | null
  postAdoptionPolicy: PostAdoptionPolicyV1
  postAdoptionTaskTypes: PostAdoptionTaskTypeV1[]
  postAdoptionBudget: PostAdoptionBudgetV1
  createdAt: number
  updatedAt: number
}

/**
 * Work-specific casting data. Character identity stays world-owned; a work can
 * assign a role, arc and outcome without copying or mutating that identity.
 */
export interface WorkCharacterBinding {
  id?: number
  projectId: number
  workId: number
  characterId: number
  role?: string
  arc?: string
  outcome?: string
  createdAt: number
  updatedAt: number
}

export interface WorkspaceScope {
  projectId: number
  worldId: number
  workId: number
}

export interface OwnershipScopeChange {
  tableName: string
  recordId: number
  previousOwner: 'world' | 'work'
  targetOwner: 'world' | 'work'
  changedAt: number
}

/** Immutable audit event for an explicit current-architecture scope change. */
export interface OwnershipScopeChangeRecord extends OwnershipScopeChange {
  id?: number
  projectId: number
  worldId: number
  workId: number
  createdAt: number
}

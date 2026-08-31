import type { CommunityWorldOrigin, ProjectStatus } from './project'

/**
 * PROGRESS-1: author-owned policy for work that may follow prose adoption.
 * Missing fields are intentionally interpreted as `suggest`; this keeps every
 * pre-PROGRESS-1 Work safe without a destructive IndexedDB migration.
 */
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
  identityKind?: WorldIdentityKind
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
  code?: string
  /** Missing on legacy rows, which always resolve to novel. */
  kind?: WorkKind
  /** Only meaningful for novel works. Missing legacy novel rows resolve to long. */
  novelProfile?: NovelWorkflowProfile | null
  title: string
  description: string
  genres: string[]
  status: ProjectStatus
  targetWordCount: number
  currentWordCount?: number
  coverImage?: string
  writingStyleId?: string
  methodologyId?: string
  activeCharacterDrivenPlanId?: number | null
  activeNarrativeModuleId?: number | null
  /** PROGRESS-1: omitted on legacy rows and resolved to the safe `suggest` default. */
  postAdoptionPolicy?: PostAdoptionPolicyV1
  postAdoptionTaskTypes?: PostAdoptionTaskTypeV1[]
  postAdoptionBudget?: PostAdoptionBudgetV1
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

export type OwnershipMigrationStatus = 'prepared' | 'ready' | 'failed' | 'rolled-back'

export interface WorkspaceScope {
  projectId: number
  worldId: number
  workId: number
}

export interface OwnershipBeforeImageRow {
  id: number
  hadWorldId: boolean
  hadWorkId: boolean
  worldId?: number | null
  workId?: number | null
}

export interface OwnershipBeforeImageValue {
  present: boolean
  value?: unknown
}

export interface OwnershipScopeChange {
  tableName: string
  recordId: number
  previousOwner: 'world' | 'work'
  targetOwner: 'world' | 'work'
  changedAt: number
}

/**
 * Compact ownership provenance and scope-change audit. Migrated workspaces
 * retain their recovery before-image; natively created workspaces use an
 * empty before-image and are deliberately not rollbackable. Manuscript text
 * and other content payloads are never stored here.
 */
export interface OwnershipMigrationReceipt {
  id?: number
  projectId: number
  contractVersion: number
  status: OwnershipMigrationStatus
  sourceFingerprint: string
  sourceCounts: Record<string, number>
  readyFingerprint?: string
  defaultWorldId?: number | null
  defaultWorkId?: number | null
  createdDefaultWorld?: boolean
  createdDefaultWork?: boolean
  projectBeforeImage: Record<string, OwnershipBeforeImageValue>
  ownerBeforeImages: Record<string, OwnershipBeforeImageRow[]>
  scopeChanges?: OwnershipScopeChange[]
  errorCode?: string
  preparedAt: number
  completedAt?: number
  updatedAt: number
}

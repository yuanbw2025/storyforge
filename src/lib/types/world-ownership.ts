import type { CommunityWorldOrigin, ProjectStatus } from './project'

/** WORLD-2C: a stable world root inside one local workspace. */
export interface World {
  id?: number
  projectId: number
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
 * Compact recovery evidence for the lazy ownership migration. It stores
 * only root/owner fields, never manuscript text or other content payloads.
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

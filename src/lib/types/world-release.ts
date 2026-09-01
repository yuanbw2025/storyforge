import type { NarrativeModuleKind } from './narrative-blueprint'
import type { WorldCapabilityArea } from '../registry/types'

export interface WorldRevision {
  id?: number
  projectId: number
  worldId: number
  parentRevisionId?: number | null
  revision: number
  label: string
  manifestJson: string
  contentHash: string
  createdAt: number
  updatedAt: number
}

export interface WorldRelease {
  id?: number
  /**
   * Stable release identity used by WorldReference. Unlike the local Dexie id,
   * this value survives export/import remapping and is bound to the release
   * content hash. Historical rows are deterministically backfilled by v83.
   */
  releaseUid?: string
  projectId: number
  worldId: number
  revisionId: number
  version: number
  label: string
  manifestJson: string
  contentHash: string
  sourceWorldCode: string
  createdAt: number
}

/** ARCH-01/D-WORLD-03 immutable provenance for an explicit work -> world derivation. */
export interface WorldDerivationV1 {
  id?: number
  projectId: number
  worldId: number
  sourceWorkspaceUid: string
  sourceWorkCode: string
  /** Source Work updatedAt at the instant the immutable content vector was captured. */
  sourceWorkRevision: number
  /** Full registered Canon revision vector, retained for replay and stale proof. */
  sourceRevisionVectorJson: string
  sourceKind: 'long-novel' | 'short-novel'
  sourceRangeJson: string
  selectedResourceIdsJson: string
  sourceContentHash: string
  targetRevisionId?: number | null
  targetReleaseId?: number | null
  createdAt: number
}

export interface WorldReleaseManifestV2 {
  schema: 'storyforge.world-package'
  version: 2
  /** Pure semantic world contract. */
  semanticContract: 3
  worldCode: string
  worldName: string
  workTitle: string
  selectedTables: string[]
  selectedNarrativeModules: Array<{
    exportId: number
    kind: NarrativeModuleKind
    title: string
  }>
  dependencies: Array<{
    table: string
    rowCount: number
    contentHash: string
  }>
  records: Record<string, unknown[]>
  portableProject: Record<string, unknown>
  capabilityProfile: Array<{
    area: WorldCapabilityArea
    resourceCount: number
    rowCount: number
    status: 'missing' | 'partial' | 'available'
    /** D-WORLD-01: selection and content sufficiency are separate facts. */
    selectionStatus?: 'selected' | 'partial-selection' | 'omitted'
    selectedResourceCount?: number
    omittedResourceCount?: number
    confirmedRowCount?: number
    candidateRowCount?: number
    conflictRowCount?: number
    omittedRowCount?: number
    latestRevision?: number | null
    originalEvidenceAvailable?: boolean
    queryableIndexAvailable?: boolean
  }>
  resourceCatalog: Array<{
    resourceId: string
    resourceKind: string
    area: WorldCapabilityArea
    table: string
    rowCount: number
    contentHash: string
    confirmedRowCount?: number
    candidateRowCount?: number
    conflictRowCount?: number
    omittedRowCount?: number
    latestRevision?: number | null
  }>
  sourceManifest: {
    sourceKind: 'world-draft' | 'independent-work-derivation'
    sourceWorkspaceUid: string
    sourceWorldCode: string
    sourceWorkCode: string
    selectedResourceIds: string[]
    omittedResourceIds: string[]
    contentHash: string
  }
}

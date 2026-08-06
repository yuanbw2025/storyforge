import type { NarrativeModuleKind } from './narrative-blueprint'

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

export interface WorldReleaseManifestV2 {
  schema: 'storyforge.world-package'
  version: 2
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
}

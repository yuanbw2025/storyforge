import type { WorldCapabilityArea } from '../registry/types'

export const TTRPG_WORLD_SOURCE_CONTRACT_VERSION = 2 as const
export const TTRPG_WORLD_SOURCE_MAPPING_VERSION = 2 as const

/** Stable semantic needs exposed by the neutral WorldRelease gateway. */
export const TTRPG_WORLD_SOURCE_RESOURCE_KINDS = [
  'worldview',
  'world-rules',
  'power-system',
  'cultivation-system',
  'geography',
  'history',
  'historical-event',
  'historical-keyword',
  'world-group',
  'world-link',
  'world-node',
  'location',
  'codex-category',
  'codex-entry',
  'character',
  'character-relation',
  'work-character-binding',
  'story-core',
  'story-arc',
  'outline-node',
  'detailed-outline',
] as const

export type TtrpgWorldSourceResourceKindV2 =
  typeof TTRPG_WORLD_SOURCE_RESOURCE_KINDS[number]

export interface TtrpgWorldSourceCatalogDependencyV2 {
  resourceKey: string
  relationKind: string
}

export interface TtrpgWorldSourceCatalogRecordV2 {
  resourceKey: string
  resourceKind: TtrpgWorldSourceResourceKindV2
  area: WorldCapabilityArea
  coordinate: string
  /** Numeric portable coordinate when the source has one; UI convenience only. */
  exportId: number | null
  stableKey: string | null
  label: string
  summary: string
  dependencies: TtrpgWorldSourceCatalogDependencyV2[]
}

/**
 * Product-specific metadata projection over the neutral world protocol.
 * It contains no physical table names, package roots, raw rows or executable
 * narrative modules. Product production performs actual reads through its
 * frozen ProductSourcePlan and records Context Manifest evidence.
 */
export interface TtrpgWorldSourceCatalogV2 {
  schema: 'storyforge.ttrpg-world-source-catalog'
  version: 2
  productType: 'ttrpg'
  contractVersion: 2
  worldReferenceHash: string
  worldReleaseId: number
  sourceWorldCode: string
  worldContentHash: string
  sourceMappingVersion: 2
  resources: TtrpgWorldSourceCatalogRecordV2[]
  unavailableResourceKinds: TtrpgWorldSourceResourceKindV2[]
}

import type {
  NarrativeModuleKind,
  NarrativeNodeKind,
} from './narrative-blueprint'
import type {
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
} from './character-interaction'
import type { AdventureContentV1 } from './adventure'
import type { AvgPresentationContentV1 } from './avg'
import type { FrozenProductMediaAsset } from './product-media'
import type { OpenWorldEvolutionContentV1 } from './open-world-evolution'
import type { OpenWorldContentV1 } from './open-world'
import type { RagDocumentMetadata } from './rag-library'
import type { TtrpgRuntimeContentV1 } from './ttrpg-product'
import type { ProductionProductKindV1 } from './product-identity'

/** Product-owned selection over the neutral WorldRelease resource protocol. */
export interface ProductWorldSourceSelectionV1 {
  schema: 'storyforge.product-world-source-selection'
  version: 1
  productType: ProductionProductKindV1
  worldReferenceHash: string
  resourceKeys: string[]
  roleBindings: Record<string, string[]>
}

export const NARRATIVE_BEAT_KINDS = ['narration', 'dialogue', 'action', 'system'] as const
export type NarrativeBeatKind = typeof NARRATIVE_BEAT_KINDS[number]

export interface NarrativeBeat extends RagDocumentMetadata {
  id?: number
  projectId: number
  moduleId: number
  nodeKey: string
  beatKey: string
  kind: NarrativeBeatKind
  speakerCharacterId?: number | null
  text: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface NarrativeChoice extends RagDocumentMetadata {
  id?: number
  projectId: number
  moduleId: number
  sourceNodeKey: string
  choiceKey: string
  text: string
  description: string
  unavailableReason: string
  targetNodeKey: string
  displayConditionJson: string
  availableConditionJson: string
  effectsJson: string
  tagsJson: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface FrozenNarrativeBeat {
  beatKey: string
  nodeKey: string
  kind: NarrativeBeatKind
  speakerKey: string | null
  text: string
  order: number
}

export interface FrozenNarrativeChoice {
  choiceKey: string
  sourceNodeKey: string
  text: string
  description: string
  unavailableReason: string
  targetNodeKey: string
  displayConditionJson: string
  availableConditionJson: string
  effectsJson: string
  tags: string[]
  order: number
}

export interface FrozenProductNarrativeNode {
  key: string
  kind: NarrativeNodeKind
  title: string
  summary: string
  conditionJson: string
  effectsJson: string
  successorKeys: string[]
}

export interface NarrativeContentGraphReport {
  valid: boolean
  entryKey: string | null
  reachableNodeKeys: string[]
  unreachableNodeKeys: string[]
  endingNodeKeys: string[]
  reachableEndingKeys: string[]
  deadEndNodeKeys: string[]
  danglingSuccessors: Array<{ nodeKey: string; successorKey: string }>
  invalidChoiceTargets: Array<{ choiceKey: string; targetNodeKey: string }>
  orphanBeatKeys: string[]
  orphanChoiceKeys: string[]
  cycleRisks: string[][]
  blockingCycleKeys: string[][]
  errors: string[]
}

export interface FrozenProductNarrativeV1 {
  moduleKind: NarrativeModuleKind
  moduleTitle: string
  entryNodeKey: string
  nodes: FrozenProductNarrativeNode[]
  beats: FrozenNarrativeBeat[]
  choices: FrozenNarrativeChoice[]
}

export interface FrozenInteractionRuntimeV2 {
  playerKey: 'player'
  profiles: FrozenInteractionCharacterProfile[]
  sceneTemplates: FrozenInteractionSceneTemplate[]
}

export interface FrozenRuntimeMediaAssetV2 extends FrozenProductMediaAsset {
  /** Content-addressed physical object identity; never a local row id or object URL. */
  blobContentHash: string
}

/**
 * Product-neutral immutable package shared by Build Preview and ProductRelease.
 * It contains no Dexie ids, provider credentials, binary bytes, Build ids, or Release ids.
 */
export interface ProductRuntimePackageV1 {
  schema: 'storyforge.product-runtime-package'
  version: 1
  productType: ProductionProductKindV1
  definition: {
    productKey: string
    title: string
    description: string
    enabledCapabilities: string[]
    rulesetVersion: number
    initialVariables: Record<string, unknown>
  }
  sourceWorld: {
    contentHash: string
    selection: ProductWorldSourceSelectionV1
  }
  narrative: FrozenProductNarrativeV1
  interaction?: FrozenInteractionRuntimeV2
  adventure?: AdventureContentV1
  presentation?: AvgPresentationContentV1 & { assets: FrozenRuntimeMediaAssetV2[] }
  openWorldEvolution?: OpenWorldEvolutionContentV1
  openWorld?: OpenWorldContentV1
  ttrpg?: TtrpgRuntimeContentV1
}

export interface ProductReleaseManifestV1 {
  schema: 'storyforge.product-release'
  version: 1
  productType: ProductionProductKindV1
  sourceWorldRelease: { contentHash: string }
  runtimePackage: ProductRuntimePackageV1
  packageHash: string
  productionProvenance: {
    productionKey: string
    buildNumber: number
    buildManifestHash: string
    rootTerminalReceiptHash: string
  }
  sourceContracts: {
    sourcePlan: import('./world-product-contracts').ProductSourcePlanV1
    confirmedBrief: import('./world-product-contracts').ConfirmedProductBriefV1
    sourceManifest: import('./world-product-contracts').ProductSourceManifestV1
  }
  /** Hash of every release field except lineage. */
  releaseIdentityHash: string
  lineage: import('./world-product-contracts').ProductReleaseLineageV1
}

export type CharacterInteractionProductRuntimePackageV1 = ProductRuntimePackageV1 & {
  productType: 'character-interaction'
  interaction: FrozenInteractionRuntimeV2
}
export type AdventureProductRuntimePackageV1 = ProductRuntimePackageV1 & {
  productType: 'text-adventure'
  interaction: FrozenInteractionRuntimeV2
  adventure: AdventureContentV1
}
export type AvgProductRuntimePackageV1 = ProductRuntimePackageV1 & {
  productType: 'avg'
  presentation: AvgPresentationContentV1 & { assets: FrozenRuntimeMediaAssetV2[] }
}
export type TextOpenWorldProductRuntimePackageV1 = ProductRuntimePackageV1 & {
  productType: 'text-open-world'
  interaction: FrozenInteractionRuntimeV2
  adventure: AdventureContentV1
  openWorldEvolution: OpenWorldEvolutionContentV1
  openWorld: OpenWorldContentV1
}

export type AnyProductReleaseManifest = ProductReleaseManifestV1

export interface ProductRelease {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionKey: string
  productType: ProductionProductKindV1
  /** Optional local provenance locator; runtime never dereferences it. */
  worldReleaseId: number | null
  version: number
  label: string
  manifestJson: string
  contentHash: string
  createdAt: number
  distributionProvenance?: {
    source: 'marketplace'
    listingId: string
    orderId: string | null
    entitlementId: string | null
    license: {
      licenseId: string
      licenseVersion: string
      allowOfflineExport: boolean
      allowRemix: boolean
      commercialReuse: boolean
      requiresAttribution: boolean
      termsUrl: string
    }
    attribution: string[]
    localCopyPreserved: boolean
    acquiredAt: number
    importedAt: number
  }
}

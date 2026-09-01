import type {
  NarrativeCondition,
  NarrativeEffect,
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
import type { NarrativeSimulationContentV1 } from './narrative-simulation'
import type { OpenWorldContentV1 } from './open-world'
import type { RagDocumentMetadata } from './rag-library'
import type { TtrpgRuntimeContentV1 } from './ttrpg-product'

export const GAME_PRODUCT_TYPES = [
  'storygame',
  'character-interaction',
  'text-adventure',
  'avg',
  'narrative-simulation',
  'text-open-world',
  'ttrpg',
] as const
export type GameProductType = typeof GAME_PRODUCT_TYPES[number]

/**
 * Product-owned selection over the neutral WorldRelease resource protocol.
 *
 * The selection deliberately contains no world table names, export ids,
 * executable narrative modules or media assets. Product requirement adapters
 * assign semantic resources to product-local roles; the product Build owns all
 * narrative, media and runtime state created from those resources.
 */
export interface ProductWorldSourceSelectionV1 {
  schema: 'storyforge.product-world-source-selection'
  version: 1
  productType: GameProductType
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

export interface FrozenGameNarrativeNode {
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

export interface FrozenGameNarrativeV2 {
  moduleKind: NarrativeModuleKind
  moduleTitle: string
  entryNodeKey: string
  nodes: FrozenGameNarrativeNode[]
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
 * Product-neutral immutable package shared by Build Preview and GameRelease v2.
 * It contains no Dexie ids, provider credentials, binary bytes, Build ids, or Release ids.
 */
export interface GameRuntimePackageV2 {
  schema: 'storyforge.game-runtime-package'
  version: 2
  productType: GameProductType
  definition: {
    gameKey: string
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
  narrative: FrozenGameNarrativeV2
  interaction?: FrozenInteractionRuntimeV2
  adventure?: AdventureContentV1
  presentation?: AvgPresentationContentV1 & { assets: FrozenRuntimeMediaAssetV2[] }
  simulation?: NarrativeSimulationContentV1
  openWorld?: OpenWorldContentV1
  ttrpg?: TtrpgRuntimeContentV1
}

export interface GameReleaseManifestV2 {
  schema: 'storyforge.game-release'
  version: 2
  productType: GameProductType
  sourceWorldRelease: {
    contentHash: string
  }
  runtimePackage: GameRuntimePackageV2
  packageHash: string
  productionProvenance: {
    productionKey: string
    buildNumber: number
    buildManifestHash: string
    rootTerminalReceiptHash: string
  } | null
}

export type StoryGameRuntimePackageV2 = GameRuntimePackageV2 & { productType: 'storygame' }
export type InteractionGameRuntimePackageV2 = GameRuntimePackageV2 & {
  productType: 'character-interaction'
  interaction: FrozenInteractionRuntimeV2
}
export type AdventureGameRuntimePackageV2 = GameRuntimePackageV2 & {
  productType: 'text-adventure'
  interaction: FrozenInteractionRuntimeV2
  adventure: AdventureContentV1
}
export type AvgGameRuntimePackageV2 = GameRuntimePackageV2 & {
  productType: 'avg'
  presentation: AvgPresentationContentV1 & { assets: FrozenRuntimeMediaAssetV2[] }
}
export type NarrativeSimulationGameRuntimePackageV2 = GameRuntimePackageV2 & {
  productType: 'narrative-simulation'
  simulation: NarrativeSimulationContentV1
}
export type TextOpenWorldGameRuntimePackageV2 = GameRuntimePackageV2 & {
  productType: 'text-open-world'
  interaction: FrozenInteractionRuntimeV2
  adventure: AdventureContentV1
  simulation: NarrativeSimulationContentV1
  openWorld: OpenWorldContentV1
}

export type AnyGameReleaseManifest = GameReleaseManifestV2

export interface GameRelease {
  id?: number
  projectId: number
  worldId: number
  workId: number
  /** Stable product release line within the owning Work. */
  productionKey: string
  /** Optional local provenance locator; runtime never dereferences it. */
  worldReleaseId: number | null
  version: number
  label: string
  manifestJson: string
  contentHash: string
  createdAt: number
  /** Optional marketplace receipt; contains no access/payment credential. */
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

export interface NarrativeChoiceEvaluation {
  choiceKey: string
  visible: boolean
  available: boolean
  unavailableReason: string
  targetNodeKey: string
}

export interface NarrativeChoiceCommittedPayload {
  commandId: string
  baseSequence: number
  baseStateHash: string
  fromNodeKey: string
  choiceKey: string
  toNodeKey: string
}

export interface NarrativeChoiceHistoryEntry {
  eventSequence: number
  choiceKey: string
  fromNodeKey: string
  toNodeKey: string
}

export type ParsedNarrativeCondition = NarrativeCondition
export type ParsedNarrativeEffect = NarrativeEffect

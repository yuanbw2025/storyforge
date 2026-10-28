import type {
  NarrativeModuleKind,
  NarrativeNodeKind,
} from './narrative-blueprint'
import type {
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
} from './character-interaction'
import type { AdventureContentV1 } from './adventure'
import type { AdventureContent } from './adventure-v2'
import type { AvgPresentationContentV1 } from './avg'
import type { AvgRuntimeModuleV1 } from '../avg/runtime-contract-v2'
import type { AvgRuntimeModuleV2 } from '../avg/executable-module'
import type { FrozenProductMediaAsset } from './product-media'
import type { OpenWorldEvolutionContentV1 } from './open-world-evolution'
import type { OpenWorldContentV1 } from './open-world'
import type { RagDocumentMetadata } from './rag-library'
import type { TtrpgRuntimeContentV1 } from './ttrpg-product'
import type { ProductionProductKindV1 } from './product-identity'
import type { AiTownRuntimeContentV1 } from './ai-town'
import type { TextOpenWorldRuntimePackageV1 } from './text-open-world-runtime'

/** Product-owned selection over the neutral WorldRelease resource protocol. */
export interface ProductWorldSourceSelectionV1 {
  schema: 'storyforge.product-world-source-selection'
  version: 1
  productType: ProductionProductKindV1
  worldReferenceHash: string
  resourceKeys: string[]
  roleBindings: Record<string, string[]>
}
export interface ProductWorldSourceSelectionV2 extends Omit<ProductWorldSourceSelectionV1, 'version' | 'productType'> {
  version: 2
  productType: 'character-interaction' | 'avg'
}
export type ProductWorldSourceSelection = ProductWorldSourceSelectionV1 | ProductWorldSourceSelectionV2

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
  chatSource?: import('./character-interaction').FrozenChatSourceProjectionV1
  /** Experimental chat narrative module; absent in existing releases. */
  chatNarrative?: import('./chat-narrative').FrozenChatNarrativeV1
  /** Player-visible images owned by this frozen product, never by the world. */
  chatMedia?: import('../character-interaction/media-contract').ChatMediaBindingsV1
  chatVisualDesign?: import('../character-interaction/visual-design').ChatVisualDesignV1
  /** Attribution for converted external cards; never copied into role knowledge. */
  chatCardCredits?: import('../character-interaction/card-credits').ChatCharacterCardCreditsV1
  /** Public author statements, frozen per release and excluded from AI knowledge. */
  chatExperienceInfo?: import('../character-interaction/experience-info').ChatExperienceInfoV1
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
    selection: ProductWorldSourceSelection
  }
  narrative: FrozenProductNarrativeV1
  interaction?: FrozenInteractionRuntimeV2
  adventure?: AdventureContent
  presentation?: AvgPresentationContentV1 & { assets: FrozenRuntimeMediaAssetV2[] }
  openWorldEvolution?: OpenWorldEvolutionContentV1
  openWorld?: OpenWorldContentV1
  /**
   * TEXT-OPEN-WORLD-2 governed runtime payload. Existing text-open-world releases
   * may omit it; every vNext release/build includes it inside the one shared
   * ProductRuntimePackage instead of creating a parallel release family.
   */
  textOpenWorldVNext?: TextOpenWorldRuntimePackageV1
  ttrpg?: TtrpgRuntimeContentV1
  town?: AiTownRuntimeContentV1
}

export interface ProductReleaseManifestV1 {
  schema: 'storyforge.product-release'
  version: 1
  productType: ProductionProductKindV1
  /** Legacy/shared runtime source coordinate. Creator releases additionally
   * carry the authoritative dual-source contract below and never use this
   * field or `ProductRelease.worldReleaseId` as a novel locator. */
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
    sourcePlan: import('./world-product-contracts').ProductSourcePlan
    confirmedBrief: import('./world-product-contracts').ConfirmedProductBriefV1
    sourceManifest: import('./world-product-contracts').ProductSourceManifest
  } | import('./text-open-world-production').TextOpenWorldCreatorReleaseSourceContractsV1
  /** Hash of every release field except lineage. */
  releaseIdentityHash: string
  lineage: import('./world-product-contracts').ProductReleaseLineageV1
    | import('./text-open-world-production').TextOpenWorldCreatorReleaseLineageV1
}

export type CharacterInteractionProductRuntimePackageV1 = ProductRuntimePackageV1 & {
  productType: 'character-interaction'
  interaction: FrozenInteractionRuntimeV2
}
export type AdventureProductRuntimePackageV1 = ProductRuntimePackageV1 & {
  productType: 'text-adventure'
  interaction: FrozenInteractionRuntimeV2
  adventure: AdventureContent
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
  textOpenWorldVNext?: TextOpenWorldRuntimePackageV1
}
export type AiTownProductRuntimePackageV1 = ProductRuntimePackageV1 & {
  productType: 'ai-town'
  interaction: FrozenInteractionRuntimeV2
  town: AiTownRuntimeContentV1
}

export type TextOpenWorldLegacyOnlyProductRuntimePackageV1 =
  Omit<TextOpenWorldProductRuntimePackageV1, 'textOpenWorldVNext' | 'presentation'> & {
    textOpenWorldVNext?: undefined
    presentation?: undefined
  }

export type TextOpenWorldHybridProductRuntimePackageV1 =
  TextOpenWorldProductRuntimePackageV1 & {
    textOpenWorldVNext: TextOpenWorldRuntimePackageV1
    /** Optional vNext media; when present every inner slot asset must close to
     * exactly one frozen outer presentation asset. */
    presentation?: AvgPresentationContentV1 & { assets: FrozenRuntimeMediaAssetV2[] }
  }

/**
 * A vNext-only text-open-world package deliberately omits the four legacy
 * runtime modules. Keeping this shape separate preserves the stricter legacy
 * contract for old command code while allowing product readers and players to
 * model all three formal release states: legacy-only, hybrid, and vNext-only.
 */
export type TextOpenWorldVNextOnlyProductRuntimePackageV1 = ProductRuntimePackageV1 & {
  productType: 'text-open-world'
  interaction?: undefined
  adventure?: undefined
  openWorldEvolution?: undefined
  openWorld?: undefined
  textOpenWorldVNext: TextOpenWorldRuntimePackageV1
}

export type PlayableTextOpenWorldProductRuntimePackageV1 =
  | TextOpenWorldLegacyOnlyProductRuntimePackageV1
  | TextOpenWorldHybridProductRuntimePackageV1
  | TextOpenWorldVNextOnlyProductRuntimePackageV1

/** Shared V2 carrier. Product-owned modules are admitted only by registered
 * typed codecs. BASE-00B admits an inert AVG module; V2 runtime remains closed. */
export interface ProductRuntimePackageV2 {
  schema: 'storyforge.product-runtime-package'
  version: 2
  productType: 'avg'
  definition: ProductRuntimePackageV1['definition']
  sourceWorld: ProductRuntimePackageV1['sourceWorld']
  narrative: FrozenProductNarrativeV1
  modules: Array<AvgRuntimeModuleV1 | AvgRuntimeModuleV2>
  presentation?: undefined
  interaction?: undefined
  adventure?: undefined
  openWorldEvolution?: undefined
  openWorld?: undefined
  textOpenWorldVNext?: undefined
  ttrpg?: undefined
  town?: undefined
}

export type AnyProductRuntimePackage = ProductRuntimePackageV1 | ProductRuntimePackageV2
  | import('../ttrpg/content-version').ProductRuntimePackageWithTtrpgV2

export interface ProductReleaseManifestV2 extends Omit<ProductReleaseManifestV1,
  'version' | 'productType' | 'runtimePackage' | 'sourceContracts' | 'lineage'> {
  version: 2
  productType: 'avg'
  runtimePackage: ProductRuntimePackageV2
  sourceContracts: {
    sourcePlan: import('./world-product-contracts').ProductSourcePlan
    confirmedBrief: import('./world-product-contracts').ConfirmedProductBriefV1
    sourceManifest: import('./world-product-contracts').ProductSourceManifest
  }
  lineage: import('./world-product-contracts').ProductReleaseLineageV1
}

export type AnyProductReleaseManifest = ProductReleaseManifestV1 | ProductReleaseManifestV2
  | import('../ttrpg/content-version').ProductReleaseManifestWithTtrpgV2

export interface ProductReleaseMarketplaceProvenanceV1 {
  source: 'marketplace' | 'community-bundle'
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

export interface ProductReleaseLocalFileProvenanceV1 {
  source: 'local-file'
  candidatePackageHash: string
  originalReleaseHash: string
  candidateStatus: 'eligible-for-community-submission'
  remoteCreatorIdentityVerified: false
  localCopyPreserved: true
  importedAt: number
}

/** A verified, self-contained file; it carries no marketplace or creator claim. */
export interface ProductReleaseLocalBundleProvenanceV1 {
  source: 'local-bundle'
  bundleHash: string
  originalReleaseHash: string
  remoteCreatorIdentityVerified: false
  localCopyPreserved: true
  importedAt: number
}

export type ProductReleaseDistributionProvenanceV1 =
  | ProductReleaseMarketplaceProvenanceV1
  | ProductReleaseLocalFileProvenanceV1
  | ProductReleaseLocalBundleProvenanceV1

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
  distributionProvenance?: ProductReleaseDistributionProvenanceV1
}

/** Player view preserves the actual package version; no V2-to-V1 conversion. */
export type AvgPlayableRuntimePackage = AvgProductRuntimePackageV1 | ProductRuntimePackageV2

import { type WorldSourcePurposeProofV1 } from '../world-engine/source-purpose-contract'
import type {
  ContextAccessPolicyV1,
  ContextResourceDepthV1,
  ContextResourceKind,
  WorldCapabilityArea,
} from '../registry/types'
import type { AgentContextTaskKind } from '../agent/context-policy'
import type { UpperProductKindV1 } from './product-identity'

export type { UpperProductKindV1 } from './product-identity'

/** Immutable stage-one handoff. `localReleaseRecordId` is a remappable locator,
 * never part of the portable reference identity. */
export interface WorldReferenceV1 {
  schema: 'storyforge.world-reference'
  version: 1
  worldCode: string
  releaseUid: string
  releaseVersion: number
  releaseHash: string
  localReleaseRecordId: number
  manifestIdentity: {
    schema: 'storyforge.world-release'
    version: 3
    semanticContract: 3
    schemaHash: string
  }
  capabilityIdentity: {
    catalogHash: string
    profileHash: string
  }
  referenceHash: string
}

/** Neutral, read-only catalog entry shown while an upper product chooses its
 * immutable world source. The physical WorldRelease row and manifest are never
 * exposed across the product boundary. */
export interface WorldReferenceCatalogEntryV1 {
  reference: WorldReferenceV1
  label: string
  createdAt: number
}
export type WorldReferenceCatalogEntry = Omit<WorldReferenceCatalogEntryV1, 'reference'> & {
  reference: WorldReferenceV1 | import('./world-query').WorldReferenceV2
}

export type WorldRequirementLevelV1 =
  | 'stable-required'
  | 'recommended'
  | 'conditional'
  | 'prohibited'

export interface WorldResourceSelectorV1 {
  areas: WorldCapabilityArea[]
  resourceKinds: string[]
  contextKinds: ContextResourceKind[]
  query: string | null
}

export interface WorldRequirementRuleV1 {
  key: string
  label: string
  level: WorldRequirementLevelV1
  selector: WorldResourceSelectorV1
  minimumResources: number
  /** Conditions are resolved by typed product code before a plan is frozen. */
  condition: null | {
    key: string
    active: boolean
    reason: string
  }
}

export type WorldRequirementStatusV1 =
  | 'matched'
  | 'missing'
  | 'conflict'
  | 'omitted'
  | 'insufficient'

export interface WorldRequirementResolutionV1 extends WorldRequirementRuleV1 {
  status: WorldRequirementStatusV1
  matchedResourceKeys: string[]
  availableResourceCount: number
  reasonCodes: string[]
}

export interface WorldRequirementAdapterSnapshotV1 {
  adapterId: string
  adapterVersion: number
  productType: UpperProductKindV1
  contextTaskKind: AgentContextTaskKind
  contractHash: string
}

export interface ContextManifestPointerV1 {
  stepId: string
  attempt: number
  manifestHash: string
}
/** Local locator accepted while aggregating evidence. It is deliberately not
 * serialized into ProductSourceManifest so import/remapping cannot change the
 * product release identity. */
export interface LocalContextManifestAttemptV1 extends ContextManifestPointerV1 {
  runId: number
}

export type ProductSourceMissingStrategyV1 =
  | 'block'
  | 'ask-author'
  | 'product-private-supplement'
  | 'degrade-explicitly'

/** Stage-two frozen read authority. It contains permissions and discovery
 * results, not a fabricated list of resources that a future run will use. */
export interface ProductSourcePlanV1 {
  schema: 'storyforge.product-source-plan'
  version: 1
  productType: UpperProductKindV1
  productInstanceKey: string
  worldReference: WorldReferenceV1
  /** Optional because historical frozen plans keep their original bytes. */
  sourcePurpose?: WorldSourcePurposeProofV1
  adapter: WorldRequirementAdapterSnapshotV1
  requirements: WorldRequirementResolutionV1[]
  /** User/adapter selected starting set. Production may progressively discover
   * more resources inside permission, and must record those actual reads. */
  initialResourceKeys: string[]
  permission: {
    /** Exact adapter-owned selectors. Empty `resourceKinds` means every kind
     * inside that selector's declared areas/context kinds, not a global
     * wildcard that can accidentally widen another rule. */
    allowedSelectors: WorldResourceSelectorV1[]
    prohibitedSelectors: WorldResourceSelectorV1[]
    allowedAreas: WorldCapabilityArea[]
    allowedResourceKinds: string[]
    allowedContextKinds: ContextResourceKind[]
    allowedDepths: ContextResourceDepthV1[]
    prohibitedAreas: WorldCapabilityArea[]
    prohibitedResourceKinds: string[]
  }
  gatewayPolicy: ContextAccessPolicyV1
  gatewayPolicyHash: string
  missingStrategy: ProductSourceMissingStrategyV1
  consultationContextManifests: ContextManifestPointerV1[]
  readiness: 'ready' | 'ready-with-gaps' | 'blocked'
  createdAt: number
  planHash: string
}

/** Exact read authority. V1 stays readable with its original count-based
 * semantics; saving an enhanced product Brief creates a new V2 plan. */
export interface ProductSourcePlanV2 extends Omit<ProductSourcePlanV1, 'version' | 'worldReference'> {
  version: 2
  worldReference: WorldReferenceV1 | import('./world-query').WorldReferenceV2
  compiler: {
    compilerId: string
    compilerVersion: 1
    briefHash: string
    configurationHash: string
    resolverVersion: 'world-neutral-closure-v2' | 'narrative-neutral-closure-v1'
  }
  configuration: {
    inheritStoryContinuity: boolean
    allowCrossWorld: boolean
    roleBindings: Record<string, string[]>
  }
  exact: {
    authorResourceKeys: string[]
    dependencyResourceKeys: string[]
    requiredResourceKeys: string[]
    permittedResourceKeys: string[]
    closureHash: string
    resources: Array<{
      resourceKey: string
      minimumDepth: 'original'
      area: WorldCapabilityArea
      resourceKind: string
      contextKind: ContextResourceKind
      contentHash: string
      /** Portable references omit only the local WorldRelease row locator. */
      sourceRefsHash: string
    }>
    requirements: Array<{
      requirementKey: string
      requiredResourceKeys: string[]
      condition: null | {
        expressionVersion: 'brief-derived-boolean-v1'
        field: 'inheritStoryContinuity' | 'allowCrossWorld'
        value: boolean
        result: boolean
        briefHash: string
      }
    }>
    slices: Array<{
      key: 'adaptation' | 'content' | 'integration'
      purpose: string
      resourceKeys: string[]
    }>
    views: ['canon']
    audiences: ['product-author']
    branches: ['canon']
    timeBound: null
  }
}

export type ProductSourcePlan = ProductSourcePlanV1 | ProductSourcePlanV2

/** Cross-product logical projection of a product-owned confirmed Brief row. */
export interface ConfirmedProductBriefV1 {
  schema: 'storyforge.confirmed-product-brief'
  version: 1
  productType: UpperProductKindV1
  productInstanceKey: string
  sourcePlanHash: string
  briefRevision: number
  briefContentHash: string
  authorStartRevision: number
  confirmedBy: 'author'
  confirmedAt: number
  confirmationHash: string
}

export interface ProductSourceManifestResourceV1 {
  resourceKey: string
  area: WorldCapabilityArea
  resourceKind: string
  status: WorldRequirementStatusV1
  depths: ContextResourceDepthV1[]
  contentHashes: string[]
  sourceRefsHash: string | null
  contextManifestHashes: string[]
  reasonCodes: string[]
}

/** Stage-three release evidence, aggregated only from exact ContextManifestV3
 * artifacts belonging to durable production runs. */
export interface ProductSourceManifestV1 {
  schema: 'storyforge.product-source-manifest'
  version: 1
  productType: UpperProductKindV1
  productInstanceKey: string
  worldReferenceHash: string
  sourcePlanHash: string
  runContextManifests: ContextManifestPointerV1[]
  requirementOutcomes: Array<{
    requirementKey: string
    status: WorldRequirementStatusV1
    evidenceResourceKeys: string[]
    reasonCodes: string[]
  }>
  resources: ProductSourceManifestResourceV1[]
  summary: {
    matched: number
    missing: number
    conflict: number
    omitted: number
    insufficient: number
  }
  createdAt: number
  manifestHash: string
}

export interface ProductSourceManifestV2 extends Omit<ProductSourceManifestV1, 'version'> {
  version: 2
  exactEvidence: {
    compilerHash: string
    closureHash: string
    requiredResourceKeys: string[]
    resourceRequirementsHash: string
  }
}
export type ProductSourceManifest = ProductSourceManifestV1 | ProductSourceManifestV2

export interface ProductReleaseLineageV1 {
  schema: 'storyforge.product-release-lineage'
  version: 1
  productType: UpperProductKindV1
  productInstanceKey: string
  releaseUid: string
  releaseVersion: number
  releaseHash: string
  parentRelease: null | { releaseUid: string; releaseHash: string }
  worldReferenceHash: string
  sourcePlanHash: string
  sourceManifestHash: string
  confirmedBriefHash: string
  build: { buildUid: string; buildHash: string }
  quality: { passed: boolean; receiptHashes: string[] }
  compatibility: {
    status: 'initial' | 'compatible' | 'requires-migration' | 'incompatible'
    protocolVersion: number
    evidenceHashes: string[]
  }
  createdAt: number
  lineageHash: string
}
/** Runtime inherits a frozen plan; these products make no direct world reads. */
export interface ProductRuntimeSourceManifestV1 {
  schema: 'storyforge.product-runtime-source-manifest'
  version: 1
  productType: 'character-interaction' | 'avg'
  sourceKind: 'release' | 'build-preview'
  sourceIdentityHash: string
  packageHash: string
  sourceWorldContentHash: string
  sourcePlanHash: string
  worldReferenceHash: string
  inheritedSourceManifestHash: string | null
  readMode: 'frozen-product-package'
  directWorldReads: []
  manifestHash: string
}

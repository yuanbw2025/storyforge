import type {
  ContextAccessPolicyV1,
  ContextResourceDepthV1,
  ContextResourceKind,
  WorldCapabilityArea,
} from '../registry/types'
import type { AgentContextTaskKind } from '../agent/context-policy'

export type UpperProductKindV1 =
  | 'ttrpg'
  | 'character-interaction'
  | 'ai-town'
  | 'text-adventure'
  | 'avg'
  | 'open-world-text-game'
  | (string & {})

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
    schema: 'storyforge.world-package'
    version: 2
    semanticContract: 3
    schemaHash: string
  }
  capabilityIdentity: {
    catalogHash: string
    profileHash: string
  }
  referenceHash: string
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

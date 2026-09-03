import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  createProductReleaseManifestV1,
  productReleaseIdentityHashV1,
  parseProductRuntimePackageV1,
} from '../../src/lib/product-production/runtime-package'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type {
  ConfirmedProductBriefV1,
  ProductReleaseManifestV1,
  ProductRuntimePackageV1,
  ProductReleaseLineageV1,
  ProductSourceManifestV1,
  ProductSourcePlanV1,
  WorldReferenceV1,
} from '../../src/lib/types'
import {
  createConfirmedProductBriefV1,
  createProductReleaseLineageV1,
  productReleaseUidV1,
} from '../../src/lib/product/source-contracts'
import { worldReleaseUidV1 } from '../../src/lib/world-engine/releases'

const CREATED_AT = 1_700_000_000_000

/**
 * Strict protocol fixture. It creates all five release contracts rather than
 * bypassing the formal production boundary with the retired nullable release
 * provenance shape.
 */
export async function createFixtureProductReleaseManifestV1(input: {
  runtimePackage: ProductRuntimePackageV1
  productionProvenance?: ProductReleaseManifestV1['productionProvenance']
  productionKey?: string
  releaseVersion?: number
  parentRelease?: ProductReleaseLineageV1['parentRelease']
}): Promise<ProductReleaseManifestV1> {
  const releaseVersion = input.releaseVersion ?? 1
  const productionKey = input.productionProvenance?.productionKey
    ?? input.productionKey
    ?? 'fixture.product'
  const sourceWorldHash = input.runtimePackage.sourceWorld.contentHash
  const worldCode = 'WORLD-FIXTURE'
  const portableReferenceBody: Omit<WorldReferenceV1, 'referenceHash'> = {
    schema: 'storyforge.world-reference',
    version: 1,
    worldCode,
    releaseUid: worldReleaseUidV1({ worldCode, version: 1, contentHash: sourceWorldHash }),
    releaseVersion: 1,
    releaseHash: sourceWorldHash,
    localReleaseRecordId: 0,
    manifestIdentity: {
      schema: 'storyforge.world-release', version: 3, semanticContract: 3,
      schemaHash: await hashCanonicalValue({ schema: 'storyforge.world-release', version: 3, semanticContract: 3 }),
    },
    capabilityIdentity: {
      catalogHash: await hashCanonicalValue({ fixture: 'catalog' }),
      profileHash: await hashCanonicalValue({ fixture: 'profile' }),
    },
  }
  const { localReleaseRecordId: _localLocator, ...referenceIdentity } = portableReferenceBody
  const worldReference: WorldReferenceV1 = {
    ...portableReferenceBody,
    referenceHash: await hashCanonicalValue(referenceIdentity),
  }
  const runtimePackage = parseProductRuntimePackageV1({
    ...structuredClone(input.runtimePackage),
    sourceWorld: {
      ...structuredClone(input.runtimePackage.sourceWorld),
      selection: {
        ...structuredClone(input.runtimePackage.sourceWorld.selection),
        worldReferenceHash: worldReference.referenceHash,
      },
    },
  })
  const selectedResourceKey = runtimePackage.sourceWorld.selection.resourceKeys[0] ?? 'fixture.world.resource'
  const selector = {
    areas: ['foundation'] as const,
    resourceKinds: ['worldview'],
    contextKinds: ['worldview-field'] as const,
    query: null,
  }
  const gatewayPolicy: ProductSourcePlanV1['gatewayPolicy'] = {
    version: 'context-access-policy-v1',
    policyId: 'fixture-release-world-source-v1',
    mandatorySourceKeys: ['worldRelease'], allowedSourceKeys: ['worldRelease'],
    allowedResourceKinds: ['worldview-field'],
    allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
    selectorPolicyId: 'fixture-release-selector-v1',
    maxReadCalls: 8, maxRetrievedTokens: 8_000, allowOriginalRead: true,
    candidateAccess: 'forbidden',
  }
  const requirements: ProductSourcePlanV1['requirements'] = [{
    key: 'fixture-world-source', label: 'fixture world source', level: 'stable-required',
    selector: {
      areas: [...selector.areas], resourceKinds: [...selector.resourceKinds],
      contextKinds: [...selector.contextKinds], query: null,
    },
    minimumResources: 1, condition: null, status: 'matched',
    matchedResourceKeys: [selectedResourceKey], availableResourceCount: 1,
    reasonCodes: ['fixture-exact-source'],
  }]
  const planBody: Omit<ProductSourcePlanV1, 'planHash'> = {
    schema: 'storyforge.product-source-plan', version: 1,
    productType: runtimePackage.productType, productInstanceKey: productionKey,
    worldReference,
    adapter: {
      adapterId: `fixture.${runtimePackage.productType}.world-requirements`,
      adapterVersion: 1, productType: runtimePackage.productType,
      contextTaskKind: 'agent-outline',
      contractHash: await hashCanonicalValue({ fixture: runtimePackage.productType }),
    },
    requirements,
    initialResourceKeys: [selectedResourceKey],
    permission: {
      allowedSelectors: [requirements[0]!.selector], prohibitedSelectors: [],
      allowedAreas: ['foundation'], allowedResourceKinds: ['worldview'],
      allowedContextKinds: ['worldview-field'],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      prohibitedAreas: [], prohibitedResourceKinds: [],
    },
    gatewayPolicy,
    gatewayPolicyHash: await hashCanonicalValue(gatewayPolicy),
    missingStrategy: 'block', consultationContextManifests: [], readiness: 'ready',
    createdAt: CREATED_AT,
  }
  const { localReleaseRecordId: _planLocal, ...portablePlanReference } = planBody.worldReference
  const sourcePlan: ProductSourcePlanV1 = {
    ...planBody,
    planHash: await hashCanonicalValue({
      ...planBody,
      worldReference: portablePlanReference,
    }),
  }
  const confirmedBrief: ConfirmedProductBriefV1 = await createConfirmedProductBriefV1({
    productType: runtimePackage.productType,
    productInstanceKey: productionKey,
    sourcePlan,
    briefRevision: 1,
    briefContentHash: await hashProductProductionValueV2(runtimePackage),
    authorStartRevision: 1,
    confirmedAt: CREATED_AT,
  })
  const resourceContentHash = await hashCanonicalValue({ resourceKey: selectedResourceKey })
  const manifestBody: Omit<ProductSourceManifestV1, 'manifestHash'> = {
    schema: 'storyforge.product-source-manifest', version: 1,
    productType: runtimePackage.productType, productInstanceKey: productionKey,
    worldReferenceHash: worldReference.referenceHash, sourcePlanHash: sourcePlan.planHash,
    runContextManifests: [],
    requirementOutcomes: [{
      requirementKey: requirements[0]!.key, status: 'matched',
      evidenceResourceKeys: [selectedResourceKey], reasonCodes: ['fixture-exact-source'],
    }],
    resources: [{
      resourceKey: selectedResourceKey, area: 'foundation', resourceKind: 'worldview',
      status: 'matched', depths: ['full'], contentHashes: [resourceContentHash],
      sourceRefsHash: await hashCanonicalValue({ fixture: 'source-ref' }),
      contextManifestHashes: [], reasonCodes: ['fixture-exact-source'],
    }],
    summary: { matched: 1, missing: 0, conflict: 0, omitted: 0, insufficient: 0 },
    createdAt: CREATED_AT,
  }
  const sourceManifest: ProductSourceManifestV1 = {
    ...manifestBody,
    manifestHash: await hashCanonicalValue(manifestBody),
  }
  const productionProvenance: ProductReleaseManifestV1['productionProvenance'] = input.productionProvenance ?? {
    productionKey,
    buildNumber: 1,
    buildManifestHash: await hashCanonicalValue({ productionKey, fixture: 'build' }),
    rootTerminalReceiptHash: await hashCanonicalValue({ productionKey, fixture: 'root-receipt' }),
  }
  const sourceContracts = { sourcePlan, confirmedBrief, sourceManifest }
  const identityBody: Omit<ProductReleaseManifestV1, 'releaseIdentityHash' | 'lineage'> = {
    schema: 'storyforge.product-release', version: 1,
    productType: runtimePackage.productType,
    sourceWorldRelease: { contentHash: runtimePackage.sourceWorld.contentHash },
    runtimePackage,
    packageHash: await hashProductProductionValueV2(runtimePackage),
    productionProvenance,
    sourceContracts,
  }
  const releaseIdentityHash = await productReleaseIdentityHashV1(identityBody)
  const releaseUid = productReleaseUidV1({
    productType: runtimePackage.productType,
    productInstanceKey: productionKey,
    releaseVersion,
    releaseHash: releaseIdentityHash,
  })
  const lineage = await createProductReleaseLineageV1({
    productType: runtimePackage.productType,
    productInstanceKey: productionKey,
    releaseUid,
    releaseVersion,
    releaseHash: releaseIdentityHash,
    parentRelease: input.parentRelease ?? null,
    worldReference,
    sourcePlan,
    sourceManifest,
    confirmedBrief,
    build: { buildUid: `fixture-build-${releaseVersion}`, buildHash: productionProvenance.buildManifestHash },
    quality: { passed: true, receiptHashes: [productionProvenance.rootTerminalReceiptHash] },
    compatibility: {
      status: releaseVersion === 1 ? 'initial' : 'compatible',
      protocolVersion: 1,
      evidenceHashes: [],
    },
    createdAt: CREATED_AT,
  })
  return createProductReleaseManifestV1({ runtimePackage, productionProvenance, sourceContracts, lineage })
}

import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createProductReleaseManifestV2, productReleaseIdentityHashV2 } from '../../src/lib/product-production/runtime-package'
import { createProductBuildPreviewManifestV2 } from '../../src/lib/product-production/preview-manifest'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductReleaseLineageV1, productReleaseUidV1 } from '../../src/lib/product/source-contracts'
import type { ProductReleaseManifestV2, ProductRuntimePackageV1, ProductRuntimePackageV2 } from '../../src/lib/types'
import { currentProductSelection } from './current-product-world'
import { createFixtureProductReleaseManifestV1 } from './product-release-v1'

const HASH = 'a'.repeat(64)

export function legacyPackage(): ProductRuntimePackageV1 {
  return {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'avg',
    definition: { productKey: 'fixture.avg', title: 'Protocol fixture', description: '',
      enabledCapabilities: ['narrative', 'presentation'], rulesetVersion: 1, initialVariables: {} },
    sourceWorld: { contentHash: HASH, selection: currentProductSelection('avg', {
      story: ['world-release:fixture:semantic:story-core:2'],
    }, 'd'.repeat(64)) },
    narrative: {
      moduleKind: 'main', moduleTitle: 'Fixture', entryNodeKey: 'ending.home',
      nodes: [{ key: 'ending.home', kind: 'ending', title: 'Home', summary: '',
        conditionJson: '{}', effectsJson: '[]', successorKeys: [] }],
      beats: [{ beatKey: 'beat.home', nodeKey: 'ending.home', kind: 'narration',
        speakerKey: null, text: 'Home.', order: 0 }], choices: [],
    },
    presentation: { version: 1, cues: [], assets: [] },
  }
}

export async function fixture() {
  const legacy = await createFixtureProductReleaseManifestV1({ runtimePackage: legacyPackage() })
  if ('schema' in legacy.sourceContracts) throw new Error('Expected shared source fixture')
  const runtimePackage: ProductRuntimePackageV2 = {
    schema: 'storyforge.product-runtime-package', version: 2, productType: 'avg',
    definition: { ...legacy.runtimePackage.definition, enabledCapabilities: ['narrative'] },
    sourceWorld: legacy.runtimePackage.sourceWorld, narrative: legacy.runtimePackage.narrative, modules: [],
  }
  const body: Omit<ProductReleaseManifestV2, 'releaseIdentityHash' | 'lineage'> = {
    schema: 'storyforge.product-release', version: 2, productType: 'avg', runtimePackage,
    sourceWorldRelease: legacy.sourceWorldRelease, packageHash: await hashProductProductionValueV2(runtimePackage),
    productionProvenance: legacy.productionProvenance, sourceContracts: legacy.sourceContracts,
  }
  const releaseIdentityHash = await productReleaseIdentityHashV2(body)
  const { sourcePlan, confirmedBrief, sourceManifest } = legacy.sourceContracts
  const lineage = await createProductReleaseLineageV1({
    productType: 'avg', productInstanceKey: legacy.productionProvenance.productionKey,
    releaseUid: productReleaseUidV1({ productType: 'avg', productInstanceKey: sourcePlan.productInstanceKey,
      releaseVersion: 1, releaseHash: releaseIdentityHash }),
    releaseVersion: 1, releaseHash: releaseIdentityHash, parentRelease: null,
    worldReference: sourcePlan.worldReference, sourcePlan, confirmedBrief, sourceManifest,
    build: { buildUid: 'fixture-build-1', buildHash: body.productionProvenance.buildManifestHash },
    quality: { passed: true, receiptHashes: [body.productionProvenance.rootTerminalReceiptHash] },
    compatibility: { status: 'initial', protocolVersion: 2, evidenceHashes: [] }, createdAt: 1_700_000_000_000,
  })
  const release = await createProductReleaseManifestV2({ runtimePackage,
    productionProvenance: body.productionProvenance, sourceContracts: body.sourceContracts, lineage })
  const preview = await createProductBuildPreviewManifestV2({
    runtimePackage, productionKey: body.productionProvenance.productionKey, buildNumber: 1,
    buildManifestHash: body.productionProvenance.buildManifestHash,
  })
  return { legacy, runtimePackage, release, preview }
}

export async function seedRelease() {
  const f = await fixture()
  const { scope } = await createWorkspace({ name: 'AVG carrier isolation', genres: [], status: 'drafting',
    description: '', targetWordCount: 1, enableMultiWorld: false },
  { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const id = await db.productReleases.add({
    ...scope, productionKey: f.release.productionProvenance.productionKey, productType: 'avg',
    worldReleaseId: null, version: 1, label: 'Structural carrier only',
    manifestJson: canonicalProductProductionJsonV2(f.release),
    contentHash: await hashProductProductionValueV2(f.release), createdAt: 1_700_000_000_000,
  }) as number
  return { ...f, scope, id }
}

export async function seedBuild() {
  const s = await seedRelease()
  const {sourcePlan,confirmedBrief}=s.release.sourceContracts
  if(sourcePlan.version!==1)throw new Error('Structural carrier fixture requires an actual legacy V1 source contract')
  const now = 1_700_000_000_000
  const revisionId = await db.worldRevisions.add({ ...s.scope, parentRevisionId: null, revision: 1,
    label: 'Source fixture', manifestJson: '{}', contentHash: HASH, createdAt: now, updatedAt: now }) as number
  const worldReleaseId = await db.worldReleases.add({ projectId: s.scope.projectId, worldId: s.scope.worldId,
    revisionId, version: 1, label: 'Source fixture', manifestJson: '{}', contentHash: HASH,
    sourceWorldCode: 'WORLD-FIXTURE', createdAt: now }) as number
  const productionId = await db.productProductions.add({ ...s.scope,
    productionKey: s.preview.productionKey, title: 'Carrier fixture', status: 'producing', productType: 'avg',
    stateRevision: 1, controlEpoch: 1, currentBriefRevision: 1, currentBuildNumber: 1,
    currentProductReleaseId: null, lastErrorJson: '{}', createdAt: now, updatedAt: now }) as number
  await db.productProductionBriefs.add({ ...s.scope, productionId, revision: 1, parentRevision: null,
    status: 'authorized', sourceWorldReleaseId: worldReleaseId, sourceWorldContentHash: HASH,
    userIntentSummary: 'Protocol test only', unresolvedJson: '[]', estimateJson: '{}', briefJson: '{}',
    briefHash: HASH, sourcePlanJson: canonicalProductProductionJsonV2({...sourcePlan,
      worldReference:{...sourcePlan.worldReference,localReleaseRecordId:worldReleaseId}}), sourcePlanHash: sourcePlan.planHash,
    confirmedBriefJson: canonicalProductProductionJsonV2(confirmedBrief),
    confirmedBriefHash: confirmedBrief.confirmationHash, authorizedAt: now, createdAt: now })
  const buildId = await db.productBuilds.add({ ...s.scope, productionId, buildNumber: 1, briefRevision: 1,
    briefHash: HASH, parentBuildNumber: null, sourceProductReleaseId: null, status: 'preview-ready',
    resumeState: null, stateRevision: 1, controlEpoch: 1, planRevision: 1, planJson: '{}', planHash: HASH,
    budgetLedgerJson: '{}', manifestJson: '{}', manifestHash: s.preview.buildManifestHash,
    packageHash: s.preview.packageHash, previewManifestJson: canonicalProductProductionJsonV2(s.preview),
    previewHash: s.preview.previewHash, qualityReportJson: '{}', qualityReportHash: '', compatibilityJson: '{}',
    rootTerminalReceiptHash: null, adoptionIntentHash: null, releasedProductReleaseId: null, failureJson: '{}',
    authorizedAt: now, startedAt: now, completedAt: null, createdAt: now, updatedAt: now }) as number
  return { ...s, productionId, buildId }
}

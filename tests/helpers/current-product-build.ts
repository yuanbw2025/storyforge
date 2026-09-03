import { db } from '../../src/lib/db/schema'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductBuildPreviewManifestV1 } from '../../src/lib/product-production/preview-manifest'
import type { ProductRuntimePackageV1, WorkspaceScope, WorldRelease } from '../../src/lib/types'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'

/**
 * Minimal current-only Product Build fixture. Tests that need a formal runtime
 * must pass through this helper instead of creating a release-less product
 * session or reviving a retired per-product workbench.
 */
export async function seedCurrentProductBuild(input: {
  scope: WorkspaceScope
  worldRelease: WorldRelease & { id: number }
  runtimePackage: ProductRuntimePackageV1
  title: string
  worldGroupId?: number | null
  seed?: string
}) {
  const now = Date.now()
  const productionKey = `current-product-${input.scope.projectId}-${crypto.randomUUID().slice(0, 8)}`
  const briefBody = {
    schema: 'storyforge.test-product-brief',
    version: 1,
    productType: input.runtimePackage.productType,
  }
  const briefHash = await hashProductProductionValueV2(briefBody)
  const sourcePlan = {
    schema: 'storyforge.product-source-plan',
    version: 1,
    worldReleaseId: input.worldRelease.id,
  }
  const confirmedBrief = {
    schema: 'storyforge.confirmed-product-brief',
    version: 1,
    briefHash,
  }
  const productionId = await db.productProductions.add({
    ...input.scope,
    productionKey,
    title: input.title,
    productType: input.runtimePackage.productType,
    status: 'producing',
    stateRevision: 2,
    controlEpoch: 0,
    currentBriefRevision: 1,
    currentBuildNumber: 1,
    currentProductReleaseId: null,
    lastErrorJson: '',
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.productProductionBriefs.add({
    ...input.scope,
    productionId,
    revision: 1,
    parentRevision: null,
    status: 'authorized',
    sourceWorldReleaseId: input.worldRelease.id,
    sourceWorldContentHash: input.worldRelease.contentHash,
    userIntentSummary: input.title,
    unresolvedJson: '[]',
    estimateJson: '{}',
    briefJson: JSON.stringify(briefBody),
    briefHash,
    sourcePlanJson: JSON.stringify(sourcePlan),
    sourcePlanHash: await hashProductProductionValueV2(sourcePlan),
    confirmedBriefJson: JSON.stringify(confirmedBrief),
    confirmedBriefHash: await hashProductProductionValueV2(confirmedBrief),
    authorizedAt: now,
    createdAt: now,
  })
  const buildManifest = {
    schema: 'storyforge.test-build-manifest',
    version: 1,
    productionKey,
    buildNumber: 1,
  }
  const manifestHash = await hashProductProductionValueV2(buildManifest)
  const preview = await createProductBuildPreviewManifestV1({
    productionKey,
    buildNumber: 1,
    buildManifestHash: manifestHash,
    runtimePackage: input.runtimePackage,
  })
  const planBody = { schema: 'storyforge.test-build-plan', version: 1, tasks: [] }
  const planHash = await hashProductProductionValueV2(planBody)
  const buildId = await db.productBuilds.add({
    ...input.scope,
    productionId,
    buildNumber: 1,
    briefRevision: 1,
    briefHash,
    parentBuildNumber: null,
    sourceProductReleaseId: null,
    status: 'preview-ready',
    resumeState: null,
    stateRevision: 1,
    controlEpoch: 0,
    planRevision: 1,
    planJson: JSON.stringify(planBody),
    planHash,
    budgetLedgerJson: '{}',
    manifestJson: JSON.stringify(buildManifest),
    manifestHash,
    packageHash: preview.packageHash,
    previewManifestJson: JSON.stringify(preview),
    previewHash: preview.previewHash,
    qualityReportJson: '{}',
    qualityReportHash: await hashProductProductionValueV2({}),
    compatibilityJson: '{}',
    rootTerminalReceiptHash: null,
    adoptionIntentHash: null,
    releasedProductReleaseId: null,
    failureJson: '',
    authorizedAt: now,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  }) as number
  const session = await createProductRuntimeInstanceFromSource({
    scope: input.scope,
    source: { kind: 'build', productBuildId: buildId, expectedPreviewHash: preview.previewHash },
    title: input.title,
    worldGroupId: input.worldGroupId,
    seed: input.seed,
  })
  return { productionId, buildId, preview, session }
}

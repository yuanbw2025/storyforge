import { db } from '../../src/lib/db/schema'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { createGameBuildPreviewManifestV1 } from '../../src/lib/game-production/preview-manifest'
import type { GameRuntimePackageV2, WorkspaceScope, WorldRelease } from '../../src/lib/types'
import { createPlayableGameInstance } from '../../src/lib/world-engine/instances'

/**
 * Minimal current-only Product Build fixture. Tests that need a formal runtime
 * must pass through this helper instead of creating a release-less product
 * session or reviving a retired per-product workbench.
 */
export async function seedCurrentPlayableBuild(input: {
  scope: WorkspaceScope
  worldRelease: WorldRelease & { id: number }
  runtimePackage: GameRuntimePackageV2
  title: string
}) {
  const now = Date.now()
  const productionKey = `current-product-${input.scope.projectId}-${crypto.randomUUID().slice(0, 8)}`
  const briefBody = {
    schema: 'storyforge.test-product-brief',
    version: 1,
    productType: input.runtimePackage.productType,
  }
  const briefHash = await hashGameProductionValueV2(briefBody)
  const productionId = await db.gameProductions.add({
    ...input.scope,
    productionKey,
    title: input.title,
    status: 'producing',
    stateRevision: 2,
    controlEpoch: 0,
    currentBriefRevision: 1,
    currentBuildNumber: 1,
    currentGameReleaseId: null,
    lastErrorJson: '',
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.gameProductionBriefs.add({
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
    authorizedAt: now,
    createdAt: now,
  })
  const buildManifest = {
    schema: 'storyforge.test-build-manifest',
    version: 1,
    productionKey,
    buildNumber: 1,
  }
  const manifestHash = await hashGameProductionValueV2(buildManifest)
  const preview = await createGameBuildPreviewManifestV1({
    productionKey,
    buildNumber: 1,
    buildManifestHash: manifestHash,
    runtimePackage: input.runtimePackage,
  })
  const planBody = { schema: 'storyforge.test-build-plan', version: 1, tasks: [] }
  const planHash = await hashGameProductionValueV2(planBody)
  const buildId = await db.gameBuilds.add({
    ...input.scope,
    productionId,
    buildNumber: 1,
    briefRevision: 1,
    briefHash,
    parentBuildNumber: null,
    sourceGameReleaseId: null,
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
    qualityReportHash: await hashGameProductionValueV2({}),
    compatibilityJson: '{}',
    rootTerminalReceiptHash: null,
    adoptionIntentHash: null,
    releasedGameReleaseId: null,
    failureJson: '',
    authorizedAt: now,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  }) as number
  const session = await createPlayableGameInstance({
    scope: input.scope,
    source: { kind: 'build', gameBuildId: buildId, expectedPreviewHash: preview.previewHash },
    title: input.title,
  })
  return { productionId, buildId, preview, session }
}

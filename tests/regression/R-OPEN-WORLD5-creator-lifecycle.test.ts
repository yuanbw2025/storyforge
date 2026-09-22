import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { acceptTextOpenWorldSourcePinBundleV1 } from '../../src/lib/open-world/source-pin'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { assertProductReleaseUnchanged } from '../../src/lib/product/releases'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import type { ProductRelease } from '../../src/lib/types'
import { verifyTextOpenWorldVNextSessionBindingV1 } from '../../src/lib/open-world/session-binding'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'

async function seedPublishedCreatorWorkspace(sourceKind: 'world-release' | 'novel') {
  const fixture = await createTextOpenWorldCreatorReleaseFixtureV1(sourceKind)
  const sourceArtifacts = await acceptTextOpenWorldSourcePinBundleV1({
    scope: fixture.scope,
    buildId: fixture.creator.buildId,
    controlEpoch: fixture.creator.controlEpoch,
    bundle: fixture.pinBundle,
  })
  const now = Date.now()
  const release: ProductRelease = {
    ...fixture.scope,
    productionKey: fixture.creator.productionKey,
    productType: 'text-open-world',
    worldReleaseId: fixture.localWorldReleaseId,
    version: 1,
    label: fixture.releaseAuthorization.releaseLabel,
    manifestJson: JSON.stringify(fixture.manifest),
    contentHash: await hashProductProductionValueV2(fixture.manifest),
    createdAt: now,
  }
  release.id = await db.productReleases.add(release) as number
  await db.productBuilds.update(fixture.creator.buildId, {
    status: 'released',
    manifestHash: fixture.manifest.productionProvenance.buildManifestHash,
    packageHash: fixture.manifest.packageHash,
    rootTerminalReceiptHash: fixture.manifest.productionProvenance.rootTerminalReceiptHash,
    releasedProductReleaseId: release.id,
    completedAt: now,
    updatedAt: now,
  })
  await db.productProductions.update(fixture.creator.productionId, {
    status: 'released',
    currentProductReleaseId: release.id,
    updatedAt: now,
  })
  const session = await createTextOpenWorldInstance({
    scope: fixture.scope,
    productReleaseId: release.id,
    title: `${sourceKind} Creator 正式旅程`,
    seed: `g5-12-${sourceKind}`,
  })
  return { fixture, sourceArtifacts, release, session }
}

describe('TOW-G5-12 · Creator工作台完整备份、验真和删除', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it.each(['world-release', 'novel'] as const)(
    '%s Creator从来源冻结、Build、正式Release到Session完整往返，随后按项目级联删除',
    async sourceKind => {
      const seeded = await seedPublishedCreatorWorkspace(sourceKind)
      const backup = await exportProjectJSON(seeded.fixture.scope.projectId)
      expect(backup.productProductions).toHaveLength(1)
      expect(backup.productBuilds).toHaveLength(1)
      expect(backup.productReleases).toHaveLength(1)
      expect(backup.productRuntimeSessions).toHaveLength(1)
      expect(backup.productBuildArtifacts.filter(row => (
        row.kind === 'text-open-world.source-pin-unit'
      ))).toHaveLength(seeded.sourceArtifacts.unitArtifacts.length)
      expect(backup.productBuildArtifacts.find(row => (
        row.kind === 'text-open-world.source-pin'
      ))?.contentHash).toBe(seeded.fixture.pinBundle.pin.pinHash)

      const importedProjectId = await importProjectJSON(structuredClone(backup))
      const [production, build, release, session] = await Promise.all([
        db.productProductions.where('projectId').equals(importedProjectId).first(),
        db.productBuilds.where('projectId').equals(importedProjectId).first(),
        db.productReleases.where('projectId').equals(importedProjectId).first(),
        db.productRuntimeSessions.where('projectId').equals(importedProjectId).first(),
      ])
      expect(production).toMatchObject({
        productionKey: seeded.fixture.creator.productionKey,
        currentProductReleaseId: release?.id,
      })
      expect(build).toMatchObject({
        productionId: production?.id,
        releasedProductReleaseId: release?.id,
      })
      expect(session).toMatchObject({
        productReleaseId: release?.id,
        productBuildId: null,
        runtimeSourceHash: seeded.fixture.manifest.packageHash,
      })
      await expect(assertProductReleaseUnchanged(release!.id!)).resolves.toBeDefined()
      await expect(verifyTextOpenWorldVNextSessionBindingV1(session!)).resolves.toMatchObject({
        runtimePackage: seeded.fixture.runtimePackage.textOpenWorldVNext,
      })
      const importedSourceArtifacts = await db.productBuildArtifacts
        .where('buildId').equals(build!.id!).toArray()
      expect(importedSourceArtifacts).toHaveLength(1 + seeded.sourceArtifacts.unitArtifacts.length)

      await cascadeDeleteProject(importedProjectId)
      expect(await db.projects.get(importedProjectId)).toBeUndefined()
      for (const table of [
        db.productProductions,
        db.productProductionBriefs,
        db.productProductionCommands,
        db.productBuilds,
        db.productBuildArtifacts,
        db.productReleases,
        db.productRuntimeSessions,
      ]) expect(await table.where('projectId').equals(importedProjectId).count()).toBe(0)
      expect(await db.projects.get(seeded.fixture.scope.projectId)).toBeDefined()
    },
    90_000,
  )

  it('Creator备份中的SourcePin闭包或正式Release任一被篡改，都在项目写入前失败关闭', async () => {
    const seeded = await seedPublishedCreatorWorkspace('world-release')
    const backup = await exportProjectJSON(seeded.fixture.scope.projectId)
    const before = await db.projects.count()

    const sourceTampered = structuredClone(backup)
    const unit = sourceTampered.productBuildArtifacts.find(row => (
      row.kind === 'text-open-world.source-pin-unit'
    ))!
    const unitPayload = JSON.parse(unit.payloadJson)
    unitPayload.label = `${unitPayload.label}（伪造）`
    unit.payloadJson = JSON.stringify(unitPayload)
    await expect(importProjectJSON(sourceTampered)).rejects.toThrow(/SourcePin Artifact payload\/hash 无效/)
    expect(await db.projects.count()).toBe(before)

    const releaseTampered = structuredClone(backup)
    const manifest = JSON.parse(releaseTampered.productReleases[0]!.manifestJson)
    manifest.sourceContracts.artifactReceipts[0].contentHash = '0'.repeat(64)
    releaseTampered.productReleases[0]!.manifestJson = JSON.stringify(manifest)
    await expect(importProjectJSON(releaseTampered)).rejects.toThrow(/ProductRelease 内容、身份或Hash无效/)
    expect(await db.projects.count()).toBe(before)
  }, 90_000)
})

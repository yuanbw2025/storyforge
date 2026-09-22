import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { verifyProductReleaseManifestV1 } from '../../src/lib/product-production/runtime-package'
import type { ProductRelease } from '../../src/lib/types'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterAll(async () => {
  await db.delete()
})

describe('TOW-G5-10 · Creator不可变Release合同', () => {
  it.each(['world-release', 'novel'] as const)(
    '冻结 %s 来源、Artifact、装配、质量和作者授权，并能从Release创建正式Session',
    async sourceKind => {
      const fixture = await createTextOpenWorldCreatorReleaseFixtureV1(sourceKind)
      await expect(verifyProductReleaseManifestV1(fixture.manifest)).resolves.toEqual(fixture.manifest)
      expect(fixture.manifest.sourceContracts.schema)
        .toBe('storyforge.text-open-world-creator-release-source-contracts')
      expect(fixture.manifest.lineage.schema)
        .toBe('storyforge.text-open-world-creator-release-lineage')
      expect(fixture.manifest.sourceContracts.sourcePlan.sourceKind).toBe(sourceKind)
      expect(fixture.manifest.lineage.quality.receiptHashes)
        .toContain(fixture.releaseQuality.receiptHash)

      const serialized = JSON.stringify(fixture.manifest)
      if (sourceKind === 'novel') {
        expect(serialized).not.toContain('localReleaseRecordId')
        expect(serialized).not.toContain('守渠人在黎明发现盐渠断流')
        expect(fixture.manifest.sourceContracts.sourcePin.units.every(unit => unit.readDepth === 'full')).toBe(true)
      } else if (fixture.manifest.sourceContracts.sourcePin.source.kind === 'world-release') {
        expect(fixture.manifest.sourceContracts.sourcePin.source.worldReference.localReleaseRecordId).toBe(0)
      }

      const release: ProductRelease = {
        projectId: fixture.scope.projectId, worldId: fixture.scope.worldId, workId: fixture.scope.workId,
        productionKey: fixture.creator.productionKey, productType: 'text-open-world',
        worldReleaseId: fixture.localWorldReleaseId,
        version: 1, label: fixture.releaseAuthorization.releaseLabel,
        manifestJson: JSON.stringify(fixture.manifest),
        contentHash: await hashProductProductionValueV2(fixture.manifest),
        createdAt: Date.now(),
      }
      release.id = await db.productReleases.add(release) as number
      const session = await createTextOpenWorldInstance({
        scope: fixture.scope, productReleaseId: release.id,
        title: `${sourceKind} 正式旅程`, seed: `release-${sourceKind}`,
      })
      expect(session).toMatchObject({
        productReleaseId: release.id, productBuildId: null,
        runtimeSourceHash: fixture.manifest.packageHash, kind: 'text-open-world',
      })
    },
    60_000,
  )

  it('任一来源、Artifact、质量或作者授权坐标被改写都拒绝读取', async () => {
    const fixture = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
    const mutations = [
      (manifest: typeof fixture.manifest) => {
        manifest.sourceContracts.sourcePin.pinHash = '0'.repeat(64)
      },
      (manifest: typeof fixture.manifest) => {
        manifest.sourceContracts.artifactReceipts[0]!.contentHash = '0'.repeat(64)
      },
      (manifest: typeof fixture.manifest) => {
        manifest.sourceContracts.releaseQuality.receiptHash = '0'.repeat(64)
      },
      (manifest: typeof fixture.manifest) => {
        manifest.sourceContracts.releaseAuthorization.releaseLabel = '被改写的版本'
      },
      (manifest: typeof fixture.manifest) => {
        manifest.lineage.governanceSnapshotHash = '0'.repeat(64)
      },
    ]
    for (const mutate of mutations) {
      const changed = structuredClone(fixture.manifest)
      mutate(changed)
      await expect(verifyProductReleaseManifestV1(changed)).rejects.toThrow()
    }
  }, 60_000)
})

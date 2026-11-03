import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { validateTextOpenWorldCreatorReleaseSourceContractsV1 } from '../../src/lib/open-world/creator-release-contract'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { verifyProductReleaseManifestV1 } from '../../src/lib/product-production/runtime-package'
import type { ProductRelease } from '../../src/lib/types'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'
import { seedQuality005LegacyNovelV1, snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterAll(async () => {
  await db.delete()
})

describe('TOW-G5-10 · Creator不可变Release合同', () => {
  it('fresh Release receipts bind complete accepted payloads while legacy body-hash contracts remain readable', async () => {
    const fixture = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
    const source = fixture.sourceContracts
    expect(source.version).toBe(2)
    for (const [key, payload] of [
      ['text-open-world.source-manifest', source.sourceManifest],
      ['text-open-world.integration-report', source.integrationReport],
    ] as const) {
      expect(source.artifactReceipts.find(row => row.artifactKey === key)?.contentHash)
        .toBe(await hashProductProductionValueV2(payload))
    }
    const legacy = structuredClone(source)
    legacy.version = 1
    legacy.artifactReceipts.find(row => row.artifactKey === 'text-open-world.source-manifest')!.contentHash = legacy.sourceManifest.manifestHash
    legacy.artifactReceipts.find(row => row.artifactKey === 'text-open-world.integration-report')!.contentHash = legacy.integrationReport.integrationReportHash
    legacy.artifactSetHash = await hashProductProductionValueV2(legacy.artifactReceipts)
    const { contractHash: _contractHash, ...body } = legacy
    legacy.contractHash = await hashProductProductionValueV2(body)
    await expect(validateTextOpenWorldCreatorReleaseSourceContractsV1(legacy, fixture.runtimePackage)).resolves.toEqual(legacy)
    const invalidFresh = { ...legacy, version: 2 as const }
    const { contractHash: _invalidHash, ...invalidBody } = invalidFresh
    invalidFresh.contractHash = await hashProductProductionValueV2(invalidBody)
    await expect(validateTextOpenWorldCreatorReleaseSourceContractsV1(invalidFresh, fixture.runtimePackage))
      .rejects.toThrow('正式消费槽、来源单元或终态Artifact receipt集合不闭合')
  }, 60_000)

  it('version 2 assembly and quality retain exact artifact versions and review hashes through portable verification', async () => {
    const fixture = await createTextOpenWorldCreatorReleaseFixtureV1('world-release', 2)
    expect(fixture.integrationReport.version).toBe(2)
    expect(fixture.integrationReport.responsibilitySnapshot?.tracks).toHaveLength(3)
    await expect(verifyProductReleaseManifestV1(fixture.manifest)).resolves.toEqual(fixture.manifest)
    const mismatched = structuredClone(fixture.sourceContracts)
    mismatched.artifactReceipts.find(row => row.artifactKey === 'text-open-world.system-configs')!.version++
    mismatched.artifactSetHash = await hashProductProductionValueV2(mismatched.artifactReceipts)
    await expect(validateTextOpenWorldCreatorReleaseSourceContractsV1(mismatched, fixture.runtimePackage))
      .rejects.toThrow('三线快照与冻结 Artifact receipt 不一致')
    const original = JSON.stringify(fixture.manifest)
    fixture.manifest.sourceContracts.releaseQuality.evidence.visualReviewReceiptHash = null
    await expect(verifyProductReleaseManifestV1(fixture.manifest)).rejects.toThrow()
    await expect(verifyProductReleaseManifestV1(JSON.parse(original))).resolves.toBeDefined()
  }, 60_000)

  it.each(['world-release'] as const)(
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
      expect(serialized).not.toContain('守渠人在黎明发现盐渠断流')
      if (fixture.manifest.sourceContracts.sourcePin.source.kind === 'world-release') {
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

  it('005 历史 novel Release 的严格合同与字节仍可读取，但不能创建新 Session', async () => {
    const old = await seedQuality005LegacyNovelV1()
    const release = (await db.productReleases.get(old.releaseId))!
    const before = await snapshotQuality005RowsV1()
    const verified = await verifyProductReleaseManifestV1(release.manifestJson)
    expect(verified).toMatchObject({ sourceContracts: { sourcePlan: { sourceKind: 'novel' }, sourcePin: { sourceKind: 'novel' } } })
    expect(release.manifestJson).not.toContain('localReleaseRecordId')
    expect(release.manifestJson).not.toContain('守渠人在黎明发现盐渠断流')
    await expect(createTextOpenWorldInstance({ scope: old.scope, productReleaseId: release.id!,
      title: 'not a new legacy play session', seed: '005-legacy-release-reader' })).rejects.toThrow(/WorldRelease|派生/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  }, 30_000)

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

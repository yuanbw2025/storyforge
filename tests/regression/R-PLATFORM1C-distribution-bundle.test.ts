import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  exportProductDistributionBundleV2,
  importMarketplaceProductDistributionV2,
  verifyProductDistributionBundleV2,
  type MarketplaceImportProvenanceV2,
} from '../../src/lib/product-platform/distribution-bundle'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { putMediaBlobObject, sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { assertProductReleaseUnchanged } from '../../src/lib/product/releases'
import type { FrozenRuntimeMediaAssetV2, ProductRuntimePackageV1, WorkspaceScope } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { CURRENT_PRODUCT_RESOURCE_KEYS, currentProductSelection } from '../helpers/current-product-world'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'

async function workspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspacePurpose: 'world-engine',
    name, genre: 'interactive-fiction', genres: ['interactive-fiction'], status: 'drafting',
    description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
  } as never) as number
  return ensureWorkspaceOwnership(projectId)
}

function narrative(): ProductRuntimePackageV1['narrative'] {
  return {
    moduleKind: 'main', moduleTitle: '可分发短篇', entryNodeKey: 'ending.arrive',
    nodes: [{
      key: 'ending.arrive', kind: 'ending', title: '抵达', summary: '', conditionJson: '{}',
      effectsJson: '[]', successorKeys: [],
    }],
    beats: [{
      beatKey: 'beat.arrive', nodeKey: 'ending.arrive', kind: 'narration', speakerKey: null,
      text: '完整发行物已经抵达。', order: 0,
    }],
    choices: [],
  }
}

function avgPackage(worldContentHash: string, asset: FrozenRuntimeMediaAssetV2): ProductRuntimePackageV1 {
  return parseProductRuntimePackageV1({
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'avg',
    definition: {
      productKey: 'market.harbor', title: '市场雾港', description: '可离线导入的完整游戏。',
      enabledCapabilities: ['narrative', 'presentation'], rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: {
      contentHash: worldContentHash,
      selection: currentProductSelection('avg', {
        story: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
      }),
    },
    narrative: narrative(),
    presentation: { version: 1, cues: [], assets: [asset] },
  })
}

async function publishedFixture(scope: WorkspaceScope) {
  const revision = await createWorldRevision({ scope, label: '市场来源世界' })
  const worldRelease = await publishWorldRevision(revision.id!)
  const data = new TextEncoder().encode('storyforge-distribution-image-v1').buffer
  const contentHash = await sha256MediaData(data)
  const asset: FrozenRuntimeMediaAssetV2 = {
    assetKey: 'background.harbor', version: 1, kind: 'background', name: '雾港',
    mimeType: 'image/png', byteSize: data.byteLength, width: 1920, height: 1080, durationMs: null,
    contentHash, blobContentHash: contentHash, source: 'creator-upload', license: 'CC-BY-4.0',
    altText: '雾中的港口', characterTag: '', sceneTag: 'harbor',
  }
  const object = await putMediaBlobObject({ scope, data, mimeType: asset.mimeType, expectedContentHash: contentHash })
  const now = Date.now()
  const manifest = await createFixtureProductReleaseManifestV1({
    runtimePackage: avgPackage(worldRelease.contentHash, asset), productionKey: 'market.harbor',
  })
  const releaseId = await db.productReleases.add({
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    productionKey: 'market.harbor', productType: 'avg', worldReleaseId: worldRelease.id!, version: 1, label: '市场雾港 v1',
    manifestJson: JSON.stringify(manifest), contentHash: await hashProductProductionValueV2(manifest), createdAt: now,
  }) as number
  const mediaAssetId = await db.productMediaAssets.add({
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    ownerKind: 'release', productType: 'avg', productReleaseId: releaseId, productRuntimeSessionId: null,
    assetKey: asset.assetKey, version: asset.version, kind: asset.kind, name: asset.name,
    mimeType: asset.mimeType, byteSize: asset.byteSize, width: asset.width, height: asset.height,
    durationMs: asset.durationMs, contentHash: asset.contentHash, source: asset.source, license: asset.license,
    altText: asset.altText, characterTag: asset.characterTag, sceneTag: asset.sceneTag,
    createdAt: now, updatedAt: now,
  }) as number
  await db.productMediaBlobs.add({
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    mediaAssetId, blobObjectId: object.id!, data: null, createdAt: now,
  })
  return { releaseId, data, asset }
}

function provenance(overrides: Partial<MarketplaceImportProvenanceV2> = {}): MarketplaceImportProvenanceV2 {
  return {
    listingId: 'listing.market-harbor', orderId: 'order.market-harbor',
    entitlementId: 'entitlement.market-harbor',
    license: {
      licenseId: 'license.community', licenseVersion: '1.0.0', allowOfflineExport: true,
      allowRemix: true, commercialReuse: false, requiresAttribution: true,
      termsUrl: 'https://storyforge.example/licenses/community-1',
    },
    attribution: ['雾港工作室 · 原作'], localCopyPreserved: true, acquiredAt: 1_755_734_400_000,
    ...overrides,
  }
}

describe('PLATFORM-1C · Marketplace ProductDistributionBundle', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('冻结自包含 ProductRelease、世界来源证明与产品媒资，导入后无需复制 WorldRelease 即可运行', async () => {
    const source = await workspace('创作者工作区')
    const fixture = await publishedFixture(source.scope)
    const bundle = await exportProductDistributionBundleV2({ scope: source.scope, productReleaseId: fixture.releaseId })
    expect(bundle.media).toHaveLength(1)
    await expect(verifyProductDistributionBundleV2(JSON.parse(JSON.stringify(bundle)))).resolves.toEqual(bundle)

    const target = await workspace('玩家工作区')
    const imported = await importMarketplaceProductDistributionV2({
      scope: target.scope, bundle: JSON.parse(JSON.stringify(bundle)), provenance: provenance(),
    })
    await expect(assertProductReleaseUnchanged(imported.id!)).resolves.toMatchObject({ id: imported.id })
    expect(imported.distributionProvenance).toMatchObject({
      source: 'marketplace', listingId: 'listing.market-harbor', localCopyPreserved: true,
      attribution: ['雾港工作室 · 原作'],
    })
    expect(await db.worldReleases.where('worldId').equals(target.scope.worldId).count()).toBe(0)
    expect(await db.productMediaAssets.where('workId').equals(target.scope.workId).first()).not.toHaveProperty('blobContentHash')
    const importedBlob = await db.mediaBlobObjects.where('workId').equals(target.scope.workId).first()
    expect(new Uint8Array(importedBlob!.data!)).toEqual(new Uint8Array(fixture.data))

    const repeated = await importMarketplaceProductDistributionV2({
      scope: target.scope, bundle, provenance: provenance(),
    })
    expect(repeated.id).toBe(imported.id)
    expect(await db.productReleases.where('workId').equals(target.scope.workId).count()).toBe(1)
    expect(await db.mediaBlobObjects.where('workId').equals(target.scope.workId).count()).toBe(1)
  }, 40_000)

  it('拒绝媒资、世界来源证明和总包任一层篡改', async () => {
    const source = await workspace('篡改来源')
    const fixture = await publishedFixture(source.scope)
    const bundle = await exportProductDistributionBundleV2({ scope: source.scope, productReleaseId: fixture.releaseId })

    const mediaTamper = structuredClone(bundle)
    mediaTamper.media[0].dataBase64 = `${mediaTamper.media[0].dataBase64.slice(0, -4)}AAAA`
    await expect(verifyProductDistributionBundleV2(mediaTamper)).rejects.toThrow(/媒资/)

    const worldTamper = structuredClone(bundle)
    worldTamper.sourceWorld.contentHash = 'f'.repeat(64)
    await expect(verifyProductDistributionBundleV2(worldTamper)).rejects.toThrow(/世界来源证明/)

    const bundleTamper = structuredClone(bundle)
    bundleTamper.bundleHash = '0'.repeat(64)
    await expect(verifyProductDistributionBundleV2(bundleTamper)).rejects.toThrow(/bundleHash/)
  }, 40_000)

  it('许可不允许离线交付或归因回执不完整时，在目标 Work 中零业务写入', async () => {
    const source = await workspace('许可来源')
    const fixture = await publishedFixture(source.scope)
    const bundle = await exportProductDistributionBundleV2({ scope: source.scope, productReleaseId: fixture.releaseId })
    const target = await workspace('许可目标')

    await expect(importMarketplaceProductDistributionV2({
      scope: target.scope, bundle,
      provenance: provenance({ license: { ...provenance().license, allowOfflineExport: false } }),
    })).rejects.toThrow(/许可/)
    await expect(importMarketplaceProductDistributionV2({
      scope: target.scope, bundle, provenance: provenance({ attribution: [] }),
    })).rejects.toThrow(/归因/)
    expect(await db.productReleases.where('workId').equals(target.scope.workId).count()).toBe(0)
    expect(await db.worldReleases.where('worldId').equals(target.scope.worldId).count()).toBe(0)
    expect(await db.mediaBlobObjects.where('workId').equals(target.scope.workId).count()).toBe(0)
  }, 40_000)
})

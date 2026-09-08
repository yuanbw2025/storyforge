import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1,
  deleteImportedProductReleaseV1,
  exportProductDistributionBundleV2,
  importLocalProductDistributionV2,
  importMarketplaceProductDistributionV2,
  listImportedProductReleasesV1,
  verifyProductDistributionBundleV2,
  type MarketplaceImportProvenanceV2,
} from '../../src/lib/product-platform/distribution-bundle'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { putMediaBlobObject, sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { assertProductReleaseUnchanged } from '../../src/lib/product/releases'
import { createAvgGameInstance } from '../../src/lib/product/runtime-instances'
import type { FrozenRuntimeMediaAssetV2, ProductRuntimePackageV1, WorkspaceScope } from '../../src/lib/types'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { CURRENT_PRODUCT_RESOURCE_KEYS, currentProductSelection } from '../helpers/current-product-world'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { seedCurrentProject } from '../helpers/current-workspace'

async function workspace(name: string) {
  const now = Date.now()
  const projectId = await seedCurrentProject({
    workspacePurpose: 'world-engine',
    name, genres: ['interactive-fiction'], status: 'drafting',
    description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
  } as never) as number
  return resolveWorkspaceOwnership(projectId)
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

  it('本地文件导入使用独立来源语义，重复导入幂等且不伪造市场权益', async () => {
    const source = await workspace('本地包来源')
    const fixture = await publishedFixture(source.scope)
    const bundle = await exportProductDistributionBundleV2({ scope: source.scope, productReleaseId: fixture.releaseId })
    const target = await workspace('本地包目标')
    const candidatePackageHash = 'c'.repeat(64)

    const imported = await importLocalProductDistributionV2({
      scope: target.scope,
      bundle,
      provenance: {
        candidatePackageHash,
        originalReleaseHash: bundle.productRelease.contentHash,
        candidateStatus: 'eligible-for-community-submission',
      },
    })
    expect(imported.distributionProvenance).toEqual(expect.objectContaining({
      source: 'local-file', candidatePackageHash,
      originalReleaseHash: bundle.productRelease.contentHash,
      remoteCreatorIdentityVerified: false, localCopyPreserved: true,
    }))
    expect(imported.distributionProvenance).not.toHaveProperty('listingId')
    expect(imported.distributionProvenance).not.toHaveProperty('entitlementId')

    const repeated = await importLocalProductDistributionV2({
      scope: target.scope,
      bundle,
      provenance: {
        candidatePackageHash,
        originalReleaseHash: bundle.productRelease.contentHash,
        candidateStatus: 'eligible-for-community-submission',
      },
    })
    expect(repeated.id).toBe(imported.id)
    expect(await db.productReleases.where('workId').equals(target.scope.workId).count()).toBe(1)
    expect(await db.mediaBlobObjects.where('workId').equals(target.scope.workId).count()).toBe(1)
  }, 40_000)

  it('本地导入在 Release 身份冲突后回收本次暂存 Blob，不留下半成品', async () => {
    const source = await workspace('冲突包来源')
    const fixture = await publishedFixture(source.scope)
    const bundle = await exportProductDistributionBundleV2({ scope: source.scope, productReleaseId: fixture.releaseId })
    const target = await workspace('冲突包目标')
    await db.productReleases.add({
      projectId: target.scope.projectId, worldId: target.scope.worldId, workId: target.scope.workId,
      productionKey: 'conflicting.production', productType: 'avg', worldReleaseId: null,
      version: 1, label: '冲突占位', manifestJson: '{}',
      contentHash: bundle.productRelease.contentHash, createdAt: Date.now(),
    })

    await expect(importLocalProductDistributionV2({
      scope: target.scope,
      bundle,
      provenance: {
        candidatePackageHash: 'd'.repeat(64),
        originalReleaseHash: bundle.productRelease.contentHash,
        candidateStatus: 'eligible-for-community-submission',
      },
    })).rejects.toThrow(/身份.*冲突/)
    expect(await db.productReleases.where('workId').equals(target.scope.workId).count()).toBe(1)
    expect(await db.productMediaAssets.where('workId').equals(target.scope.workId).count()).toBe(0)
    expect(await db.mediaBlobObjects.where('workId').equals(target.scope.workId).count()).toBe(0)
  }, 40_000)

  it('只删除导入副本及其私域会话，并按注册引用保留其他 Release 共用的 Blob', async () => {
    const source = await workspace('删除副本来源')
    const fixture = await publishedFixture(source.scope)
    const bundle = await exportProductDistributionBundleV2({ scope: source.scope, productReleaseId: fixture.releaseId })
    const target = await workspace('删除副本目标')
    const imported = await importLocalProductDistributionV2({
      scope: target.scope,
      bundle,
      provenance: {
        candidatePackageHash: 'e'.repeat(64),
        originalReleaseHash: bundle.productRelease.contentHash,
        candidateStatus: 'eligible-for-community-submission',
      },
    })
    const session = await createAvgGameInstance({
      scope: target.scope,
      productReleaseId: imported.id!,
      title: '待删除导入副本存档',
      seed: 'delete-imported-copy',
    })
    const importedAsset = await db.productMediaAssets.where('productReleaseId').equals(imported.id!).first()
    const importedBinding = await db.productMediaBlobs.where('mediaAssetId').equals(importedAsset!.id!).first()
    const sharedReleaseId = await db.productReleases.add({
      ...imported,
      id: undefined,
      productionKey: 'local-file:shared-copy',
      version: 1,
      label: '仍需保留的导入副本',
      createdAt: Date.now() + 1,
    }) as number
    const sharedAssetId = await db.productMediaAssets.add({
      ...importedAsset!,
      id: undefined,
      productReleaseId: sharedReleaseId,
      createdAt: Date.now() + 1,
      updatedAt: Date.now() + 1,
    }) as number
    await db.productMediaBlobs.add({
      ...importedBinding!,
      id: undefined,
      mediaAssetId: sharedAssetId,
      createdAt: Date.now() + 1,
    })

    await expect(listImportedProductReleasesV1({ scope: target.scope, productType: 'avg' }))
      .resolves.toHaveLength(2)
    await expect(deleteImportedProductReleaseV1({
      scope: target.scope,
      productReleaseId: imported.id!,
      confirmation: DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1,
    })).resolves.toMatchObject({
      productReleaseId: imported.id,
      source: 'local-file',
      deletedSessionCount: 1,
      deletedMediaAssetCount: 1,
      deletedMediaBindingCount: 1,
      reclaimedBlobObjectIds: [],
      retainedBlobObjectIds: [importedBinding!.blobObjectId],
    })
    expect(await db.productReleases.get(imported.id!)).toBeUndefined()
    expect(await db.productRuntimeSessions.get(session.id!)).toBeUndefined()
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(0)
    expect(await db.productReleases.get(sharedReleaseId)).toBeDefined()
    expect(await db.mediaBlobObjects.get(importedBinding!.blobObjectId)).toBeDefined()
    expect(await db.worldReleases.where('worldId').equals(source.scope.worldId).count()).toBe(1)

    const finalRemoval = await deleteImportedProductReleaseV1({
      scope: target.scope,
      productReleaseId: sharedReleaseId,
      confirmation: DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1,
    })
    expect(finalRemoval.reclaimedBlobObjectIds).toEqual([importedBinding!.blobObjectId])
    expect(await db.mediaBlobObjects.get(importedBinding!.blobObjectId)).toBeUndefined()
  }, 40_000)

  it('拒绝无确认、跨 Work、原创 Release 与已进入生产血缘的导入副本删除', async () => {
    const source = await workspace('删除边界来源')
    const fixture = await publishedFixture(source.scope)
    const bundle = await exportProductDistributionBundleV2({ scope: source.scope, productReleaseId: fixture.releaseId })
    const target = await workspace('删除边界目标')
    const imported = await importLocalProductDistributionV2({
      scope: target.scope,
      bundle,
      provenance: {
        candidatePackageHash: 'f'.repeat(64),
        originalReleaseHash: bundle.productRelease.contentHash,
        candidateStatus: 'eligible-for-community-submission',
      },
    })

    await expect(deleteImportedProductReleaseV1({
      scope: target.scope,
      productReleaseId: imported.id!,
      confirmation: 'missing-confirmation' as typeof DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1,
    })).rejects.toThrow(/明确确认/)
    await expect(deleteImportedProductReleaseV1({
      scope: source.scope,
      productReleaseId: imported.id!,
      confirmation: DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1,
    })).rejects.toThrow(/不存在或跨 Work/)
    await expect(deleteImportedProductReleaseV1({
      scope: source.scope,
      productReleaseId: fixture.releaseId,
      confirmation: DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1,
    })).rejects.toThrow(/原创 ProductRelease/)

    const productionId = await db.productProductions.add({
      projectId: target.scope.projectId,
      worldId: target.scope.worldId,
      workId: target.scope.workId,
      productType: 'avg',
      productionKey: 'lineage-protection',
      currentProductReleaseId: imported.id!,
      status: 'released',
      updatedAt: Date.now(),
    } as never) as number
    await expect(deleteImportedProductReleaseV1({
      scope: target.scope,
      productReleaseId: imported.id!,
      confirmation: DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1,
    })).rejects.toThrow(/生产血缘/)
    expect(await db.productReleases.get(imported.id!)).toBeDefined()
    await db.productProductions.delete(productionId)
  }, 40_000)
})

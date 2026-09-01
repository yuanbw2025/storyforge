import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  exportGameDistributionBundleV2,
  importMarketplaceGameDistributionV2,
  verifyGameDistributionBundleV2,
  type MarketplaceImportProvenanceV2,
} from '../../src/lib/game-platform/distribution-bundle'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { putMediaBlobObject, sha256MediaData } from '../../src/lib/game-production/media-blob-store'
import { createGameReleaseManifestV2, parseGameRuntimePackageV2 } from '../../src/lib/game-production/runtime-package'
import { assertGameReleaseUnchanged } from '../../src/lib/text-game/releases'
import type { FrozenRuntimeMediaAssetV2, GameRuntimePackageV2, WorkspaceScope } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { CURRENT_PRODUCT_RESOURCE_KEYS, currentProductSelection } from '../helpers/current-product-world'

async function workspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    name, genre: 'interactive-fiction', genres: ['interactive-fiction'], status: 'drafting',
    description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
  } as never) as number
  return ensureWorkspaceOwnership(projectId)
}

function narrative(): GameRuntimePackageV2['narrative'] {
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

function avgPackage(worldContentHash: string, asset: FrozenRuntimeMediaAssetV2): GameRuntimePackageV2 {
  return parseGameRuntimePackageV2({
    schema: 'storyforge.game-runtime-package', version: 2, productType: 'avg',
    definition: {
      gameKey: 'market.harbor', title: '市场雾港', description: '可离线导入的完整游戏。',
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
  const mediaAssetId = await db.productMediaAssets.add({
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
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
  const manifest = await createGameReleaseManifestV2({
    runtimePackage: avgPackage(worldRelease.contentHash, asset), productionProvenance: null,
  })
  const releaseId = await db.gameReleases.add({
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    productionKey: 'market.harbor', worldReleaseId: worldRelease.id!, version: 1, label: '市场雾港 v1',
    manifestJson: JSON.stringify(manifest), contentHash: await hashGameProductionValueV2(manifest), createdAt: now,
  }) as number
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

describe('PLATFORM-1C · Marketplace GameDistributionBundle', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('冻结自包含 GameRelease、世界来源证明与产品媒资，导入后无需复制 WorldRelease 即可运行', async () => {
    const source = await workspace('创作者工作区')
    const fixture = await publishedFixture(source.scope)
    const bundle = await exportGameDistributionBundleV2({ scope: source.scope, gameReleaseId: fixture.releaseId })
    expect(bundle.media).toHaveLength(1)
    await expect(verifyGameDistributionBundleV2(JSON.parse(JSON.stringify(bundle)))).resolves.toEqual(bundle)

    const target = await workspace('玩家工作区')
    const imported = await importMarketplaceGameDistributionV2({
      scope: target.scope, bundle: JSON.parse(JSON.stringify(bundle)), provenance: provenance(),
    })
    await expect(assertGameReleaseUnchanged(imported.id!)).resolves.toMatchObject({ id: imported.id })
    expect(imported.distributionProvenance).toMatchObject({
      source: 'marketplace', listingId: 'listing.market-harbor', localCopyPreserved: true,
      attribution: ['雾港工作室 · 原作'],
    })
    expect(await db.worldReleases.where('worldId').equals(target.scope.worldId).count()).toBe(0)
    expect(await db.productMediaAssets.where('workId').equals(target.scope.workId).first()).not.toHaveProperty('blobContentHash')
    const importedBlob = await db.mediaBlobObjects.where('workId').equals(target.scope.workId).first()
    expect(new Uint8Array(importedBlob!.data!)).toEqual(new Uint8Array(fixture.data))

    const repeated = await importMarketplaceGameDistributionV2({
      scope: target.scope, bundle, provenance: provenance(),
    })
    expect(repeated.id).toBe(imported.id)
    expect(await db.gameReleases.where('workId').equals(target.scope.workId).count()).toBe(1)
    expect(await db.mediaBlobObjects.where('workId').equals(target.scope.workId).count()).toBe(1)
  }, 40_000)

  it('拒绝媒资、世界来源证明和总包任一层篡改', async () => {
    const source = await workspace('篡改来源')
    const fixture = await publishedFixture(source.scope)
    const bundle = await exportGameDistributionBundleV2({ scope: source.scope, gameReleaseId: fixture.releaseId })

    const mediaTamper = structuredClone(bundle)
    mediaTamper.media[0].dataBase64 = `${mediaTamper.media[0].dataBase64.slice(0, -4)}AAAA`
    await expect(verifyGameDistributionBundleV2(mediaTamper)).rejects.toThrow(/媒资/)

    const worldTamper = structuredClone(bundle)
    worldTamper.sourceWorld.contentHash = 'f'.repeat(64)
    await expect(verifyGameDistributionBundleV2(worldTamper)).rejects.toThrow(/世界来源证明/)

    const bundleTamper = structuredClone(bundle)
    bundleTamper.bundleHash = '0'.repeat(64)
    await expect(verifyGameDistributionBundleV2(bundleTamper)).rejects.toThrow(/bundleHash/)
  }, 40_000)

  it('许可不允许离线交付或归因回执不完整时，在目标 Work 中零业务写入', async () => {
    const source = await workspace('许可来源')
    const fixture = await publishedFixture(source.scope)
    const bundle = await exportGameDistributionBundleV2({ scope: source.scope, gameReleaseId: fixture.releaseId })
    const target = await workspace('许可目标')

    await expect(importMarketplaceGameDistributionV2({
      scope: target.scope, bundle,
      provenance: provenance({ license: { ...provenance().license, allowOfflineExport: false } }),
    })).rejects.toThrow(/许可/)
    await expect(importMarketplaceGameDistributionV2({
      scope: target.scope, bundle, provenance: provenance({ attribution: [] }),
    })).rejects.toThrow(/归因/)
    expect(await db.gameReleases.where('workId').equals(target.scope.workId).count()).toBe(0)
    expect(await db.worldReleases.where('worldId').equals(target.scope.worldId).count()).toBe(0)
    expect(await db.mediaBlobObjects.where('workId').equals(target.scope.workId).count()).toBe(0)
  }, 40_000)
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { deleteProductRuntimeSession } from '../../src/lib/avg/runtime-api'
import { importProductRuntimeMediaAssetV1 } from '../../src/lib/product/runtime-media-library'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  collectUnreferencedMediaBlobObjects,
  putMediaBlobObject,
  sha256MediaData,
} from '../../src/lib/product-production/media-blob-store'
import { readProductReleaseMediaBytes } from '../../src/lib/product-production/release-media'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import type {
  FrozenRuntimeMediaAssetV2,
  ProductRuntimePackageV1,
  WorkspaceScope,
  WorldRelease,
} from '../../src/lib/types'
import { createCurrentRuntimePackageFixture } from '../helpers/current-runtime-package'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import {
  loadCurrentProductWorldSourceCatalogV1,
  seedCurrentProductWorld,
} from '../helpers/current-product-world'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer
}

async function addReleaseMedia(input: {
  scope: WorkspaceScope
  worldRelease: WorldRelease & { id: number }
  basePackage: ProductRuntimePackageV1
  productionKey: string
  payload: string
}) {
  const data = bytes(input.payload)
  const contentHash = await sha256MediaData(data)
  const asset: FrozenRuntimeMediaAssetV2 = {
    assetKey: 'background.shared-key', version: 1, kind: 'background', name: input.productionKey,
    mimeType: 'image/png', byteSize: data.byteLength, width: 1280, height: 720, durationMs: null,
    contentHash, blobContentHash: contentHash, source: 'test', license: 'test-only',
    altText: input.productionKey, characterTag: '', sceneTag: 'opening',
  }
  const runtimePackage = parseProductRuntimePackageV1({
    ...structuredClone(input.basePackage),
    presentation: { version: 1, cues: [], assets: [asset] },
  })
  const manifest = await createFixtureProductReleaseManifestV1({
    runtimePackage,
    productionKey: input.productionKey,
  })
  const now = Date.now()
  const productReleaseId = await db.productReleases.add({
    ...input.scope,
    productionKey: input.productionKey,
    productType: 'avg',
    worldReleaseId: input.worldRelease.id,
    version: 1,
    label: `${input.productionKey} v1`,
    manifestJson: JSON.stringify(manifest),
    contentHash: await hashProductProductionValueV2(manifest),
    createdAt: now,
  }) as number
  const object = await putMediaBlobObject({
    scope: input.scope,
    data,
    mimeType: asset.mimeType,
    expectedContentHash: contentHash,
  })
  const productMediaAssetId = await db.productMediaAssets.add({
    ...input.scope,
    ownerKind: 'release',
    productType: 'avg',
    productReleaseId,
    productRuntimeSessionId: null,
    assetKey: asset.assetKey,
    version: asset.version,
    kind: asset.kind,
    name: asset.name,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    contentHash: asset.contentHash,
    source: asset.source,
    license: asset.license,
    altText: asset.altText,
    characterTag: asset.characterTag,
    sceneTag: asset.sceneTag,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.productMediaBlobs.add({
    ...input.scope,
    mediaAssetId: productMediaAssetId,
    blobObjectId: object.id!,
    data: null,
    createdAt: now,
  })
  return { productReleaseId, asset, data }
}

describe('ARCH-09 · 产品媒资精确所有权', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('同一 Work 的两个 ProductRelease 可拥有同名同版本媒资且绝不串读', async () => {
    const world = await seedCurrentProductWorld('媒资发布隔离')
    const catalog = await loadCurrentProductWorldSourceCatalogV1({
      scope: world.scope,
      worldReleaseId: world.release.id!,
      productType: 'avg',
    })
    const basePackage = createCurrentRuntimePackageFixture({
      productType: 'avg', worldRelease: world.release as WorldRelease & { id: number }, sourceCatalog: catalog,
    })
    const first = await addReleaseMedia({
      scope: world.scope, worldRelease: world.release as WorldRelease & { id: number },
      basePackage, productionKey: 'avg.release.first', payload: 'first-release-bytes',
    })
    const second = await addReleaseMedia({
      scope: world.scope, worldRelease: world.release as WorldRelease & { id: number },
      basePackage, productionKey: 'avg.release.second', payload: 'second-release-bytes',
    })

    expect(await readProductReleaseMediaBytes({
      scope: world.scope, productReleaseId: first.productReleaseId, asset: first.asset,
    })).toEqual(first.data)
    expect(await readProductReleaseMediaBytes({
      scope: world.scope, productReleaseId: second.productReleaseId, asset: second.asset,
    })).toEqual(second.data)
    await expect(readProductReleaseMediaBytes({
      scope: world.scope, productReleaseId: first.productReleaseId, asset: second.asset,
    })).rejects.toThrow(/缺失或元数据不匹配/)
  }, 40_000)

  it('运行中媒资绑定具体 ProductRuntimeSession，删除一个实例不会误删另一个实例', async () => {
    const world = await seedCurrentProductWorld('媒资运行隔离')
    const catalog = await loadCurrentProductWorldSourceCatalogV1({
      scope: world.scope,
      worldReleaseId: world.release.id!,
      productType: 'avg',
    })
    const runtimePackage = createCurrentRuntimePackageFixture({
      productType: 'avg', worldRelease: world.release as WorldRelease & { id: number }, sourceCatalog: catalog,
    })
    const first = await seedCurrentProductBuild({
      scope: world.scope, worldRelease: world.release as WorldRelease & { id: number }, runtimePackage,
      title: '运行实例 A',
    })
    const second = await seedCurrentProductBuild({
      scope: world.scope, worldRelease: world.release as WorldRelease & { id: number }, runtimePackage,
      title: '运行实例 B',
    })
    const firstAsset = await importProductRuntimeMediaAssetV1({
      scope: world.scope, productRuntimeSessionId: first.session.id!, assetKey: 'runtime.generated',
      kind: 'background', name: '运行 A', blob: new Blob([bytes('runtime-a')], { type: 'image/png' }),
    })
    const secondAsset = await importProductRuntimeMediaAssetV1({
      scope: world.scope, productRuntimeSessionId: second.session.id!, assetKey: 'runtime.generated',
      kind: 'background', name: '运行 B', blob: new Blob([bytes('runtime-b')], { type: 'image/png' }),
    })
    const firstBlob = await db.productMediaBlobs.where('mediaAssetId').equals(firstAsset.id!).first()
    const secondBlob = await db.productMediaBlobs.where('mediaAssetId').equals(secondAsset.id!).first()

    await deleteProductRuntimeSession(first.session.id!)

    expect(await db.productMediaAssets.get(firstAsset.id!)).toBeUndefined()
    expect(await db.productMediaBlobs.get(firstBlob!.id!)).toBeUndefined()
    expect(await db.productMediaAssets.get(secondAsset.id!)).toMatchObject({
      ownerKind: 'runtime', productRuntimeSessionId: second.session.id, productType: 'avg',
    })
    expect(await db.productMediaBlobs.get(secondBlob!.id!)).toBeDefined()
    const collected = await collectUnreferencedMediaBlobObjects({ scope: world.scope })
    expect(collected.deleted).toContain(firstBlob!.blobObjectId)
    expect(collected.retained).toContain(secondBlob!.blobObjectId)
  }, 40_000)
})

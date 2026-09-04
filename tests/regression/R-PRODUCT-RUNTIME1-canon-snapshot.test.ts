import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  buildProductWorldSourceBundleV1,
  verifyProductRuntimeCanonSnapshot,
  verifyProductWorldSourceBundleV1,
} from '../../src/lib/product/runtime-canon'
import {
  branchProductRuntimeSession,
  createProductRuntimeCheckpoint,
  readProductRuntimeState,
  verifyProductRuntimeCheckpoint,
} from '../../src/lib/product/runtime-api'
import { appendProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import {
  loadCurrentProductWorldSourceCatalogV1,
  seedCurrentProductWorld,
} from '../helpers/current-product-world'
import { createCurrentRuntimePackageFixture } from '../helpers/current-runtime-package'

async function currentSource(name: string) {
  const owned = await seedCurrentProductWorld(name)
  const catalog = await loadCurrentProductWorldSourceCatalogV1({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
    productType: 'character-interaction',
  })
  const bundle = await buildProductWorldSourceBundleV1({
    world: catalog.world,
    release: catalog.release,
    resources: catalog.resources,
  })
  return { owned, catalog, bundle }
}

async function currentRuntime(name: string) {
  const source = await currentSource(name)
  const runtimePackage = createCurrentRuntimePackageFixture({
    productType: 'character-interaction',
    worldRelease: source.owned.release as typeof source.owned.release & { id: number },
    sourceCatalog: source.catalog,
  })
  const built = await seedCurrentProductBuild({
    scope: source.owned.scope,
    worldRelease: source.owned.release as typeof source.owned.release & { id: number },
    runtimePackage,
    title: `${name} · 产品运行`,
  })
  return { ...source, ...built, runtimePackage }
}

describe('PRODUCT-RUNTIME-1B · 冻结世界来源与产品运行投影', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('只从不可变 WorldRelease 编译语义来源，并冻结字段、时间与内容 hash', async () => {
    const { bundle } = await currentSource('冻结来源测试')
    const names = bundle.canonSnapshot.sources.map(source => source.name)
    expect(names).toEqual(expect.arrayContaining(['林舟', '雾港灯塔', '黄铜潮汐钥匙']))
    expect(bundle.canonSnapshot.sources.every(source => /^[0-9a-f]{64}$/.test(source.contentHash)))
      .toBe(true)
    expect(bundle.canonSnapshot.snapshotHash).toMatch(/^[0-9a-f]{64}$/)
    expect(bundle.bundleHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await verifyProductRuntimeCanonSnapshot(bundle.canonSnapshot)).toBe(true)
    expect(await verifyProductWorldSourceBundleV1(bundle)).toBe(true)
    expect(await verifyProductRuntimeCanonSnapshot({
      ...bundle.canonSnapshot,
      sources: bundle.canonSnapshot.sources.map((source, index) => (
        index === 0 ? { ...source, summary: '被篡改' } : source
      )),
    })).toBe(false)
    expect(Object.values(bundle.initialState.entities).some(entity => entity.name === '林舟')).toBe(true)
    expect(Object.values(bundle.initialState.entities).some(entity => entity.name === '雾港灯塔')).toBe(true)
    expect(Object.values(bundle.initialState.entities).some(entity => entity.name === '黄铜潮汐钥匙')).toBe(true)
  })

  it('实时工作区变化不改写 WorldRelease，正式 Build 会话、分支和导入后仍独立回放', async () => {
    const built = await currentRuntime('冻结产品谱系')
    const originalBundleHash = built.bundle.bundleHash
    const originalSourceHash = built.session.runtimeSourceHash

    await db.characters.update(built.owned.characterIds[0], {
      shortDescription: '实时工作区中已经离开雾港',
      updatedAt: Date.now() + 100,
    })
    const reloadedCatalog = await loadCurrentProductWorldSourceCatalogV1({
      scope: built.owned.scope,
      worldReleaseId: built.owned.release.id!,
      productType: 'character-interaction',
    })
    const recompiled = await buildProductWorldSourceBundleV1({
      world: reloadedCatalog.world,
      release: reloadedCatalog.release,
      resources: reloadedCatalog.resources,
    })
    expect(recompiled.bundleHash).toBe(originalBundleHash)

    await db.characters.delete(built.owned.characterIds[0])
    const parentState = await readProductRuntimeState(built.session.id!)
    expect(parentState.narrative?.contentHash).toBe(originalSourceHash)
    expect(parentState.narrative?.moduleTitle).toBe(built.runtimePackage.narrative.moduleTitle)
    const child = await branchProductRuntimeSession({
      parentSessionId: built.session.id!,
      throughSequence: parentState.lastSequence,
      title: '冻结产品谱系 · 私域分支',
    })
    expect(child.runtimeSourceHash).toBe(originalSourceHash)
    expect(child.productBuildId).toBe(built.buildId)

    const exported = await exportProjectJSON(built.owned.scope.projectId)
    const importedProjectId = await importProjectJSON(exported)
    const imported = await db.productRuntimeSessions
      .where('projectId').equals(importedProjectId)
      .filter(session => session.title === '冻结产品谱系 · 产品运行')
      .first()
    expect(imported?.runtimeSourceHash).toBe(originalSourceHash)
    expect(imported?.productBuildId).toBeTypeOf('number')
    expect((await readProductRuntimeState(imported!.id!)).narrative?.contentHash).toBe(originalSourceHash)
  })

  it('拒绝损坏的世界来源，并验证正式产品检查点和分支恢复', async () => {
    const built = await currentRuntime('检查点恢复')
    await expect(buildProductWorldSourceBundleV1({
      world: built.catalog.world,
      release: { ...built.catalog.release, contentHash: 'invalid' },
      resources: built.catalog.resources,
    })).rejects.toThrow('content hash 无效')

    await appendProductRuntimeEvent({
      sessionId: built.session.id!,
      type: 'time.advanced',
      payload: { amount: 2 },
    })
    const checkpoint = await createProductRuntimeCheckpoint({
      sessionId: built.session.id!,
      name: '第二刻',
    })
    expect(await verifyProductRuntimeCheckpoint(checkpoint.id!)).toBe(true)
    const state = await readProductRuntimeState(built.session.id!)
    const restored = await branchProductRuntimeSession({
      parentSessionId: built.session.id!,
      throughSequence: state.lastSequence,
      title: '检查点恢复 · 第二刻',
    })
    expect(restored).toMatchObject({
      parentThroughSequence: state.lastSequence,
      title: '检查点恢复 · 第二刻',
      productBuildId: built.buildId,
    })
    expect((await readProductRuntimeState(restored.id!)).clock).toBe(2)

    await db.productRuntimeCheckpoints.update(checkpoint.id!, { stateJson: '{"tampered":true}' })
    expect(await verifyProductRuntimeCheckpoint(checkpoint.id!)).toBe(false)
    expect(await db.productRuntimeSessions.where('projectId').equals(built.owned.scope.projectId).count()).toBe(2)
  })
})

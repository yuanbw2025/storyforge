import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { EMPTY_PRODUCT_RUNTIME_STATE, type ProductRelease } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { createTextOpenWorldVNextOnlyProductRuntimePackageFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function resetStore() {
  useTextOpenWorldPlayerStore.setState({
    scope: null,
    worldGroupId: null,
    releases: [],
    sessions: [],
    selectedSessionId: null,
    selectedSession: null,
    selectedSessionSource: null,
    events: [],
    checkpoints: [],
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    selectedManifest: null,
    lastFeedback: null,
    generatedCandidate: null,
    loading: false,
    busy: false,
    error: '',
  })
}

async function fixture() {
  const owned = await seedCurrentProductWorld(`开放世界玩家库-${crypto.randomUUID()}`)
  const textOpenWorldVNext = createTextOpenWorldVNextFixture()
  textOpenWorldVNext.sourceManifest.contentHash = owned.release.contentHash
  const runtimePackage = createTextOpenWorldVNextOnlyProductRuntimePackageFixtureV1(textOpenWorldVNext)
  const build = await seedCurrentProductBuild({
    scope: owned.scope,
    worldRelease: owned.release,
    runtimePackage,
    title: '明确交接的 Build Preview',
  })

  const productionKey = `fixture.text-open-world.library.${crypto.randomUUID()}`
  const manifest = await createFixtureProductReleaseManifestV1({ runtimePackage, productionKey })
  const now = Date.now()
  const release: ProductRelease = {
    ...owned.scope,
    productionKey,
    productType: 'text-open-world',
    worldReleaseId: owned.release.id!,
    version: 1,
    label: '正式开放世界 v1',
    manifestJson: JSON.stringify(manifest),
    contentHash: await hashProductProductionValueV2(manifest),
    createdAt: now,
  }
  release.id = await db.productReleases.add(release) as number
  const formalSession = await createTextOpenWorldInstance({
    scope: owned.scope,
    productReleaseId: release.id,
    title: '正式旅程',
    seed: 'release-library-session',
  })
  return { ...owned, runtimePackage, build, manifest, release, formalSession }
}

describe('Text Open World G4 · 玩家库与显式Session加载', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    resetStore()
  })
  afterAll(() => db.close())

  it('无显式Session时停留游戏库，不以最近存档自动开局', async () => {
    const created = await fixture()

    await useTextOpenWorldPlayerStore.getState().load(created.scope, null)

    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
      selectedSessionId: null,
      selectedSession: null,
      selectedSessionSource: null,
      error: '',
    })
    expect(new Set(useTextOpenWorldPlayerStore.getState().sessions.map(row => row.id)))
      .toEqual(new Set([created.formalSession.id, created.build.session.id]))
    expect(useTextOpenWorldPlayerStore.getState().runtimeState)
      .toEqual(EMPTY_PRODUCT_RUNTIME_STATE)
  })

  it('显式initialSessionId一次装载Build Preview，统一Session集合仍保留两种来源', async () => {
    const created = await fixture()

    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.build.session.id)

    const state = useTextOpenWorldPlayerStore.getState()
    expect(new Set(state.sessions.map(row => row.id)))
      .toEqual(new Set([created.formalSession.id, created.build.session.id]))
    expect(state.selectedSessionId).toBe(created.build.session.id)
    expect(state.selectedSession).toMatchObject({
      id: created.build.session.id,
      productReleaseId: null,
      productBuildId: created.build.buildId,
      title: '明确交接的 Build Preview',
    })
    expect(state.selectedSessionSource).toBe('build-preview')
    expect(state.selectedManifest?.textOpenWorldVNext?.metadata.packageKey)
      .toBe(created.runtimePackage.textOpenWorldVNext?.metadata.packageKey)
    expect(state.error).toBe('')
  })

  it('高风险确认遇到外部事件漂移后刷新权威Projection，并可按新基线重试', async () => {
    const created = await fixture()
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.formalSession.id)
    const staleBaseSequence = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence

    await executeTextOpenWorldActionV1({
      sessionId: created.formalSession.id!,
      actionKey: 'action.talk-caretaker',
      targetKey: 'actor.caretaker',
      commandId: 'command.player-store.external-talk',
    })
    const databaseSequence = (await db.productRuntimeSessions.get(created.formalSession.id!))!
      .runtimeHeadSequence!
    expect(databaseSequence).toBeGreaterThan(staleBaseSequence)

    await expect(useTextOpenWorldPlayerStore.getState().executeVNextAction(
      'action.steal-tonic',
      'actor.caretaker',
      { confirmed: true, expectedBaseSequence: staleBaseSequence },
    )).rejects.toThrow('确认基线已变化')

    const refreshed = useTextOpenWorldPlayerStore.getState()
    expect(refreshed.runtimeState.lastSequence).toBe(databaseSequence)
    expect(refreshed.error).toContain('确认基线已变化')

    await refreshed.executeVNextAction(
      'action.steal-tonic',
      'actor.caretaker',
      { confirmed: true, expectedBaseSequence: refreshed.runtimeState.lastSequence },
    )
    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({ error: '' })
  }, 15_000)

  it('较慢的旧scope与世界分组装载完成后不会覆盖较新的游戏库与空选择', async () => {
    const stale = await fixture()
    const current = await fixture()
    await db.productRuntimeSessions.update(current.formalSession.id!, { worldGroupId: 9 })
    await db.productRuntimeSessions.update(current.build.session.id!, { worldGroupId: 9 })
    let releaseStaleRead!: () => void
    let staleReadEntered!: () => void
    const staleReadGate = new Promise<void>(resolve => { releaseStaleRead = resolve })
    const staleReadStarted = new Promise<void>(resolve => { staleReadEntered = resolve })
    const originalGet = db.productReleases.get.bind(db.productReleases)
    const getSpy = vi.spyOn(db.productReleases, 'get').mockImplementation(async key => {
      const result = originalGet(key)
      if (key === stale.release.id) {
        staleReadEntered()
        await staleReadGate
      }
      return result
    })

    const staleLoad = useTextOpenWorldPlayerStore.getState()
      .load(stale.scope, null, stale.formalSession.id)
    await staleReadStarted
    await useTextOpenWorldPlayerStore.getState().load(current.scope, 9)

    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
      scope: current.scope,
      worldGroupId: 9,
      selectedSessionId: null,
      selectedSession: null,
      error: '',
    })
    releaseStaleRead()
    await staleLoad
    getSpy.mockRestore()

    const state = useTextOpenWorldPlayerStore.getState()
    expect(state.scope).toEqual(current.scope)
    expect(state.releases.map(item => item.release.id)).toEqual([current.release.id])
    expect(new Set(state.sessions.map(item => item.id)))
      .toEqual(new Set([current.formalSession.id, current.build.session.id]))
    expect(state.selectedSessionId).toBeNull()
    expect(state.selectedSession).toBeNull()
    expect(state.runtimeState).toEqual(EMPTY_PRODUCT_RUNTIME_STATE)
  })

  it('旧scope的延迟选档完成后不会把运行投影写入新scope', async () => {
    const stale = await fixture()
    const current = await fixture()
    await useTextOpenWorldPlayerStore.getState().load(stale.scope, null)
    let releaseStaleRead!: () => void
    let staleReadEntered!: () => void
    const staleReadGate = new Promise<void>(resolve => { releaseStaleRead = resolve })
    const staleReadStarted = new Promise<void>(resolve => { staleReadEntered = resolve })
    const originalGet = db.productReleases.get.bind(db.productReleases)
    const getSpy = vi.spyOn(db.productReleases, 'get').mockImplementation(async key => {
      const result = originalGet(key)
      if (key === stale.release.id) {
        staleReadEntered()
        await staleReadGate
      }
      return result
    })

    const staleSelect = useTextOpenWorldPlayerStore.getState().select(stale.formalSession.id!)
    await staleReadStarted
    await useTextOpenWorldPlayerStore.getState().load(current.scope, null)
    releaseStaleRead()
    await staleSelect
    getSpy.mockRestore()

    const state = useTextOpenWorldPlayerStore.getState()
    expect(state.scope).toEqual(current.scope)
    expect(state.releases.map(item => item.release.id)).toEqual([current.release.id])
    expect(state.selectedSessionId).toBeNull()
    expect(state.selectedSession).toBeNull()
    expect(state.selectedManifest).toBeNull()
    expect(state.runtimeState).toEqual(EMPTY_PRODUCT_RUNTIME_STATE)
    expect(state.error).toBe('')
  })

  it('Release库同时核验project/world/work与productType，不接纳同workId伪同域记录', async () => {
    const created = await fixture()
    const foreignProject = {
      ...created.release,
      id: undefined,
      projectId: created.scope.projectId + 100,
      productionKey: `${created.release.productionKey}.foreign-project`,
    }
    const foreignWorld = {
      ...created.release,
      id: undefined,
      worldId: created.scope.worldId + 100,
      productionKey: `${created.release.productionKey}.foreign-world`,
    }
    const foreignProduct = {
      ...created.release,
      id: undefined,
      productionKey: `${created.release.productionKey}.foreign-product`,
      productType: 'text-adventure' as const,
    }
    await db.productReleases.bulkAdd([foreignProject, foreignWorld, foreignProduct])

    await useTextOpenWorldPlayerStore.getState().load(created.scope, null)

    const releases = useTextOpenWorldPlayerStore.getState().releases
    expect(releases.map(item => item.release.id)).toEqual([created.release.id])
    expect(releases[0]?.packageHash).toBe(created.manifest.packageHash)
  })

  it('同域损坏Release仍作为不可启动条目可见，并拒绝根行与生产谱系不一致', async () => {
    const created = await fixture()
    const invalidManifest: ProductRelease = {
      ...created.release,
      id: undefined,
      productionKey: `${created.release.productionKey}.invalid-manifest`,
      label: '损坏清单',
      manifestJson: '{not-json',
      createdAt: created.release.createdAt + 1,
    }
    invalidManifest.id = await db.productReleases.add(invalidManifest) as number
    const provenanceMismatch: ProductRelease = {
      ...created.release,
      id: undefined,
      productionKey: `${created.release.productionKey}.wrong-lineage`,
      label: '错误生产谱系',
      createdAt: created.release.createdAt + 2,
    }
    provenanceMismatch.id = await db.productReleases.add(provenanceMismatch) as number

    await useTextOpenWorldPlayerStore.getState().load(created.scope, null)

    const invalid = useTextOpenWorldPlayerStore.getState().releases
      .find(item => item.release.id === invalidManifest.id)
    expect(invalid).toMatchObject({ manifest: null, packageHash: null })
    expect(invalid?.error).not.toBe('')
    const mismatched = useTextOpenWorldPlayerStore.getState().releases
      .find(item => item.release.id === provenanceMismatch.id)
    expect(mismatched).toMatchObject({ manifest: null, packageHash: null })
    expect(mismatched?.error).toMatch(/生产谱系不一致/)
  })

  it('选择损坏存档会清空全部运行投影并给出可恢复错误，不删除任何Session', async () => {
    const created = await fixture()
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.build.session.id)
    await db.productReleases.update(created.release.id!, {
      manifestJson: created.release.manifestJson.replace('盐脊', '被篡改的盐脊'),
    })

    await expect(useTextOpenWorldPlayerStore.getState().select(created.formalSession.id!)).resolves.toBeUndefined()

    const state = useTextOpenWorldPlayerStore.getState()
    expect(state).toMatchObject({
      selectedSessionId: null,
      selectedSession: null,
      selectedSessionSource: null,
      selectedManifest: null,
      events: [],
      checkpoints: [],
      loading: false,
    })
    expect(state.runtimeState).toEqual(EMPTY_PRODUCT_RUNTIME_STATE)
    expect(state.error).toMatch(/存档加载失败，可返回游戏库重试/)
    await expect(db.productRuntimeSessions.get(created.formalSession.id!)).resolves.toBeDefined()
    await expect(db.productRuntimeSessions.get(created.build.session.id!)).resolves.toBeDefined()
  })

  it('来源已损坏的自有正式存档仍可删除，Release和其它Session保持不变', async () => {
    const created = await fixture()
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null)
    await db.productReleases.update(created.release.id!, { manifestJson: '{broken-release' })

    await useTextOpenWorldPlayerStore.getState().remove(created.formalSession.id!)

    await expect(db.productRuntimeSessions.get(created.formalSession.id!)).resolves.toBeUndefined()
    await expect(db.productRuntimeSessions.get(created.build.session.id!)).resolves.toBeDefined()
    await expect(db.productReleases.get(created.release.id!)).resolves.toBeDefined()
    expect(useTextOpenWorldPlayerStore.getState().error).toBe('')
  })

  it('显式Build Preview存档即使预览来源损坏也可删除，不进入正式存档列表', async () => {
    const created = await fixture()
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.build.session.id)
    await db.productBuilds.update(created.build.buildId, { previewManifestJson: '{broken-preview' })

    await useTextOpenWorldPlayerStore.getState().remove(created.build.session.id!)

    await expect(db.productRuntimeSessions.get(created.build.session.id!)).resolves.toBeUndefined()
    await expect(db.productRuntimeSessions.get(created.formalSession.id!)).resolves.toBeDefined()
    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
      sessions: [{ id: created.formalSession.id }],
      selectedSessionId: null,
      selectedSession: null,
      selectedSessionSource: null,
      error: '',
    })
  })

  it('删除边界拒绝其它世界分组的存档且不触碰原记录', async () => {
    const created = await fixture()
    await db.productRuntimeSessions.update(created.formalSession.id!, { worldGroupId: 9 })
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null)

    await expect(useTextOpenWorldPlayerStore.getState().remove(created.formalSession.id!))
      .rejects.toThrow(/只能删除当前World\/Work和世界分组/)

    await expect(db.productRuntimeSessions.get(created.formalSession.id!)).resolves.toBeDefined()
    expect(useTextOpenWorldPlayerStore.getState().error).toMatch(/只能删除当前World\/Work和世界分组/)
  })
})

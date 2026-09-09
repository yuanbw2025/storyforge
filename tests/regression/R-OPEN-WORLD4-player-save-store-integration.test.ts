import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  TEXT_OPEN_WORLD_MANUAL_SAVE_LIMIT_V1,
  createTextOpenWorldManualSaveV1,
  type TextOpenWorldSaveOwnerV1,
} from '../../src/lib/open-world/player-saves'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { EMPTY_PRODUCT_RUNTIME_STATE, type ProductRelease } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import {
  createGovernedTextOpenWorldSessionFixtureV1,
  createTextOpenWorldProductRuntimePackageFixtureV1,
} from '../helpers/text-open-world-product-session'
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
    saveProjection: { groups: [], totalBranches: 0, totalCheckpoints: 0 },
    versionCompatibility: null,
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    selectedManifest: null,
    lastFeedback: null,
    generatedCandidate: null,
    presentationBusy: false,
    presentationIssue: null,
    issue: null,
    recovery: null,
    recoveryNotice: '',
    loading: false,
    busy: false,
    error: '',
  })
}

async function fixture(name: string) {
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `${name}-${crypto.randomUUID()}`,
    textOpenWorldVNext: createTextOpenWorldVNextFixture(),
    runtimeShape: 'vnext-only',
    title: name,
    seed: `save-store-${name}`,
  })
  const owner: TextOpenWorldSaveOwnerV1 = { scope: created.scope, worldGroupId: null }
  return { ...created, owner }
}

async function legacyFixture() {
  const hybrid = createTextOpenWorldProductRuntimePackageFixtureV1(createTextOpenWorldVNextFixture())
  const raw = structuredClone(hybrid) as any
  delete raw.textOpenWorldVNext
  raw.definition.enabledCapabilities = raw.definition.enabledCapabilities
    .filter((capability: string) => capability !== 'textOpenWorldVNext')
  const runtimePackage = parseProductRuntimePackageV1(raw)
  const workspace = await createWorkspace({
    name: `旧Release Store集成-${crypto.randomUUID()}`,
    genres: ['open-world'],
    status: 'drafting',
    description: '',
    targetWordCount: 1,
    enableMultiWorld: false,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const productionKey = `fixture.text-open-world.legacy.store.${crypto.randomUUID()}`
  const manifest = await createFixtureProductReleaseManifestV1({ runtimePackage, productionKey })
  const release: ProductRelease = {
    ...workspace.scope,
    productionKey,
    productType: 'text-open-world',
    worldReleaseId: null,
    version: 1,
    label: '旧版盐脊 v1',
    manifestJson: JSON.stringify(manifest),
    contentHash: await hashProductProductionValueV2(manifest),
    createdAt: Date.now(),
  }
  release.id = await db.productReleases.add(release) as number
  const session = await createTextOpenWorldInstance({
    scope: workspace.scope,
    productReleaseId: release.id,
    title: '旧版盐脊旅程',
    seed: 'legacy-store-integration',
  })
  return { ...workspace, release, session }
}

function currentBranch() {
  return useTextOpenWorldPlayerStore.getState().saveProjection.groups
    .flatMap(group => group.branches)
    .find(branch => branch.isCurrent)
}

function delayNextSessionRead(sessionId: number) {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  const originalGet = db.productRuntimeSessions.get.bind(db.productRuntimeSessions)
  let shouldDelay = true
  const spy = vi.spyOn(db.productRuntimeSessions, 'get').mockImplementation(async key => {
    const result = originalGet(key)
    if (shouldDelay && key === sessionId) {
      shouldDelay = false
      entered()
      await gate
    }
    return result
  })
  return { started, release, restore: () => spy.mockRestore() }
}

describe('Text Open World G4-12F · Store与玩家存档领域集成', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    resetStore()
  })
  afterAll(() => db.close())

  it('load从规范旅行终态补自动档，并同时发布存档与固定Release版本投影', async () => {
    const created = await fixture('旅行恢复旅程')
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.travel-port-ridge',
      targetKey: 'location.ridge-channel',
      commandId: 'command.save-store.travel',
    })
    expect((await db.productRuntimeCheckpoints.where('sessionId').equals(created.session.id!).toArray())
      .filter(checkpoint => checkpoint.purpose === 'autosave')).toHaveLength(0)

    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.session.id)

    const state = useTextOpenWorldPlayerStore.getState()
    const automatic = (await db.productRuntimeCheckpoints
      .where('sessionId').equals(created.session.id!).toArray())
      .filter(checkpoint => checkpoint.purpose === 'autosave')
    expect(automatic).toHaveLength(1)
    expect(state.checkpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: automatic[0].id, purpose: 'autosave', subjectKey: null }),
    ]))
    expect(state.saveProjection).toMatchObject({
      totalBranches: 1,
      totalCheckpoints: 1,
      groups: [{
        versionLabel: '版本 1',
        branches: [{
          isCurrent: true,
          actionIdentity: { sessionId: created.session.id },
          summary: { locationLabel: '断脊渠口', regionLabel: '断脊' },
          checkpoints: [{
            actionIdentity: { sessionId: created.session.id, checkpointId: automatic[0].id },
            purpose: 'autosave',
            health: 'available',
          }],
        }],
      }],
    })
    expect(state.versionCompatibility).toMatchObject({
      availability: 'ready',
      productionKey: created.release.productionKey,
      pinnedRelease: {
        version: 1,
        label: created.release.label,
        canContinueWithoutUpgrade: true,
      },
      migration: { available: false, reason: 'versioned-migrator-not-implemented' },
    })
  }, 20_000)

  it('saveCheckpoint执行20槽领域上限并刷新投影，满槽时forkCurrent仍创建system点', async () => {
    const created = await fixture('手动槽旅程')
    const sessionId = created.session.id!
    for (let index = 0; index < TEXT_OPEN_WORLD_MANUAL_SAVE_LIMIT_V1 - 1; index += 1) {
      await createTextOpenWorldManualSaveV1({
        owner: created.owner,
        sessionId,
        name: `既有手动档 ${index + 1}`,
      })
    }
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, sessionId)
    expect(currentBranch()?.manualSlots).toEqual({ used: 19, limit: 20, remaining: 1 })

    await useTextOpenWorldPlayerStore.getState().saveCheckpoint('第20个手动档')
    expect(currentBranch()?.manualSlots).toEqual({ used: 20, limit: 20, remaining: 0 })
    expect(currentBranch()?.checkpoints.some(checkpoint => checkpoint.name === '第20个手动档'))
      .toBe(true)
    await expect(useTextOpenWorldPlayerStore.getState().saveCheckpoint('越界手动档'))
      .rejects.toThrow('最多20个')
    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({ busy: false })

    const forkSequence = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence
    const childId = await useTextOpenWorldPlayerStore.getState().forkCurrent('满槽仍可分支')
    const parentRows = await db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray()
    expect(parentRows.filter(checkpoint => (checkpoint.purpose ?? 'manual') === 'manual')).toHaveLength(20)
    expect(parentRows.filter(checkpoint => checkpoint.purpose === 'system')).toEqual([
      expect.objectContaining({ subjectKey: null, throughSequence: forkSequence }),
    ])
    expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).toBe(childId)
    expect(currentBranch()).toMatchObject({
      actionIdentity: { sessionId: childId },
      relationship: 'child',
      manualSlots: { used: 0, limit: 20, remaining: 20 },
    })
    const parentProjection = useTextOpenWorldPlayerStore.getState().saveProjection.groups
      .flatMap(group => group.branches)
      .find(branch => branch.actionIdentity.sessionId === sessionId)
    expect(parentProjection?.manualSlots).toEqual({ used: 20, limit: 20, remaining: 0 })
  }, 45_000)

  it('forkCheckpoint使用投影actionIdentity建立同Release子分支，切换父子Session不串投影', async () => {
    const created = await fixture('投影分支旅程')
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.session.id)
    await useTextOpenWorldPlayerStore.getState().saveCheckpoint('父分支起点')
    const parentCheckpoint = currentBranch()?.checkpoints.find(checkpoint => checkpoint.name === '父分支起点')
    expect(parentCheckpoint?.actionIdentity).toEqual({
      sessionId: created.session.id,
      checkpointId: expect.any(Number),
    })

    const childId = await useTextOpenWorldPlayerStore.getState().forkCheckpoint(
      parentCheckpoint!.actionIdentity.checkpointId,
      '投影派生分支',
    )
    await expect(db.productRuntimeSessions.get(childId)).resolves.toMatchObject({
      parentSessionId: created.session.id,
      productReleaseId: created.release.id,
      productBuildId: null,
      runtimeSourceHash: created.session.runtimeSourceHash,
    })
    expect(currentBranch()).toMatchObject({
      actionIdentity: { sessionId: childId },
      relationship: 'child',
      parentTitle: '投影分支旅程',
      checkpoints: [],
    })
    await useTextOpenWorldPlayerStore.getState().saveCheckpoint('子分支独有档')

    await useTextOpenWorldPlayerStore.getState().select(created.session.id!)
    expect(useTextOpenWorldPlayerStore.getState().checkpoints.map(checkpoint => checkpoint.name))
      .toEqual(['父分支起点'])
    expect(currentBranch()).toMatchObject({
      actionIdentity: { sessionId: created.session.id },
      relationship: 'root',
      checkpoints: [expect.objectContaining({ name: '父分支起点' })],
    })
    expect(useTextOpenWorldPlayerStore.getState().versionCompatibility?.pinnedRelease?.version).toBe(1)

    await useTextOpenWorldPlayerStore.getState().select(childId)
    expect(useTextOpenWorldPlayerStore.getState().checkpoints.map(checkpoint => checkpoint.name))
      .toEqual(['子分支独有档'])
    expect(currentBranch()).toMatchObject({
      actionIdentity: { sessionId: childId },
      relationship: 'child',
      checkpoints: [expect.objectContaining({ name: '子分支独有档' })],
    })
  }, 30_000)

  it('删除与两类修复均执行owner守卫，成功后刷新保存中心健康状态', async () => {
    const owned = await fixture('受管维护旅程')
    const foreign = await fixture('外部维护旅程')
    const foreignCheckpoint = await createTextOpenWorldManualSaveV1({
      owner: foreign.owner,
      sessionId: foreign.session.id!,
      name: '外部存档',
    })
    await useTextOpenWorldPlayerStore.getState().load(owned.scope, null, owned.session.id)
    await useTextOpenWorldPlayerStore.getState().saveCheckpoint('待修复档')
    await useTextOpenWorldPlayerStore.getState().saveCheckpoint('待删除档')
    const repairId = currentBranch()?.checkpoints.find(checkpoint => checkpoint.name === '待修复档')
      ?.actionIdentity.checkpointId
    const deleteId = currentBranch()?.checkpoints.find(checkpoint => checkpoint.name === '待删除档')
      ?.actionIdentity.checkpointId
    expect(repairId).toEqual(expect.any(Number))
    expect(deleteId).toEqual(expect.any(Number))
    await db.productRuntimeCheckpoints.update(repairId!, { stateHash: 'f'.repeat(64) })
    await db.productRuntimeSessions.update(owned.session.id!, { runtimeHeadStateHash: 'f'.repeat(64) })

    await useTextOpenWorldPlayerStore.getState().refreshSaveCenter()
    expect(currentBranch()).toMatchObject({ runtimeHealth: 'repairable', runtimeRepairable: true })
    expect(currentBranch()?.checkpoints.find(checkpoint => checkpoint.name === '待修复档'))
      .toMatchObject({ health: 'repairable', repairable: true })

    const beforeForeignRepair = structuredClone(useTextOpenWorldPlayerStore.getState().saveProjection)
    await expect(useTextOpenWorldPlayerStore.getState().repairCheckpoint(foreignCheckpoint.id!))
      .rejects.toThrow('只能操作当前World/Work')
    expect(useTextOpenWorldPlayerStore.getState().saveProjection).toEqual(beforeForeignRepair)
    await useTextOpenWorldPlayerStore.getState().repairCheckpoint(repairId!)
    expect(currentBranch()?.checkpoints.find(checkpoint => checkpoint.name === '待修复档'))
      .toMatchObject({ health: 'available', repairable: false })

    await expect(useTextOpenWorldPlayerStore.getState().repairRuntimeHead(foreign.session.id!))
      .rejects.toThrow('只能操作当前World/Work')
    await useTextOpenWorldPlayerStore.getState().repairRuntimeHead(owned.session.id!)
    expect(currentBranch()).toMatchObject({ runtimeHealth: 'available', runtimeRepairable: false })

    await expect(useTextOpenWorldPlayerStore.getState().deleteCheckpoint(foreignCheckpoint.id!))
      .rejects.toThrow('只能操作当前World/Work')
    await useTextOpenWorldPlayerStore.getState().deleteCheckpoint(deleteId!)
    await expect(db.productRuntimeCheckpoints.get(deleteId!)).resolves.toBeUndefined()
    expect(currentBranch()?.checkpoints.some(checkpoint => checkpoint.name === '待删除档')).toBe(false)
    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({ busy: false, error: '' })
  }, 30_000)

  it('延迟refreshSaveCenter完成前切换Session，不会串入旧保存投影或版本投影', async () => {
    const stale = await fixture('旧投影旅程')
    const current = await fixture('新投影旅程')
    await createTextOpenWorldManualSaveV1({
      owner: stale.owner,
      sessionId: stale.session.id!,
      name: '只属于旧Session',
    })
    await createTextOpenWorldManualSaveV1({
      owner: current.owner,
      sessionId: current.session.id!,
      name: '只属于新Session',
    })
    await useTextOpenWorldPlayerStore.getState().load(stale.scope, null, stale.session.id)
    const delayed = delayNextSessionRead(stale.session.id!)

    try {
      const staleRefresh = useTextOpenWorldPlayerStore.getState().refreshSaveCenter()
      await delayed.started
      await useTextOpenWorldPlayerStore.getState().load(current.scope, null, current.session.id)
      delayed.release()
      await staleRefresh

      const state = useTextOpenWorldPlayerStore.getState()
      expect(state).toMatchObject({
        scope: current.scope,
        selectedSessionId: current.session.id,
        busy: false,
        error: '',
      })
      expect(JSON.stringify(state.saveProjection)).toContain('只属于新Session')
      expect(JSON.stringify(state.saveProjection)).not.toContain('只属于旧Session')
      expect(currentBranch()?.actionIdentity).toEqual({ sessionId: current.session.id })
      expect(state.versionCompatibility).toMatchObject({
        productionKey: current.release.productionKey,
        pinnedRelease: { label: current.release.label },
      })
      expect(state.versionCompatibility?.productionKey).not.toBe(stale.release.productionKey)
    } finally {
      delayed.release()
      delayed.restore()
    }
  }, 20_000)

  it('旧Release继续通过Store完成手动保存和同固定Release分支', async () => {
    const created = await legacyFixture()
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.session.id)
    expect(currentBranch()).toMatchObject({
      actionIdentity: { sessionId: created.session.id },
      runtimeFormat: 'legacy',
      runtimeHealth: 'available',
    })
    expect(useTextOpenWorldPlayerStore.getState().versionCompatibility).toMatchObject({
      availability: 'ready',
      pinnedRelease: { version: 1, label: '旧版盐脊 v1' },
    })

    await useTextOpenWorldPlayerStore.getState().saveCheckpoint('旧Release手动档')
    const projected = currentBranch()?.checkpoints.find(checkpoint => checkpoint.name === '旧Release手动档')
    expect(projected).toMatchObject({
      purpose: 'manual',
      health: 'available',
      actionIdentity: { sessionId: created.session.id, checkpointId: expect.any(Number) },
    })
    const childId = await useTextOpenWorldPlayerStore.getState().forkCheckpoint(
      projected!.actionIdentity.checkpointId,
      '旧Release Store分支',
    )

    await expect(db.productRuntimeSessions.get(childId)).resolves.toMatchObject({
      parentSessionId: created.session.id,
      productReleaseId: created.release.id,
      productBuildId: null,
      runtimeSourceHash: created.session.runtimeSourceHash,
      title: '旧Release Store分支',
    })
    expect(currentBranch()).toMatchObject({
      actionIdentity: { sessionId: childId },
      runtimeFormat: 'legacy',
      relationship: 'child',
    })
  }, 20_000)
})

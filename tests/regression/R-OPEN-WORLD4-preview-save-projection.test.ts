import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as saves from '../../src/lib/open-world/player-saves'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

const initialStore = useTextOpenWorldPlayerStore.getState()

async function preview() {
  const fixture = await createTextOpenWorldCreatorReleaseFixtureV1('world-release', 1, { portableRoot: true })
  // The isolated release helper seeds the sealed preview proof but leaves the
  // scheduler row in its initial state. This fixture exercises an unpublished preview.
  await db.productBuilds.update(fixture.creator.buildId, { status: 'preview-ready' })
  const session = await createProductRuntimeInstanceFromSource({
    scope: fixture.scope,
    source: {
      kind: 'build', productBuildId: fixture.creator.buildId,
      expectedPreviewHash: fixture.portableRoot!.previewHash,
    },
    title: '受治理的制作预览',
  })
  return { ...fixture, session }
}

describe('制作预览只读取当前会话，不加载未开放的正式存档目录', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useTextOpenWorldPlayerStore.setState(initialStore, true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    useTextOpenWorldPlayerStore.setState(initialStore, true)
  })
  afterAll(() => db.close())

  it('跳过历史存档目录，但保留当前自动存档核对和正式动作落盘', async () => {
    const created = await preview()
    const library = vi.spyOn(saves, 'projectTextOpenWorldPlayerSavesV1')
      .mockRejectedValue(new Error('unavailable historical library'))
    const reconcile = vi.spyOn(saves, 'reconcileTextOpenWorldAutomaticSavesV1')
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.session.id!)
    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
      error: '', selectedSessionId: created.session.id, selectedSessionSource: 'build-preview',
      saveProjection: { groups: [], totalBranches: 0, totalCheckpoints: 0 },
    })
    expect(library).not.toHaveBeenCalled()
    expect(reconcile).toHaveBeenCalledWith({
      owner: { scope: created.scope, worldGroupId: null }, sessionId: created.session.id,
    })
    const before = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence
    await useTextOpenWorldPlayerStore.getState().executeVNextAction('action.investigate-channel', 'location.salt-port')
    expect(useTextOpenWorldPlayerStore.getState().lastFeedback).toMatchObject({
      sessionId: created.session.id, phase: 'terminal', status: 'succeeded', outcomeCommitted: true,
    })
    expect(useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence).toBeGreaterThan(before)
    expect(await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count())
      .toBeGreaterThan(before)
    expect(library).not.toHaveBeenCalled()
  })

  it('正式Release继续加载原存档目录', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: '正式存档投影', textOpenWorldVNext: createTextOpenWorldVNextFixture(),
    })
    const library = vi.spyOn(saves, 'projectTextOpenWorldPlayerSavesV1')
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.session.id!)
    expect(useTextOpenWorldPlayerStore.getState().error).toBe('')
    expect(library).toHaveBeenCalledWith({
      owner: { scope: created.scope, worldGroupId: null }, currentSessionId: created.session.id,
    })
    expect(useTextOpenWorldPlayerStore.getState().saveProjection.totalBranches).toBe(1)
  })

  it('预览来源被篡改时仍拒绝加载，不以空存档目录代替来源校验', async () => {
    const created = await preview()
    await db.productRuntimeSessions.update(created.session.id!, { runtimeSourceHash: 'f'.repeat(64) })
    const library = vi.spyOn(saves, 'projectTextOpenWorldPlayerSavesV1')
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.session.id!)
    expect(useTextOpenWorldPlayerStore.getState().error).not.toBe('')
    expect(useTextOpenWorldPlayerStore.getState().selectedManifest).toBeNull()
    expect(library).not.toHaveBeenCalled()
  })
})

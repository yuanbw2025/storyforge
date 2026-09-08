import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  executeTextOpenWorldActionV1,
  executeTextOpenWorldSystemCombatTransitionV1,
} from '../../src/lib/open-world/action-executor'
import { ensureTextOpenWorldCombatRetryCheckpointV1 } from '../../src/lib/open-world/checkpoints'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { EMPTY_PRODUCT_RUNTIME_STATE, type TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCombatResolutionV1,
} from '../helpers/text-open-world-vnext-fixture'

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

async function fixture(label: string, runtimePackage = createTextOpenWorldVNextFixture()) {
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `${label}-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    runtimeShape: 'vnext-only',
    title: label,
  })
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

function expectCurrentSession(current: Awaited<ReturnType<typeof fixture>>) {
  expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
    scope: current.scope,
    worldGroupId: null,
    selectedSessionId: current.session.id,
    selectedSession: { id: current.session.id },
    busy: false,
    error: '',
    lastFeedback: null,
  })
}

function defeatedRuntimePackage(): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = downgradeTextOpenWorldFixtureCombatResolutionV1(
    createTextOpenWorldVNextFixture(),
  )
  const world = runtimePackage.modules.world.payload as any
  const combat = runtimePackage.modules.combat.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  combat.encounters[0].locationKey = 'location.salt-port'
  actions.actions.find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = [
    'location.salt-port',
  ]
  world.fastTravelPoints[0].canRespawn = true
  return runtimePackage
}

describe('Text Open World G4 · 玩家Store异步操作作用域', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    resetStore()
  })
  afterAll(() => db.close())

  it('旧Session手动保存延迟完成后只写原Session，不刷新新Session', async () => {
    const stale = await fixture('旧Session')
    const current = await fixture('新Session')
    await useTextOpenWorldPlayerStore.getState().load(stale.scope, null, stale.session.id)
    const delayed = delayNextSessionRead(stale.session.id!)

    try {
      const saving = useTextOpenWorldPlayerStore.getState().saveCheckpoint('旧Session手动点')
      await delayed.started
      await useTextOpenWorldPlayerStore.getState().load(current.scope, null, current.session.id)
      delayed.release()
      await saving

      await expect(db.productRuntimeCheckpoints.where('sessionId').equals(stale.session.id!).count())
        .resolves.toBe(1)
      await expect(db.productRuntimeCheckpoints.where('sessionId').equals(current.session.id!).count())
        .resolves.toBe(0)
      expectCurrentSession(current)
      expect(useTextOpenWorldPlayerStore.getState().checkpoints).toEqual([])
    } finally {
      delayed.release()
      delayed.restore()
    }
  }, 15_000)

  it('同一Session较慢的旧保存被新操作代次取代后不回写旧刷新结果', async () => {
    const created = await fixture('同Session')
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.session.id)
    const delayed = delayNextSessionRead(created.session.id!)

    try {
      const staleSave = useTextOpenWorldPlayerStore.getState().saveCheckpoint('慢保存')
      await delayed.started
      await useTextOpenWorldPlayerStore.getState().saveCheckpoint('新保存')
      expect(useTextOpenWorldPlayerStore.getState().checkpoints.map(item => item.name))
        .toEqual(['新保存'])

      delayed.release()
      await staleSave

      const persisted = await db.productRuntimeCheckpoints
        .where('sessionId').equals(created.session.id!).toArray()
      expect(new Set(persisted.map(item => item.name))).toEqual(new Set(['慢保存', '新保存']))
      expect(useTextOpenWorldPlayerStore.getState().checkpoints.map(item => item.name))
        .toEqual(['新保存'])
      expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({ busy: false, error: '' })
    } finally {
      delayed.release()
      delayed.restore()
    }
  }, 15_000)

  it('旧Session检查点分支延迟完成后保留子分支，但不选择到新scope', async () => {
    const stale = await fixture('旧检查点Session')
    const current = await fixture('当前Session')
    await useTextOpenWorldPlayerStore.getState().load(stale.scope, null, stale.session.id)
    await useTextOpenWorldPlayerStore.getState().saveCheckpoint('旧分支点')
    const checkpointId = useTextOpenWorldPlayerStore.getState().checkpoints[0]!.id!
    const delayed = delayNextSessionRead(stale.session.id!)

    try {
      const branching = useTextOpenWorldPlayerStore.getState().forkCheckpoint(checkpointId, '旧分支')
      await delayed.started
      await useTextOpenWorldPlayerStore.getState().load(current.scope, null, current.session.id)
      delayed.release()
      const childSessionId = await branching

      await expect(db.productRuntimeSessions.get(childSessionId)).resolves.toMatchObject({
        parentSessionId: stale.session.id,
        title: '旧分支',
      })
      expectCurrentSession(current)
    } finally {
      delayed.release()
      delayed.restore()
    }
  }, 15_000)

  it('旧Session当前状态分支延迟完成后不把子分支选择结果写入新Session', async () => {
    const stale = await fixture('旧当前状态')
    const current = await fixture('新当前状态')
    await useTextOpenWorldPlayerStore.getState().load(stale.scope, null, stale.session.id)
    const delayed = delayNextSessionRead(stale.session.id!)

    try {
      const branching = useTextOpenWorldPlayerStore.getState().forkCurrent('旧Session当前分支')
      await delayed.started
      await useTextOpenWorldPlayerStore.getState().load(current.scope, null, current.session.id)
      delayed.release()
      const childSessionId = await branching

      await expect(db.productRuntimeSessions.get(childSessionId)).resolves.toMatchObject({
        parentSessionId: stale.session.id,
        title: '旧Session当前分支',
      })
      expectCurrentSession(current)
    } finally {
      delayed.release()
      delayed.restore()
    }
  }, 15_000)

  it('旧战败Session重试延迟完成后保留重试分支，但不覆盖新Session', async () => {
    const runtimePackage = defeatedRuntimePackage()
    const stale = await fixture('旧战败Session', runtimePackage)
    const current = await fixture('新安全Session')
    const preCombatSequence = (await readProductRuntimeState(stale.session.id!)).lastSequence
    await ensureTextOpenWorldCombatRetryCheckpointV1({
      sessionId: stale.session.id!,
      encounterKey: 'encounter.ridge-jackal',
      throughSequence: preCombatSequence,
    })
    await executeTextOpenWorldActionV1({
      sessionId: stale.session.id!,
      actionKey: 'action.start-ridge-jackal',
      targetKey: 'encounter.ridge-jackal',
      commandId: 'command.store-race.combat-start',
      requestedAt: 1,
    })
    await executeTextOpenWorldSystemCombatTransitionV1({
      sessionId: stale.session.id!,
      actionKey: 'action.settle-combat-state',
      targetKey: 'encounter.ridge-jackal',
      combatTransitionIntent: 'complete-turn',
      commandId: 'command.store-race.combat-complete-turn',
      requestedAt: 2,
    })
    await executeTextOpenWorldSystemCombatTransitionV1({
      sessionId: stale.session.id!,
      actionKey: 'action.settle-combat-state',
      targetKey: 'encounter.ridge-jackal',
      combatTransitionIntent: 'finish-defeat',
      commandId: 'command.store-race.combat-defeat',
      requestedAt: 3,
    })
    await useTextOpenWorldPlayerStore.getState().load(stale.scope, null, stale.session.id)
    const delayed = delayNextSessionRead(stale.session.id!)

    try {
      const retrying = useTextOpenWorldPlayerStore.getState().retryDefeatedCombat('旧战败重试')
      await delayed.started
      await useTextOpenWorldPlayerStore.getState().load(current.scope, null, current.session.id)
      delayed.release()
      const childSessionId = await retrying

      await expect(db.productRuntimeSessions.get(childSessionId)).resolves.toMatchObject({
        parentSessionId: stale.session.id,
        parentThroughSequence: preCombatSequence,
        title: '旧战败重试',
      })
      expectCurrentSession(current)
    } finally {
      delayed.release()
      delayed.restore()
    }
  }, 25_000)

  it('旧Session删除延迟完成后使用冻结目标，不清空新Session选择', async () => {
    const stale = await fixture('待删除旧Session')
    const current = await fixture('保留新Session')
    await useTextOpenWorldPlayerStore.getState().load(stale.scope, null, stale.session.id)
    const delayed = delayNextSessionRead(stale.session.id!)

    try {
      const removing = useTextOpenWorldPlayerStore.getState().remove(stale.session.id!)
      await delayed.started
      await useTextOpenWorldPlayerStore.getState().load(current.scope, null, current.session.id)
      delayed.release()
      await removing

      await expect(db.productRuntimeSessions.get(stale.session.id!)).resolves.toBeUndefined()
      await expect(db.productRuntimeSessions.get(current.session.id!)).resolves.toBeDefined()
      expectCurrentSession(current)
    } finally {
      delayed.release()
      delayed.restore()
    }
  }, 15_000)
})

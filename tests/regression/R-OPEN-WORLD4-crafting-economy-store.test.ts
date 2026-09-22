import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { EMPTY_PRODUCT_RUNTIME_STATE, type TextOpenWorldCommandEnvelopeV1 } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
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

async function fixture(label: string) {
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 制作经济Store-${label}-${crypto.randomUUID()}`,
    textOpenWorldVNext: createTextOpenWorldVNextFixture(),
    runtimeShape: 'vnext-only',
    title: `${label}存档`,
    seed: `crafting-economy-store-${label}`,
  })
}

async function playerCommandEnvelopes(sessionId: number): Promise<TextOpenWorldCommandEnvelopeV1[]> {
  const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
  return events
    .filter(event => event.type === 'text-open-world.command.committed')
    .map(event => JSON.parse(event.payloadJson).envelope as TextOpenWorldCommandEnvelopeV1)
    .filter(envelope => envelope.actorKey === 'player')
}

describe('Text Open World G4-10 · 制作与经济Store执行桥', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    resetStore()
  })
  afterAll(() => db.close())

  it('把配方/商店目标、quantity与itemKey完整送入统一Action命令并刷新权威状态', async () => {
    const created = await fixture('参数透传')
    const sessionId = created.session.id!
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, sessionId)

    const buyBase = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence
    await useTextOpenWorldPlayerStore.getState().executeVNextAction(
      'action.buy-caretaker',
      'vendor.caretaker',
      {
        commandId: 'command.g4-10.store.buy-materials',
        expectedBaseSequence: buyBase,
        quantity: 2,
        itemKey: 'item.salt-crystal',
      },
    )
    const craftBase = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence
    await useTextOpenWorldPlayerStore.getState().executeVNextAction(
      'action.craft-brine-tonic',
      'recipe.brine-tonic',
      {
        commandId: 'command.g4-10.store.craft-tonic',
        expectedBaseSequence: craftBase,
        quantity: 1,
      },
    )
    const sellBase = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence
    const sold = await useTextOpenWorldPlayerStore.getState().executeVNextAction(
      'action.sell-caretaker',
      'vendor.caretaker',
      {
        commandId: 'command.g4-10.store.sell-tonic',
        expectedBaseSequence: sellBase,
        quantity: 1,
        itemKey: 'item.brine-tonic',
      },
    )

    expect(sold).toMatchObject({
      sessionId,
      actionKey: 'action.sell-caretaker',
      targetKey: 'vendor.caretaker',
      baseSequence: sellBase,
      phase: 'terminal',
      status: 'succeeded',
    })
    const state = useTextOpenWorldPlayerStore.getState()
    expect(state.lastFeedback?.receiptHash).toBe(sold.receiptHash)
    expect(state.runtimeState.textOpenWorld?.state.inventory).toMatchObject({
      currency: 20,
      stackQuantities: {},
    })
    expect(state.runtimeState.textOpenWorld?.state.time.worldMinute).toBe(495)

    const envelopes = await playerCommandEnvelopes(sessionId)
    expect(envelopes.find(envelope => envelope.commandId === 'command.g4-10.store.buy-materials')?.payload)
      .toEqual({ targetKey: 'vendor.caretaker', quantity: 2, itemKey: 'item.salt-crystal' })
    expect(envelopes.find(envelope => envelope.commandId === 'command.g4-10.store.craft-tonic')?.payload)
      .toEqual({ targetKey: 'recipe.brine-tonic', quantity: 1 })
    expect(envelopes.find(envelope => envelope.commandId === 'command.g4-10.store.sell-tonic')?.payload)
      .toEqual({ targetKey: 'vendor.caretaker', quantity: 1, itemKey: 'item.brine-tonic' })
  }, 30_000)

  it('外部事件令expectedBaseSequence过期时不执行交易，并刷新当前Session而不伪造回执', async () => {
    const created = await fixture('基线漂移')
    const sessionId = created.session.id!
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, sessionId)
    const staleBaseSequence = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence

    await executeTextOpenWorldActionV1({
      sessionId,
      actionKey: 'action.talk-caretaker',
      targetKey: 'actor.caretaker',
      commandId: 'command.g4-10.store.external-change',
    })
    const databaseSequence = (await db.productRuntimeSessions.get(sessionId))!.runtimeHeadSequence!

    await expect(useTextOpenWorldPlayerStore.getState().executeVNextAction(
      'action.buy-caretaker',
      'vendor.caretaker',
      {
        commandId: 'command.g4-10.store.stale-buy',
        expectedBaseSequence: staleBaseSequence,
        quantity: 1,
        itemKey: 'item.salt-crystal',
      },
    )).rejects.toThrow('确认基线已变化')

    const state = useTextOpenWorldPlayerStore.getState()
    expect(state.runtimeState.lastSequence).toBe(databaseSequence)
    expect(state.lastFeedback).toBeNull()
    expect(state.error).toContain('确认基线已变化')
    expect((await playerCommandEnvelopes(sessionId)).some(
      envelope => envelope.commandId === 'command.g4-10.store.stale-buy',
    )).toBe(false)
  }, 30_000)

  it('切换Session后隔离旧交易的投影、回执、busy与错误', async () => {
    const stale = await fixture('旧')
    const current = await fixture('新')
    await useTextOpenWorldPlayerStore.getState().load(stale.scope, null, stale.session.id)
    const staleBase = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence
    let releaseStaleRead!: () => void
    let staleReadEntered!: () => void
    const staleReadGate = new Promise<void>(resolve => { releaseStaleRead = resolve })
    const staleReadStarted = new Promise<void>(resolve => { staleReadEntered = resolve })
    const originalGet = db.productRuntimeSessions.get.bind(db.productRuntimeSessions)
    let delayNextStaleRead = true
    const getSpy = vi.spyOn(db.productRuntimeSessions, 'get').mockImplementation(async key => {
      const result = originalGet(key)
      if (delayNextStaleRead && key === stale.session.id) {
        delayNextStaleRead = false
        staleReadEntered()
        await staleReadGate
      }
      return result
    })

    try {
      const staleBuy = useTextOpenWorldPlayerStore.getState().executeVNextAction(
        'action.buy-caretaker',
        'vendor.caretaker',
        {
          commandId: 'command.g4-10.store.old-session-buy',
          expectedBaseSequence: staleBase,
          quantity: 1,
          itemKey: 'item.salt-crystal',
        },
      )
      await staleReadStarted
      await useTextOpenWorldPlayerStore.getState().load(current.scope, null, current.session.id)
      releaseStaleRead()
      await staleBuy

      expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
        scope: current.scope,
        selectedSessionId: current.session.id,
        lastFeedback: null,
        busy: false,
        error: '',
      })
      expect(useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld?.state.inventory.currency)
        .toBe(20)
      expect((await playerCommandEnvelopes(stale.session.id!)).some(
        envelope => envelope.commandId === 'command.g4-10.store.old-session-buy',
      )).toBe(true)
    } finally {
      getSpy.mockRestore()
      releaseStaleRead()
    }
  }, 30_000)

  it('相同commandId重提只返回同一结果，旧基线回执不能覆盖较新的交易回执', async () => {
    const created = await fixture('幂等回执')
    const sessionId = created.session.id!
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, sessionId)
    const buyBase = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence
    const request = {
      commandId: 'command.g4-10.store.idempotent-buy',
      expectedBaseSequence: buyBase,
      quantity: 2,
      itemKey: 'item.salt-crystal',
    }

    const first = await useTextOpenWorldPlayerStore.getState().executeVNextAction(
      'action.buy-caretaker',
      'vendor.caretaker',
      request,
    )
    const eventCount = await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()
    const duplicate = await useTextOpenWorldPlayerStore.getState().executeVNextAction(
      'action.buy-caretaker',
      'vendor.caretaker',
      request,
    )
    expect(duplicate.receiptHash).toBe(first.receiptHash)
    expect(await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()).toBe(eventCount)
    expect(useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld?.state.inventory)
      .toMatchObject({ currency: 16, stackQuantities: { 'item.salt-crystal': 2 } })

    const sellBase = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence
    const latest = await useTextOpenWorldPlayerStore.getState().executeVNextAction(
      'action.sell-caretaker',
      'vendor.caretaker',
      {
        commandId: 'command.g4-10.store.latest-sell',
        expectedBaseSequence: sellBase,
        quantity: 1,
        itemKey: 'item.salt-crystal',
      },
    )
    const currentBase = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence
    const afterLatestCount = await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()

    await expect(useTextOpenWorldPlayerStore.getState().executeVNextAction(
      'action.buy-caretaker',
      'vendor.caretaker',
      { ...request, expectedBaseSequence: currentBase },
    )).rejects.toThrow('回执属于过期的Session事件基线')
    expect(useTextOpenWorldPlayerStore.getState().lastFeedback?.receiptHash).toBe(latest.receiptHash)
    expect(await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()).toBe(afterLatestCount)
  }, 30_000)

  it('同Session较晚请求完成后，较早请求的stale错误不会清掉最新回执', async () => {
    const created = await fixture('乱序完成')
    const sessionId = created.session.id!
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, sessionId)
    const baseSequence = useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence
    let releaseOlderRead!: () => void
    let olderReadEntered!: () => void
    const olderReadGate = new Promise<void>(resolve => { releaseOlderRead = resolve })
    const olderReadStarted = new Promise<void>(resolve => { olderReadEntered = resolve })
    const originalGet = db.productRuntimeSessions.get.bind(db.productRuntimeSessions)
    let delayFirstRead = true
    const getSpy = vi.spyOn(db.productRuntimeSessions, 'get').mockImplementation(async key => {
      const result = originalGet(key)
      if (delayFirstRead && key === sessionId) {
        delayFirstRead = false
        olderReadEntered()
        await olderReadGate
      }
      return result
    })

    try {
      const olderCraft = useTextOpenWorldPlayerStore.getState().executeVNextAction(
        'action.craft-brine-tonic',
        'recipe.brine-tonic',
        {
          commandId: 'command.g4-10.store.older-craft',
          expectedBaseSequence: baseSequence,
          quantity: 1,
        },
      )
      await olderReadStarted
      const latestBuy = await useTextOpenWorldPlayerStore.getState().executeVNextAction(
        'action.buy-caretaker',
        'vendor.caretaker',
        {
          commandId: 'command.g4-10.store.newer-buy',
          expectedBaseSequence: baseSequence,
          quantity: 2,
          itemKey: 'item.salt-crystal',
        },
      )
      releaseOlderRead()
      await expect(olderCraft).rejects.toThrow('确认基线已变化')

      expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
        selectedSessionId: sessionId,
        busy: false,
        error: '',
      })
      expect(useTextOpenWorldPlayerStore.getState().lastFeedback?.receiptHash).toBe(latestBuy.receiptHash)
      expect(useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld?.state.inventory)
        .toMatchObject({ currency: 16, stackQuantities: { 'item.salt-crystal': 2 } })
    } finally {
      getSpy.mockRestore()
      releaseOlderRead()
    }
  }, 30_000)
})

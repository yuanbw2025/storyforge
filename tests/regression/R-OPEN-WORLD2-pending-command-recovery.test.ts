import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  executeTextOpenWorldActionV1,
  recoverTextOpenWorldPendingCommandV1,
} from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldCombatActionCatalogV1 } from '../../src/lib/open-world/combat-actions'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldDirectorCatalogV1 } from '../../src/lib/open-world/director'
import { resolveTextOpenWorldRandomEvidenceV1 } from '../../src/lib/open-world/event-contract'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { deriveTextOpenWorldContextsV1, parseTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { applyProductRuntimeEvent, hashProductRuntimeStateV1, readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent, ProductRuntimeState, TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function makeEncounterLocal(runtimePackage: TextOpenWorldRuntimePackageV1) {
  const combat = runtimePackage.modules.combat.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  combat.encounters[0].locationKey = 'location.salt-port'
  actions.actions.find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = ['location.salt-port']
  return runtimePackage
}

async function createSession(input?: { combat?: boolean; seed?: string }) {
  const runtimePackage = createTextOpenWorldVNextFixture()
  return (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD Pending Recovery-${crypto.randomUUID()}`,
    textOpenWorldVNext: input?.combat ? makeEncounterLocal(runtimePackage) : runtimePackage,
    title: 'Pending Command Recovery Session',
    seed: input?.seed ?? 'pending-command-recovery-seed',
  })).session
}

async function commitPendingPlayerCommand(input: {
  sessionId: number
  commandId: string
  actionKey: string
  payload: Record<string, unknown>
}) {
  const before = await readProductRuntimeState(input.sessionId)
  return commitTextOpenWorldCommandV1({
    schema: 'storyforge.text-open-world.command', version: 1,
    commandId: input.commandId, sessionId: input.sessionId,
    actorKey: 'player', actionKey: input.actionKey, payload: input.payload,
    baseSequence: before.lastSequence, baseStateHash: await hashProductRuntimeStateV1(before),
    source: 'system-action', requestedAt: 1,
  })
}

async function commitPendingDirectorCommand(sessionId: number, commandId: string) {
  const before = await readProductRuntimeState(sessionId)
  return commitTextOpenWorldCommandV1({
    schema: 'storyforge.text-open-world.command', version: 1,
    commandId, sessionId, actorKey: 'system', actionKey: 'action.settle-director',
    payload: { directorTrigger: 'talk' },
    baseSequence: before.lastSequence, baseStateHash: await hashProductRuntimeStateV1(before),
    source: 'system-action', requestedAt: 1,
  })
}

function eventsForCommand(events: ProductRuntimeEvent[], commandId: string) {
  return events.filter(event => {
    if (event.type === 'text-open-world.command.committed') return event.commandId === commandId
    if (event.type !== 'text-open-world.random.resolved' && event.type !== 'text-open-world.effects.applied') return false
    return JSON.parse(event.payloadJson).commandId === commandId
  })
}

async function appendPendingRandomEvidence(input: {
  sessionId: number
  commandId: string
  actorKey: 'player' | 'system'
  request: Parameters<typeof resolveTextOpenWorldRandomEvidenceV1>[0]['request']
}) {
  const { sessionId, commandId } = input
  const session = await db.productRuntimeSessions.get(sessionId)
  if (!session) throw new Error('测试Session不存在')
  const state = await readProductRuntimeState(sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(state.textOpenWorld)
  const commandSequence = projection.protocol.pendingCommandSequence!
  const drawIndex = projection.protocol.randomEvidence.filter(item => item.eventSequence > commandSequence).length
  const evidence = await resolveTextOpenWorldRandomEvidenceV1({
    seed: session.seed, commandId, commandSequence, drawIndex, request: input.request,
  })
  const event: ProductRuntimeEvent = {
    projectId: session.projectId, worldGroupId: session.worldGroupId ?? null,
    sessionId, sequence: state.lastSequence + 1,
    type: 'text-open-world.random.resolved', actorKey: input.actorKey, targetKey: null,
    commandId: null, baseSequence: null, baseStateHash: null,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.random-resolved-event', version: 1,
      commandId, commandSequence, ruleset: projection.ruleset, evidence,
    }),
    createdAt: Date.now(),
  }
  const nextState = applyProductRuntimeEvent(state, event)
  const stateJson = JSON.stringify(nextState)
  const stateHash = await hashProductRuntimeStateV1(nextState)
  await db.transaction('rw', db.productRuntimeEvents, db.productRuntimeSessions, async () => {
    event.id = await db.productRuntimeEvents.add(event) as number
    await db.productRuntimeSessions.update(sessionId, {
      runtimeHeadSequence: nextState.lastSequence,
      runtimeHeadStateJson: stateJson,
      runtimeHeadStateHash: stateHash,
    })
  })
  return event
}

async function appendFirstCombatRandomAsInterruptedPrefix(sessionId: number, commandId: string) {
  const state = await readProductRuntimeState(sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(state.textOpenWorld)
  const conditionResults = Object.fromEntries(Object.entries(deriveTextOpenWorldContextsV1(projection).action.conditionResults)
    .map(([key, result]) => [key, result.satisfied]))
  const requests = createTextOpenWorldCombatActionCatalogV1(projection.runtimePackage, parseTextOpenWorldModulesV1(projection.runtimePackage))
    .randomRequestsFor({
      state: projection.state,
      actionKey: 'action.combat-basic-attack',
      targetKey: 'enemy.1.1',
      actorKey: 'player',
      conditionResults,
    })
  expect(requests).toHaveLength(1)
  return appendPendingRandomEvidence({
    sessionId, commandId, actorKey: 'player', request: requests[0],
  })
}

async function appendFirstDirectorRandomAsInterruptedPrefix(sessionId: number, commandId: string) {
  const state = await readProductRuntimeState(sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(state.textOpenWorld)
  const conditionResults = Object.fromEntries(Object.entries(deriveTextOpenWorldContextsV1(projection).action.conditionResults)
    .map(([key, result]) => [key, result.satisfied]))
  const requests = createTextOpenWorldDirectorCatalogV1(projection.runtimePackage, parseTextOpenWorldModulesV1(projection.runtimePackage))
    .randomRequestsFor({ state: projection.state, trigger: 'talk', conditionResults })
  expect(requests).toHaveLength(2)
  const event = await appendPendingRandomEvidence({
    sessionId, commandId, actorKey: 'system', request: requests[0],
  })
  return { event, requests }
}

async function replaceCachedHead(sessionId: number, mutate: (state: ProductRuntimeState) => void) {
  const state = structuredClone(await readProductRuntimeState(sessionId))
  mutate(state)
  const stateJson = JSON.stringify(state)
  await db.productRuntimeSessions.update(sessionId, {
    runtimeHeadSequence: state.lastSequence,
    runtimeHeadStateJson: stateJson,
    runtimeHeadStateHash: await hashProductRuntimeStateV1(state),
  })
}

describe('Text Open World vNext · exact pending Command recovery', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('恢复已有随机前缀的玩家战斗命令，并沿用原命令身份和证据继续战斗结算', async () => {
    const session = await createSession({ combat: true, seed: 'pending-player-combat-seed' })
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal',
      commandId: 'command.recovery.combat.start', requestedAt: 1,
    })
    const commandId = 'command.recovery.combat.player-attack'
    await commitPendingPlayerCommand({
      sessionId: session.id!, commandId,
      actionKey: 'action.combat-basic-attack', payload: { targetKey: 'enemy.1.1' },
    })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld?.protocol)
      .toMatchObject({ pendingCommandId: commandId, pendingActorKey: 'player' })
    await appendFirstCombatRandomAsInterruptedPrefix(session.id!, commandId)

    const input = {
      sessionId: session.id!, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.1',
      commandId, requestedAt: 2,
    }
    const feedback = await executeTextOpenWorldActionV1(input)
    expect(feedback).toMatchObject({ commandId, phase: 'terminal', status: 'succeeded', outcomeCommitted: true })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld?.state.combat).toMatchObject({
      status: 'active', phase: 'actor-turn', round: 2, activeCombatantKey: 'player',
    })

    const settledEvents = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(eventsForCommand(settledEvents, commandId).filter(event => event.type === 'text-open-world.command.committed')).toHaveLength(1)
    expect(eventsForCommand(settledEvents, commandId).filter(event => event.type === 'text-open-world.random.resolved')).toHaveLength(1)
    expect(eventsForCommand(settledEvents, commandId).filter(event => event.type === 'text-open-world.effects.applied')).toHaveLength(1)

    const eventCount = settledEvents.length
    await executeTextOpenWorldActionV1({ ...input, requestedAt: 3 })
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(eventCount)
  }, 60_000)

  it('刷新加载会主动恢复战斗pending，不依赖已禁用的玩家Action入口', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD Load Recovery-${crypto.randomUUID()}`,
      textOpenWorldVNext: makeEncounterLocal(createTextOpenWorldVNextFixture()),
      title: 'Load Recovery Session',
      seed: 'pending-load-recovery-seed',
    })
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal',
      commandId: 'command.recovery.load.start', requestedAt: 1,
    })
    const commandId = 'command.recovery.load.player-attack'
    await commitPendingPlayerCommand({
      sessionId: created.session.id!, commandId,
      actionKey: 'action.combat-basic-attack', payload: { targetKey: 'enemy.1.1' },
    })

    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.session.id!)
    const loaded = useTextOpenWorldPlayerStore.getState()
    expect(loaded).toMatchObject({ selectedSessionId: created.session.id, loading: false, error: '' })
    expect(loaded.selectedSession?.runtimeHeadSequence).toBe(loaded.runtimeState.lastSequence)
    expect(loaded.runtimeState.textOpenWorld?.protocol.pendingCommandId).toBeNull()
    expect(loaded.runtimeState.textOpenWorld?.state.combat).toMatchObject({
      status: 'active', phase: 'actor-turn', round: 2, activeCombatantKey: 'player',
    })
    const events = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    expect(eventsForCommand(events, commandId).filter(event => event.type === 'text-open-world.command.committed')).toHaveLength(1)
    expect(eventsForCommand(events, commandId).filter(event => event.type === 'text-open-world.effects.applied')).toHaveLength(1)
  }, 60_000)

  it('2-draw系统命令在1/2处中断后只补第二次draw，并保留合法外层归属与base', async () => {
    const session = await createSession({ seed: 'pending-director-partial-seed' })
    const commandId = 'command.recovery.director.partial-random'
    await commitPendingDirectorCommand(session.id!, commandId)
    const { event: firstRandom, requests } = await appendFirstDirectorRandomAsInterruptedPrefix(session.id!, commandId)
    const firstPayload = firstRandom.payloadJson

    await expect(recoverTextOpenWorldPendingCommandV1(session.id!))
      .resolves.toMatchObject({ commandId, phase: 'terminal', status: 'succeeded' })
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    const recovered = eventsForCommand(events, commandId)
    const randomEvents = recovered.filter(event => event.type === 'text-open-world.random.resolved')
    expect(randomEvents).toHaveLength(2)
    expect(randomEvents[0]).toMatchObject({ id: firstRandom.id, payloadJson: firstPayload })
    for (const event of randomEvents) {
      expect(event).toMatchObject({
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: session.id,
        actorKey: 'system',
        targetKey: null,
        commandId: null,
        baseSequence: null,
        baseStateHash: null,
      })
    }
    expect(randomEvents.map(event => JSON.parse(event.payloadJson).evidence.drawIndex)).toEqual([0, 1])
    expect(JSON.parse(randomEvents[1].payloadJson).evidence).toEqual(await resolveTextOpenWorldRandomEvidenceV1({
      seed: session.seed,
      commandId,
      commandSequence: JSON.parse(firstPayload).commandSequence,
      drawIndex: 1,
      request: requests[1],
    }))
    const effectEvents = recovered.filter(event => event.type === 'text-open-world.effects.applied')
    expect(effectEvents).toHaveLength(1)
    expect(JSON.parse(effectEvents[0].payloadJson).randomEventSequences)
      .toEqual(randomEvents.map(event => event.sequence))
    expect((await readProductRuntimeState(session.id!)).textOpenWorld?.protocol.pendingCommandId).toBeNull()
  }, 30_000)

  it.each([
    ['actor', (event: ProductRuntimeEvent) => ({ actorKey: event.actorKey === 'system' ? 'player' : 'system' })],
    ['outer command', () => ({ commandId: 'command.recovery.foreign-random-index' })],
    ['base sequence', (event: ProductRuntimeEvent) => ({ baseSequence: event.sequence - 1 })],
    ['base state hash', () => ({ baseStateHash: 'f'.repeat(64) })],
  ])('partial random外层%s字段不合法时拒绝恢复', async (label, mutate) => {
    const session = await createSession({ seed: `pending-director-index-${label}-seed` })
    const commandId = `command.recovery.director.invalid-${label.replaceAll(' ', '-')}`
    await commitPendingDirectorCommand(session.id!, commandId)
    const { event } = await appendFirstDirectorRandomAsInterruptedPrefix(session.id!, commandId)
    await db.productRuntimeEvents.update(event.id!, mutate(event))
    const eventCount = await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()

    await expect(recoverTextOpenWorldPendingCommandV1(session.id!))
      .rejects.toThrow('待处理命令随机前缀索引字段不一致:0')
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events).toHaveLength(eventCount)
    expect(eventsForCommand(events, commandId).filter(item => item.type === 'text-open-world.effects.applied')).toHaveLength(0)
  })

  it('partial random外层Session归属被篡改时拒绝用缓存头补发draw', async () => {
    const session = await createSession({ seed: 'pending-director-index-session-seed' })
    const commandId = 'command.recovery.director.invalid-session'
    await commitPendingDirectorCommand(session.id!, commandId)
    const { event } = await appendFirstDirectorRandomAsInterruptedPrefix(session.id!, commandId)
    const totalEventCount = await db.productRuntimeEvents.count()
    await db.productRuntimeEvents.update(event.id!, { sessionId: session.id! + 10_000 })

    await expect(recoverTextOpenWorldPendingCommandV1(session.id!))
      .rejects.toThrow(`待结算命令事件流与缓存头不一致:${commandId}`)
    expect(await db.productRuntimeEvents.count()).toBe(totalEventCount)
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(eventsForCommand(events, commandId).filter(item => item.type === 'text-open-world.effects.applied')).toHaveLength(0)
  })

  it('恢复普通玩家命令后再运行Director，并且后续玩家命令重试不会重复发牌', async () => {
    const session = await createSession({ seed: 'pending-player-talk-seed' })
    const pendingCommandId = 'command.recovery.player-talk'
    await commitPendingPlayerCommand({
      sessionId: session.id!, commandId: pendingCommandId,
      actionKey: 'action.talk-caretaker', payload: { targetKey: 'actor.caretaker' },
    })

    const nextInput = {
      sessionId: session.id!, actionKey: 'action.investigate-channel', targetKey: 'location.salt-port',
      commandId: 'command.recovery.after-player-talk', requestedAt: 2,
    }
    await expect(executeTextOpenWorldActionV1(nextInput)).resolves.toMatchObject({
      commandId: nextInput.commandId, phase: 'terminal', status: 'succeeded',
    })
    const settledEvents = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(eventsForCommand(settledEvents, pendingCommandId).filter(event => event.type === 'text-open-world.command.committed')).toHaveLength(1)
    expect(eventsForCommand(settledEvents, pendingCommandId).filter(event => event.type === 'text-open-world.effects.applied')).toHaveLength(1)
    const directorEffects = settledEvents.filter(event => event.type === 'text-open-world.effects.applied'
      && JSON.parse(event.payloadJson).plan.authorization?.kind === 'director-settlement')
    expect(directorEffects).toHaveLength(1)
    expect(JSON.parse(directorEffects[0].payloadJson).plan.authorization).toMatchObject({ trigger: 'talk' })

    const eventCount = settledEvents.length
    await executeTextOpenWorldActionV1({ ...nextInput, requestedAt: 3 })
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(eventCount)
  }, 30_000)

  it('缓存投影指向不存在的待结算命令时 fail-closed 且不追加事件', async () => {
    const session = await createSession()
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.investigate-channel', targetKey: 'location.salt-port',
      commandId: 'command.recovery.unknown.setup', requestedAt: 1,
    })
    await replaceCachedHead(session.id!, state => {
      const projection = state.textOpenWorld!
      projection.protocol.pendingCommandId = 'command.recovery.unknown'
      projection.protocol.pendingCommandSequence = projection.lastEventSequence
      projection.protocol.pendingActionKey = 'action.talk-caretaker'
      projection.protocol.pendingActorKey = 'player'
      projection.protocol.pendingTargetKey = 'actor.caretaker'
      projection.protocol.pendingCombatTransitionIntent = null
      projection.protocol.pendingActionQuantity = null
      projection.protocol.pendingActionItemKey = null
      projection.protocol.pendingDirectorTrigger = null
    })
    const eventCount = await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()

    await expect(executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.talk-caretaker', targetKey: 'actor.caretaker',
      commandId: 'command.recovery.unknown.next', requestedAt: 2,
    })).rejects.toThrow('待结算命令不存在:command.recovery.unknown')
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(eventCount)
  })

  it('待结算命令携带投影未记录的payload时 fail-closed 且不执行Effect', async () => {
    const session = await createSession()
    const commandId = 'command.recovery.inconsistent'
    await commitPendingPlayerCommand({
      sessionId: session.id!, commandId,
      actionKey: 'action.talk-caretaker',
      payload: { targetKey: 'actor.caretaker', unexpected: 'must-not-be-recovered' },
    })
    const eventCount = await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()

    await expect(executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.investigate-channel', targetKey: 'location.salt-port',
      commandId: 'command.recovery.inconsistent.next', requestedAt: 2,
    })).rejects.toThrow(`待结算命令包络与投影不一致:${commandId}`)
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events).toHaveLength(eventCount)
    expect(eventsForCommand(events, commandId).filter(event => event.type === 'text-open-world.effects.applied')).toHaveLength(0)
  })
})

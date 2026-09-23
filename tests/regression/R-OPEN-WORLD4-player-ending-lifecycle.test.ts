import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  executeTextOpenWorldActionV1,
  reconcileTextOpenWorldSessionCompletionV1,
  resumeTextOpenWorldSystemWorkV1,
} from '../../src/lib/open-world/action-executor'
import {
  branchTextOpenWorldSessionFromCheckpointV1,
  createTextOpenWorldCheckpointV1,
} from '../../src/lib/open-world/checkpoints'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { commitTextOpenWorldOutcomeBatchV1 } from '../../src/lib/open-world/events'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { parseTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import {
  branchProductRuntimeSession,
  hashProductRuntimeStateV1,
  readProductRuntimeState,
} from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent } from '../../src/lib/types'
import {
  createTextOpenWorldPlayerJourneyFixtureV1,
  type TextOpenWorldPlayerJourneyFixtureV1,
} from '../helpers/text-open-world-player-journey-fixture'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

type ReadySession = {
  sessionId: number
  finalQuestInstanceKey: string
}

let journey: TextOpenWorldPlayerJourneyFixtureV1

function eventPayload(event: ProductRuntimeEvent): Record<string, any> {
  return JSON.parse(event.payloadJson) as Record<string, any>
}

async function allEvents(sessionId: number): Promise<ProductRuntimeEvent[]> {
  return db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
}

function linkedDirectorCommands(events: ProductRuntimeEvent[], causeCommandId: string): ProductRuntimeEvent[] {
  return events.filter(event => {
    if (event.type !== 'text-open-world.command.committed' || event.actorKey !== 'system') return false
    const payload = eventPayload(event)
    return payload.envelope?.payload?.systemCauseCommandId === causeCommandId
      && typeof payload.envelope?.payload?.directorTrigger === 'string'
  })
}

function outcomeEventFor(events: ProductRuntimeEvent[], commandId: string): ProductRuntimeEvent | undefined {
  return events.find(event => (
    event.type === 'text-open-world.effects.applied' && eventPayload(event).commandId === commandId
  ))
}

function finalQuestInstanceKey(runtime: Awaited<ReturnType<typeof readProductRuntimeState>>): string {
  const projection = runtime.textOpenWorld ?? (() => { throw new Error('测试缺少文字开放世界投影') })()
  return Object.values(projection.state.quests.instancesByKey)
    .find(instance => instance.definitionKey === journey.keys.finalQuestKey)?.instanceKey
    ?? (() => { throw new Error('测试缺少最终主线任务实例') })()
}

async function createSession(input?: { status?: 'active' | 'completed'; suffix?: string }) {
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD Ending Lifecycle ${input?.suffix ?? ''}-${crypto.randomUUID()}`,
    textOpenWorldVNext: structuredClone(journey.runtimePackage),
    title: 'Ending Lifecycle',
    seed: `ending-lifecycle-${input?.suffix ?? 'active'}`,
    ...(input?.status == null ? {} : { status: input.status }),
  })
}

async function createReadySession(suffix: string): Promise<ReadySession> {
  const created = await createSession({ suffix })
  const sessionId = created.session.id!
  const finalQuestInstance = finalQuestInstanceKey(await readProductRuntimeState(sessionId))
  await executeTextOpenWorldActionV1({
    sessionId,
    actionKey: 'action.accept-main',
    targetKey: finalQuestInstance,
    source: 'fixed-choice',
    commandId: `command.ending-lifecycle.${suffix}.accept`,
    requestedAt: 1,
  })
  await executeTextOpenWorldActionV1({
    sessionId,
    actionKey: 'action.complete-main-objective',
    targetKey: finalQuestInstance,
    source: 'fixed-choice',
    commandId: `command.ending-lifecycle.${suffix}.objective`,
    requestedAt: 2,
  })
  const completedQuest = await readProductRuntimeState(sessionId)
  expect(completedQuest.textOpenWorld?.state.quests.instancesByKey[finalQuestInstance].status).toBe('completed')

  await executeTextOpenWorldActionV1({
    sessionId,
    actionKey: journey.keys.claimActionKey,
    targetKey: finalQuestInstance,
    source: 'fixed-choice',
    commandId: `command.ending-lifecycle.${suffix}.reward`,
    requestedAt: 3,
  })
  const claimed = await readProductRuntimeState(sessionId)
  expect(claimed.textOpenWorld?.state.quests.instancesByKey[finalQuestInstance].rewardClaimKey).not.toBeNull()
  return { sessionId, finalQuestInstanceKey: finalQuestInstance }
}

async function createLegacyEndingSession(suffix: string): Promise<number> {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const actions = runtimePackage.modules.actions.payload as any
  actions.effects.push(
    { key: 'effect.legacy-unlock-ending', operation: 'unlock-ending', payload: { endingKey: 'ending.cooperate' } },
    { key: 'effect.legacy-reach-ending', operation: 'reach-ending', payload: { endingKey: 'ending.cooperate' } },
  )
  actions.actions.push({
    key: 'action.legacy-reach-ending', category: 'investigate', label: '抵达旧版结局',
    description: '用于验证旧版Action结局生命周期恢复。', actorScope: 'player', targetScope: 'none',
    locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.legacy-unlock-ending', 'effect.legacy-reach-ending'], failureEffectKeys: [],
    timeCostMinutes: 0, confirmationPolicy: 'never', repeatPolicy: 'once', cooldownMinutes: null,
  })
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD Legacy Ending ${suffix}-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    title: 'Legacy Ending Lifecycle',
    seed: `legacy-ending-${suffix}`,
  })
  const sessionId = created.session.id!
  await executeTextOpenWorldActionV1({
    sessionId,
    actionKey: 'action.legacy-reach-ending',
    source: 'system-action',
    commandId: `command.legacy-ending.${suffix}`,
    requestedAt: 1,
  })
  expect((await db.productRuntimeSessions.get(sessionId))?.status).toBe('completed')
  return sessionId
}

async function completeEnding(sessionId: number, suffix: string): Promise<string> {
  const before = await readProductRuntimeState(sessionId)
  const commandId = `command.ending-lifecycle.${suffix}.ending`
  const feedback = await executeTextOpenWorldActionV1({
    sessionId,
    actionKey: journey.keys.endingActionKeys[0],
    source: 'fixed-choice',
    confirmed: true,
    expectedBaseSequence: before.lastSequence,
    commandId,
    requestedAt: 4,
  })
  expect(feedback).toMatchObject({ phase: 'terminal', status: 'succeeded', outcomeCommitted: true })
  return commandId
}

/** Simulates interruption after the player's atomic ending Effect batch, before automatic system work. */
async function commitEndingEffectWithoutSystemFollowUp(sessionId: number, commandId: string): Promise<void> {
  const before = await readProductRuntimeState(sessionId)
  await commitTextOpenWorldCommandV1({
    schema: 'storyforge.text-open-world.command',
    version: 1,
    commandId,
    sessionId,
    actorKey: 'player',
    actionKey: journey.keys.endingActionKeys[0],
    payload: {},
    baseSequence: before.lastSequence,
    baseStateHash: await hashProductRuntimeStateV1(before),
    source: 'fixed-choice',
    requestedAt: 4,
  })
  const pending = await readProductRuntimeState(sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(pending.textOpenWorld)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const action = modules.actions.actions.find(candidate => candidate.key === journey.keys.endingActionKeys[0])
    ?? (() => { throw new Error('测试缺少最终选择Action') })()
  const effectKeys = [...new Set([...action.costEffectKeys, ...action.successEffectKeys])]
  const catalog = createTextOpenWorldEffectCatalogV1(projection.runtimePackage)
  const plan = await catalog.plan({
    effectKeys,
    claimKey: `claim.${commandId}`,
    state: projection.state,
    authorization: null,
  })
  const { receipt } = await catalog.apply({ plan, state: projection.state })
  await commitTextOpenWorldOutcomeBatchV1({
    sessionId,
    commandId,
    ruleset: projection.ruleset,
    randomRequests: [],
    plan,
    receipt,
    outcome: 'success',
    reason: null,
    degradation: null,
  })
}

describe('Text Open World G4 · player ending lifecycle', () => {
  beforeAll(async () => { journey = await createTextOpenWorldPlayerJourneyFixtureV1() })
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('最终选择先持久化结局并完成Director后续，再把Session收束为completed；完成后玩法命令不再写事件', async () => {
    const { sessionId } = await createReadySession('normal')
    const endingCommandId = await completeEnding(sessionId, 'normal')
    const session = await db.productRuntimeSessions.get(sessionId)
    const runtime = await readProductRuntimeState(sessionId)
    const events = await allEvents(sessionId)
    const endingOutcome = outcomeEventFor(events, endingCommandId)
    const markers = linkedDirectorCommands(events, endingCommandId)
    const markerOutcome = markers[0]?.commandId == null
      ? undefined
      : outcomeEventFor(events, markers[0].commandId)

    expect(runtime.textOpenWorld?.state.endings.reachedKey).toBe(journey.keys.endingKeys[0])
    expect(session).toMatchObject({ status: 'completed', runtimeHeadSequence: runtime.lastSequence })
    expect(endingOutcome).toBeDefined()
    expect(markers).toHaveLength(1)
    expect(markerOutcome).toBeDefined()
    expect(endingOutcome!.sequence).toBeLessThan(markers[0].sequence)
    expect(markers[0].sequence).toBeLessThan(markerOutcome!.sequence)
    expect(markerOutcome!.sequence).toBe(runtime.lastSequence)

    const eventCount = events.length
    const rejected = await executeTextOpenWorldActionV1({
      sessionId,
      actionKey: 'action.talk-caretaker',
      targetKey: 'actor.caretaker',
      source: 'fixed-choice',
      commandId: 'command.ending-lifecycle.normal.after-completed',
      requestedAt: 5,
    })
    expect(rejected).toMatchObject({ phase: 'preflight', status: 'rejected', outcomeCommitted: false })
    expect(await allEvents(sessionId)).toHaveLength(eventCount)
    expect((await db.productRuntimeSessions.get(sessionId))?.status).toBe('completed')

    const checkpoint = await createTextOpenWorldCheckpointV1({
      sessionId,
      name: '结局后只读存档',
      purpose: 'manual',
    })
    const sessionCount = await db.productRuntimeSessions.count()
    await expect(branchTextOpenWorldSessionFromCheckpointV1({
      checkpointId: checkpoint.id!,
      title: '不得创建的结局后分支',
    })).rejects.toThrow('不能从已抵达结局的状态创建分支')
    await expect(branchProductRuntimeSession({
      parentSessionId: sessionId,
      throughSequence: runtime.lastSequence,
      title: '不得绕过的结局后分支',
    })).rejects.toThrow('不能从已抵达结局的状态创建分支')
    expect(await db.productRuntimeSessions.count()).toBe(sessionCount)
  }, 120_000)

  it('Action v17以前的结局在没有pending命令时仍可恢复生命周期CAS且不新增事件', async () => {
    const sessionId = await createLegacyEndingSession('legacy-status-crash')
    const completed = await db.productRuntimeSessions.get(sessionId)
    if (!completed) throw new Error('测试Session不存在')
    const beforeEvents = await allEvents(sessionId)
    expect((await readProductRuntimeState(sessionId)).textOpenWorld?.state.endings.reachedKey)
      .toBe('ending.cooperate')
    await db.productRuntimeSessions.update(sessionId, {
      status: 'active',
      updatedAt: completed.updatedAt + 1,
    })

    await resumeTextOpenWorldSystemWorkV1(sessionId)
    expect((await db.productRuntimeSessions.get(sessionId))?.status).toBe('completed')
    expect(await allEvents(sessionId)).toEqual(beforeEvents)
  }, 60_000)

  it('结局Effect已写但Director marker与completed缺失时，resume补齐一次且重复恢复不新增事件', async () => {
    const { sessionId } = await createReadySession('ending-effect-crash')
    const endingCommandId = 'command.ending-lifecycle.ending-effect-crash.ending'
    await commitEndingEffectWithoutSystemFollowUp(sessionId, endingCommandId)

    const interrupted = await readProductRuntimeState(sessionId)
    const interruptedEvents = await allEvents(sessionId)
    expect(interrupted.textOpenWorld?.state.endings.reachedKey).toBe(journey.keys.endingKeys[0])
    expect(interrupted.textOpenWorld?.protocol.pendingCommandId).toBeNull()
    expect(linkedDirectorCommands(interruptedEvents, endingCommandId)).toHaveLength(0)
    expect((await db.productRuntimeSessions.get(sessionId))?.status).toBe('active')
    expect(await reconcileTextOpenWorldSessionCompletionV1(sessionId)).toBe(false)

    await resumeTextOpenWorldSystemWorkV1(sessionId)
    const recoveredEvents = await allEvents(sessionId)
    expect(linkedDirectorCommands(recoveredEvents, endingCommandId)).toHaveLength(1)
    expect((await db.productRuntimeSessions.get(sessionId))?.status).toBe('completed')
    const recoveredEventCount = recoveredEvents.length
    const recoveredSequence = (await readProductRuntimeState(sessionId)).lastSequence

    await resumeTextOpenWorldSystemWorkV1(sessionId)
    expect(await allEvents(sessionId)).toHaveLength(recoveredEventCount)
    expect((await readProductRuntimeState(sessionId)).lastSequence).toBe(recoveredSequence)
    expect((await db.productRuntimeSessions.get(sessionId))?.status).toBe('completed')
  }, 60_000)

  it('Director marker已写但status仍为active时，resume只对账生命周期且不重放任何事件', async () => {
    const { sessionId } = await createReadySession('status-crash')
    const endingCommandId = await completeEnding(sessionId, 'status-crash')
    const completed = await db.productRuntimeSessions.get(sessionId)
    if (!completed) throw new Error('测试Session不存在')
    const beforeEvents = await allEvents(sessionId)
    expect(linkedDirectorCommands(beforeEvents, endingCommandId)).toHaveLength(1)
    await db.productRuntimeSessions.update(sessionId, {
      status: 'active',
      updatedAt: completed.updatedAt + 1,
    })

    await resumeTextOpenWorldSystemWorkV1(sessionId)
    expect((await db.productRuntimeSessions.get(sessionId))?.status).toBe('completed')
    expect(await allEvents(sessionId)).toEqual(beforeEvents)

    await resumeTextOpenWorldSystemWorkV1(sessionId)
    expect((await db.productRuntimeSessions.get(sessionId))?.status).toBe('completed')
    expect(await allEvents(sessionId)).toEqual(beforeEvents)
  }, 60_000)

  it('completed缺少结局、仍有pending或仍有未结算玩家cause时全部失败关闭且不改事件流', async () => {
    const missingEnding = await createSession({ status: 'completed', suffix: 'invalid-missing-ending' })
    const missingEndingEvents = await allEvents(missingEnding.session.id!)
    await expect(resumeTextOpenWorldSystemWorkV1(missingEnding.session.id!))
      .rejects.toThrow('已完成Session与规范结局状态不一致')
    expect(await allEvents(missingEnding.session.id!)).toEqual(missingEndingEvents)

    const pending = await createSession({ suffix: 'invalid-pending' })
    const pendingSessionId = pending.session.id!
    const pendingBefore = await readProductRuntimeState(pendingSessionId)
    await commitTextOpenWorldCommandV1({
      schema: 'storyforge.text-open-world.command',
      version: 1,
      commandId: 'command.ending-lifecycle.invalid-pending.talk',
      sessionId: pendingSessionId,
      actorKey: 'player',
      actionKey: 'action.talk-caretaker',
      payload: { targetKey: 'actor.caretaker' },
      baseSequence: pendingBefore.lastSequence,
      baseStateHash: await hashProductRuntimeStateV1(pendingBefore),
      source: 'fixed-choice',
      requestedAt: 1,
    })
    await db.productRuntimeSessions.update(pendingSessionId, { status: 'completed', updatedAt: Date.now() })
    const pendingEvents = await allEvents(pendingSessionId)
    expect((await readProductRuntimeState(pendingSessionId)).textOpenWorld?.protocol.pendingCommandId)
      .toBe('command.ending-lifecycle.invalid-pending.talk')
    await expect(resumeTextOpenWorldSystemWorkV1(pendingSessionId))
      .rejects.toThrow('已完成Session与规范结局状态不一致')
    expect(await allEvents(pendingSessionId)).toEqual(pendingEvents)

    const unsettled = await createReadySession('invalid-unsettled')
    const unsettledCommandId = 'command.ending-lifecycle.invalid-unsettled.ending'
    await commitEndingEffectWithoutSystemFollowUp(unsettled.sessionId, unsettledCommandId)
    await db.productRuntimeSessions.update(unsettled.sessionId, { status: 'completed', updatedAt: Date.now() })
    const unsettledRuntime = await readProductRuntimeState(unsettled.sessionId)
    const unsettledEvents = await allEvents(unsettled.sessionId)
    expect(unsettledRuntime.textOpenWorld?.state.endings.reachedKey).toBe(journey.keys.endingKeys[0])
    expect(unsettledRuntime.textOpenWorld?.protocol.pendingCommandId).toBeNull()
    expect(linkedDirectorCommands(unsettledEvents, unsettledCommandId)).toHaveLength(0)
    await expect(resumeTextOpenWorldSystemWorkV1(unsettled.sessionId))
      .rejects.toThrow('已完成Session与规范结局状态不一致')
    expect(await allEvents(unsettled.sessionId)).toEqual(unsettledEvents)
  }, 120_000)
})

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  executeTextOpenWorldActionV1,
  supportsTextOpenWorldAutomaticCombatRewardV1,
} from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldCombatActionCatalogV1 } from '../../src/lib/open-world/combat-actions'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { commitTextOpenWorldOutcomeBatchV1 } from '../../src/lib/open-world/events'
import { resolveTextOpenWorldRandomEvidenceV1 } from '../../src/lib/open-world/event-contract'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { deriveTextOpenWorldContextsV1, parseTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { hashProductRuntimeStateV1, readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent, TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

function actionV17Runtime(input?: { combatAtSaltPort?: boolean; oneHitCombat?: boolean }): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const actions = runtimePackage.modules.actions.payload as any
  const progression = runtimePackage.modules.progression.payload as any
  const combat = runtimePackage.modules.combat.payload as any

  // Action v17 closes an old staged-abandon ambiguity in the broad fixture.
  const stagedAbandon = actions.actions.find((candidate: any) => candidate.key === 'action.abandon-supplies')
  const stagedBinding = actions.inputBindings.actions.find((candidate: any) => candidate.actionKey === stagedAbandon.key)
  actions.effects.push({
    key: 'effect.abandon-supplies-unstarted-follow-up-v17', operation: 'transition-quest',
    payload: { questKey: 'quest.template.supplies', status: 'abandoned', stageKey: null },
  })
  actions.actions.push({
    ...structuredClone(stagedAbandon), key: 'action.abandon-supplies-unstarted-follow-up-v17',
    successEffectKeys: ['effect.abandon-supplies-unstarted-follow-up-v17'],
  })
  actions.inputBindings.actions.push({
    ...structuredClone(stagedBinding), key: 'binding.action.abandon-supplies-unstarted-follow-up-v17',
    order: actions.inputBindings.actions.length + 1,
    actionKey: 'action.abandon-supplies-unstarted-follow-up-v17',
    actionDefinitionHash: 'd'.repeat(64),
    resultAuthority: {
      ...structuredClone(stagedBinding.resultAuthority),
      actionKey: 'action.abandon-supplies-unstarted-follow-up-v17',
      actionDefinitionHash: 'd'.repeat(64),
    },
    naturalLanguage: {
      ...structuredClone(stagedBinding.naturalLanguage),
      exampleUtterances: ['放弃尚未开始的续跑测试任务', '不接本次续跑测试委托'],
    },
  })
  actions.version = 17
  runtimePackage.modules.actions.schemaVersion = 17

  progression.version = 2
  progression.skills = progression.skills.map((candidate: any) => {
    const { activation: _activation, kind, ...skill } = candidate
    if (kind !== 'attack') throw new Error(`续跑测试夹具遇到未定义机制:${String(kind)}`)
    return { ...skill, mechanic: { kind: 'attack' } }
  })
  progression.statuses = progression.statuses.map((status: any) => ({
    ...status,
    duration: { clock: 'combat' },
    reapplyPolicy: 'reject',
    maxStacks: 1,
    modifiers: [],
  }))
  runtimePackage.modules.progression.schemaVersion = 2

  combat.version = 4
  delete combat.transientPlayerStatusKeys
  runtimePackage.modules.combat.schemaVersion = 4
  if (input?.combatAtSaltPort) {
    combat.encounters[0].locationKey = 'location.salt-port'
    actions.actions.find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = ['location.salt-port']
  }
  if (input?.oneHitCombat) combat.enemies[0].maximumHealth = 1
  return runtimePackage
}

function payload(event: ProductRuntimeEvent): any { return JSON.parse(event.payloadJson) }

async function commitPlayerEffectWithoutSystemFollowUp(input: {
  sessionId: number
  commandId: string
  actionKey: string
  targetKey: string
}) {
  const before = await readProductRuntimeState(input.sessionId)
  await commitTextOpenWorldCommandV1({
    schema: 'storyforge.text-open-world.command', version: 1,
    commandId: input.commandId, sessionId: input.sessionId,
    actorKey: 'player', actionKey: input.actionKey, payload: { targetKey: input.targetKey },
    baseSequence: before.lastSequence, baseStateHash: await hashProductRuntimeStateV1(before),
    source: 'system-action', requestedAt: 2,
  })
  const runtime = await readProductRuntimeState(input.sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(runtime.textOpenWorld)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const action = modules.actions.actions.find(candidate => candidate.key === input.actionKey)
  if (!action) throw new Error(`测试Action不存在:${input.actionKey}`)
  const effectKeys = [...new Set([...action.costEffectKeys, ...action.successEffectKeys])]
  const hasCombatAction = effectKeys.some(effectKey => modules.actions.effects
    .some(effect => effect.key === effectKey && effect.operation === 'perform-combat-action'))
  let randomRequests: ReturnType<ReturnType<typeof createTextOpenWorldCombatActionCatalogV1>['randomRequestsFor']> = []
  let authorization: ReturnType<ReturnType<typeof createTextOpenWorldCombatActionCatalogV1>['prepare']> | null = null
  if (hasCombatAction) {
    const combat = createTextOpenWorldCombatActionCatalogV1(projection.runtimePackage, modules)
    const commandSequence = projection.protocol.pendingCommandSequence!
    const conditionResults = Object.fromEntries(Object.entries(deriveTextOpenWorldContextsV1(projection).action.conditionResults)
      .map(([key, result]) => [key, result.satisfied]))
    const actionInput = {
      state: projection.state, actionKey: input.actionKey, targetKey: input.targetKey,
      actorKey: 'player' as const, conditionResults,
    }
    randomRequests = combat.randomRequestsFor(actionInput)
    const session = await db.productRuntimeSessions.get(input.sessionId)
    if (!session) throw new Error('测试Session不存在')
    const evidence = await Promise.all(randomRequests.map((request, drawIndex) => resolveTextOpenWorldRandomEvidenceV1({
      seed: session.seed, commandId: input.commandId, commandSequence, drawIndex, request,
    })))
    authorization = combat.prepare({ ...actionInput, evidence })
  }
  const catalog = createTextOpenWorldEffectCatalogV1(projection.runtimePackage)
  const plan = await catalog.plan({
    effectKeys, claimKey: `claim.${input.commandId}`, state: projection.state, authorization,
  })
  const { receipt } = await catalog.apply({ plan, state: projection.state })
  await commitTextOpenWorldOutcomeBatchV1({
    sessionId: input.sessionId, commandId: input.commandId, ruleset: projection.ruleset,
    randomRequests, plan, receipt, outcome: 'success', reason: null, degradation: null,
  })
  return readProductRuntimeState(input.sessionId)
}

function linkedDirectorCommands(events: ProductRuntimeEvent[], causeCommandId: string) {
  return events.filter(event => event.type === 'text-open-world.command.committed'
    && event.actorKey === 'system'
    && payload(event).envelope.payload.systemCauseCommandId === causeCommandId
    && payload(event).envelope.payload.directorTrigger != null)
}

describe('Text Open World · Action v17 durable system follow-up recovery', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('自动胜利奖励只对具有冻结RewardContract的Combat v3/v4开放，旧Combat v2保持关闭', () => {
    expect([1, 2, 3, 4, 5].map(supportsTextOpenWorldAutomaticCombatRewardV1))
      .toEqual([false, false, true, true, false])
  })

  it('玩家战斗Effect已落盘但阶段后续缺失时，刷新补跑到可操作回合且二次刷新不重复推进', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD Combat Follow-up Recovery-${crypto.randomUUID()}`,
      textOpenWorldVNext: actionV17Runtime({ combatAtSaltPort: true }),
      title: 'Combat Follow-up Recovery', seed: 'combat-follow-up-recovery-v17',
    })
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal',
      commandId: 'command.follow-up.combat.start', requestedAt: 1,
    })
    const causeCommandId = 'command.follow-up.combat.player-attack'
    const prefixState = await commitPlayerEffectWithoutSystemFollowUp({
      sessionId: created.session.id!, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.1',
      commandId: causeCommandId,
    })
    expect(prefixState.textOpenWorld?.state.combat).toMatchObject({ status: 'active', phase: 'action-resolved' })

    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.session.id!)
    const loaded = useTextOpenWorldPlayerStore.getState().runtimeState
    expect(loaded.textOpenWorld?.protocol.pendingCommandId).toBeNull()
    expect(loaded.textOpenWorld?.state.combat).toMatchObject({
      status: 'active', phase: 'actor-turn', activeCombatantKey: 'player', round: 2,
    })
    const once = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    const marker = linkedDirectorCommands(once, causeCommandId)
    expect(marker).toHaveLength(1)
    expect(once.filter(event => event.type === 'text-open-world.random.resolved'
      && payload(event).commandId === marker[0].commandId)).toHaveLength(0)
    const eventCount = once.length
    const sequence = loaded.lastSequence

    await useTextOpenWorldPlayerStore.getState().select(created.session.id!)
    const twice = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    expect(twice).toHaveLength(eventCount)
    expect(useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence).toBe(sequence)
    expect(linkedDirectorCommands(twice, causeCommandId)).toHaveLength(1)
  }, 60_000)

  it('Director marker只由稳定玩家cause标识，刷新恢复只开奖一次并保留原始原因链', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD Director Follow-up Recovery-${crypto.randomUUID()}`,
      textOpenWorldVNext: actionV17Runtime(),
      title: 'Director Follow-up Recovery', seed: 'director-follow-up-recovery-v17',
    })
    const causeCommandId = 'command.follow-up.player-talk'
    await commitPlayerEffectWithoutSystemFollowUp({
      sessionId: created.session.id!, actionKey: 'action.talk-caretaker', targetKey: 'actor.caretaker',
      commandId: causeCommandId,
    })

    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.session.id!)
    const onceState = useTextOpenWorldPlayerStore.getState().runtimeState
    const once = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    const marker = linkedDirectorCommands(once, causeCommandId)
    expect(marker).toHaveLength(1)
    expect(payload(marker[0]).envelope.payload).toMatchObject({
      directorTrigger: 'talk', systemCauseCommandId: causeCommandId,
    })
    const markerId = marker[0].commandId
    const drawCount = onceState.textOpenWorld?.state.director.drawCount
    const eventCount = once.length

    await useTextOpenWorldPlayerStore.getState().select(created.session.id!)
    const twice = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    expect(twice).toHaveLength(eventCount)
    expect(linkedDirectorCommands(twice, causeCommandId).map(event => event.commandId)).toEqual([markerId])
    expect(useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld?.state.director.drawCount).toBe(drawCount)
  }, 60_000)

  it('Combat v4胜利续跑只结算一次冻结奖励，重复刷新不会重复领奖', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD Combat4 Reward Recovery-${crypto.randomUUID()}`,
      textOpenWorldVNext: actionV17Runtime({ combatAtSaltPort: true, oneHitCombat: true }),
      title: 'Combat4 Reward Recovery', seed: 'combat4-reward-recovery-v17',
    })
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal',
      commandId: 'command.follow-up.combat4-reward.start', requestedAt: 1,
    })
    const causeCommandId = 'command.follow-up.combat4-reward.attack'
    await commitPlayerEffectWithoutSystemFollowUp({
      sessionId: created.session.id!, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.1',
      commandId: causeCommandId,
    })

    await useTextOpenWorldPlayerStore.getState().load(created.scope, null, created.session.id!)
    const onceState = useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld!
    expect(onceState.state.combat).toMatchObject({ status: 'victory', phase: 'terminal' })
    expect(onceState.state.appliedClaimKeys.filter(key => key.startsWith('claim.reward.reward.ridge-jackal.'))).toHaveLength(1)
    const once = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    const rewardCommands = once.filter(event => event.type === 'text-open-world.command.committed'
      && payload(event).envelope.actionKey === 'action.claim-combat-reward')
    expect(rewardCommands).toHaveLength(1)
    expect(linkedDirectorCommands(once, causeCommandId)).toHaveLength(1)
    const eventCount = once.length

    await useTextOpenWorldPlayerStore.getState().select(created.session.id!)
    const twice = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    expect(twice).toHaveLength(eventCount)
    expect(twice.filter(event => event.type === 'text-open-world.command.committed'
      && payload(event).envelope.actionKey === 'action.claim-combat-reward')).toHaveLength(1)
    expect(useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld?.state.appliedClaimKeys
      .filter(key => key.startsWith('claim.reward.reward.ridge-jackal.'))).toHaveLength(1)
  }, 60_000)
})

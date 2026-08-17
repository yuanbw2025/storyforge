import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { publishAdventureGameDraft, seedAdventureAcceptanceGame } from '../../src/lib/adventure/authoring'
import { db } from '../../src/lib/db/schema'
import {
  commitAdventureAction,
  commitAdventureNarrativeChoice,
  commitNarrativeChoice,
  readSimulationState,
  readSimulationStateVersion,
  replaySimulationEvents,
} from '../../src/lib/simulation/runtime'
import { createTextAdventureInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

async function workspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    name, genre: 'adventure', genres: ['adventure'], status: 'drafting',
    description: '文字冒险高级流程回归', targetWordCount: 30_000, createdAt: now, updatedAt: now,
  } as any) as number
  return ensureWorkspaceOwnership(projectId)
}

async function act(sessionId: number, actionKey: string, commandId: string) {
  const base = await readSimulationStateVersion(sessionId)
  return commitAdventureAction({
    sessionId, actionKey, commandId,
    baseSequence: base.sequence, baseStateHash: base.stateHash,
  })
}

describe('TEXTADV-1 · Narrative bridge, inventory and growth', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('Narrative Choice 只能经幂等公共行动桥接改变 Adventure 状态并进入失落结局', async () => {
    const owned = await workspace('TEXTADV Narrative 桥接')
    const definition = await seedAdventureAcceptanceGame({ scope: owned.scope, title: '桥接样例' })
    const publication = await publishAdventureGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    const session = await createTextAdventureInstance({
      scope: owned.scope, gameReleaseId: publication.gameRelease.id!, title: '桥接存档', seed: 'bridge-seed',
    })
    await act(session.id!, 'inspect.notice', 'bridge.quest')
    await act(session.id!, 'move.market', 'bridge.market')
    await act(session.id!, 'move.archive', 'bridge.archive')
    await act(session.id!, 'move.canal', 'bridge.canal')
    await act(session.id!, 'move.tower', 'bridge.tower')
    const before = await readSimulationStateVersion(session.id!)
    await expect(commitNarrativeChoice({
      sessionId: session.id!, choiceKey: 'action.abandon', commandId: 'bridge.bypass',
      baseSequence: before.sequence, baseStateHash: before.stateHash,
    })).rejects.toThrow('必须先通过公共 Adventure 行动桥接')
    const first = await commitAdventureNarrativeChoice({ sessionId: session.id!, choiceKey: 'action.abandon' })
    expect(await commitAdventureNarrativeChoice({ sessionId: session.id!, choiceKey: 'action.abandon' })).toEqual(first)
    const state = await readSimulationState(session.id!)
    expect(state.adventure?.quests.find(item => item.questKey === 'main.bell')?.status).toBe('failed')
    expect(state.adventure?.actionHistory.filter(item => item.actionKey === 'quest.abandon')).toHaveLength(1)
    expect(state.narrative).toMatchObject({ completed: true, endingKey: 'failure' })
    const events = await db.simulationEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events.map(item => item.type)).toEqual(expect.arrayContaining([
      'adventure.quest.failed', 'adventure.narrative.synced', 'adventure.action.committed',
      'narrative.choice.committed', 'narrative.ending.reached',
    ]))
  }, 20_000)

  it('物品装备、交付与任务奖励能力成长都由正式事件回放', async () => {
    const owned = await workspace('TEXTADV 物品与成长')
    const definition = await seedAdventureAcceptanceGame({ scope: owned.scope, title: '物品成长样例' })
    const publication = await publishAdventureGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    const session = await createTextAdventureInstance({
      scope: owned.scope, gameReleaseId: publication.gameRelease.id!, title: '成长存档', seed: 'growth-seed',
    })
    await act(session.id!, 'take.rope', 'growth.rope.take')
    await act(session.id!, 'use.rope', 'growth.rope.equip')
    await act(session.id!, 'inspect.notice', 'growth.main')
    await act(session.id!, 'move.market', 'growth.market')
    await act(session.id!, 'talk.merchant', 'growth.merchant')
    await act(session.id!, 'move.archive', 'growth.archive')
    await act(session.id!, 'move.canal', 'growth.canal')
    await act(session.id!, 'inspect.grate', 'growth.herbs.accept')
    await act(session.id!, 'take.herb', 'growth.herbs.take')
    await act(session.id!, 'move.tower', 'growth.tower')
    await act(session.id!, 'move.cliff', 'growth.cliff')
    await act(session.id!, 'move.harbor', 'growth.harbor')
    await act(session.id!, 'give.herb', 'growth.herbs.give')
    const state = await readSimulationState(session.id!)
    expect(state.adventure?.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: 'rope', state: 'equipped' }),
      expect.objectContaining({ itemKey: 'herb', ownerKey: 'apothecary', state: 'transferred' }),
    ]))
    expect(state.adventure?.quests.find(item => item.questKey === 'side.herbs')?.status).toBe('completed')
    expect(state.adventure?.abilities.empathy).toBe(3)
    const events = await db.simulationEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events.map(item => item.type)).toEqual(expect.arrayContaining([
      'adventure.item.state-changed', 'adventure.item.transferred', 'adventure.ability.changed',
    ]))
    const initial = JSON.parse((await db.simulationSessions.get(session.id!))!.initialStateJson)
    expect(replaySimulationEvents(initial, events)).toEqual(state)
  }, 20_000)
})

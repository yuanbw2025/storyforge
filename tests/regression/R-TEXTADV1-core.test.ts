import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdventureAcceptanceContent,
  publishAdventureGameDraft,
  seedAdventureAcceptanceGame,
  validateAdventureGameDraft,
} from '../../src/lib/adventure/authoring'
import { createInitialAdventureState, parseAdventureContent, validateAdventureContent } from '../../src/lib/adventure/runtime'
import { db } from '../../src/lib/db/schema'
import {
  branchSimulationSession,
  commitAdventureAction,
  commitAdventureNarrativeChoice,
  appendSimulationEvent,
  applySimulationEvent,
  readSimulationState,
  readSimulationStateVersion,
  replaySimulationEvents,
} from '../../src/lib/simulation/runtime'
import { parseAdventureGameReleaseManifest } from '../../src/lib/text-game/releases'
import { createTextAdventureInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { EMPTY_SIMULATION_STATE, type SimulationEvent } from '../../src/lib/types'

async function workspace(name = 'TEXTADV-1') {
  const now = Date.now()
  const projectId = await db.projects.add({
    name, genre: 'adventure', genres: ['adventure'], status: 'drafting',
    description: '文字冒险回归项目', targetWordCount: 30_000, createdAt: now, updatedAt: now,
  } as any) as number
  return ensureWorkspaceOwnership(projectId)
}

async function act(sessionId: number, actionKey: string, commandId = `command.${actionKey}`) {
  const base = await readSimulationStateVersion(sessionId)
  const result = await commitAdventureAction({
    sessionId, actionKey, commandId,
    baseSequence: base.sequence, baseStateHash: base.stateHash,
  })
  return result
}

describe('TEXTADV-1 · deterministic content and execution kernel', () => {
  // Every persisted case owns a distinct Project/World/Work, so one initial
  // reset is sufficient and avoids fake-indexeddb versionchange churn between
  // long replay scenarios.
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  const dbIt = it.sequential

  it('验收内容覆盖有限地图、对象、物品、能力、状态、四条任务和三种主线解法', () => {
    const content = createAdventureAcceptanceContent()
    expect(content).toMatchObject({ version: 1, initialLocationKey: 'harbor' })
    expect(content.locations).toHaveLength(6)
    expect(content.objects).toHaveLength(8)
    expect(content.items).toHaveLength(10)
    expect(content.abilities).toHaveLength(4)
    expect(content.conditions).toHaveLength(3)
    expect(content.quests).toHaveLength(4)
    const objective = content.quests.find(item => item.key === 'main.bell')!.objectives[0]
    expect(objective.alternativeActionKeys).toEqual(expect.arrayContaining([
      'talk.merchant', 'use.coin', 'attempt.lock', 'use.key',
    ]))
    expect(validateAdventureContent(content)).toMatchObject({ valid: true, unreachableLocationKeys: [] })
  })

  it('拒绝断链、不可达地点、无效目标和未真正完成任务目标的替代行动', () => {
    const content = structuredClone(createAdventureAcceptanceContent())
    content.locations.push({ key: 'void', title: '虚空', description: '不可达。', tags: [] })
    content.objects[0].locationKey = 'missing'
    content.actions.find(item => item.key === 'take.shard')!.targetKey = 'missing-target'
    content.quests[0].objectives[0].alternativeActionKeys.push('take.rope')
    const report = validateAdventureContent(content)
    expect(report.valid).toBe(false)
    expect(report.errors.join('\n')).toMatch(/交互物地点不存在/)
    expect(report.errors.join('\n')).toMatch(/行动目标不存在/)
    expect(report.errors.join('\n')).toMatch(/不可达地点:void/)
    expect(report.errors.join('\n')).toMatch(/替代行动没有完成对应目标/)
  })

  dbIt('冻结发布后离线游玩，事件化物品/任务/判定可幂等提交、回放和分支', async () => {
    const owned = await workspace()
    const definition = await seedAdventureAcceptanceGame({ scope: owned.scope, title: '雾港潮汐钟', gameKey: 'mist-harbor' })
    expect(await validateAdventureGameDraft(owned.scope, definition.id!)).toMatchObject({ valid: true })
    const publication = await publishAdventureGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    const manifest = parseAdventureGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(manifest.adventure.locations).toHaveLength(6)
    expect(manifest.interaction).toMatchObject({
      playerKey: 'player',
      profiles: expect.arrayContaining([expect.objectContaining({ participantKey: 'merchant' })]),
      sceneTemplates: expect.arrayContaining([expect.objectContaining({ sceneKey: 'merchant-records' })]),
    })

    const session = await createTextAdventureInstance({
      scope: owned.scope, gameReleaseId: publication.gameRelease.id!,
      title: '第一次冒险', seed: 'textadv-fixed-seed',
    })
    await act(session.id!, 'inspect.notice')
    await act(session.id!, 'move.market')
    const beforeTalk = await readSimulationStateVersion(session.id!)
    const talk = await commitAdventureAction({
      sessionId: session.id!, actionKey: 'talk.merchant', commandId: 'main.talk',
      baseSequence: beforeTalk.sequence, baseStateHash: beforeTalk.stateHash,
    })
    expect(await commitAdventureAction({
      sessionId: session.id!, actionKey: 'talk.merchant', commandId: 'main.talk',
      baseSequence: beforeTalk.sequence, baseStateHash: beforeTalk.stateHash,
    })).toEqual(talk)
    let state = await readSimulationState(session.id!)
    expect(state.adventure?.inventory).toEqual(expect.arrayContaining([expect.objectContaining({ itemKey: 'ledger-page' })]))
    expect(state.adventure?.quests.find(item => item.questKey === 'main.bell')?.objectives[0].completed).toBe(true)
    expect(state.interaction?.relationshipHistory).toEqual([
      expect.objectContaining({ ruleKey: 'merchant.share-records', sourceEventSequence: expect.any(Number) }),
    ])
    expect(state.interaction?.activeScene).toBeNull()

    await act(session.id!, 'move.archive')
    await act(session.id!, 'move.canal')
    await act(session.id!, 'move.tower')
    await act(session.id!, 'take.shard')
    state = await readSimulationState(session.id!)
    expect(state.adventure?.quests.find(item => item.questKey === 'main.bell')?.status).toBe('completed')
    expect(state.adventure?.conditions).toEqual(expect.arrayContaining([expect.objectContaining({ conditionKey: 'inspired' })]))
    const events = await db.simulationEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events.map(item => item.type)).toEqual(expect.arrayContaining([
      'interaction.scene.started', 'interaction.player.message.committed', 'interaction.relationship.changed',
      'interaction.scene.ended', 'adventure.item.gained', 'adventure.quest.objective-updated',
      'adventure.quest.completed', 'adventure.action.committed',
    ]))
    const branch = await branchSimulationSession({ parentSessionId: session.id!, throughSequence: talk.sequence, title: '交谈后的分支' })
    expect((await readSimulationState(branch.id!)).adventure?.currentLocationKey).toBe('market')
  }, 60_000)

  dbIt('确定性随机判定保存证据，资源和物品不能双花', async () => {
    const owned = await workspace('TEXTADV 判定')
    const definition = await seedAdventureAcceptanceGame({ scope: owned.scope, title: '判定样例' })
    const publication = await publishAdventureGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    const session = await createTextAdventureInstance({ scope: owned.scope, gameReleaseId: publication.gameRelease.id!, title: '判定存档', seed: 'costly-seed' })
    await act(session.id!, 'inspect.notice')
    await act(session.id!, 'move.market')
    await act(session.id!, 'move.archive')
    await act(session.id!, 'attempt.lock')
    const state = await readSimulationState(session.id!)
    expect(state.adventure?.checks.at(-1)).toMatchObject({ actionKey: 'attempt.lock', mode: 'random', expression: '1d6' })
    await expect(act(session.id!, 'attempt.lock', 'attempt.lock.again')).rejects.toThrow()

    const parsed = parseAdventureContent(createAdventureAcceptanceContent())
    const pay = parsed.actions.find(item => item.key === 'use.coin')!
    expect(pay.successEffects.filter(item => item.op === 'remove-item')).toHaveLength(1)
  }, 60_000)

  dbIt('覆盖成功、带代价成功与失败，并允许失败后走钥匙替代路线', async () => {
    const owned = await workspace('TEXTADV 三态判定')
    const definition = await seedAdventureAcceptanceGame({ scope: owned.scope, title: '三态判定' })
    const publication = await publishAdventureGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    const outcomes = new Map<string, number>()
    for (let index = 0; index < 36 && outcomes.size < 3; index++) {
      const session = await createTextAdventureInstance({
        scope: owned.scope, gameReleaseId: publication.gameRelease.id!, title: `判定-${index}`, seed: `outcome-seed-${index}`,
      })
      await act(session.id!, 'inspect.notice', `inspect.${index}`)
      await act(session.id!, 'move.market', `market.${index}`)
      await act(session.id!, 'inspect.gate', `key.${index}`)
      await act(session.id!, 'move.archive', `archive.${index}`)
      await act(session.id!, 'attempt.lock', `attempt.${index}`)
      const state = await readSimulationState(session.id!)
      const outcome = state.adventure!.checks.at(-1)!.outcome
      outcomes.set(outcome, session.id!)
    }
    expect([...outcomes.keys()]).toEqual(expect.arrayContaining(['success', 'costly-success', 'failure']))
    expect((await readSimulationState(outcomes.get('costly-success')!)).adventure?.conditions)
      .toEqual(expect.arrayContaining([expect.objectContaining({ conditionKey: 'wanted' })]))
    const costlyId = outcomes.get('costly-success')!
    await act(costlyId, 'move.canal', 'costly.canal')
    await act(costlyId, 'move.tower', 'costly.tower')
    await act(costlyId, 'take.shard', 'costly.shard')
    await commitAdventureNarrativeChoice({ sessionId: costlyId, choiceKey: 'ending.alternate', commandId: 'costly.ending' })
    expect((await readSimulationState(costlyId)).narrative).toMatchObject({ completed: true, endingKey: 'alternate' })
    const failureId = outcomes.get('failure')!
    expect((await readSimulationState(failureId)).adventure?.resources.time).toBe(7)
    await act(failureId, 'use.key', 'failure.alternative.key')
    expect((await readSimulationState(failureId)).adventure?.quests.find(item => item.questKey === 'main.bell')?.objectives[0].completed).toBe(true)
  }, 60_000)

  dbIt('拒绝重复领取、重复消费和旧式页面直写事件', async () => {
    const owned = await workspace('TEXTADV 反例')
    const definition = await seedAdventureAcceptanceGame({ scope: owned.scope, title: '反例' })
    const publication = await publishAdventureGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    const claimSession = await createTextAdventureInstance({ scope: owned.scope, gameReleaseId: publication.gameRelease.id!, title: '重复领取' })
    await act(claimSession.id!, 'take.rope', 'claim.rope.once')
    await expect(act(claimSession.id!, 'take.rope', 'claim.rope.twice')).rejects.toThrow()
    expect((await readSimulationState(claimSession.id!)).adventure?.inventory.find(item => item.itemKey === 'rope')?.quantity).toBe(1)

    const spendSession = await createTextAdventureInstance({ scope: owned.scope, gameReleaseId: publication.gameRelease.id!, title: '重复消费' })
    await act(spendSession.id!, 'inspect.notice', 'spend.quest')
    await act(spendSession.id!, 'move.market', 'spend.market')
    await act(spendSession.id!, 'use.coin', 'spend.coin.once')
    await expect(act(spendSession.id!, 'use.coin', 'spend.coin.twice')).rejects.toThrow()
    expect((await readSimulationState(spendSession.id!)).adventure?.inventory.some(item => item.itemKey === 'coin')).toBe(false)
    await expect(appendSimulationEvent({
      sessionId: spendSession.id!, type: 'adventure.action.committed',
      payload: { actionKey: 'invented.action' },
    })).rejects.toThrow('只能通过 commitAdventureAction')
    await expect(appendSimulationEvent({
      sessionId: spendSession.id!, type: 'interaction.relationship.changed', payload: {},
    })).rejects.toThrow('专用命令 API')
  }, 60_000)

  it('1000 步随机合法行动逐步投影与从头回放完全一致', () => {
    const content = createAdventureAcceptanceContent()
    const initial = { ...structuredClone(EMPTY_SIMULATION_STATE), adventure: createInitialAdventureState(content, 'a'.repeat(64)) }
    let projected = structuredClone(initial)
    const events: SimulationEvent[] = []
    let random = 0x5eed1234
    for (let index = 0; index < 1_000; index++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      const actionKey = random % 2 === 0 ? 'look.harbor' : 'rest.harbor'
      const event: SimulationEvent = {
        projectId: 1, worldGroupId: null, sessionId: 1, sequence: index + 1,
        type: 'adventure.action.committed', actorKey: 'player', targetKey: null,
        commandId: `stress.${index}`, baseSequence: index, baseStateHash: 'b'.repeat(64),
        payloadJson: JSON.stringify({ commandId: `stress.${index}`, actionKey, kind: actionKey.startsWith('look') ? 'look' : 'rest', outcome: 'success', narrative: actionKey, repeatable: true }),
        createdAt: index + 1,
      }
      events.push(event)
      projected = applySimulationEvent(projected, event)
    }
    const replayed = replaySimulationEvents(initial, events)
    expect(replayed).toEqual(projected)
    expect(replayed.adventure?.actionHistory).toHaveLength(1_000)
  })

})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  appendSimulationEvent,
  applyTtrpgCondition,
  changeTtrpgResource,
  createSimulationSessionFixtureV1,
  openTtrpgScene,
  readSimulationState,
  removeTtrpgCondition,
  resolveTtrpgAttack,
  resolveTtrpgEncounter,
  startTtrpgEncounter,
} from '../../src/lib/simulation/runtime'
import { EMPTY_SIMULATION_STATE, type Project } from '../../src/lib/types'

const now = 1_700_000_000_000

async function seedCombatSession() {
  const project: Project = {
    id: 93101,
    name: 'TTRPG-1B 遭遇测试',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 0,
    enableMultiWorld: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.projects.put(project)
  const session = await createSimulationSessionFixtureV1({
    projectId: project.id!,
    kind: 'ttrpg',
    title: '潮汐钟楼遭遇',
    seed: 'ttrpg-1b-fixed-seed',
    initialState: {
      ...structuredClone(EMPTY_SIMULATION_STATE),
      entities: {
        'character:linzhou': {
          entityKey: 'character:linzhou',
          kind: 'character',
          sourceId: 1,
          name: '林舟',
          locationKey: 'location:tower',
          lifecycleStatus: 'active',
          attributes: { role: 'player', hp: 18, maxHp: 20, armorClass: 14, initiative: 20, mana: 4, maxMana: 6 },
        },
        'npc:watcher': {
          entityKey: 'npc:watcher',
          kind: 'npc',
          sourceId: null,
          name: '钟楼守望者',
          locationKey: 'location:tower',
          lifecycleStatus: 'active',
          attributes: { role: 'npc', hp: 12, maxHp: 12, armorClass: 12, initiative: 10 },
        },
        'location:tower': {
          entityKey: 'location:tower',
          kind: 'location',
          sourceId: 2,
          name: '潮汐钟楼',
          locationKey: null,
          lifecycleStatus: 'active',
          attributes: {},
        },
      },
    },
  })
  await openTtrpgScene({
    sessionId: session.id!,
    title: '钟楼门厅',
    description: '守望者堵住了通路。',
    locationKey: 'location:tower',
    turnOrder: ['character:linzhou', 'npc:watcher'],
  })
  return { project, session }
}

async function startEncounter(sessionId: number) {
  return startTtrpgEncounter({
    sessionId,
    candidate: {
      baseSequence: 1,
      title: '门厅伏击',
      description: '击退守望者并打开通路。',
      participantKeys: ['character:linzhou', 'npc:watcher'],
    },
  })
}

describe('TTRPG-1B · 规则与战斗遭遇', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('从运行时实体建立确定性先攻、资源和护甲快照', async () => {
    const { session } = await seedCombatSession()
    const event = await startEncounter(session.id!)
    expect(event.type).toBe('ttrpg.encounter.started')
    const encounter = (await readSimulationState(session.id!)).ttrpg?.encounter
    expect(encounter).toMatchObject({
      title: '门厅伏击',
      round: 1,
      activeActorKey: 'character:linzhou',
      turnOrder: ['character:linzhou', 'npc:watcher'],
    })
    expect(encounter?.combatants['character:linzhou']).toMatchObject({
      initiative: 20,
      armorClass: 14,
      resources: { hp: { current: 18, maximum: 20 }, mana: { current: 4, maximum: 6 } },
    })
    expect(encounter?.combatants['npc:watcher']).toMatchObject({
      initiative: 10,
      armorClass: 12,
      resources: { hp: { current: 12, maximum: 12 } },
    })
  })

  it('攻击、确定性伤害、资源扣减和战斗回合在一个事务中完成', async () => {
    const { session } = await seedCombatSession()
    await startEncounter(session.id!)
    const events = await resolveTtrpgAttack({
      sessionId: session.id!,
      actorKey: 'character:linzhou',
      targetKey: 'npc:watcher',
      attackExpression: '1d20+100',
      damageExpression: '1d6+2',
      reason: '用短剑攻击。',
    })
    expect(events.map(event => event.type)).toEqual([
      'ttrpg.combat.attack.resolved',
      'ttrpg.combat.resource.changed',
      'ttrpg.combat.turn.advanced',
    ])
    const state = await readSimulationState(session.id!)
    const attack = state.ttrpg?.attacks[0]
    expect(attack).toMatchObject({ actorKey: 'character:linzhou', targetKey: 'npc:watcher', hit: true, armorClass: 12 })
    expect(attack?.damageTotal).toBeGreaterThanOrEqual(3)
    expect(state.ttrpg?.encounter?.combatants['npc:watcher'].resources.hp.current).toBe(12 - attack!.damageTotal)
    expect(state.ttrpg?.encounter).toMatchObject({ activeActorKey: 'npc:watcher', round: 1 })
  })

  it('手动资源和状态效果受上下限约束，并在行动者结束回合时递减', async () => {
    const { session } = await seedCombatSession()
    await startEncounter(session.id!)
    await changeTtrpgResource({
      sessionId: session.id!,
      entityKey: 'character:linzhou',
      resourceKey: 'hp',
      delta: 100,
      reason: '治疗',
    })
    await applyTtrpgCondition({
      sessionId: session.id!,
      entityKey: 'character:linzhou',
      condition: { conditionId: 'condition:guarded', name: '防御', description: '直到本回合结束。', duration: 1, stacks: 1 },
    })
    expect((await readSimulationState(session.id!)).ttrpg?.encounter?.combatants['character:linzhou']).toMatchObject({
      resources: { hp: { current: 20, maximum: 20 } },
      conditions: [{ conditionId: 'condition:guarded', duration: 1 }],
    })
    await resolveTtrpgAttack({
      sessionId: session.id!,
      actorKey: 'character:linzhou',
      targetKey: 'npc:watcher',
      attackExpression: '1d20-100',
      damageExpression: '1d6',
    })
    expect((await readSimulationState(session.id!)).ttrpg?.encounter?.combatants['character:linzhou'].conditions).toEqual([])
    await applyTtrpgCondition({
      sessionId: session.id!,
      entityKey: 'npc:watcher',
      condition: { conditionId: 'condition:marked', name: '标记', description: '', duration: null, stacks: 1 },
    })
    await removeTtrpgCondition({ sessionId: session.id!, entityKey: 'npc:watcher', conditionId: 'condition:marked' })
    expect((await readSimulationState(session.id!)).ttrpg?.encounter?.combatants['npc:watcher'].conditions).toEqual([])
  })

  it('拒绝过期遭遇、越权行动者和通用入口直写，失败不留下半个事件', async () => {
    const { session } = await seedCombatSession()
    await changeTtrpgResource({
      sessionId: session.id!,
      entityKey: 'missing',
      resourceKey: 'hp',
      delta: -1,
    }).catch(() => undefined)
    expect(await db.simulationEvents.count()).toBe(1)
    await expect(startTtrpgEncounter({
      sessionId: session.id!,
      candidate: { baseSequence: 0, title: '旧候选', description: '已过期', participantKeys: ['character:linzhou', 'npc:watcher'] },
    })).rejects.toThrow('已过期')
    await startEncounter(session.id!)
    const countBefore = await db.simulationEvents.count()
    await expect(resolveTtrpgAttack({
      sessionId: session.id!,
      actorKey: 'npc:watcher',
      targetKey: 'character:linzhou',
      attackExpression: '1d20',
      damageExpression: '1d6',
    })).rejects.toThrow('还没轮到')
    await expect(appendSimulationEvent({
      sessionId: session.id!,
      type: 'ttrpg.combat.resource.changed',
      payload: { entityKey: 'npc:watcher', resourceKey: 'hp', delta: -99, current: 0 },
    })).rejects.toThrow('专用 API')
    expect(await db.simulationEvents.count()).toBe(countBefore)
  })

  it('战斗遭遇随既有项目导出导入往返，不增加平行存档表', async () => {
    const { project, session } = await seedCombatSession()
    await startEncounter(session.id!)
    await resolveTtrpgAttack({
      sessionId: session.id!,
      actorKey: 'character:linzhou',
      targetKey: 'npc:watcher',
      attackExpression: '1d20+100',
      damageExpression: '1d4',
    })
    const importedProjectId = await importProjectJSON(await exportProjectJSON(project.id!))
    const imported = await db.simulationSessions.where('projectId').equals(importedProjectId).first()
    expect(imported).toBeTruthy()
    const state = await readSimulationState(imported!.id!)
    expect(state.ttrpg?.encounter).toMatchObject({ title: '门厅伏击', activeActorKey: 'npc:watcher' })
    expect(state.ttrpg?.attacks).toHaveLength(1)
  })

  it('结束遭遇会冻结最终战斗状态，结束后不能继续攻击', async () => {
    const { session } = await seedCombatSession()
    await startEncounter(session.id!)
    await resolveTtrpgEncounter({ sessionId: session.id!, reason: '守望者投降。' })
    const state = await readSimulationState(session.id!)
    expect(state.ttrpg?.encounter).toMatchObject({ status: 'resolved', activeActorKey: null })
    expect(state.narratives.at(-1)?.text).toContain('守望者投降')
    await expect(resolveTtrpgAttack({
      sessionId: session.id!,
      actorKey: 'character:linzhou',
      targetKey: 'npc:watcher',
      attackExpression: '1d20',
      damageExpression: '1d4',
    })).rejects.toThrow('进行中的战斗遭遇')
  })
})

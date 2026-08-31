import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  appendSimulationEvent,
  appendTtrpgTurn,
  createSimulationSessionFixtureV1,
  openTtrpgScene,
  readSimulationState,
  resolveTtrpgCheck,
} from '../../src/lib/simulation/runtime'
import { EMPTY_SIMULATION_STATE, type Project } from '../../src/lib/types'

const now = 1_700_000_000_000

async function seedSession() {
  const project: Project = {
    id: 93001,
    name: 'TTRPG-1 跑团测试',
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
    title: '潮汐钟楼战役',
    seed: 'ttrpg-fixed-seed',
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
          attributes: { role: 'player', hp: 10 },
        },
        'npc:watcher': {
          entityKey: 'npc:watcher',
          kind: 'npc',
          sourceId: null,
          name: '钟楼守望者',
          locationKey: 'location:tower',
          lifecycleStatus: 'active',
          attributes: { role: 'npc', hp: 8 },
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
  return { project, session }
}

describe('TTRPG-1 · 单机战役运行时闭环', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('场景、动作、技能检定、GM 分支叙事和回合推进形成可回放事件流', async () => {
    const { session } = await seedSession()
    await openTtrpgScene({
      sessionId: session.id!,
      title: '钟楼门厅',
      description: '潮声从石墙后传来，门锁上刻着陌生符号。',
      locationKey: 'location:tower',
      turnOrder: ['character:linzhou', 'npc:watcher'],
    })
    const events = await appendTtrpgTurn({
      sessionId: session.id!,
      candidate: {
        baseSequence: 1,
        actorKey: 'character:linzhou',
        action: '检查门锁上的潮汐刻痕。',
        narrative: '林舟俯身观察门锁。',
        check: {
          skill: '调查',
          expression: '1d20+2',
          dc: 12,
          reason: '刻痕是否隐藏了开门线索。',
        },
        outcomes: {
          success: '他发现了可旋转的暗纹，门锁发出轻响。',
          failure: '暗纹在潮气中模糊，暂时找不到机关。',
        },
        nextActorKey: 'npc:watcher',
      },
    })
    expect(events.map(event => event.type)).toEqual([
      'ttrpg.action.recorded',
      'ttrpg.check.resolved',
      'ttrpg.gm.response.recorded',
      'ttrpg.turn.advanced',
    ])
    const state = await readSimulationState(session.id!)
    expect(state.lastSequence).toBe(5)
    expect(state.ttrpg).toMatchObject({
      round: 1,
      activeActorKey: 'npc:watcher',
      turnOrder: ['character:linzhou', 'npc:watcher'],
    })
    expect(state.ttrpg?.actions[0].text).toContain('检查门锁')
    expect(state.ttrpg?.checks[0]).toMatchObject({ skill: '调查', dc: 12 })
    expect(state.narratives[0].text).toContain('林舟俯身观察')
    expect(state.narratives[0].text).toMatch(/暗纹/)
  })

  it('候选过期、伪造检定和直接写受治理事件都会被拒绝且不产生半回合', async () => {
    const { session } = await seedSession()
    await openTtrpgScene({
      sessionId: session.id!,
      title: '门厅',
      description: '',
      locationKey: null,
      turnOrder: ['character:linzhou', 'npc:watcher'],
    })
    await resolveTtrpgCheck({
      sessionId: session.id!,
      actorKey: 'character:linzhou',
      skill: '感知',
      expression: '1d20',
      dc: 10,
    })
    const countBefore = await db.simulationEvents.count()
    await expect(appendTtrpgTurn({
      sessionId: session.id!,
      candidate: {
        baseSequence: 1,
        actorKey: 'character:linzhou',
        action: '继续观察。',
        narrative: '他继续观察。',
        check: null,
        outcomes: null,
        nextActorKey: 'npc:watcher',
      },
    })).rejects.toThrow('已过期')
    expect(await db.simulationEvents.count()).toBe(countBefore)
    await expect(appendSimulationEvent({
      sessionId: session.id!,
      type: 'ttrpg.turn.advanced',
      payload: { nextActorKey: 'character:linzhou', round: 2 },
    })).rejects.toThrow('专用 API')
    const state = await readSimulationState(session.id!)
    expect(state.ttrpg?.actions).toHaveLength(0)
    expect(state.ttrpg?.checks).toHaveLength(1)
  })

  it('回合结束自动进入下一行动者并在轮回时递增回合号', async () => {
    const { session } = await seedSession()
    await openTtrpgScene({
      sessionId: session.id!,
      title: '门厅',
      description: '',
      locationKey: null,
      turnOrder: ['character:linzhou', 'npc:watcher'],
    })
    await appendTtrpgTurn({
      sessionId: session.id!,
      candidate: {
        baseSequence: 1,
        actorKey: 'character:linzhou',
        action: '喊话。',
        narrative: '回声穿过门厅。',
        check: null,
        outcomes: null,
        nextActorKey: 'npc:watcher',
      },
    })
    await appendTtrpgTurn({
      sessionId: session.id!,
      candidate: {
        baseSequence: 4,
        actorKey: 'npc:watcher',
        action: '回应。',
        narrative: '守望者抬起头。',
        check: null,
        outcomes: null,
        nextActorKey: 'character:linzhou',
      },
    })
    expect((await readSimulationState(session.id!)).ttrpg).toMatchObject({
      round: 2,
      activeActorKey: 'character:linzhou',
    })
  })

  it('战役状态随既有项目导出/导入往返，不需要新增表或旁路清单', async () => {
    const { project, session } = await seedSession()
    await openTtrpgScene({
      sessionId: session.id!,
      title: '可携带场景',
      description: '导出后仍然可继续。',
      locationKey: null,
      turnOrder: ['character:linzhou', 'npc:watcher'],
    })
    const importedProjectId = await importProjectJSON(await exportProjectJSON(project.id!))
    const imported = await db.simulationSessions.where('projectId').equals(importedProjectId).first()
    expect(imported).toBeTruthy()
    expect((await readSimulationState(imported!.id!)).ttrpg).toMatchObject({
      scene: { title: '可携带场景' },
      activeActorKey: 'character:linzhou',
    })
  })
})

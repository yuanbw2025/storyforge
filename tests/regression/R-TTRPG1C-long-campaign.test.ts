import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  appendSimulationEvent,
  branchSimulationSessionFixtureV1,
  createSimulationSessionFixtureV1,
  readSimulationState,
  updateTtrpgCampaignSummary,
  upsertTtrpgNpcSchedule,
  upsertTtrpgQuest,
} from '../../src/lib/simulation/runtime'
import { EMPTY_SIMULATION_STATE, type Project } from '../../src/lib/types'

const now = 1_700_000_000_000

async function seedCampaignSession() {
  const project: Project = {
    id: 93201,
    name: 'TTRPG-1C 长期战役测试',
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
    title: '潮汐钟楼长期战役',
    seed: 'ttrpg-1c-fixed-seed',
    initialState: {
      ...structuredClone(EMPTY_SIMULATION_STATE),
      entities: {
        'npc:warden': {
          entityKey: 'npc:warden',
          kind: 'npc',
          sourceId: null,
          name: '钟楼守望者',
          locationKey: 'location:tower',
          lifecycleStatus: 'active',
          attributes: { role: 'npc' },
        },
        'location:tower': {
          entityKey: 'location:tower',
          kind: 'location',
          sourceId: 1,
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

describe('TTRPG-1C · 长期战役状态与跨会话续接', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('摘要、任务、NPC 日程和世界时钟共用一条可回放事件流', async () => {
    const { session } = await seedCampaignSession()
    await updateTtrpgCampaignSummary({ sessionId: session.id!, summary: '守望者答应在潮汐钟响前打开北门。' })
    await upsertTtrpgQuest({
      sessionId: session.id!,
      questId: 'quest:north-gate',
      title: '打开北门',
      description: '在第三次钟响前取得钥匙。',
      status: 'active',
      priority: 2,
      dueClock: 3,
    })
    await upsertTtrpgNpcSchedule({
      sessionId: session.id!,
      scheduleId: 'schedule:warden-watch',
      entityKey: 'npc:warden',
      startClock: 2,
      endClock: 5,
      locationKey: 'location:tower',
      activity: '巡视北门',
      recurrence: 'daily',
    })
    await appendSimulationEvent({ sessionId: session.id!, type: 'time.advanced', payload: { amount: 2 } })
    const state = await readSimulationState(session.id!)
    expect(state.clock).toBe(2)
    expect(state.ttrpg?.campaign).toMatchObject({
      summary: '守望者答应在潮汐钟响前打开北门。',
      quests: [{ questId: 'quest:north-gate', dueClock: 3, status: 'active', updatedSequence: 2 }],
      npcSchedules: [{ scheduleId: 'schedule:warden-watch', startClock: 2, endClock: 5, recurrence: 'daily' }],
    })
    expect((await db.simulationEvents.toArray()).map(event => event.type)).toEqual([
      'ttrpg.campaign.summary.updated',
      'ttrpg.campaign.quest.upserted',
      'ttrpg.campaign.schedule.upserted',
      'time.advanced',
    ])
  })

  it('拒绝过期摘要和伪造 NPC/地点，失败不留下事件', async () => {
    const { session } = await seedCampaignSession()
    await updateTtrpgCampaignSummary({ sessionId: session.id!, summary: '第一版摘要' })
    const count = await db.simulationEvents.count()
    await expect(updateTtrpgCampaignSummary({ sessionId: session.id!, summary: '旧摘要', baseSequence: 0 })).rejects.toThrow('基线已变化')
    await expect(upsertTtrpgNpcSchedule({
      sessionId: session.id!,
      scheduleId: 'schedule:fake',
      entityKey: 'npc:missing',
      startClock: 1,
      activity: '伪造日程',
    })).rejects.toThrow('不是当前运行时 NPC')
    await expect(upsertTtrpgNpcSchedule({
      sessionId: session.id!,
      scheduleId: 'schedule:fake-location',
      entityKey: 'npc:warden',
      startClock: 1,
      locationKey: 'location:missing',
      activity: '伪造地点',
    })).rejects.toThrow('不是当前运行时地点')
    expect(await db.simulationEvents.count()).toBe(count)
  })

  it('战役分支继承长期资料且便携导出导入不新增存档表', async () => {
    const { project, session } = await seedCampaignSession()
    await updateTtrpgCampaignSummary({ sessionId: session.id!, summary: '主线分叉前的共同进展。' })
    await upsertTtrpgQuest({
      sessionId: session.id!,
      questId: 'quest:shared',
      title: '共同任务',
      description: '分支前必须完成。',
      status: 'active',
    })
    const child = await branchSimulationSessionFixtureV1({
      parentSessionId: session.id!,
      throughSequence: 2,
      title: '北门路线分支',
    })
    const childState = await readSimulationState(child.id!)
    expect(child.parentSessionId).toBe(session.id)
    expect(child.parentThroughSequence).toBe(2)
    expect(childState.ttrpg?.campaign?.summary).toBe('主线分叉前的共同进展。')
    expect(childState.ttrpg?.campaign?.quests[0].questId).toBe('quest:shared')
    await upsertTtrpgQuest({
      sessionId: child.id!,
      questId: 'quest:shared',
      title: '共同任务（分支）',
      description: '改走北门。',
      status: 'completed',
    })
    expect((await readSimulationState(session.id!)).ttrpg?.campaign?.quests[0].status).toBe('active')
    const importedProjectId = await importProjectJSON(await exportProjectJSON(project.id!))
    const importedSessions = await db.simulationSessions.where('projectId').equals(importedProjectId).toArray()
    expect(importedSessions).toHaveLength(2)
    const importedChild = importedSessions.find(row => row.title === '北门路线分支')
    expect(importedChild).toBeTruthy()
    expect((await readSimulationState(importedChild!.id!)).ttrpg?.campaign?.quests[0].title).toBe('共同任务（分支）')
  })
})

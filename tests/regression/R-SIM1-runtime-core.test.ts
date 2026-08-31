import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  appendSimulationEvent,
  applySimulationEvent,
  branchSimulationSession,
  createSimulationCheckpoint,
  createSimulationSession,
  deleteSimulationSession,
  readSimulationState,
  resolveSimulationDice,
  verifySimulationCheckpoint,
} from '../../src/lib/simulation/runtime'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteGroup } from '../../src/lib/registry/lifecycle'
import type { Project, SimulationEvent } from '../../src/lib/types'

const now = 1_700_000_000_000

async function seedProject(multiWorld = false) {
  const project: Project = {
    id: 91001,
    name: 'SIM-1 运行时测试',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld: multiWorld,
    createdAt: now,
    updatedAt: now,
  }
  await db.projects.put(project)
  const worldGroupId = multiWorld
    ? await db.worldGroups.add({
        projectId: project.id!,
        name: '潮汐界',
        type: 'primary',
        order: 0,
        createdAt: now,
        updatedAt: now,
      })
    : null
  await db.characters.add({
    projectId: project.id!,
    homeWorldGroupId: worldGroupId,
    name: '林舟',
    role: 'protagonist',
    roleWeight: 'main',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
    alignment: 'neutral',
    shortDescription: '潮汐旅人',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '',
    arc: '',
    createdAt: now,
    updatedAt: now,
  })
  return { project, worldGroupId: worldGroupId as number | null }
}

async function addCharacter(sessionId: number) {
  return appendSimulationEvent({
    sessionId,
    type: 'entity.upserted',
    payload: {
      entity: {
        entityKey: 'character:linzhou',
        kind: 'character',
        sourceId: 1,
        name: '林舟',
        locationKey: 'location:gate',
        lifecycleStatus: 'active',
        attributes: { hp: 10, mood: '平静' },
      },
    },
  })
}

describe('SIM-1A · 共享互动运行时核心', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('冻结创作来源后只靠追加事件回放状态，不修改角色主档', async () => {
    const { project } = await seedProject()
    const session = await createSimulationSession({
      projectId: project.id!,
      kind: 'npc-evolution',
      title: '城门之后',
      seed: 'same-seed',
      canonSnapshot: {
        version: 1,
        sources: [{ type: 'character', id: 1, name: '林舟' }],
      },
    })
    await addCharacter(session.id!)
    await appendSimulationEvent({
      sessionId: session.id!,
      type: 'time.advanced',
      payload: { amount: 3 },
    })
    await appendSimulationEvent({
      sessionId: session.id!,
      type: 'entity.patched',
      payload: {
        entityKey: 'character:linzhou',
        patch: {
          locationKey: 'location:market',
          attributes: { hp: 8 },
        },
      },
    })

    const state = await readSimulationState(session.id!)
    expect(state).toMatchObject({
      version: 1,
      clock: 3,
      lastSequence: 3,
      entities: {
        'character:linzhou': {
          name: '林舟',
          locationKey: 'location:market',
          attributes: { hp: 8, mood: '平静' },
        },
      },
    })
    expect((await db.characters.where('projectId').equals(project.id!).first())?.shortDescription)
      .toBe('潮汐旅人')
  })

  it('拒绝未知实体补丁、伪造随机事件与暂停会话写入', async () => {
    const { project } = await seedProject()
    const session = await createSimulationSession({
      projectId: project.id!,
      kind: 'sandbox',
      title: '安全边界',
      seed: 'guard-seed',
    })
    await expect(appendSimulationEvent({
      sessionId: session.id!,
      type: 'entity.patched',
      payload: { entityKey: 'character:missing', patch: { name: '幽灵' } },
    })).rejects.toThrow('不存在')
    await expect(appendSimulationEvent({
      sessionId: session.id!,
      type: 'random.resolved',
      payload: { expression: '1d20', dice: [20], modifier: 0, total: 20 },
    })).rejects.toThrow('只能通过')
    await db.simulationSessions.update(session.id!, { status: 'paused' })
    await expect(appendSimulationEvent({
      sessionId: session.id!,
      type: 'time.advanced',
      payload: { amount: 1 },
    })).rejects.toThrow('active')
    expect(await db.simulationEvents.count()).toBe(0)
  })

  it('相同种子与事件位置得到相同骰子，保存结果可被独立一致性校验', async () => {
    const { project } = await seedProject()
    const first = await createSimulationSession({
      projectId: project.id!,
      kind: 'sandbox',
      title: '判定 A',
      seed: 'fixed-seed',
    })
    const second = await createSimulationSession({
      projectId: project.id!,
      kind: 'sandbox',
      title: '判定 B',
      seed: 'fixed-seed',
    })
    const firstRoll = await resolveSimulationDice({
      sessionId: first.id!,
      expression: '2D20+3',
      nonce: '开锁',
    })
    const secondRoll = await resolveSimulationDice({
      sessionId: second.id!,
      expression: '2d20+3',
      nonce: '开锁',
    })
    expect(firstRoll.payloadJson).toBe(secondRoll.payloadJson)
    const payload = JSON.parse(firstRoll.payloadJson)
    expect(payload.dice).toHaveLength(2)
    expect(payload.dice.every((die: number) => die >= 1 && die <= 20)).toBe(true)
    expect(payload.total).toBe(payload.dice[0] + payload.dice[1] + 3)

    const forged: SimulationEvent = {
      ...firstRoll,
      id: undefined,
      sequence: 1,
      payloadJson: JSON.stringify({ ...payload, total: 999 }),
    }
    expect(() => applySimulationEvent({
      version: 1,
      clock: 0,
      entities: {},
      memories: [],
      narratives: [],
      lastSequence: 0,
    }, forged)).toThrow('合计')

    await expect(resolveSimulationDice({
      sessionId: first.id!, expression: '1d100', nonce: '百分骰',
    })).resolves.toMatchObject({ type: 'random.resolved' })
    await expect(resolveSimulationDice({
      sessionId: first.id!, expression: '1d101', nonce: '非法百分骰',
    })).rejects.toThrow('d2～d100')
  })

  it('并发追加仍形成连续唯一序号，记忆自动绑定真实事件序号', async () => {
    const { project } = await seedProject()
    const session = await createSimulationSession({
      projectId: project.id!,
      kind: 'sandbox',
      title: '并发会话',
      seed: 'concurrent',
    })
    await Promise.all([
      appendSimulationEvent({
        sessionId: session.id!,
        type: 'time.advanced',
        payload: { amount: 1 },
      }),
      appendSimulationEvent({
        sessionId: session.id!,
        type: 'time.advanced',
        payload: { amount: 2 },
      }),
    ])
    await appendSimulationEvent({
      sessionId: session.id!,
      type: 'memory.recorded',
      payload: {
        memory: {
          id: 'memory:gate',
          subjectKey: 'character:linzhou',
          status: 'known',
          content: '守卫收了银票。',
          sourceEventSequence: 999,
        },
      },
    })
    const events = (await db.simulationEvents.where('sessionId').equals(session.id!).toArray())
      .sort((a, b) => a.sequence - b.sequence)
    expect(events.map(event => event.sequence)).toEqual([1, 2, 3])
    const state = await readSimulationState(session.id!)
    expect(state.clock).toBe(3)
    expect(state.memories[0].sourceEventSequence).toBe(3)
  })

  it('检查点可验真，分支冻结目标序号且父子后续互不影响', async () => {
    const { project } = await seedProject()
    const parent = await createSimulationSession({
      projectId: project.id!,
      kind: 'npc-evolution',
      title: '父时间线',
      seed: 'parent',
    })
    await addCharacter(parent.id!)
    await appendSimulationEvent({
      sessionId: parent.id!,
      type: 'time.advanced',
      payload: { amount: 5 },
    })
    const checkpoint = await createSimulationCheckpoint({
      sessionId: parent.id!,
      name: '五日后',
    })
    expect(await verifySimulationCheckpoint(checkpoint.id!)).toBe(true)

    const child = await branchSimulationSession({
      parentSessionId: parent.id!,
      throughSequence: 1,
      title: '城门分支',
      seed: 'child',
    })
    expect(await readSimulationState(child.id!)).toMatchObject({
      clock: 0,
      lastSequence: 0,
      entities: { 'character:linzhou': { name: '林舟' } },
    })
    await appendSimulationEvent({
      sessionId: child.id!,
      type: 'narrative.recorded',
      payload: { text: '林舟转身离开城门。' },
    })
    expect((await readSimulationState(parent.id!)).narratives).toHaveLength(0)
    expect((await readSimulationState(child.id!)).narratives[0].text).toContain('离开')

    await db.simulationCheckpoints.update(checkpoint.id!, { stateJson: '{"tampered":true}' })
    expect(await verifySimulationCheckpoint(checkpoint.id!)).toBe(false)
    await deleteSimulationSession(parent.id!)
    expect(await db.simulationSessions.get(parent.id!)).toBeUndefined()
    expect(await db.simulationSessions.get(child.id!)).toMatchObject({
      parentSessionId: null,
      parentThroughSequence: null,
    })
    expect(await db.simulationEvents.where('sessionId').equals(child.id!).count()).toBe(1)
  })

  it('项目 JSON 往返重映射会话分支、事件、检查点和世界作用域', async () => {
    const { project, worldGroupId } = await seedProject(true)
    const parent = await createSimulationSession({
      projectId: project.id!,
      worldGroupId,
      kind: 'sandbox',
      title: '原战役',
      seed: 'portable',
    })
    await addCharacter(parent.id!)
    const child = await branchSimulationSession({
      parentSessionId: parent.id!,
      throughSequence: 1,
      title: '分支战役',
      seed: 'portable-child',
    })
    await resolveSimulationDice({ sessionId: child.id!, expression: '1d20+2' })
    await createSimulationCheckpoint({ sessionId: child.id!, name: '分支存档' })

    const exported = await exportProjectJSON(project.id!)
    const importedProjectId = await importProjectJSON(exported)
    const sessions = await db.simulationSessions
      .where('projectId').equals(importedProjectId).toArray()
    const importedParent = sessions.find(session => session.title === '原战役')!
    const importedChild = sessions.find(session => session.title === '分支战役')!
    expect(importedChild.parentSessionId).toBe(importedParent.id)
    expect(importedChild.worldGroupId).not.toBe(worldGroupId)
    expect(importedChild.worldGroupId).toBeTypeOf('number')
    expect(await db.simulationEvents.where('sessionId').equals(importedChild.id!).count()).toBe(1)
    expect(await db.simulationCheckpoints.where('sessionId').equals(importedChild.id!).count()).toBe(1)
    expect((await readSimulationState(importedChild.id!)).lastSequence).toBe(1)
  })

  it('删除世界组会清除该世界全部运行时表，不留下孤儿存档', async () => {
    const { project, worldGroupId } = await seedProject(true)
    const session = await createSimulationSession({
      projectId: project.id!,
      worldGroupId,
      kind: 'sandbox',
      title: '待删除世界',
      seed: 'world-delete',
    })
    await addCharacter(session.id!)
    await createSimulationCheckpoint({ sessionId: session.id!, name: '删除前' })

    await cascadeDeleteGroup(project.id!, worldGroupId!)
    expect(await db.simulationSessions.where('projectId').equals(project.id!).count()).toBe(0)
    expect(await db.simulationEvents.where('projectId').equals(project.id!).count()).toBe(0)
    expect(await db.simulationCheckpoints.where('projectId').equals(project.id!).count()).toBe(0)
  })
})

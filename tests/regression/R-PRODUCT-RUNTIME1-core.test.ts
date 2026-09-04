import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  branchProductRuntimeSession,
  createProductRuntimeCheckpoint,
  deleteProductRuntimeSession,
  readProductRuntimeState,
  verifyProductRuntimeCheckpoint,
} from '../../src/lib/product/runtime-api'
import { appendProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteGroup } from '../../src/lib/registry/lifecycle'
import {
  createCurrentTtrpgRuntimeTestBedV1,
} from '../helpers/current-product-runtime'

async function seedProject(multiWorld = false) {
  return createCurrentTtrpgRuntimeTestBedV1({
    title: 'Product Runtime 测试',
    seed: 'current-runtime-bed',
    withWorldGroup: multiWorld,
  })
}

async function addCharacter(sessionId: number) {
  return appendProductRuntimeEvent({
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

describe('PRODUCT-RUNTIME-1A · 上层产品运行时核心', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('冻结创作来源后只靠追加事件回放状态，不修改角色主档', async () => {
    const { project, session } = await seedProject()
    const before = (await db.characters.where('projectId').equals(project.id!).first())?.shortDescription
    await addCharacter(session.id!)
    await appendProductRuntimeEvent({
      sessionId: session.id!,
      type: 'time.advanced',
      payload: { amount: 3 },
    })
    await appendProductRuntimeEvent({
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

    const state = await readProductRuntimeState(session.id!)
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
      .toBe(before)
  })

  it('拒绝未知实体补丁、绕过产品命令与暂停会话写入', async () => {
    const { session } = await seedProject()
    await expect(appendProductRuntimeEvent({
      sessionId: session.id!,
      type: 'entity.patched',
      payload: { entityKey: 'character:missing', patch: { name: '幽灵' } },
    })).rejects.toThrow('不存在')
    await expect(appendProductRuntimeEvent({
      sessionId: session.id!,
      type: 'adventure.check.resolved',
      payload: { evidence: {} },
    })).rejects.toThrow('文字冒险')
    await db.productRuntimeSessions.update(session.id!, { status: 'paused' })
    await expect(appendProductRuntimeEvent({
      sessionId: session.id!,
      type: 'time.advanced',
      payload: { amount: 1 },
    })).rejects.toThrow('active')
    expect(await db.productRuntimeEvents.count()).toBe(0)
  })

  it('并发追加仍形成连续唯一序号，记忆自动绑定真实事件序号', async () => {
    const { session } = await seedProject()
    await Promise.all([
      appendProductRuntimeEvent({
        sessionId: session.id!,
        type: 'time.advanced',
        payload: { amount: 1 },
      }),
      appendProductRuntimeEvent({
        sessionId: session.id!,
        type: 'time.advanced',
        payload: { amount: 2 },
      }),
    ])
    await appendProductRuntimeEvent({
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
    const events = (await db.productRuntimeEvents.where('sessionId').equals(session.id!).toArray())
      .sort((a, b) => a.sequence - b.sequence)
    expect(events.map(event => event.sequence)).toEqual([1, 2, 3])
    const state = await readProductRuntimeState(session.id!)
    expect(state.clock).toBe(3)
    expect(state.memories[0].sourceEventSequence).toBe(3)
  })

  it('检查点可验真，分支冻结目标序号且父子后续互不影响', async () => {
    const { session: parent } = await seedProject()
    await addCharacter(parent.id!)
    await appendProductRuntimeEvent({
      sessionId: parent.id!,
      type: 'time.advanced',
      payload: { amount: 5 },
    })
    const checkpoint = await createProductRuntimeCheckpoint({
      sessionId: parent.id!,
      name: '五日后',
    })
    expect(await verifyProductRuntimeCheckpoint(checkpoint.id!)).toBe(true)

    const child = await branchProductRuntimeSession({
      parentSessionId: parent.id!,
      throughSequence: 1,
      title: '城门分支',
      seed: 'child',
    })
    expect(await readProductRuntimeState(child.id!)).toMatchObject({
      clock: 0,
      lastSequence: 0,
      entities: { 'character:linzhou': { name: '林舟' } },
    })
    await appendProductRuntimeEvent({
      sessionId: child.id!,
      type: 'narrative.recorded',
      payload: { text: '林舟转身离开城门。' },
    })
    expect((await readProductRuntimeState(parent.id!)).narratives).toHaveLength(0)
    expect((await readProductRuntimeState(child.id!)).narratives[0].text).toContain('离开')

    await db.productRuntimeCheckpoints.update(checkpoint.id!, { stateJson: '{"tampered":true}' })
    expect(await verifyProductRuntimeCheckpoint(checkpoint.id!)).toBe(false)
    await deleteProductRuntimeSession(parent.id!)
    expect(await db.productRuntimeSessions.get(parent.id!)).toBeUndefined()
    expect(await db.productRuntimeSessions.get(child.id!)).toMatchObject({
      parentSessionId: null,
      parentThroughSequence: null,
    })
    expect(await db.productRuntimeEvents.where('sessionId').equals(child.id!).count()).toBe(1)
  })

  it('项目 JSON 往返重映射会话分支、事件、检查点和世界作用域', async () => {
    const { project, worldGroupId, session: parent } = await seedProject(true)
    await db.productRuntimeSessions.update(parent.id!, { title: '原战役', seed: 'portable' })
    await addCharacter(parent.id!)
    const child = await branchProductRuntimeSession({
      parentSessionId: parent.id!,
      throughSequence: 1,
      title: '分支战役',
      seed: 'portable-child',
    })
    await appendProductRuntimeEvent({
      sessionId: child.id!,
      type: 'narrative.recorded',
      payload: { text: '分支战役已建立。' },
    })
    await createProductRuntimeCheckpoint({ sessionId: child.id!, name: '分支存档' })

    const exported = await exportProjectJSON(project.id!)
    const importedProjectId = await importProjectJSON(exported)
    const sessions = await db.productRuntimeSessions
      .where('projectId').equals(importedProjectId).toArray()
    const importedParent = sessions.find(session => session.title === '原战役')!
    const importedChild = sessions.find(session => session.title === '分支战役')!
    expect(importedChild.parentSessionId).toBe(importedParent.id)
    expect(importedChild.worldGroupId).not.toBe(worldGroupId)
    expect(importedChild.worldGroupId).toBeTypeOf('number')
    expect(await db.productRuntimeEvents.where('sessionId').equals(importedChild.id!).count()).toBe(1)
    expect(await db.productRuntimeCheckpoints.where('sessionId').equals(importedChild.id!).count()).toBe(1)
    expect((await readProductRuntimeState(importedChild.id!)).lastSequence).toBe(1)
  })

  it('删除世界组会清除该世界全部运行时表，不留下孤儿存档', async () => {
    const { project, worldGroupId, session } = await seedProject(true)
    await addCharacter(session.id!)
    await createProductRuntimeCheckpoint({ sessionId: session.id!, name: '删除前' })

    await cascadeDeleteGroup(project.id!, worldGroupId!)
    expect(await db.productRuntimeSessions.where('projectId').equals(project.id!).count()).toBe(0)
    expect(await db.productRuntimeEvents.where('projectId').equals(project.id!).count()).toBe(0)
    expect(await db.productRuntimeCheckpoints.where('projectId').equals(project.id!).count()).toBe(0)
  })
})

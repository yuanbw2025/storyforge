import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  createTextOpenWorldManualSaveV1,
  reconcileTextOpenWorldAutomaticSavesV1,
  type TextOpenWorldSaveOwnerV1,
} from '../../src/lib/open-world/player-saves'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function fixture(name: string) {
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `${name}-${crypto.randomUUID()}`,
    textOpenWorldVNext: createTextOpenWorldVNextFixture(),
    title: '自动存档旅程',
    seed: 'automatic-save-seed',
  })
  const owner: TextOpenWorldSaveOwnerV1 = { scope: created.scope, worldGroupId: null }
  return { ...created, owner }
}

async function travel(sessionId: number, direction: 'ridge' | 'port', commandId: string) {
  return executeTextOpenWorldActionV1({
    sessionId,
    actionKey: direction === 'ridge' ? 'action.travel-port-ridge' : 'action.travel-ridge-port',
    targetKey: direction === 'ridge' ? 'location.ridge-channel' : 'location.salt-port',
    commandId,
  })
}

describe('Text Open World G4-12B · 规范终态自动存档', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('只从规范终态补建，按Session+用途+序号并发幂等，并在崩溃缺档后恢复', async () => {
    const created = await fixture('自动存档幂等')
    const sessionId = created.session.id!
    await createTextOpenWorldManualSaveV1({ owner: created.owner, sessionId, name: '不参与轮转的手动档' })
    await travel(sessionId, 'ridge', 'command.autosave.travel.1')
    expect((await db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray())
      .filter(checkpoint => checkpoint.purpose === 'autosave')).toHaveLength(0)

    const concurrent = await Promise.all([
      reconcileTextOpenWorldAutomaticSavesV1({ owner: created.owner, sessionId, maximumAutomaticSaves: 2 }),
      reconcileTextOpenWorldAutomaticSavesV1({ owner: created.owner, sessionId, maximumAutomaticSaves: 2 }),
    ])
    expect(concurrent.reduce((sum, result) => sum + result.createdCount, 0)).toBe(1)
    let automatic = (await db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray())
      .filter(checkpoint => checkpoint.purpose === 'autosave')
    expect(automatic).toHaveLength(1)

    const repeated = await reconcileTextOpenWorldAutomaticSavesV1({
      owner: created.owner, sessionId, maximumAutomaticSaves: 2,
    })
    expect(repeated).toMatchObject({ createdCount: 0, retainedCount: 1, damagedCount: 0 })

    await db.productRuntimeCheckpoints.delete(automatic[0].id!)
    const recovered = await reconcileTextOpenWorldAutomaticSavesV1({
      owner: created.owner, sessionId, maximumAutomaticSaves: 2,
    })
    expect(recovered).toMatchObject({ createdCount: 1, retainedCount: 0, damagedCount: 0 })
    automatic = (await db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray())
      .filter(checkpoint => checkpoint.purpose === 'autosave')
    expect(automatic).toHaveLength(1)
  })

  it('每个Session有限轮转自动档，保留手动档，并从主线终态派生稳定里程碑', async () => {
    const created = await fixture('自动档轮转与里程碑')
    const sessionId = created.session.id!
    const manual = await createTextOpenWorldManualSaveV1({ owner: created.owner, sessionId, name: '长期保留' })
    await travel(sessionId, 'ridge', 'command.autosave.travel.1')
    await travel(sessionId, 'port', 'command.autosave.travel.2')
    await travel(sessionId, 'ridge', 'command.autosave.travel.3')
    await reconcileTextOpenWorldAutomaticSavesV1({ owner: created.owner, sessionId, maximumAutomaticSaves: 2 })

    let rows = await db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray()
    expect(rows.filter(checkpoint => checkpoint.purpose === 'autosave')).toHaveLength(2)
    expect(rows.some(checkpoint => checkpoint.id === manual.id)).toBe(true)

    await travel(sessionId, 'port', 'command.autosave.travel.4')
    const runtime = (await readProductRuntimeState(sessionId)).textOpenWorld!
    const mainline = Object.values(runtime.state.quests.instancesByKey)
      .find(instance => instance.definitionKey === 'quest.main.1')!
    await executeTextOpenWorldActionV1({
      sessionId,
      actionKey: 'action.accept-main',
      targetKey: mainline.instanceKey,
      commandId: 'command.milestone.accept',
    })
    await executeTextOpenWorldActionV1({
      sessionId,
      actionKey: 'action.complete-main-objective',
      targetKey: mainline.instanceKey,
      commandId: 'command.milestone.complete',
    })

    const first = await reconcileTextOpenWorldAutomaticSavesV1({
      owner: created.owner, sessionId, maximumAutomaticSaves: 3,
    })
    expect(first.createdCount).toBeGreaterThan(0)
    rows = await db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray()
    const milestones = rows.filter(checkpoint => checkpoint.purpose === 'milestone')
    expect(milestones).toHaveLength(1)
    expect(milestones[0].subjectKey).toMatch(/^quest:quest\.main\.1:stage:/)
    expect(rows.filter(checkpoint => checkpoint.purpose === 'autosave')).toHaveLength(2)
    expect(rows.filter(checkpoint => checkpoint.purpose === 'autosave' || checkpoint.purpose === 'milestone')).toHaveLength(3)
    expect(rows.some(checkpoint => checkpoint.id === manual.id)).toBe(true)

    const second = await reconcileTextOpenWorldAutomaticSavesV1({
      owner: created.owner, sessionId, maximumAutomaticSaves: 3,
    })
    expect(second.createdCount).toBe(0)
    expect((await db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray())
      .filter(checkpoint => checkpoint.purpose === 'milestone')).toHaveLength(1)
  }, 30_000)
})

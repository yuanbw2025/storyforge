import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldCheckpointV1 } from '../../src/lib/open-world/checkpoints'
import {
  TEXT_OPEN_WORLD_MANUAL_SAVE_LIMIT_V1,
  branchTextOpenWorldPlayerSaveV1,
  createTextOpenWorldManualSaveV1,
  deleteTextOpenWorldPlayerBranchV1,
  deleteTextOpenWorldPlayerCheckpointV1,
  projectTextOpenWorldPlayerSavesV1,
  repairTextOpenWorldPlayerCheckpointV1,
  repairTextOpenWorldPlayerRuntimeHeadV1,
  type TextOpenWorldSaveOwnerV1,
} from '../../src/lib/open-world/player-saves'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function fixture(name = '存档领域') {
  const runtimePackage = createTextOpenWorldVNextFixture()
  ;(runtimePackage.modules.combat.payload as any).encounters[0].locationKey = 'location.salt-port'
  ;(runtimePackage.modules.actions.payload as any).actions
    .find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = ['location.salt-port']
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `${name}-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    title: '盐脊旅程',
    seed: 'player-save-seed',
  })
  const owner: TextOpenWorldSaveOwnerV1 = { scope: created.scope, worldGroupId: null }
  return { ...created, owner }
}

describe('Text Open World G4-12B · 专属存档领域', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('以原子事务限制每个Session最多20个手动档，自动/战前/里程碑/系统档不占名额', async () => {
    const created = await fixture('手动档并发上限')
    const sessionId = created.session.id!
    const automatic = await createTextOpenWorldCheckpointV1({ sessionId, name: '自动点', purpose: 'autosave' })
    await createTextOpenWorldCheckpointV1({
      sessionId, name: '战前点', purpose: 'combat-retry', subjectKey: 'encounter.ridge-jackal',
    })
    await createTextOpenWorldCheckpointV1({
      sessionId, name: '里程碑', purpose: 'milestone', subjectKey: 'quest:quest.main.1:stage:quest-stage.main.1',
    })
    await createTextOpenWorldCheckpointV1({ sessionId, name: '系统点', purpose: 'system' })
    for (let index = 0; index < TEXT_OPEN_WORLD_MANUAL_SAVE_LIMIT_V1 - 1; index += 1) {
      await createTextOpenWorldManualSaveV1({ owner: created.owner, sessionId, name: `手动档 ${index + 1}` })
    }

    const concurrent = await Promise.allSettled([
      createTextOpenWorldManualSaveV1({ owner: created.owner, sessionId, name: '并发手动档 A' }),
      createTextOpenWorldManualSaveV1({ owner: created.owner, sessionId, name: '并发手动档 B' }),
    ])

    expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(concurrent.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(concurrent.find(result => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining('最多20个') }),
    })
    const checkpoints = await db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray()
    expect(checkpoints.filter(checkpoint => (checkpoint.purpose ?? 'manual') === 'manual')).toHaveLength(20)
    expect(checkpoints.filter(checkpoint => checkpoint.purpose !== 'manual')).toHaveLength(4)
    await expect(deleteTextOpenWorldPlayerCheckpointV1({
      owner: created.owner,
      checkpointId: automatic.id!,
    })).rejects.toThrow('只有玩家创建的手动存档可以删除')
  }, 30_000)

  it('只投影玩家已知的版本、地点、主线和分支摘要，不泄露内部ID、Hash或未揭示任务', async () => {
    const created = await fixture('披露安全列表')
    await createTextOpenWorldManualSaveV1({
      owner: created.owner,
      sessionId: created.session.id!,
      name: '渠边记录',
    })

    const projection = await projectTextOpenWorldPlayerSavesV1({
      owner: created.owner,
      currentSessionId: created.session.id,
    })

    expect(projection).toMatchObject({
      totalBranches: 1,
      totalCheckpoints: 1,
      groups: [{
        sourceKind: '正式发布',
        versionLabel: '版本 1',
        branchCount: 1,
        branches: [{
          title: '盐脊旅程',
          runtimeFormat: 'vnext',
          relationship: 'root',
          isCurrent: true,
          summary: {
            runtimeFormat: 'vnext',
            level: 1,
            locationLabel: '盐港广场',
            regionLabel: '盐港',
            mainlineLabel: expect.stringContaining('断流的盐渠'),
            worldTimeLabel: expect.stringContaining('第 1 天'),
          },
          manualSlots: { used: 1, limit: 20, remaining: 19 },
          checkpoints: [{
            actionIdentity: { sessionId: created.session.id, checkpointId: expect.any(Number) },
            name: '渠边记录', purpose: 'manual', health: 'available',
          }],
        }],
      }],
    })
    expect(projection.groups[0]?.branches[0]?.actionIdentity).toEqual({ sessionId: created.session.id })
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain(created.session.runtimeSourceHash)
    expect(serialized).not.toContain('location.salt-port')
    expect(serialized).not.toContain('quest.main.1')
    expect(serialized).not.toContain('短缺物资')
    expect(serialized).not.toContain('sourceManifest')
  })

  it('从历史档派生同Release子分支并保留父未来；删除分支不删除父分支或Release', async () => {
    const created = await fixture('分支与删除')
    const checkpoint = await createTextOpenWorldManualSaveV1({
      owner: created.owner,
      sessionId: created.session.id!,
      name: '分支起点',
    })
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.investigate-channel',
      targetKey: 'location.salt-port',
      commandId: 'command.parent.future',
    })
    const parentEventCount = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()

    const child = await branchTextOpenWorldPlayerSaveV1({
      owner: created.owner,
      checkpointId: checkpoint.id!,
      title: '另一条盐渠时间线',
      seed: 'child-save-seed',
    })

    expect(child).toMatchObject({
      parentSessionId: created.session.id,
      parentThroughSequence: checkpoint.throughSequence,
      productReleaseId: created.release.id,
      productBuildId: null,
      runtimeSourceHash: created.session.runtimeSourceHash,
    })
    expect(await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()).toBe(parentEventCount)
    expect(await db.productRuntimeEvents.where('sessionId').equals(child.id!).count()).toBe(0)
    const listed = await projectTextOpenWorldPlayerSavesV1({ owner: created.owner, currentSessionId: child.id })
    expect(listed.groups).toHaveLength(1)
    expect(listed.groups[0]?.branches).toHaveLength(2)
    expect(listed.groups[0]?.branches.find(branch => branch.isCurrent)).toMatchObject({
      title: '另一条盐渠时间线', relationship: 'child', parentTitle: '盐脊旅程', depth: 1,
    })

    const foreign = await fixture('错误Owner')
    await expect(deleteTextOpenWorldPlayerBranchV1({ owner: foreign.owner, sessionId: child.id! }))
      .rejects.toThrow('只能操作当前World/Work')
    await deleteTextOpenWorldPlayerBranchV1({ owner: created.owner, sessionId: child.id! })
    await expect(db.productRuntimeSessions.get(child.id!)).resolves.toBeUndefined()
    await expect(db.productRuntimeSessions.get(created.session.id!)).resolves.toBeDefined()
    await expect(db.productReleases.get(created.release.id!)).resolves.toBeDefined()
    expect(await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()).toBe(parentEventCount)
  })

  it('把可重放的损坏档标为可修复，repair/delete均执行scope owner守卫', async () => {
    const created = await fixture('诊断修复')
    const checkpoint = await createTextOpenWorldManualSaveV1({
      owner: created.owner,
      sessionId: created.session.id!,
      name: '待修复档',
    })
    await db.productRuntimeCheckpoints.update(checkpoint.id!, { stateHash: 'f'.repeat(64) })
    const before = await projectTextOpenWorldPlayerSavesV1({ owner: created.owner })
    expect(before.groups[0]?.branches[0]?.checkpoints[0]).toMatchObject({
      name: '待修复档', health: 'repairable', repairable: true,
    })

    const foreign = await fixture('修复错误Owner')
    await expect(repairTextOpenWorldPlayerCheckpointV1({ owner: foreign.owner, checkpointId: checkpoint.id! }))
      .rejects.toThrow('只能操作当前World/Work')
    await expect(repairTextOpenWorldPlayerCheckpointV1({ owner: created.owner, checkpointId: checkpoint.id! }))
      .resolves.toMatchObject({ health: 'available', repairable: false })

    await db.productRuntimeSessions.update(created.session.id!, { runtimeHeadStateHash: 'f'.repeat(64) })
    await expect(repairTextOpenWorldPlayerRuntimeHeadV1({ owner: foreign.owner, sessionId: created.session.id! }))
      .rejects.toThrow('只能操作当前World/Work')
    await expect(repairTextOpenWorldPlayerRuntimeHeadV1({ owner: created.owner, sessionId: created.session.id! }))
      .resolves.toEqual({ health: 'available', label: '运行状态可读取' })

    await expect(deleteTextOpenWorldPlayerCheckpointV1({ owner: foreign.owner, checkpointId: checkpoint.id! }))
      .rejects.toThrow('只能操作当前World/Work')
    await deleteTextOpenWorldPlayerCheckpointV1({ owner: created.owner, checkpointId: checkpoint.id! })
    await expect(db.productRuntimeCheckpoints.get(checkpoint.id!)).resolves.toBeUndefined()
  })

  it('不可重建的损坏摘要降级为damaged空摘要，不击穿整个存档列表', async () => {
    const created = await fixture('摘要损坏降级')
    const checkpoint = await createTextOpenWorldManualSaveV1({
      owner: created.owner,
      sessionId: created.session.id!,
      name: '地点摘要已损坏',
    })
    await db.productRuntimeCheckpoints.update(checkpoint.id!, { throughSequence: Number.MAX_SAFE_INTEGER })

    const projection = await projectTextOpenWorldPlayerSavesV1({ owner: created.owner })
    expect(projection.groups[0]?.branches[0]).toMatchObject({
      checkpoints: [{
        name: '地点摘要已损坏',
        health: 'damaged',
        repairable: false,
        summary: null,
      }],
    })
  })

  it('同owner但冻结来源跨Work或损坏的Session只显示诊断，不读取Release和状态正文', async () => {
    const owned = await fixture('来源隔离')
    const checkpoint = await createTextOpenWorldManualSaveV1({
      owner: owned.owner,
      sessionId: owned.session.id!,
      name: '来源损坏前的手动档',
    })
    const foreign = await fixture('跨Work秘密来源')
    await db.productReleases.update(foreign.release.id!, { label: '跨Work秘密版本标题' })
    const secretState = foreign.session.initialStateJson.replace('盐港广场', '跨Work秘密地点')
    await db.productRuntimeSessions.update(owned.session.id!, {
      productReleaseId: foreign.release.id,
      runtimeSourceHash: foreign.session.runtimeSourceHash,
      initialStateJson: secretState,
    })
    await db.productRuntimeCheckpoints.update(checkpoint.id!, { stateJson: secretState })

    const projection = await projectTextOpenWorldPlayerSavesV1({
      owner: owned.owner,
      currentSessionId: owned.session.id,
    })

    expect(projection.groups).toHaveLength(1)
    expect(projection.groups[0]).toMatchObject({
      title: '盐脊旅程',
      versionLabel: '版本待核验',
      sourceKind: '正式发布',
      branches: [{
        runtimeFormat: 'unknown',
        runtimeHealth: 'damaged',
        runtimeRepairable: false,
        summary: null,
        checkpoints: [{ health: 'damaged', repairable: false, summary: null }],
      }],
    })
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('跨Work秘密版本标题')
    expect(serialized).not.toContain('跨Work秘密地点')
  })
})

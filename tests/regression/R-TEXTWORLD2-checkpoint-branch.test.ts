import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  branchTextOpenWorldSessionFromCheckpointV1,
  createTextOpenWorldCheckpointV1,
  inspectTextOpenWorldCheckpointV1,
  inspectTextOpenWorldRuntimeHeadV1,
  repairTextOpenWorldRuntimeHeadV1,
} from '../../src/lib/open-world/checkpoints'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { commitTextOpenWorldOutcomeBatchV1 } from '../../src/lib/open-world/events'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { hashProductRuntimeStateV1, readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeState, ProductRuntimeSession, TextOpenWorldCommandEnvelopeV1, TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function createSession(runtimePackage: TextOpenWorldRuntimePackageV1): Promise<ProductRuntimeSession> {
  const now = Date.now(); const projectId = await db.projects.add({ name: 'TEXTWORLD 检查点测试', genre: 'open-world', genres: ['open-world'], status: 'drafting', description: '', targetWordCount: 1, createdAt: now, updatedAt: now } as any) as number
  const initial: ProductRuntimeState = { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: createInitialTextOpenWorldSessionProjectionV1(runtimePackage) }
  const initialStateJson = JSON.stringify(initial); const runtimeHeadStateHash = await hashProductRuntimeStateV1(initial)
  const session: ProductRuntimeSession = {
    projectId, worldGroupId: null, worldId: projectId, workId: projectId,
    productReleaseId: null, productBuildId: 1, runtimeSourceHash: runtimePackage.sourceManifest.contentHash,
    kind: 'text-open-world', title: '检查点Session', status: 'active', rulesetVersion: 1, seed: 'checkpoint-seed', canonSnapshotJson: '{}', initialStateJson,
    runtimeHeadSequence: 0, runtimeHeadStateJson: initialStateJson, runtimeHeadStateHash, parentSessionId: null, parentThroughSequence: null, createdAt: now, updatedAt: now,
  }
  session.id = await db.productRuntimeSessions.add(session) as number; return session
}

async function command(sessionId: number, commandId: string): Promise<TextOpenWorldCommandEnvelopeV1> {
  const base = await readProductRuntimeStateVersion(sessionId)
  return { schema: 'storyforge.text-open-world.command', version: 1, commandId, sessionId, actorKey: 'player', actionKey: 'action.investigate-channel', payload: { targetKey: 'location.salt-port' }, baseSequence: base.sequence, baseStateHash: base.stateHash, source: 'system-action', requestedAt: Date.now() }
}

async function playReward(runtimePackage: TextOpenWorldRuntimePackageV1, sessionId: number, commandId: string, claimKey: string) {
  const envelope = await command(sessionId, commandId); await commitTextOpenWorldCommandV1(envelope)
  const pending = (await readProductRuntimeState(sessionId)).textOpenWorld!; const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
  const plan = await catalog.plan({ effectKeys: ['effect.reward-currency'], claimKey, state: pending.state }); const { receipt } = await catalog.apply({ plan, state: pending.state })
  await commitTextOpenWorldOutcomeBatchV1({ sessionId, commandId, ruleset: { key: 'storyforge.standard', version: 1 }, randomRequests: [], plan, receipt })
}

describe('TEXTWORLD-2 · checkpoint, replay and child branch', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('从已验证历史检查点建立序号归零的子Session，不删除父分支未来事件', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture(); const parent = await createSession(runtimePackage)
    await playReward(runtimePackage, parent.id!, 'command.parent.1', 'claim.parent.1')
    const checkpoint = await createTextOpenWorldCheckpointV1({ sessionId: parent.id!, name: '第一次奖励后' })
    expect(await inspectTextOpenWorldCheckpointV1(checkpoint.id!)).toMatchObject({ valid: true, code: 'valid', throughSequence: 2 })
    await playReward(runtimePackage, parent.id!, 'command.parent.2', 'claim.parent.2')

    const child = await branchTextOpenWorldSessionFromCheckpointV1({ checkpointId: checkpoint.id!, title: '从第一次奖励分支', seed: 'child-seed' })
    const childState = await readProductRuntimeState(child.id!); const parentState = await readProductRuntimeState(parent.id!)
    expect(child).toMatchObject({ parentSessionId: parent.id, parentThroughSequence: 2 })
    expect(childState).toMatchObject({ lastSequence: 0, textOpenWorld: { lastEventSequence: 0, state: { inventory: { currency: 30 }, appliedClaimKeys: ['claim.parent.1'] }, protocol: { pendingCommandId: null, randomEvidence: [], lastCompletedCommandId: null } } })
    expect(parentState.textOpenWorld!.state.inventory.currency).toBe(40)
    expect(await db.productRuntimeEvents.where('sessionId').equals(parent.id!).count()).toBe(4)
    expect(await db.productRuntimeEvents.where('sessionId').equals(child.id!).count()).toBe(0)
    await expect(playReward(runtimePackage, child.id!, 'command.child.1', 'claim.child.1')).resolves.toBeUndefined()
  })

  it('不能在只有Command而没有Effect终态的位置创建检查点', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture(); const session = await createSession(runtimePackage)
    await commitTextOpenWorldCommandV1(await command(session.id!, 'command.pending'))
    await expect(createTextOpenWorldCheckpointV1({ sessionId: session.id!, name: '非法中间点' })).rejects.toThrow('不能在未终结命令上创建检查点')
    expect(await db.productRuntimeCheckpoints.where('sessionId').equals(session.id!).count()).toBe(0)
  })

  it('检查点诊断区分正文损坏、Hash不匹配和重放不一致', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture(); const session = await createSession(runtimePackage)
    await playReward(runtimePackage, session.id!, 'command.checkpoint', 'claim.checkpoint')
    const checkpoint = await createTextOpenWorldCheckpointV1({ sessionId: session.id!, name: '诊断点' })
    await db.productRuntimeCheckpoints.update(checkpoint.id!, { stateHash: 'f'.repeat(64) })
    expect(await inspectTextOpenWorldCheckpointV1(checkpoint.id!)).toMatchObject({ code: 'checkpoint-hash-mismatch', valid: false })
    const divergent = JSON.parse(checkpoint.stateJson); divergent.textOpenWorld.state.inventory.currency = 999; const divergentJson = JSON.stringify(divergent)
    await db.productRuntimeCheckpoints.update(checkpoint.id!, { stateJson: divergentJson, stateHash: await hashProductRuntimeStateV1(divergent) })
    expect(await inspectTextOpenWorldCheckpointV1(checkpoint.id!)).toMatchObject({ code: 'replay-mismatch', valid: false })
    await db.productRuntimeCheckpoints.update(checkpoint.id!, { stateJson: '{broken', stateHash: checkpoint.stateHash })
    expect(await inspectTextOpenWorldCheckpointV1(checkpoint.id!)).toMatchObject({ code: 'checkpoint-state-invalid', valid: false })
  })

  it('runtime head损坏可诊断并从规范事件安全修复', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture(); const session = await createSession(runtimePackage)
    await playReward(runtimePackage, session.id!, 'command.head', 'claim.head')
    expect(await inspectTextOpenWorldRuntimeHeadV1(session.id!)).toMatchObject({ code: 'valid', repairable: false, latestSequence: 2 })
    await db.productRuntimeSessions.update(session.id!, { runtimeHeadStateHash: 'f'.repeat(64) })
    expect(await inspectTextOpenWorldRuntimeHeadV1(session.id!)).toMatchObject({ code: 'cache-hash-mismatch', repairable: true })
    expect(await repairTextOpenWorldRuntimeHeadV1(session.id!)).toMatchObject({ code: 'valid', repairable: false, latestSequence: 2 })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld!.state.inventory.currency).toBe(30)
  })
})

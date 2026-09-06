import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  branchTextOpenWorldSessionFromCheckpointV1,
  createTextOpenWorldCheckpointV1,
  inspectTextOpenWorldRuntimeHeadV1,
  repairTextOpenWorldRuntimeHeadV1,
} from '../../src/lib/open-world/checkpoints'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { commitTextOpenWorldOutcomeBatchV1 } from '../../src/lib/open-world/events'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function fixture() {
  const textOpenWorldVNext = createTextOpenWorldVNextFixture()
  const actions = textOpenWorldVNext.modules.actions.payload as any
  const combat = textOpenWorldVNext.modules.combat.payload as any
  actions.actions[0].successEffectKeys = ['effect.reward-currency', 'effect.investigate-time']
  actions.actions.find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = ['location.salt-port']
  combat.encounters[0].locationKey = 'location.salt-port'
  combat.enemies[0].maximumHealth = 1
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 无AI端到端验收-${crypto.randomUUID()}`,
    textOpenWorldVNext,
    title: '盐脊纵切面',
    seed: 'end-to-end-seed',
  })
  return { ...created, textOpenWorldVNext }
}

describe('Text Open World vNext · no-AI minimum package end-to-end', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('发布、启动、行动、保存、刷新重放和检查点分支使用同一正式事件链', async () => {
    const created = await fixture()
    const session = created.session
    const feedback = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.investigate-channel', targetKey: 'location.salt-port',
      commandId: 'command.end-to-end.1', requestedAt: 1_000,
    })
    expect(feedback).toMatchObject({ status: 'succeeded', outcomeCommitted: true, gameplayStateChanged: true, evidenceEventSequences: [3, 4] })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld?.state.inventory.currency).toBe(30)
    const equipped = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.equip-rust-sword', targetKey: 'item.rust-sword',
      commandId: 'command.end-to-end.equip', requestedAt: 1_100,
    })
    expect(equipped).toMatchObject({ status: 'succeeded', outcomeCommitted: true, gameplayStateChanged: true, evidenceEventSequences: [5, 6] })
    const equippedProjection = (await readProductRuntimeState(session.id!)).textOpenWorld!
    expect(equippedProjection.state.inventory.equippedItemInstanceIdBySlot.weapon).toBe('instance.initial.1.item.rust-sword')
    expect(deriveTextOpenWorldContextsV1(equippedProjection).playerStats.attack).toBe(8)
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(6)

    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal',
      commandId: 'command.end-to-end.combat-start', requestedAt: 1_200,
    })
    const rewardFeedback = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.1',
      commandId: 'command.end-to-end.combat-attack', requestedAt: 1_300,
    })
    expect(rewardFeedback).toMatchObject({ status: 'succeeded', outcomeCommitted: true })
    const rewarded = (await readProductRuntimeState(session.id!)).textOpenWorld!
    expect(rewarded.state.player).toMatchObject({ level: 2, experience: 100 })
    expect(rewarded.state.combat).toMatchObject({ status: 'victory', phase: 'terminal' })
    expect(rewarded.state.inventory.stackQuantities['item.salt-crystal']).toBeGreaterThanOrEqual(1)
    const rewardedEventCount = await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()
    await expect(executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.combat-basic-attack', targetKey: 'enemy.1.1',
      commandId: 'command.end-to-end.combat-attack', requestedAt: 9_999,
    })).resolves.toMatchObject({ receiptHash: rewardFeedback.receiptHash })
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(rewardedEventCount)

    const retry = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.investigate-channel', targetKey: 'location.salt-port',
      commandId: 'command.end-to-end.1', requestedAt: 9_999,
    })
    expect(retry.receiptHash).toBe(feedback.receiptHash)
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(rewardedEventCount)

    const checkpoint = await createTextOpenWorldCheckpointV1({ sessionId: session.id!, name: '调查完成' })
    await db.productRuntimeSessions.update(session.id!, { runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null })
    await expect(inspectTextOpenWorldRuntimeHeadV1(session.id!)).resolves.toMatchObject({ code: 'cache-missing', repairable: true })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld?.state.inventory.currency).toBe(30)
    await expect(repairTextOpenWorldRuntimeHeadV1(session.id!)).resolves.toMatchObject({ code: 'valid' })

    const parentEventCount = await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()
    const branch = await branchTextOpenWorldSessionFromCheckpointV1({ checkpointId: checkpoint.id!, title: '盐脊分支', seed: 'branch-seed' })
    const branchState = await readProductRuntimeState(branch.id!)
    expect(branch).toMatchObject({
      parentSessionId: session.id,
      productReleaseId: created.release.id,
      runtimeSourceHash: created.manifest.packageHash,
    })
    expect(branchState).toMatchObject({ lastSequence: 0, textOpenWorld: { lastEventSequence: 0, state: { inventory: { currency: 30 } } } })
    await executeTextOpenWorldActionV1({
      sessionId: branch.id!, actionKey: 'action.investigate-channel', targetKey: 'location.salt-port',
      commandId: 'command.end-to-end.branch.1', requestedAt: 2_000,
    })
    expect((await readProductRuntimeState(branch.id!)).textOpenWorld?.state.inventory.currency).toBe(40)
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(parentEventCount)
    expect(await db.agentRuns.where('projectId').equals(created.scope.projectId).count()).toBe(0)

    const unauthorizedBase = await readProductRuntimeStateVersion(session.id!)
    await commitTextOpenWorldCommandV1({
      schema: 'storyforge.text-open-world.command', version: 1, commandId: 'command.end-to-end.unauthorized-drop', sessionId: session.id!,
      actorKey: 'player', actionKey: 'action.investigate-channel', payload: { targetKey: 'location.salt-port' },
      baseSequence: unauthorizedBase.sequence, baseStateHash: unauthorizedBase.stateHash, source: 'system-action', requestedAt: 3_000,
    })
    const current = (await readProductRuntimeState(session.id!)).textOpenWorld!
    const effectCatalog = createTextOpenWorldEffectCatalogV1(created.textOpenWorldVNext)
    const unauthorizedPlan = await effectCatalog.plan({ effectKeys: ['effect.drop-salt-1'], claimKey: 'claim.unauthorized-drop', state: current.state })
    const unauthorizedReceipt = (await effectCatalog.apply({ plan: unauthorizedPlan, state: current.state })).receipt
    await expect(commitTextOpenWorldOutcomeBatchV1({
      sessionId: session.id!, commandId: 'command.end-to-end.unauthorized-drop', ruleset: current.ruleset,
      randomRequests: [], plan: unauthorizedPlan, receipt: unauthorizedReceipt, outcome: 'success', reason: null, degradation: null,
    })).rejects.toThrow('EffectPlan与命令Action不一致')
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(parentEventCount + 1)
  }, 30_000)
})

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1, recoverTextOpenWorldPendingCommandV1 } from '../../src/lib/open-world/action-executor'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { projectTextOpenWorldPlayerCraftingEconomyReceiptV1 } from '../../src/lib/open-world/player-crafting-economy'
import { hashProductRuntimeStateV1, readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createActionEvidenceV19Fixture } from '../helpers/text-open-world-action-evidence-fixture'

async function suppliedSession() {
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `Craft proof replay ${crypto.randomUUID()}`, textOpenWorldVNext: createActionEvidenceV19Fixture(),
    runtimeShape: 'vnext-only', title: 'Craft proof replay', seed: 'craft-proof-replay',
  })
  const sessionId = created.session.id!
  await executeTextOpenWorldActionV1({
    sessionId, actionKey: 'action.buy-caretaker', targetKey: 'vendor.caretaker',
    itemKey: 'item.salt-crystal', quantity: 2, commandId: 'command.proof.buy', requestedAt: 1,
  })
  return created
}

function commandEvents(events: ProductRuntimeEvent[], commandId: string) {
  return events.filter(event => event.commandId === commandId
    || (event.type === 'text-open-world.effects.applied' && JSON.parse(event.payloadJson).commandId === commandId))
}

describe('Crafting v19 command, proof and recovery', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('persists materials, output, time and proof together, replays them and does not repeat the command', async () => {
    const created = await suppliedSession()
    const sessionId = created.session.id!
    const before = await readProductRuntimeState(sessionId)
    const input = {
      sessionId, actionKey: 'action.craft-brine-tonic', targetKey: 'recipe.brine-tonic',
      quantity: 1, commandId: 'command.proof.craft', requestedAt: 2,
    }
    const rawReceipt = await executeTextOpenWorldActionV1(input)
    expect(rawReceipt).toMatchObject({
      phase: 'terminal', status: 'succeeded', outcomeCommitted: true,
    })
    const receiptInput = {
      projection: before.textOpenWorld!, runtimeEventSequence: before.lastSequence,
      request: { kind: 'craft' as const, sessionId, actionKey: input.actionKey,
        targetKey: input.targetKey, quantity: input.quantity, expectedBaseSequence: before.lastSequence },
      receipt: rawReceipt,
    }
    const publicReceipt = projectTextOpenWorldPlayerCraftingEconomyReceiptV1(receiptInput)
    expect(publicReceipt).toMatchObject({
      status: 'succeeded', outcomeCommitted: true,
      message: '已制作盐露药剂 × 1。',
      details: ['消耗 盐晶 × 2', '获得 盐露药剂 × 1', '耗时 15 分钟'],
    })
    expect(JSON.stringify(publicReceipt)).not.toContain('flag.fulfillment.recipe')
    for (const mutation of ['missing', 'extra', 'reversed', 'key', 'operation', 'domain', 'summary', 'before', 'after', 'materials']) {
      const receipt = structuredClone(rawReceipt)
      if (mutation === 'missing') receipt.changes.pop()
      if (mutation === 'extra') receipt.changes.push(structuredClone(receipt.changes[1]))
      if (mutation === 'reversed') receipt.changes.reverse()
      if (mutation === 'key') receipt.changes[1].effectKey += '.wrong'
      if (mutation === 'operation') receipt.changes[1].operation = 'advance-time'
      if (mutation === 'domain') receipt.changes[1].domain = 'inventory'
      if (mutation === 'summary') receipt.changes[1].summary += '.wrong'
      if (mutation === 'before') receipt.changes[1].before = true
      if (mutation === 'after') receipt.changes[1].after = false
      if (mutation === 'materials') receipt.changes[0].before = { forged: true }
      expect(() => projectTextOpenWorldPlayerCraftingEconomyReceiptV1({ ...receiptInput, receipt }), mutation)
        .toThrow('制作回执')
    }
    const after = await readProductRuntimeState(sessionId)
    expect(after.textOpenWorld!.state.inventory.stackQuantities['item.salt-crystal'] ?? 0).toBe(0)
    expect(after.textOpenWorld!.state.inventory.stackQuantities['item.brine-tonic']).toBe(1)
    expect(after.textOpenWorld!.state.time.worldMinute).toBe(before.textOpenWorld!.state.time.worldMinute + 15)
    expect(after.textOpenWorld!.state.world.flags['flag.fulfillment.recipe.recipe.brine-tonic']).toBe(true)
    expect(after.textOpenWorld!.protocol.pendingCommandId).toBeNull()
    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    const own = commandEvents(events, input.commandId)
    expect(own.filter(event => event.type === 'text-open-world.command.committed')).toHaveLength(1)
    expect(own.filter(event => event.type === 'text-open-world.effects.applied')).toHaveLength(1)
    expect(replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), events).textOpenWorld)
      .toEqual(after.textOpenWorld)
    await executeTextOpenWorldActionV1(input)
    expect(await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()).toBe(events.length)
    await db.productRuntimeSessions.update(sessionId, {
      runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null,
    })
    expect((await readProductRuntimeState(sessionId)).textOpenWorld).toEqual(after.textOpenWorld)

    for (const mutation of ['missing-proof', 'extra-effect', 'reversed-effects', 'different-quantity']) {
      const tampered = structuredClone(events)
      const event = tampered.find(candidate => candidate.type === 'text-open-world.effects.applied'
        && JSON.parse(candidate.payloadJson).commandId === input.commandId)!
      const payload = JSON.parse(event.payloadJson)
      if (mutation === 'missing-proof') payload.plan.effectKeys.pop()
      if (mutation === 'extra-effect') payload.plan.effectKeys.push('effect.reward-currency')
      if (mutation === 'reversed-effects') payload.plan.effectKeys.reverse()
      if (mutation === 'different-quantity') payload.plan.authorization.quantity = 2
      event.payloadJson = JSON.stringify(payload)
      expect(() => replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), tampered)).toThrow()
    }
  }, 60_000)

  it('recovers the persisted unfinished crafting command once and retains its original identity', async () => {
    const created = await suppliedSession()
    const sessionId = created.session.id!
    const before = await readProductRuntimeState(sessionId)
    const commandId = 'command.proof.pending-craft'
    await commitTextOpenWorldCommandV1({
      schema: 'storyforge.text-open-world.command', version: 1, commandId, sessionId,
      actorKey: 'player', actionKey: 'action.craft-brine-tonic',
      payload: { targetKey: 'recipe.brine-tonic', quantity: 1 },
      baseSequence: before.lastSequence, baseStateHash: await hashProductRuntimeStateV1(before),
      source: 'system-action', requestedAt: 2,
    })
    const pending = await readProductRuntimeState(sessionId)
    expect(pending.textOpenWorld!.state.inventory).toEqual(before.textOpenWorld!.state.inventory)
    expect(pending.textOpenWorld!.state.world.flags['flag.fulfillment.recipe.recipe.brine-tonic']).not.toBe(true)
    expect(pending.textOpenWorld!.protocol.pendingCommandId).toBe(commandId)
    expect(await recoverTextOpenWorldPendingCommandV1(sessionId)).toMatchObject({
      commandId, phase: 'terminal', status: 'succeeded', outcomeCommitted: true,
    })
    const settled = await readProductRuntimeState(sessionId)
    // Recovery also completes the Director follow-up, so the last system
    // command may differ; the original craft identity is checked above and below.
    expect(settled.textOpenWorld!.protocol.pendingCommandId).toBeNull()
    expect(settled.textOpenWorld!.state.inventory.stackQuantities['item.brine-tonic']).toBe(1)
    expect(settled.textOpenWorld!.state.inventory.stackQuantities['item.salt-crystal'] ?? 0).toBe(0)
    expect(settled.textOpenWorld!.state.time.worldMinute).toBe(before.textOpenWorld!.state.time.worldMinute + 15)
    expect(settled.textOpenWorld!.state.world.flags['flag.fulfillment.recipe.recipe.brine-tonic']).toBe(true)
    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    const own = commandEvents(events, commandId)
    expect(own.filter(event => event.type === 'text-open-world.command.committed')).toHaveLength(1)
    expect(own.filter(event => event.type === 'text-open-world.effects.applied')).toHaveLength(1)
    await recoverTextOpenWorldPendingCommandV1(sessionId)
    expect(await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()).toBe(events.length)
    expect(replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), events).textOpenWorld)
      .toEqual(settled.textOpenWorld)
  }, 60_000)
})

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import {
  parseTextOpenWorldRandomResolvedEventPayloadV1,
  replayTextOpenWorldEventProtocolV1,
  resolveTextOpenWorldRandomEvidenceV1,
} from '../../src/lib/open-world/event-contract'
import { commitTextOpenWorldOutcomeBatchV1 } from '../../src/lib/open-world/events'
import {
  appendProductRuntimeEvent,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from '../../src/lib/product/runtime-core'
import type {
  ProductRuntimeEvent,
  TextOpenWorldCommandEnvelopeV1,
} from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

const RULESET = { key: 'storyforge.standard', version: 1 } as const

async function createSession() {
  return (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXTWORLD vNext事件测试-${crypto.randomUUID()}`,
    textOpenWorldVNext: createTextOpenWorldVNextFixture(),
    title: '事件协议Session', seed: 'event-protocol-seed',
  })).session
}

async function command(sessionId: number, commandId = 'command.event.1'): Promise<TextOpenWorldCommandEnvelopeV1> {
  const base = await readProductRuntimeStateVersion(sessionId)
  return {
    schema: 'storyforge.text-open-world.command', version: 1, commandId, sessionId,
    actorKey: 'player', actionKey: 'action.investigate-channel', payload: { targetKey: 'location.salt-port' },
    baseSequence: base.sequence, baseStateHash: base.stateHash, source: 'system-action', requestedAt: Date.now(),
  }
}

async function outcome(sessionId: number, claimKey = 'claim.event.1') {
  const projection = (await readProductRuntimeState(sessionId)).textOpenWorld!
  const catalog = createTextOpenWorldEffectCatalogV1(projection.runtimePackage)
  const before = projection.state
  const plan = await catalog.plan({ effectKeys: ['effect.reward-currency'], claimKey, state: before })
  const { receipt } = await catalog.apply({ plan, state: before })
  return { plan, receipt }
}

describe('TEXTWORLD-2 · vNext Simulation Event protocol', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('原子追加命令随机证据和Effect终态，并可从seed完整重放', async () => {
    const session = await createSession(); const envelope = await command(session.id!); await commitTextOpenWorldCommandV1(envelope)
    const result = await outcome(session.id!)
    const receipt = await commitTextOpenWorldOutcomeBatchV1({
      sessionId: session.id!, commandId: envelope.commandId, ruleset: RULESET,
      randomRequests: [
        { drawKey: 'draw.encounter', minimumInclusive: 1, maximumInclusive: 6 },
        { drawKey: 'draw.loot', minimumInclusive: 0, maximumInclusive: 99 },
      ], ...result,
    })
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events.map(event => event.type)).toEqual(['narrative.started', 'narrative.node.entered', 'textworld.command.committed', 'textworld.random.resolved', 'textworld.random.resolved', 'textworld.effects.applied'])
    expect(receipt).toMatchObject({ status: 'committed', commandSequence: 3, randomEventSequences: [4, 5], effectsEventSequence: 6, resultingSequence: 6, replayed: false })
    expect(await readProductRuntimeStateVersion(session.id!)).toMatchObject({ sequence: 6 })

    const projection = await replayTextOpenWorldEventProtocolV1(events, session.seed)
    expect(projection).toMatchObject({ lastSequence: 6, pendingCommandId: null, batches: [{ commandId: envelope.commandId, commandSequence: 3, randomEventSequences: [4, 5], effectsEventSequence: 6 }] })
    const random = parseTextOpenWorldRandomResolvedEventPayloadV1(JSON.parse(events[3].payloadJson))
    expect(random.evidence).toEqual(await resolveTextOpenWorldRandomEvidenceV1({
      seed: session.seed, commandId: envelope.commandId, commandSequence: 3, drawIndex: 0,
      request: { drawKey: 'draw.encounter', minimumInclusive: 1, maximumInclusive: 6 },
    }))
  })

  it('同一结果批次重试返回原事件，不同内容不能复用commandId', async () => {
    const session = await createSession(); const envelope = await command(session.id!); await commitTextOpenWorldCommandV1(envelope)
    const result = await outcome(session.id!)
    const input = { sessionId: session.id!, commandId: envelope.commandId, ruleset: RULESET, randomRequests: [{ drawKey: 'draw.encounter', minimumInclusive: 1, maximumInclusive: 6 }], ...result }
    const first = await commitTextOpenWorldOutcomeBatchV1(input)
    const retry = await commitTextOpenWorldOutcomeBatchV1(input)
    expect(retry).toMatchObject({ replayed: true, effectsEventId: first.effectsEventId, randomEventIds: first.randomEventIds })
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(5)
    await expect(commitTextOpenWorldOutcomeBatchV1({ ...input, randomRequests: [{ drawKey: 'draw.changed', minimumInclusive: 1, maximumInclusive: 6 }] }))
      .rejects.toThrow('结果批次内容不同')
  })

  it('上一命令必须先写入Effect终态，之后才能接收下一命令', async () => {
    const session = await createSession(); const first = await command(session.id!); await commitTextOpenWorldCommandV1(first)
    await expect(commitTextOpenWorldCommandV1(await command(session.id!, 'command.event.2')))
      .rejects.toThrow('上一命令尚未生成结果批次')
    await commitTextOpenWorldOutcomeBatchV1({ sessionId: session.id!, commandId: first.commandId, ruleset: RULESET, randomRequests: [], ...await outcome(session.id!) })
    await expect(commitTextOpenWorldCommandV1(await command(session.id!, 'command.event.2'))).resolves.toMatchObject({ eventSequence: 5 })
  })

  it('篡改随机证据、打乱序号或伪造规则版本都会被重放拒绝', async () => {
    const session = await createSession(); const envelope = await command(session.id!); await commitTextOpenWorldCommandV1(envelope)
    await commitTextOpenWorldOutcomeBatchV1({
      sessionId: session.id!, commandId: envelope.commandId, ruleset: RULESET,
      randomRequests: [{ drawKey: 'draw.encounter', minimumInclusive: 1, maximumInclusive: 6 }], ...await outcome(session.id!),
    })
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    await expect(replayTextOpenWorldEventProtocolV1([events[1], events[0], events[2]], session.seed)).rejects.toThrow('事件序号不连续')
    const tampered = structuredClone(events) as ProductRuntimeEvent[]
    const payload = JSON.parse(tampered[3].payloadJson); payload.evidence.value = payload.evidence.value === 1 ? 2 : 1; tampered[3].payloadJson = JSON.stringify(payload)
    await expect(replayTextOpenWorldEventProtocolV1(tampered, session.seed)).rejects.toThrow('随机证据无法由Session seed重放')
    await expect(commitTextOpenWorldOutcomeBatchV1({ sessionId: session.id!, commandId: envelope.commandId, ruleset: { ...RULESET, version: 2 }, randomRequests: [], ...await outcome(session.id!, 'claim.event.changed') }))
      .rejects.toThrow('结果批次内容不同')
  })

  it('无效Effect回执不会留下半批次，治理事件也不能绕过专用入口', async () => {
    const session = await createSession(); const envelope = await command(session.id!); await commitTextOpenWorldCommandV1(envelope)
    const result = await outcome(session.id!); const invalidReceipt = { ...result.receipt, resultingStateHash: 'f'.repeat(64) }
    await expect(commitTextOpenWorldOutcomeBatchV1({ sessionId: session.id!, commandId: envelope.commandId, ruleset: RULESET, randomRequests: [{ drawKey: 'draw.encounter', minimumInclusive: 1, maximumInclusive: 6 }], plan: result.plan, receipt: invalidReceipt }))
      .rejects.toThrow('plan与receipt不一致')
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(3)
    await expect(appendProductRuntimeEvent({ sessionId: session.id!, type: 'textworld.effects.applied', payload: {} }))
      .rejects.toThrow('vNext事件只能通过对应的专用命令API')
  })
})

import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {EMPTY_PRODUCT_RUNTIME_STATE, type ProductRuntimeEvent} from '../../src/lib/types'
import * as core from '../../src/lib/product/runtime-core'
import * as api from '../../src/lib/character-interaction/runtime-api'
import {createChatRuntimeReplayV1, readChatRuntimeStateAtSequenceV1} from '../../src/lib/character-interaction/runtime-replay'
import {seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const initial = JSON.stringify(EMPTY_PRODUCT_RUNTIME_STATE)
const event = (sequence: number, amount = 1): ProductRuntimeEvent => ({projectId: 1, worldGroupId: null, sessionId: 1,
  sequence, type: 'time.advanced', actorKey: null, targetKey: null, payloadJson: JSON.stringify({amount}), createdAt: sequence})

it('reuses an exact prefix, reduces only new events and returns isolated states equal to full replay', () => {
  const cached = createChatRuntimeReplayV1(), events = [event(1), event(2), event(3)]
  const full = core.replayProductRuntimeEvents, spy = vi.spyOn(core, 'replayProductRuntimeEvents')
  const first = cached(initial, events); first.clock = 999
  expect(cached(initial, structuredClone(events))).toEqual(full(core.parseProductRuntimeState(initial), events))
  expect(spy).toHaveBeenCalledTimes(1)
  events.push(event(4, 5))
  expect(cached(initial, events)).toEqual(full(core.parseProductRuntimeState(initial), events))
  expect(spy.mock.calls[1][1]).toEqual([events[3]])
  expect(cached(initial, events, 2)).toEqual(full(core.parseProductRuntimeState(initial), events, 2))
  expect(spy.mock.calls[2][1]).toEqual(events.slice(0, 2))
})
it('invalidates on earlier payload, metadata and initial-state changes despite identical event IDs and sequence', () => {
  const cached = createChatRuntimeReplayV1(), events = [event(1), event(2)]
  const spy = vi.spyOn(core, 'replayProductRuntimeEvents')
  expect(cached(initial, events).clock).toBe(2)
  events[0].payloadJson = JSON.stringify({amount: 8})
  expect(cached(initial, events).clock).toBe(9)
  events[0].projectId = 2
  expect(cached(initial, events).clock).toBe(9)
  const changedInitial = JSON.stringify({...EMPTY_PRODUCT_RUNTIME_STATE, clock: 4})
  expect(cached(changedInitial, events).clock).toBe(13)
  expect(spy.mock.calls.map(call => call[1].length)).toEqual([2, 2, 2, 2])
})
it('keeps validation and the last proven prefix after a malformed suffix, duplicate or malformed initial state', () => {
  const cached = createChatRuntimeReplayV1(), events = [event(1), event(2)]
  const expected = cached(initial, events)
  expect(() => cached(initial, [...events, event(4)])).toThrow('序号不连续')
  expect(() => cached(initial, [...events, event(2)])).toThrow('序号不连续')
  expect(() => cached('{broken', events)).toThrow()
  expect(cached(initial, events)).toEqual(expected)
  expect(cached(initial, [event(3), ...events]).clock).toBe(3)
})
it('bypasses retention above its byte bound without changing the result or skipping event validation', () => {
  const cached = createChatRuntimeReplayV1(1), events = [event(1), event(2)]
  const spy = vi.spyOn(core, 'replayProductRuntimeEvents')
  expect(cached(initial, events).clock).toBe(2)
  expect(cached(initial, events).clock).toBe(2)
  expect(spy).toHaveBeenCalledTimes(2)
  expect(() => cached(initial, [...events, event(4)])).toThrow('序号不连续')
})
async function send(sessionId: number, text: string) {
  const v = await api.readProductRuntimeStateVersion(sessionId)
  return api.commitInteractionPlayerMessage({sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence,
    baseStateHash: v.stateHash, messageId: crypto.randomUUID(), text})
}
it('reads the original producer prefix across later events, reopen and a same-sequence canonical edit', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), first = await send(f.sessionId, '先核对原登记。')
  const original = await readChatRuntimeStateAtSequenceV1(f.sessionId, first.sequence)
  await send(f.sessionId, '下一件事。')
  db.close(); await db.open()
  expect(await readChatRuntimeStateAtSequenceV1(f.sessionId, first.sequence)).toEqual(original)
  const payload = JSON.parse(first.payloadJson); payload.text = '原登记已被外部修改。'
  await db.productRuntimeEvents.update(first.id!, {payloadJson: JSON.stringify(payload)})
  const altered = await readChatRuntimeStateAtSequenceV1(f.sessionId, first.sequence)
  expect(altered).toEqual(await api.readProductRuntimeState(f.sessionId, first.sequence))
  expect(altered).not.toEqual(original)
  expect(altered.interaction!.messages.slice(-1)[0].text).toBe(payload.text)
})
it('checks complete event scope even when the corrupted event lies after the requested historical prefix', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), first = await send(f.sessionId, '原来的话。')
  await readChatRuntimeStateAtSequenceV1(f.sessionId, first.sequence)
  const later = await send(f.sessionId, '后来的话。')
  await db.productRuntimeEvents.update(later.id!, {projectId: f.scope.projectId + 1})
  await expect(readChatRuntimeStateAtSequenceV1(f.sessionId, first.sequence)).rejects.toThrow('作用域与会话不一致')
})

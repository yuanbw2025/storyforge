import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as core from '../../src/lib/product/runtime-core'
import * as api from '../../src/lib/character-interaction/runtime-api'
import {seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function command(sessionId: number, id = crypto.randomUUID()) {
  const v = await api.readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: id, baseSequence: v.sequence, baseStateHash: v.stateHash}
}
it('commits a recoverable chat head with the event, keeps replay equality and preserves idempotence after reopen', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), input = {...await command(f.sessionId), messageId: 'head-message', text: '先核对登记。'}
  const event = await api.commitInteractionPlayerMessage(input)
  const session = (await db.productRuntimeSessions.get(f.sessionId))!, head = await core.readVerifiedProductRuntimeHeadV1(session)
  expect(head.fromCache).toBe(true); expect(head.sequence).toBe(event.sequence)
  expect(head.state).toEqual(await api.readProductRuntimeState(f.sessionId, event.sequence))
  db.close(); await db.open()
  expect(await api.commitInteractionPlayerMessage(input)).toEqual(event)
  expect(await db.productRuntimeSessions.get(f.sessionId)).toEqual(session)
  await db.productRuntimeSessions.update(f.sessionId, {runtimeHeadStateHash: '0'.repeat(64)})
  const damaged = await core.readVerifiedProductRuntimeHeadV1((await db.productRuntimeSessions.get(f.sessionId))!)
  expect(damaged.fromCache).toBe(false); expect(damaged.state).toEqual(head.state)
  await api.commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'next-message', text: '保持原来的选择。'})
  expect((await core.readVerifiedProductRuntimeHeadV1((await db.productRuntimeSessions.get(f.sessionId))!)).fromCache).toBe(true)
})
it('rolls back the new event and head together if the derived-head write fails', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), input = {...await command(f.sessionId), messageId: 'atomic', text: '这一句应当原子保存。'}
  const before = await db.productRuntimeSessions.get(f.sessionId), count = await db.productRuntimeEvents.count()
  vi.spyOn(core, 'updateProductRuntimeSessionHeadV1').mockRejectedValueOnce(Error('head-write'))
  await expect(api.commitInteractionPlayerMessage(input)).rejects.toThrow('head-write')
  expect(await db.productRuntimeEvents.count()).toBe(count)
  expect(await db.productRuntimeSessions.get(f.sessionId)).toEqual(before)
  vi.restoreAllMocks()
  await api.commitInteractionPlayerMessage(input)
  expect(await db.productRuntimeEvents.count()).toBe(count + 1)
})
it('rejects an altered canonical prefix at the same sequence instead of publishing a prepared stale head', async () => {
  const f = await seedChatNarrativeRuntimeFixture()
  const first = await api.commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'earlier', text: '原先的话。'})
  const input = {...await command(f.sessionId), messageId: 'later', text: '基于原状态的新话。'}, count = await db.productRuntimeEvents.count()
  const hash = core.hashStateJson; let changed = false
  vi.spyOn(core, 'hashStateJson').mockImplementation(async value => {
    const result = await hash(value)
    if (!changed) {changed = true; const payload = JSON.parse(first.payloadJson); payload.text = '并发修改的原话。'; await db.productRuntimeEvents.update(first.id!, {payloadJson: JSON.stringify(payload)})}
    return result
  })
  await expect(api.commitInteractionPlayerMessage(input)).rejects.toThrow('状态已变化')
  expect(await db.productRuntimeEvents.count()).toBe(count)
  expect((await db.productRuntimeSessions.get(f.sessionId))!.runtimeHeadSequence).toBe(first.sequence)
})

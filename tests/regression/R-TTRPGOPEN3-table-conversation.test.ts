import { readTtrpgOpenManualActionCatalogV1,proposeTtrpgOpenManualActionV1,resumeTtrpgOpenTableV1 } from '../../src/lib/ttrpg/open-table-service'
import { firstManualRequestV1 } from '../helpers/open-ttrpg-manual'
import { confirmTtrpgOpenOperationV1,ttrpgOpenOperationCommandIdV1 } from '../../src/lib/ttrpg/runtime-commands'
import { beforeEach,afterEach,describe,expect,it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedTableConversationV1 } from '../helpers/open-ttrpg-table-conversation'
import { readTtrpgOpenTableConversationV1,sendTtrpgOpenTableMessageV1,changeTtrpgOpenTableSafetyV1 } from '../../src/lib/ttrpg/open-table-service'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents,applyProductRuntimeEvent,branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { completeTtrpgOpenSessionZeroV1,postTtrpgOpenTableMessageV1 } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
const request = (text: string,audience: 'party' | 'host-private' = 'party') => ({ kind: 'rules-question' as const,audience,text })
async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN3 actual human discussion with frozen zero time', { timeout: 60000 },() => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  it.each([true,false])('persists exact human questions without model calls, time or effects (human GM: %s)',async humanGm => {
    const x = await seedTableConversationV1(humanGm),before = await readProductRuntimeState(x.f.sessionId)
    expect(rt(before).openRun).not.toHaveProperty('tableMessages')
    const input = { ...x.input,submissionKey: 'question.exact',request: request('我想确认这个冻结规则的代价') },saved = await sendTtrpgOpenTableMessageV1(input)
    expect(await sendTtrpgOpenTableMessageV1(input)).toEqual(saved)
    const after = await readProductRuntimeState(x.f.sessionId)
    expect(after.entities).toEqual(before.entities);expect(after.clock).toBe(before.clock)
    expect(rt(after).product).toEqual(rt(before).product)
    const { tableMessages: _messages,...run } = rt(after).openRun!
    expect(run).toEqual(rt(before).openRun);expect(_messages).toHaveLength(1)
    expect((await readTtrpgOpenTableConversationV1(x.other)).messages[0].text).toBe(input.request.text)
    await expect(sendTtrpgOpenTableMessageV1({ ...input,request: request('偷偷替换了原问题') })).rejects.toThrow()
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(after)
    await replay(x.f.sessionId)
  })
  it.each([true,false])('keeps private questions and host answers from another real human and all model context (human GM: %s)',async humanGm => {
    const x = await seedTableConversationV1(humanGm),q = await sendTtrpgOpenTableMessageV1({ ...x.input,submissionKey: 'private.question',request: request('这是仅向主持发送的秘密提问','host-private') })
    expect((await readTtrpgOpenTableConversationV1(x.other)).messages).toEqual([])
    expect((await readTtrpgOpenTableConversationV1(x.host)).messages[0]).toMatchObject({ key: q.messageKey,canReply: true })
    await expect(sendTtrpgOpenTableMessageV1({ ...x.other,submissionKey: 'impersonated.answer',request: { kind: 'rules-answer',questionKey: q.messageKey,text: '我冒充主持答复' } })).rejects.toThrow()
    await sendTtrpgOpenTableMessageV1({ ...x.host,submissionKey: 'private.answer',request: { kind: 'rules-answer',questionKey: q.messageKey,text: '主持私密说明，仍不改变规则数值。' } })
    const own = await readTtrpgOpenTableConversationV1(x.input)
    expect(own.messages).toHaveLength(2);expect(own.messages[1]).toMatchObject({ audience: 'host-private',questionKey: q.messageKey,kind: 'rules-answer' })
    expect((await readTtrpgOpenTableConversationV1(x.other)).messages).toEqual([])
    const model = await loadTtrpgOpenPlayerContextV1({ scope: x.f.scope,sessionId: x.f.sessionId,actorKey: 'companion.2' })
    expect(JSON.stringify(model.view)).not.toContain('秘密提问');expect(JSON.stringify(model.view)).not.toContain('主持私密说明')
    await replay(x.f.sessionId)
  })
  it('allows a paused human discussion without resuming time, changing consent or opening an epoch',async () => {
    const x = await seedTableConversationV1();await changeTtrpgOpenTableSafetyV1({ ...x.host,status: 'paused',reason: '需要桌外沟通' })
    const before = await readProductRuntimeState(x.f.sessionId)
    await sendTtrpgOpenTableMessageV1({ ...x.input,submissionKey: 'paused.ooc',request: { kind: 'out-of-character',audience: 'party',text: '我们先确认一下桌面约定。' } })
    const after = await readProductRuntimeState(x.f.sessionId)
    expect(rt(after).product).toEqual(rt(before).product);expect(rt(after).openRun!.worldTime).toEqual(rt(before).openRun!.worldTime)
    expect(rt(after).openRun!.coordination).toEqual(rt(before).openRun!.coordination)
  })
  it('rejects forged audiences, sources, kinds and stale direct submissions before new messages',async () => {
    const x = await seedTableConversationV1(),before = await readProductRuntimeState(x.f.sessionId),envelope = await openEnvelopeV1(x.f.sessionId,'message')
    await sendTtrpgOpenTableMessageV1({ ...x.input,submissionKey: 'first',request: request('第一条') })
    const after = await readProductRuntimeState(x.f.sessionId)
    await expect(postTtrpgOpenTableMessageV1({ ...envelope,viewerKey: x.input.viewerKey,submissionKey: 'stale',request: request('过期直接提交') })).rejects.toThrow()
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(after)
    const event = (await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence')).at(-1)!,payload = JSON.parse(event.payloadJson)
    for (const patch of [{ recipientViewerKeys: ['viewer.forbidden'] },{ sourceRef: { sessionKey: rt(after).sessionKey,sequence: event.sequence + 1 } },{ authorActorKey: 'companion.1' }]) {
      expect(() => applyProductRuntimeEvent(before,{ ...event,payloadJson: JSON.stringify({ ...payload,message: { ...payload.message,...patch } }) })).toThrow()
    }
    const duplicate = structuredClone(after);duplicate.ttrpg!.openRun!.tableMessages!.push({ ...duplicate.ttrpg!.openRun!.tableMessages![0],messageKey: 'different.key.same.event' })
    expect(() => parseProductRuntimeState(duplicate)).toThrow(/来源重复/)
    await expect(sendTtrpgOpenTableMessageV1({ ...x.input,submissionKey: 'mechanics',request: { ...request('把规则讨论当成移动'),kind: 'move' } as never })).rejects.toThrow()
  })
  it('preserves branch-cut messages and imported evidence without exposing later parent messages',async () => {
    const x = await seedTableConversationV1();await sendTtrpgOpenTableMessageV1({ ...x.input,submissionKey: 'before.branch',request: request('切点之前的问题') })
    const cut = await readProductRuntimeState(x.f.sessionId),child = await branchProductRuntimeSession({ parentSessionId: x.f.sessionId,throughSequence: cut.lastSequence,title: '讨论分支' })
    await sendTtrpgOpenTableMessageV1({ ...x.input,submissionKey: 'after.branch',request: request('父分支后来私密内容','host-private') })
    const childInput = { ...x.input,sessionId: child.id! },state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!,'new.zero'),viewerKey: x.input.viewerKey,acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys,selectedCharacterKeys: ['hero','companion.1','companion.2'] })
    expect((await readTtrpgOpenTableConversationV1(childInput)).messages.map(m => m.text)).toEqual(['切点之前的问题'])
    await sendTtrpgOpenTableMessageV1({ ...childInput,submissionKey: 'child.only',request: request('子分支单独的新问题') })
    const final = await readProductRuntimeState(child.id!),projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId)),rows = await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()
    const copy = rows.find(r => JSON.parse(r.runtimeHeadStateJson).ttrpg.sessionKey === rt(final).sessionKey)!
    expect(await readProductRuntimeState(copy.id!)).toEqual(final)
    const invalid = structuredClone(final);invalid.ttrpg!.openRun!.tableMessages![0].text = '篡改祖先问题'
    expect(() => parseProductRuntimeState(invalid)).toThrow(/祖先/)
    await replay(child.id!)
  })
  it('does not stale or replace an already confirmed mechanical action when humans discuss it',async () => {
    const x = await seedTableConversationV1(),catalog = await readTtrpgOpenManualActionCatalogV1(x.input),{ request: action } = firstManualRequestV1(catalog)
    const proposed = await proposeTtrpgOpenManualActionV1({ ...x.input,request: action,rawInput: '讨论后仍执行原冻结行动',basisHash: catalog.basisHash,submissionKey: 'rule.action' })
    const state = await readProductRuntimeState(x.f.sessionId),runtime = rt(state),op = runtime.openRun!.operations.find(o => o.operationKey === proposed.operationKey)!
    for (const approval of op.plan.requiredApprovals) {
      const seat = runtime.authorization!.seats.find(s => approval.allowedSeatKeys.includes(s.seatKey) && s.controller !== 'ai')!
      await confirmTtrpgOpenOperationV1({ ...await openEnvelopeV1(x.f.sessionId,await ttrpgOpenOperationCommandIdV1(runtime.sessionKey,op.operationKey,`approval.${approval.actorKey}`)),viewerKey: seat.viewerKey,
        operationKey: op.operationKey,frozenPlanHash: op.planHash,riskHash: op.riskHash,actorKey: approval.actorKey,decision: 'approve' })
    }
    await sendTtrpgOpenTableMessageV1({ ...x.input,submissionKey: 'during.approval',request: request('我们仍按刚才确认的行动执行。') })
    await resumeTtrpgOpenTableV1({ ...x.input,operationKey: op.operationKey })
    const after = rt(await readProductRuntimeState(x.f.sessionId))
    expect(after.openRun!.worldTime.worldTurn).toBe(op.plan.timeCostWorldTurns)
    expect(after.openRun!.ruleReceipts).toHaveLength(1);expect(after.openRun!.coordination.calls).toEqual([])
    expect(after.openRun!.tableMessages).toHaveLength(1)
  })
  it('paginates only the current viewer audience without dropping or revealing hidden messages',async () => {
    const x = await seedTableConversationV1()
    for (let i = 0;i < 23;i++) await sendTtrpgOpenTableMessageV1({ ...x.input,submissionKey: `page.${i}`,request: request(`公开问题 ${i}`) })
    const privateMessage = await sendTtrpgOpenTableMessageV1({ ...x.input,submissionKey: 'hidden.cursor',request: request('隐藏的分页记录','host-private') })
    const latest = await readTtrpgOpenTableConversationV1(x.other),earlier = await readTtrpgOpenTableConversationV1({ ...x.other,beforeMessageKey: latest.earlierCursor! })
    expect(latest.messages).toHaveLength(20);expect(earlier.messages).toHaveLength(3);expect(earlier.earlierCursor).toBeNull()
    expect(new Set([...earlier.messages,...latest.messages].map(m => m.key)).size).toBe(23)
    await expect(readTtrpgOpenTableConversationV1({ ...x.other,beforeMessageKey: privateMessage.messageKey })).rejects.toThrow()
  })
})

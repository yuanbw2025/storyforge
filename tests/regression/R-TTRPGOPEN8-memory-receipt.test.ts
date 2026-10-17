import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { recordTtrpgOpenNarrativeMemoryV1, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readTtrpgOpenNarrativeMemoriesV1 } from '../../src/lib/ttrpg/open-memory-service'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import type { TtrpgOpenMemoryDraftV1 } from '../../src/lib/ttrpg/open-memory-contract'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { ttrpgOpenMemoryEventDigestV1 } from '../../src/lib/ttrpg/open-memory-event-digest'
import type { ProductRuntimeEvent } from '../../src/lib/types'

async function setup(allHuman = false) {
  const f = await readyOpenTtrpgSessionV1('memory receipt', pkg => {
    pkg.ttrpg!.campaign.characterTemplates[1].controller = 'hybrid'
    if (allHuman) pkg.ttrpg!.campaign.characterTemplates[2].controller = 'hybrid'
  })
  const input = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }
  const draft: TtrpgOpenMemoryDraftV1 = { revisionKey: 'memory.hero.1', observerKey: 'hero', reliability: 'belief',
    audience: 'private', knownBy: ['hero'], summary: '我怀疑河港里有人在观察我们。', fromEventSequence: 1,
    toEventSequence: (await readProductRuntimeState(f.sessionId)).lastSequence }
  const envelope = await openEnvelopeV1(f.sessionId, 'memory.note.1')
  return { ...f, input, draft, envelope, record: () => recordTtrpgOpenNarrativeMemoryV1({ ...envelope, viewerKey: input.viewerKey, draft }) }
}
async function confirmChild(sessionId: number) {
  const state = await readProductRuntimeState(sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!
  await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(sessionId, 'child.memory.zero'), viewerKey: OPEN_HUMAN_VIEWER,
    selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: runtime.product.sessionZero.requiredItemKeys })
}
describe('R-TTRPGOPEN8 real human memory receipts and origin lifecycle', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('atomically records one real event and memory row, preserves all gameplay, and retries the exact confirmation idempotently', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.sessionId)
    const event = await f.record(), after = await readProductRuntimeState(f.sessionId)
    const receipt = JSON.parse(event.payloadJson).memory
    const expected = structuredClone(before)
    expected.lastSequence = event.sequence
    parseTtrpgRuntimeStateV2(after.ttrpg)
    ;(expected.ttrpg as any).openRun.memoryReceipts = [receipt]
    expect(after).toEqual(expected)
    expect((await f.record()).id).toBe(event.id)
    expect(await db.ttrpgNarrativeMemories.where('sessionId').equals(f.sessionId).count()).toBe(1)
    const read = await readTtrpgOpenNarrativeMemoriesV1(f.input)
    expect(read.entries).toHaveLength(1)
    expect(read.entries[0]).toMatchObject({ summary: f.draft.summary, reliability: 'belief', noMechanicalAuthority: true, noKnowledgeGrant: true })
    await expect(recordTtrpgOpenNarrativeMemoryV1({ ...f.envelope, viewerKey: f.input.viewerKey, draft: { ...f.draft, summary: '更换原确认' } })).rejects.toThrow(/commandId/)
    db.close(); await db.open()
    expect((await readTtrpgOpenNarrativeMemoriesV1(f.input)).entries).toEqual(read.entries)
  })
  it.each(['other-observer', 'unknown-private-reader', 'future-window'])('rejects %s without any event, row or gameplay mutation', async kind => {
    const f = await setup(), before = await readProductRuntimeState(f.sessionId), draft = structuredClone(f.draft)
    if (kind === 'other-observer') { draft.observerKey = 'companion.1'; draft.knownBy = ['companion.1'] }
    if (kind === 'unknown-private-reader') draft.knownBy.push('outside-party')
    if (kind === 'future-window') draft.toEventSequence += 100
    await expect(recordTtrpgOpenNarrativeMemoryV1({ ...f.envelope, viewerKey: f.input.viewerKey, draft })).rejects.toThrow()
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    expect(await db.ttrpgNarrativeMemories.count()).toBe(0)
  })
  it.each(['origin', 'candidateHash', 'runId'])('rejects model provenance field %s instead of relabeling it as human authored', async field => {
    const f = await setup(), before = await readProductRuntimeState(f.sessionId)
    const input = { ...f.envelope, viewerKey: f.input.viewerKey, draft: f.draft, [field]: field === 'runId' ? 99 : 'model' }
    await expect(recordTtrpgOpenNarrativeMemoryV1(input)).rejects.toThrow()
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    expect(await db.ttrpgNarrativeMemories.count()).toBe(0)
  })
  it('keeps private belief out of another actual human view and never grants host access to another actor private notes', async () => {
    const f = await setup(); await f.record()
    const other = (await db.ttrpgSessionParticipants.where('sessionId').equals(f.sessionId).toArray()).find(s => s.actorKey === 'companion.1')!
    expect((await readTtrpgOpenNarrativeMemoriesV1({ ...f.input, viewerKey: other.viewerKey })).entries).toEqual([])
    const draft = { ...f.draft, revisionKey: 'memory.other.1', observerKey: 'companion.1', knownBy: ['companion.1'], summary: 'ANOTHER-HUMAN-SECRET' }
    await recordTtrpgOpenNarrativeMemoryV1({ ...await openEnvelopeV1(f.sessionId, 'other.memory'), viewerKey: other.viewerKey, draft })
    expect(JSON.stringify(await readTtrpgOpenNarrativeMemoriesV1(f.input))).not.toContain('ANOTHER-HUMAN-SECRET')
  })
  it('shares the author own note only with the explicitly selected private recipients, retaining the original observer and reliability', async () => {
    const f = await setup(true)
    f.draft.knownBy = ['hero', 'companion.1']
    await f.record()
    const seats = await db.ttrpgSessionParticipants.where('sessionId').equals(f.sessionId).toArray()
    const shared = seats.find(s => s.actorKey === 'companion.1')!, excluded = seats.find(s => s.actorKey === 'companion.2')!
    expect((await readTtrpgOpenNarrativeMemoriesV1({ ...f.input, viewerKey: shared.viewerKey })).entries[0]).toMatchObject({ summary: f.draft.summary, observerKey: 'hero', reliability: 'belief', noKnowledgeGrant: true })
    expect((await readTtrpgOpenNarrativeMemoriesV1({ ...f.input, viewerKey: excluded.viewerKey })).entries).toEqual([])
  })
  it('rolls back the actual event and head when memory storage fails, then retries without duplicate confirmation', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.sessionId)
    const write = vi.spyOn(db.ttrpgNarrativeMemories, 'add').mockRejectedValueOnce(new Error('fixture memory row failure'))
    await expect(f.record()).rejects.toThrow('fixture memory row failure')
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    expect(await db.productRuntimeEvents.where('[sessionId+commandId]').equals([f.sessionId, f.envelope.commandId]).count()).toBe(0)
    write.mockRestore(); await f.record()
    expect((await readTtrpgOpenNarrativeMemoriesV1(f.input)).entries).toHaveLength(1)
  })
  it('detects a real source mutation inside the commit transaction and rolls it back with the attempted memory', async () => {
    const f = await setup(), raw = (await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).toArray()).find(event => event.type === 'ttrpg.session-zero.completed')!
    // The authorization event precedes the selected summary interval and must still be protected.
    f.draft.fromEventSequence = f.draft.toEventSequence
    const original = db.productRuntimeEvents.bulkGet.bind(db.productRuntimeEvents)
    vi.spyOn(db.productRuntimeEvents, 'bulkGet').mockImplementationOnce(async keys => {
      await db.productRuntimeEvents.update(raw.id!, { payloadJson: JSON.stringify({ ...JSON.parse(raw.payloadJson), changed: true }) })
      return original(keys)
    })
    await expect(f.record()).rejects.toThrow(/来源事件在提交期间/)
    expect((await db.productRuntimeEvents.get(raw.id!))!.payloadJson).toBe(raw.payloadJson)
    expect(await db.ttrpgNarrativeMemories.count()).toBe(0)
  })
  it('refuses the first confirmation over a damaged real prefix even while the old cached head remains readable', async () => {
    const f = await setup(), raw = (await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).toArray()).find(event => event.type === 'ttrpg.session-zero.completed')!
    const payload = JSON.parse(raw.payloadJson)
    payload.authorization.revision += 1
    await db.productRuntimeEvents.update(raw.id!, { payloadJson: JSON.stringify(payload) })
    const cached = await readProductRuntimeState(f.sessionId)
    await expect(f.record()).rejects.toThrow()
    expect(await db.ttrpgNarrativeMemories.count()).toBe(0)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(cached)
    await db.productRuntimeEvents.update(raw.id!, { payloadJson: raw.payloadJson })
    await f.record()
    expect((await readTtrpgOpenNarrativeMemoriesV1(f.input)).entries).toHaveLength(1)
  })
  it('excludes notes confirmed after a branch cut even when their covered source interval ends before the cut', async () => {
    const f = await setup(), event = await f.record()
    const before = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: event.sequence - 1, title: '确认之前' })
    const after = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: event.sequence, title: '确认之后' })
    expect(await db.ttrpgNarrativeMemories.where('sessionId').equals(before.id!).count()).toBe(0)
    expect(await db.ttrpgNarrativeMemories.where('sessionId').equals(after.id!).count()).toBe(1)
    await expect(readTtrpgOpenNarrativeMemoriesV1({ ...f.input, sessionId: after.id! })).rejects.toThrow(/开团授权/)
    await confirmChild(after.id!)
    const notes = await readTtrpgOpenNarrativeMemoriesV1({ ...f.input, sessionId: after.id! })
    expect(notes.entries[0]).toMatchObject({ summary: f.draft.summary, historical: true })
  })
  it('rolls back the complete child and participant copy if cloning a confirmed memory row fails', async () => {
    const f = await setup(), event = await f.record(), count = await db.productRuntimeSessions.count()
    const copy = vi.spyOn(db.ttrpgNarrativeMemories, 'add').mockRejectedValueOnce(new Error('fixture child memory failure'))
    await expect(branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: event.sequence, title: '未完成分支' })).rejects.toThrow('fixture child memory failure')
    expect(await db.productRuntimeSessions.count()).toBe(count)
    expect(await db.ttrpgNarrativeMemories.count()).toBe(1)
    copy.mockRestore()
    const child = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: event.sequence, title: '重试分支' })
    expect(await db.ttrpgNarrativeMemories.where('sessionId').equals(child.id!).count()).toBe(1)
  })
  it('retains independent parent and child source coordinates over two generations', async () => {
    const f = await setup(), event = await f.record()
    const child = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: event.sequence, title: '第二代' })
    await confirmChild(child.id!)
    const childNote = await recordTtrpgOpenNarrativeMemoryV1({ ...await openEnvelopeV1(child.id!, 'memory.child.note'), viewerKey: OPEN_HUMAN_VIEWER,
      draft: { ...f.draft, revisionKey: 'memory.child.own', summary: '子分支自己的判断。', toEventSequence: 1 } })
    const grandchild = await branchProductRuntimeSession({ parentSessionId: child.id!, throughSequence: childNote.sequence, title: '第三代' })
    await confirmChild(grandchild.id!)
    await deleteProductRuntimeSession(f.sessionId)
    await deleteProductRuntimeSession(child.id!)
    const notes = await readTtrpgOpenNarrativeMemoriesV1({ ...f.input, sessionId: grandchild.id! })
    expect(notes.entries).toHaveLength(2)
    expect(notes.entries.map(row => [row.summary, row.toEventSequence])).toEqual([[f.draft.summary, f.draft.toEventSequence], ['子分支自己的判断。', 1]])
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: restored.worldId!, workId: restored.workId! } })
    expect((await readTtrpgOpenNarrativeMemoriesV1({ scope, sessionId: restored.id!, viewerKey: OPEN_HUMAN_VIEWER })).entries).toEqual(notes.entries)
  })
  it('permits only the registered envelope locator rewrite, never altered meaning or a foreign instance locator', async () => {
    const event = { sessionId: 99, sequence: 1, type: 'narrative.recorded', payloadJson: JSON.stringify({ text: '同一原文', envelope: { sessionId: 99 } }) } as ProductRuntimeEvent
    const moved = { ...event, sessionId: 199, payloadJson: JSON.stringify({ text: '同一原文', envelope: { sessionId: 199 } }) }
    const first = await ttrpgOpenMemoryEventDigestV1(event, 'stable.session'), second = await ttrpgOpenMemoryEventDigestV1(moved, 'stable.session')
    expect(second.payloadHash).not.toBe(first.payloadHash)
    expect(second.portablePayloadHash).toBe(first.portablePayloadHash)
    expect((await ttrpgOpenMemoryEventDigestV1({ ...moved, payloadJson: JSON.stringify({ text: '改写正文', envelope: { sessionId: 199 } }) }, 'stable.session')).portablePayloadHash).not.toBe(first.portablePayloadHash)
    await expect(ttrpgOpenMemoryEventDigestV1({ ...event, sessionId: 199 }, 'stable.session')).rejects.toThrow(/定位越界/)
  })
  it('refuses changed source bytes or a memory projection that no longer matches its real confirmation', async () => {
    const f = await setup(); await f.record()
    const source = (await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).toArray())[0]
    await db.productRuntimeEvents.update(source.id!, { payloadJson: JSON.stringify({ ...JSON.parse(source.payloadJson), changed: 'unconfirmed' }) })
    await expect(readTtrpgOpenNarrativeMemoriesV1(f.input)).rejects.toThrow(/区间内容/)
    await db.productRuntimeEvents.update(source.id!, { payloadJson: source.payloadJson })
    const row = (await db.ttrpgNarrativeMemories.where('sessionId').equals(f.sessionId).toArray())[0]
    await db.ttrpgNarrativeMemories.update(row.id!, { reliability: 'observed' })
    await expect(readTtrpgOpenNarrativeMemoriesV1(f.input)).rejects.toThrow(/原确认不一致/)
    const count = await db.projects.count()
    await expect(importProjectJSON(await exportProjectJSON(f.scope.projectId))).rejects.toThrow(/实际确认回执/)
    expect(await db.projects.count()).toBe(count)
  })
  it('preserves exact origin after ancestor deletion and two full workspace imports with different physical IDs', async () => {
    const f = await setup(), event = await f.record()
    const child = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: event.sequence, title: '保留真实记忆' })
    await confirmChild(child.id!)
    await deleteProductRuntimeSession(f.sessionId)
    const childRow = (await db.ttrpgNarrativeMemories.where('sessionId').equals(child.id!).toArray())[0]
    expect(childRow.sourceSessionId).toBeNull()
    expect((await readTtrpgOpenNarrativeMemoriesV1({ ...f.input, sessionId: child.id! })).entries[0].historical).toBe(true)
    let projectId = f.scope.projectId
    for (let generation = 0; generation < 2; generation++) {
      projectId = await importProjectJSON(await exportProjectJSON(projectId))
      const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === child.title)!
      const scope = await resolveScope({ scope: { projectId, worldId: imported.worldId!, workId: imported.workId! } })
      expect((await readTtrpgOpenNarrativeMemoriesV1({ scope, sessionId: imported.id!, viewerKey: OPEN_HUMAN_VIEWER })).entries[0]).toMatchObject({ summary: f.draft.summary, historical: true })
    }
  })
  it('records a fresh human revision after complete import while preserving the original workspace and exact older note', async () => {
    const f = await setup(); await f.record()
    const original = await readTtrpgOpenNarrativeMemoriesV1(f.input)
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
    const version = await openEnvelopeV1(session.id!, 'memory.restored.next')
    await recordTtrpgOpenNarrativeMemoryV1({ ...version, viewerKey: OPEN_HUMAN_VIEWER,
      draft: { ...f.draft, revisionKey: 'memory.restored.2', summary: '恢复后由本人确认的新记录。', toEventSequence: version.baseSequence } })
    const notes = await readTtrpgOpenNarrativeMemoriesV1({ scope, sessionId: session.id!, viewerKey: OPEN_HUMAN_VIEWER })
    expect(notes.entries).toHaveLength(2)
    expect(notes.entries[0]).toEqual(original.entries[0])
    expect(await readTtrpgOpenNarrativeMemoriesV1(f.input)).toEqual(original)
  })
})

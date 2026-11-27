import Dexie from 'dexie'
import * as historyEvidence from '../../src/lib/authoring/history-local-save-evidence'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useHistoryStore } from '../../src/stores/project-singletons'
import { useHistoricalStore } from '../../src/stores/historical'
import { readHistoryTextWitnessesV1 } from '../../src/lib/authoring/history-local-save-evidence'
import { localSaveIdentityKeyV1, type LocalSaveHistoryIdentityV1, type LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const raw = '  # 作者历史\r\n\r\n🌊 逐字原文，保留段落。　 '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model calls') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close() })
async function fixture() {
  const { scope } = await seedCurrentWorkspace('历史保存确认')
  await useHistoryStore.getState().loadForHistoryAuthorV1({ origin: { version: 1, kind: 'work', scope }, selection: { kind: 'partition', worldGroupId: null } })
  const eventId = await useHistoricalStore.getState().addEvent({ projectId: scope.projectId, title: '事件', era: 'custom', year: 1, date: '初年', description: '原事件', isHistorical: false }, scope)
  const keywordId = await useHistoricalStore.getState().addKeyword({ projectId: scope.projectId, keyword: '关键词', era: 'custom', category: 'culture', description: '原词条' })
  const identities: LocalSaveHistoryIdentityV1[] = [
    ...(['overview', 'eraSystem'] as const).map(field => ({ ...scope, worldGroupId: null, table: 'histories' as const, field })),
    ...(['description', 'conceptNote'] as const).map(field => ({ ...scope, worldGroupId: null, table: 'historicalTimelineEvents' as const, field, recordId: eventId })),
    ...(['description', 'conceptNote'] as const).map(field => ({ ...scope, worldGroupId: null, table: 'historicalKeywords' as const, field, recordId: keywordId })),
  ]
  return { scope, identities, eventId, keywordId }
}
async function intent(identity: LocalSaveHistoryIdentityV1): Promise<LocalSaveIntentV1> {
  const witnesses = await readHistoryTextWitnessesV1([identity])
  return { kind: 'natural-field-local-save-v1', session: 'history-author', generation: 1, expected: witnesses[localSaveIdentityKeyV1(identity)] }
}
async function save(identity: LocalSaveHistoryIdentityV1, text = raw, confirmation?: LocalSaveIntentV1) {
  confirmation ??= await intent(identity)
  const scope = { projectId: identity.projectId, worldId: identity.worldId, workId: identity.workId }
  if (identity.table === 'histories') return useHistoryStore.getState().saveForHistoryAuthorV1({
    origin: { version: 1, kind: 'work', scope }, selection: { kind: 'partition', worldGroupId: identity.worldGroupId }, patch: identity.field === 'overview' ? { overview: text } : { eraSystem: text }, confirmation,
  })
  return identity.table === 'historicalTimelineEvents'
    ? useHistoricalStore.getState().updateEvent(identity.recordId, { [identity.field]: text }, scope, confirmation)
    : useHistoricalStore.getState().updateKeyword(identity.recordId, { [identity.field]: text }, scope, confirmation)
}
async function read(identity: LocalSaveHistoryIdentityV1) {
  return identity.table === 'histories' ? (await db.histories.toArray())[0]
    : await db.table(identity.table).get(identity.recordId)
}

it('confirms six exact fields in the original World records and preserves identity and sibling data across reopen', async () => {
  const { identities, eventId, keywordId, scope } = await fixture()
  for (const identity of identities) {
    const ack = await save(identity)
    expect(ack.witness).toMatchObject({ identity, value: raw, present: true, source: 'committed-write' })
  }
  const before = await Promise.all(identities.map(read)); db.close(); await db.open()
  expect(await Promise.all(identities.map(read))).toEqual(before)
  expect(await db.histories.count()).toBe(1)
  expect(await db.historicalTimelineEvents.get(eventId)).toMatchObject({ title: '事件', year: 1, date: '初年', description: raw, conceptNote: raw })
  expect(await db.historicalKeywords.get(keywordId)).toMatchObject({ keyword: '关键词', category: 'culture', description: raw, conceptNote: raw })
  for (const row of before) { expect(row.worldId).toBe(scope.worldId); expect(row.workId).toBeUndefined() }
})

it.each(['histories', 'historicalTimelineEvents', 'historicalKeywords'] as const)('rolls back actual quota/corrupt-poststate failures and retries the same %s input', async table => {
  const { identities } = await fixture(), identity = identities.find(row => row.table === table)!
  if (table === 'histories') await save(identity, '原文')
  const expected = await intent(identity), field = identity.field, physical = db.table(table)
  const quota = () => { throw new DOMException('history quota failure', 'QuotaExceededError') }
  physical.hook('updating', quota)
  try { await expect(save(identity, raw, expected)).rejects.toThrow('history quota failure') }
  finally { physical.hook('updating').unsubscribe(quota) }
  const corrupt = () => ({ [field]: 'wrong native poststate' })
  physical.hook('updating', corrupt)
  try { await expect(save(identity, raw, expected)).rejects.toThrow('未读到相同原文') }
  finally { physical.hook('updating').unsubscribe(corrupt) }
  expect((await read(identity))[field]).toBe(expected.expected.value)
  expect((await save(identity, raw, expected)).witness.value).toBe(raw)
})

it('preserves unrelated changes while rejecting stale fields, fabricated hashes, record swaps and wrong World partitions', async () => {
  const { identities, eventId, scope } = await fixture(), identity = identities[2]
  const expected = await intent(identity)
  await useHistoricalStore.getState().updateEvent(eventId, { location: '保留地点' }, scope)
  await save(identity, raw, expected)
  expect((await read(identity)).location).toBe('保留地点')
  await expect(save(identity, '陈旧覆盖', expected)).rejects.toThrow('字段已变化')
  const forged = await intent(identity); forged.expected.valueHash = 'forged'
  await expect(save(identity, '伪造', forged)).rejects.toThrow('字段已变化')
  const swapped = await intent(identity)
  swapped.expected.identity = { ...identity, recordId: eventId + 100 }
  await expect(save(identity, '错记录', swapped)).rejects.toThrow('记录凭据无效')
  const wrongGroup = await intent(identity); wrongGroup.expected.identity = { ...identity, worldGroupId: 999 }
  await expect(save(identity, '错分区', wrongGroup)).rejects.toThrow('分区不一致')
  expect((await read(identity)).description).toBe(raw)
})

it('rejects outer-transaction confirmation and keeps normal legacy parent-transaction writes available', async () => {
  const { identities, scope } = await fixture(), identity = identities[0], expected = await intent(identity)
  await expect(db.transaction('rw', db.projects, db.worlds, db.works, db.worldGroups, db.histories,
    () => save(identity, raw, expected))).rejects.toThrow('独立提交')
  expect(await db.histories.count()).toBe(0)
  await db.transaction('rw', db.projects, db.worlds, db.works, db.worldGroups, db.histories, () => useHistoryStore.getState().saveForHistoryAuthorV1({
    origin: { version: 1, kind: 'work', scope }, selection: { kind: 'partition', worldGroupId: null }, patch: { overview: raw },
  }))
  expect((await read(identity)).overview).toBe(raw)
})

it('a delayed committed readback cannot publish an older history snapshot after a newer sibling field save', async () => {
  const { identities } = await fixture()
  let entered!: () => void, release!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const original = historyEvidence.historyTextSaveAckV1
  vi.spyOn(historyEvidence, 'historyTextSaveAckV1').mockImplementation(async (row, proof, text) => {
    if (!Dexie.currentTransaction && text === 'first committed overview') { entered(); await gate }
    return original(row, proof, text)
  })
  const first = save(identities[0], 'first committed overview')
  try {
    await reached
    await save(identities[1], 'newer committed era')
    expect(useHistoryStore.getState().history?.eraSystem).toBe('newer committed era')
  } finally { release() }
  await first
  expect(useHistoryStore.getState().history).toMatchObject({ overview: 'first committed overview', eraSystem: 'newer committed era' })
})

it('one malformed legacy record cannot disable verified save feedback for the other history fields', async () => {
  const { identities, keywordId } = await fixture()
  await db.table('historicalKeywords').update(keywordId, { ragDocumentId: 'legacy-invalid' })
  const witnesses = await readHistoryTextWitnessesV1(identities)
  expect(witnesses[localSaveIdentityKeyV1(identities[0])]).toBeDefined()
  expect(witnesses[localSaveIdentityKeyV1(identities[2])]).toBeDefined()
  expect(witnesses[localSaveIdentityKeyV1(identities[4])]).toBeUndefined()
})

import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCharacterStore } from '../../src/stores/character'
import { useOutlineStore } from '../../src/stores/outline'
import { readRecordTextWitnessesV1, type RecordTextTableV1 } from '../../src/lib/authoring/record-text-save-evidence'
import type { LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import * as scopeModule from '../../src/lib/workspace/scope'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const raw = '  # 作者长描述\r\n\r\n🌊 原文、标点和尾空白。　 '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  useCharacterStore.setState({ characters: [], loadedScope: null, loading: false })
  useOutlineStore.setState({ nodes: [], loadedScope: null, loading: false })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model calls') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
async function fixture(table: RecordTextTableV1) {
  const { scope } = await seedCurrentWorkspace('记录文字保存')
  const field = table === 'characters' ? 'background' : 'summary'
  const id = table === 'characters'
    ? await useCharacterStore.getState().addCharacter({ projectId: scope.projectId, name: '原角色', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '', appearance: '', personality: '', background: '原文', profile: '', motivation: '', abilities: '', relationships: '', arc: '' })
    : await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: null, type: 'chapter', title: '原章名', summary: '原文', order: 0 }, scope)
  const load = () => table === 'characters' ? useCharacterStore.getState().loadAll(scope) : useOutlineStore.getState().loadAll(scope)
  await load()
  const intent = async (key = field): Promise<LocalSaveIntentV1> => ({ kind: 'natural-field-local-save-v1', session: 'record-author', generation: 1,
    expected: (await readRecordTextWitnessesV1(table, id, scope))[key] })
  const save = async (text = raw, proof?: LocalSaveIntentV1, key = field) => table === 'characters'
    ? useCharacterStore.getState().updateCharacter(id, { [key]: text }, { scope, confirmation: proof ?? await intent(key) })
    : useOutlineStore.getState().updateNode(id, { [key]: text }, { scope, confirmation: proof ?? await intent(key) })
  const read = () => db.table(table).get(id)
  return { scope, id, field, intent, save, read, load }
}
it.each(['characters', 'outlineNodes'] as const)('%s confirms the exact native row and field through the original writer and survives reopen', async table => {
  const f = await fixture(table), before = await f.read(), ack = await f.save()
  expect(ack.witness).toMatchObject({ recordId: f.id, resourceUid: before.ragDocumentId, present: true, value: raw,
    source: 'committed-write', identity: { ...f.scope, table, field: f.field, recordId: f.id } })
  db.close(); await db.open()
  expect((await f.read())[f.field]).toBe(raw)
  expect((await f.read()).ragDocumentId).toBe(before.ragDocumentId)
  expect((await f.read())[table === 'characters' ? 'name' : 'title']).toBe(before[table === 'characters' ? 'name' : 'title'])
})
it.each(['characters', 'outlineNodes'] as const)('%s rolls back actual quota and corrupt poststates, then retries the retained preimage', async table => {
  const f = await fixture(table), proof = await f.intent(), physical = db.table(table)
  const fault = () => { throw new DOMException('native record quota failure', 'QuotaExceededError') }
  physical.hook('updating', fault)
  try { await expect(f.save(raw, proof)).rejects.toThrow('native record quota failure') }
  finally { physical.hook('updating').unsubscribe(fault) }
  const corrupt = () => ({ [f.field]: 'wrong poststate' }); physical.hook('updating', corrupt)
  try { await expect(f.save(raw, proof)).rejects.toThrow('未读到相同身份与原文') }
  finally { physical.hook('updating').unsubscribe(corrupt) }
  expect((await f.read())[f.field]).toBe('原文')
  expect((await f.save(raw, proof)).witness.value).toBe(raw)
})
it.each(['characters', 'outlineNodes'] as const)('%s rejects stale, forged, cross-owner and missing-record evidence without a success', async table => {
  const f = await fixture(table), old = await f.intent()
  await f.save(raw, old)
  await expect(f.save('过期覆盖', old)).rejects.toThrow('字段已被修改')
  const forged = await f.intent(); forged.expected.valueHash = 'forged'
  await expect(f.save('伪造', forged)).rejects.toThrow('字段已被修改')
  const wrong = await f.intent(); wrong.expected.identity.workId += 100
  await expect(f.save('越域', wrong)).rejects.toThrow('凭据无效')
  const proof = await f.intent(); await db.table(table).delete(f.id)
  await expect(f.save('删除后假保存', proof)).rejects.toThrow(/删除/)
})
it.each(['characters', 'outlineNodes'] as const)('%s rereads a delayed old load after a committed edit instead of restoring stale UI text', async table => {
  const f = await fixture(table), expected = await f.intent(), original = scopeModule.readOwnedRows
  let release!: () => void, entered!: () => void, first = true
  const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
  vi.spyOn(scopeModule, 'readOwnedRows').mockImplementation(async (...args) => {
    const rows = await original(...args)
    if (first && args[1] === table) { first = false; entered(); await gate }
    return rows
  })
  const loading = f.load()
  try { await reached; await f.save(raw, expected) } finally { release() }
  await loading
  const rows = table === 'characters' ? useCharacterStore.getState().characters : useOutlineStore.getState().nodes
  expect(Reflect.get(rows.find(row => row.id === f.id)!, f.field)).toBe(raw)
})

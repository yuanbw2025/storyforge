import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useReferenceStore } from '../../src/stores/reference'
import { readRecordTextWitnessesV1 } from '../../src/lib/authoring/record-text-save-evidence'
import type { LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import * as scopeModule from '../../src/lib/workspace/scope'
import { adopt } from '../../src/lib/registry/adopt'

const raw = '  # 参考要点\r\n\r\n🌊 原文和尾空白。　 '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  useReferenceStore.setState({ references: [], loadedScope: null, loading: false, loadError: null })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model calls') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
async function fixture() {
  const { scope } = await seedCurrentWorkspace('参考原文保存')
  const id = await useReferenceStore.getState().addReference({ projectId: scope.projectId, title: '书名不改', author: '原作者', type: 'style', note: '原要点', url: '' }, scope)
  const read = () => db.references.get(id)
  const intent = async (): Promise<LocalSaveIntentV1> => ({ kind: 'natural-field-local-save-v1', session: 'reference-author', generation: 1,
    expected: (await readRecordTextWitnessesV1('references', id, scope)).note })
  const save = async (text = raw, confirmation?: LocalSaveIntentV1) => useReferenceStore.getState().updateReference(id, { note: text }, { scope, confirmation: confirmation ?? await intent() })
  return { scope, id, read, intent, save }
}
it('returns the original Work/record exact committed note and retains unrelated fields after reopen', async () => {
  const f = await fixture(), before = await f.read(), ack = await f.save()
  expect(ack.witness).toMatchObject({ value: raw, resourceUid: before!.ragDocumentId, identity: { ...f.scope, table: 'references', recordId: f.id, field: 'note' } })
  db.close(); await db.open()
  expect(await f.read()).toMatchObject({ note: raw, title: before!.title, author: before!.author, workId: f.scope.workId, ragDocumentId: before!.ragDocumentId })
})
it('rolls back quota, zero rows and wrong poststate before an explicit retry of the same preimage', async () => {
  const f = await fixture(), proof = await f.intent()
  const quota = () => { throw new DOMException('reference quota failure', 'QuotaExceededError') }
  db.references.hook('updating', quota)
  try { await expect(f.save(raw, proof)).rejects.toThrow('reference quota failure') } finally { db.references.hook('updating').unsubscribe(quota) }
  vi.spyOn(db.references, 'update').mockResolvedValueOnce(0)
  await expect(f.save(raw, proof)).rejects.toThrow('0行'); vi.restoreAllMocks()
  const corrupt = () => ({ note: 'wrong' }); db.references.hook('updating', corrupt)
  try { await expect(f.save(raw, proof)).rejects.toThrow('未读到相同身份与原文') } finally { db.references.hook('updating').unsubscribe(corrupt) }
  expect((await f.read())!.note).toBe('原要点'); expect((await f.save(raw, proof)).witness.value).toBe(raw)
})
it('rejects stale/forged evidence, owner/analysis patches and deleted records without changing text', async () => {
  const f = await fixture(), proof = await f.intent(), forged = structuredClone(proof)
  forged.expected.valueHash = 'forged'; await expect(f.save(raw, forged)).rejects.toThrow('字段已被修改')
  await expect(useReferenceStore.getState().updateReference(f.id, { workId: 99 })).rejects.toThrow('身份')
  await expect(useReferenceStore.getState().updateReference(f.id, { analysisSummary: '伪造分析' })).rejects.toThrow('分析结果')
  await f.save(raw, proof); await expect(f.save('过期文字', proof)).rejects.toThrow('字段已被修改')
  const latest = await f.intent(); await db.references.delete(f.id); await expect(f.save('已删除', latest)).rejects.toThrow('已删除')
})
it('freezes original Work and caller input before queuing, and never hijacks a newly loaded Work list', async () => {
  const f = await fixture(), proof = await f.intent()
  const other = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, create: { title: '另一作品' } })
  const patch = { note: raw }, scope = { ...f.scope }
  const saving = useReferenceStore.getState().updateReference(f.id, patch, { scope, confirmation: proof })
  patch.note = '调用后篡改'; scope.workId = other.id!
  await db.projects.update(f.scope.projectId, { activeWorkId: other.id })
  await useReferenceStore.getState().loadAll({ ...f.scope, workId: other.id! }); await saving
  expect((await f.read())!.note).toBe(raw); expect(useReferenceStore.getState().references).toEqual([])
  await expect(useReferenceStore.getState().updateReference(f.id, { note: '越界' })).rejects.toThrow('当前作品')
})
it('rereads a delayed load snapshot after a confirmed edit instead of republishing old notes', async () => {
  const f = await fixture(), proof = await f.intent(), original = scopeModule.readOwnedRows
  let release!: () => void, entered!: () => void, first = true
  const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
  vi.spyOn(scopeModule, 'readOwnedRows').mockImplementation(async (...args) => {
    const rows = await original(...args)
    if (first && args[1] === 'references') { first = false; entered(); await gate }
    return rows
  })
  const loading = useReferenceStore.getState().loadAll(f.scope)
  try { await reached; await f.save(raw, proof) } finally { release() }
  await loading; expect(useReferenceStore.getState().references.find(row => row.id === f.id)!.note).toBe(raw)
})
it('keeps registered reference metadata behind record-only adoption rather than allowing generated replacement rows', async () => {
  const f = await fixture(), before = await db.references.toArray()
  const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'references', data: [{ note: 'AI cannot create a reference through this registration' }], mode: 'add-many' })
  expect(result.written).toHaveLength(0); expect(result.skipped[0].reason).toContain('recordId')
  expect(await db.references.toArray()).toEqual(before)
})

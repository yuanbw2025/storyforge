import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useForeshadowStore } from '../../src/stores/foreshadow'
import { useOutlineStore } from '../../src/stores/outline'
import { readRecordTextWitnessesV1 } from '../../src/lib/authoring/record-text-save-evidence'
import type { LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import * as scopeModule from '../../src/lib/workspace/scope'

const raw = '  # 作者伏笔\r\n\r\n🌊 原文及尾空白。　 '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  useForeshadowStore.setState({ foreshadows: [], loadedScope: null, loading: false, loadError: null })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model calls') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
async function fixture() {
  const { scope } = await seedCurrentWorkspace('伏笔保存')
  const id = await useForeshadowStore.getState().addForeshadow({ projectId: scope.projectId, name: '原伏笔', type: 'symbol', status: 'planned', description: '原描述', notes: '原备注', plantChapterId: null, resolveChapterId: null, echoChapterIds: '[]' }, scope)
  const read = () => db.foreshadows.get(id)
  const intent = async (): Promise<LocalSaveIntentV1> => ({ kind: 'natural-field-local-save-v1', session: 'foreshadow-author', generation: 1,
    expected: (await readRecordTextWitnessesV1('foreshadows', id, scope)).description })
  const save = async (value = raw, confirmation?: LocalSaveIntentV1) => useForeshadowStore.getState().updateForeshadow(id, { description: value }, { scope, confirmation: confirmation ?? await intent() })
  return { scope, id, read, intent, save }
}
it('confirms original Work/UID and exact native text after reopen without changing the note or status', async () => {
  const f = await fixture(), before = await f.read(), ack = await f.save()
  expect(ack.witness).toMatchObject({ value: raw, resourceUid: before!.ragDocumentId, identity: { ...f.scope, table: 'foreshadows', field: 'description', recordId: f.id } })
  db.close(); await db.open()
  expect(await f.read()).toMatchObject({ description: raw, notes: '原备注', name: '原伏笔', status: 'planned', ragDocumentId: before!.ragDocumentId })
})
it('rolls back actual quota, zero-row and incorrect poststate writes before an explicit retry', async () => {
  const f = await fixture(), proof = await f.intent()
  const quota = () => { throw new DOMException('foreshadow quota failure', 'QuotaExceededError') }; db.foreshadows.hook('updating', quota)
  try { await expect(f.save(raw, proof)).rejects.toThrow('foreshadow quota failure') } finally { db.foreshadows.hook('updating').unsubscribe(quota) }
  vi.spyOn(db.foreshadows, 'update').mockResolvedValueOnce(0)
  await expect(f.save(raw, proof)).rejects.toThrow('0行'); vi.restoreAllMocks()
  const corrupt = () => ({ description: '错误结果' }); db.foreshadows.hook('updating', corrupt)
  try { await expect(f.save(raw, proof)).rejects.toThrow('相同伏笔身份与输入原文') } finally { db.foreshadows.hook('updating').unsubscribe(corrupt) }
  expect((await f.read())!.description).toBe('原描述'); expect((await f.save(raw, proof)).witness.value).toBe(raw)
})
it('rejects forged/stale proofs, identity fields, bad status and deleted targets rather than resolving a no-op', async () => {
  const f = await fixture(), proof = await f.intent(), forged = structuredClone(proof)
  forged.expected.valueHash = 'forged'; await expect(f.save(raw, forged)).rejects.toThrow('字段已被修改')
  await expect(useForeshadowStore.getState().updateForeshadow(f.id, { id: 999 })).rejects.toThrow('身份')
  await expect(useForeshadowStore.getState().updateForeshadow(f.id, { status: 'toString' as never })).rejects.toThrow('格式异常')
  const source = (await f.read())!
  await expect(useForeshadowStore.getState().addForeshadow({ ...source, projectId: f.scope.projectId + 999 }, f.scope)).rejects.toThrow('创建作用域不匹配')
  await f.save(raw, proof); await expect(f.save('旧覆盖', proof)).rejects.toThrow('字段已被修改')
  const latest = await f.intent(); await db.foreshadows.delete(f.id)
  await expect(f.save('删除后', latest)).rejects.toThrow('已删除')
  await expect(useForeshadowStore.getState().updateStatus(f.id, 'planted')).rejects.toThrow('已删除')
})
it('validates changed chapter references in the same transaction and preserves unrelated source on failure', async () => {
  const f = await fixture(), before = await f.read(), other = await seedCurrentWorkspace('另一本书')
  const node = await useOutlineStore.getState().addNode({ projectId: other.scope.projectId, parentId: null, type: 'chapter', title: '异作章节', summary: '', order: 0 }, other.scope)
  const chapter = await db.chapters.add(stampNewRecord(other.scope, 'chapters', { projectId: other.scope.projectId, outlineNodeId: node, title: '异作章节', content: '', wordCount: 0, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  await expect(useForeshadowStore.getState().updateForeshadow(f.id, { plantChapterId: chapter, description: raw }, { scope: f.scope })).rejects.toThrow('不属于原作品')
  await expect(useForeshadowStore.getState().updateForeshadow(f.id, { echoChapterIds: '[null]' }, { scope: f.scope })).rejects.toThrow('有效章节数组')
  expect(await f.read()).toEqual(before)
})
it('freezes caller input and scope before queueing while another Work becomes active', async () => {
  const f = await fixture(), proof = await f.intent(), other = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, create: { title: '另一本书' } })
  const patch = { description: raw }, scope = { ...f.scope }
  const saving = useForeshadowStore.getState().updateForeshadow(f.id, patch, { scope, confirmation: proof })
  patch.description = '调用后篡改'; scope.workId = other.id!
  await db.projects.update(f.scope.projectId, { activeWorkId: other.id })
  await useForeshadowStore.getState().loadAll({ ...f.scope, workId: other.id! }); await saving
  expect((await f.read())!.description).toBe(raw); expect(useForeshadowStore.getState().foreshadows).toEqual([])
  await expect(useForeshadowStore.getState().updateForeshadow(f.id, { notes: '越域' })).rejects.toThrow('不属于当前作品')
})
it('rereads a delayed old load after commit and releases failed reads with a visible error', async () => {
  const f = await fixture(), proof = await f.intent(), original = scopeModule.readOwnedRows
  let release!: () => void, entered!: () => void, first = true
  const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
  const spy = vi.spyOn(scopeModule, 'readOwnedRows').mockImplementation(async (...args) => {
    const rows = await original(...args)
    if (first && args[1] === 'foreshadows') { first = false; entered(); await gate }
    return rows
  })
  const loading = useForeshadowStore.getState().loadAll(f.scope)
  try { await reached; await f.save(raw, proof) } finally { release() }
  await loading; expect(useForeshadowStore.getState().foreshadows.find(row => row.id === f.id)!.description).toBe(raw)
  spy.mockRejectedValueOnce(new Error('native read failure'))
  await expect(useForeshadowStore.getState().loadAll(f.scope)).rejects.toThrow('native read failure')
  expect(useForeshadowStore.getState()).toMatchObject({ loading: false, loadError: 'native read failure' })
})

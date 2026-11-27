import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useWorldviewStore as store } from '../../src/stores/worldview'
import { readRecordTextWitnessesV1 } from '../../src/lib/authoring/record-text-save-evidence'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import type { LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import * as scopes from '../../src/lib/workspace/scope'
const raw = '  # 力量原文\r\n\r\n代价 e\u0301 😀  '
beforeEach(async () => { resetPendingEditCoordinatorForTestsV1(); await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close() })
async function fixture() {
 const { scope } = await seedCurrentWorkspace('力量保存')
 await store.getState().loadAll(scope)
 await store.getState().savePowerSystem({ projectId: scope.projectId, name: '原名', description: '原描述', rules: '原规则', levels: '原等级' }, scope)
 return { scope, id: store.getState().powerSystem!.id! }
}
async function proof(f: Awaited<ReturnType<typeof fixture>>, field = 'description'): Promise<LocalSaveIntentV1> {
 return { kind: 'natural-field-local-save-v1', expected: (await readRecordTextWitnessesV1('powerSystems', f.id, f.scope))[field], session: 'power-author', generation: 1 }
}
it('confirms all four exact scalar fields in the same World record with native identity after reopening', async () => {
 const f = await fixture(), before = await db.powerSystems.get(f.id)
 for (const field of ['name','description','levels','rules']) {
  const ack = await store.getState().savePowerSystem({ projectId: f.scope.projectId, [field]: raw }, f.scope, await proof(f, field))
  expect(ack).toMatchObject({ witness: { value: raw, source: 'committed-write', identity: { table: 'powerSystems', worldId: f.scope.worldId, field } } })
 }
 db.close(); await db.open()
 expect(await db.powerSystems.get(f.id)).toMatchObject({ name: raw, description: raw, levels: raw, rules: raw, ragDocumentId: Reflect.get(before!, 'ragDocumentId') })
 expect(await db.powerSystems.count()).toBe(1)
})
it('rolls back corrupt native poststate and rejects quota, zero-row, stale and removed targets without confirming them', async () => {
 const f = await fixture(), expected = await proof(f), patch = { projectId: f.scope.projectId, description: raw }
 const fault = vi.spyOn(db.powerSystems, 'update').mockRejectedValueOnce(new Error('power quota'))
 await expect(store.getState().savePowerSystem(patch, f.scope, expected)).rejects.toThrow('power quota'); fault.mockRestore()
 const zero = vi.spyOn(db.powerSystems, 'update').mockResolvedValueOnce(0)
 await expect(store.getState().savePowerSystem(patch, f.scope, expected)).rejects.toThrow('已不存在'); zero.mockRestore()
 const corrupt = () => ({ description: 'corrupt' }); db.powerSystems.hook('updating', corrupt)
 try { await expect(store.getState().savePowerSystem(patch, f.scope, expected)).rejects.toThrow('精确保存') }
 finally { db.powerSystems.hook('updating').unsubscribe(corrupt) }
 expect((await db.powerSystems.get(f.id))?.description).toBe('原描述')
 await store.getState().savePowerSystem(patch, f.scope, expected)
 await expect(store.getState().savePowerSystem({ projectId: f.scope.projectId, description: 'stale' }, f.scope, expected)).rejects.toThrow('已被修改')
 const next = await proof(f); await db.powerSystems.delete(f.id)
 await expect(store.getState().savePowerSystem(patch, f.scope, next)).rejects.toThrow('已删除'); expect(await db.powerSystems.count()).toBe(0)
})
it('preserves siblings and freezes queued caller scope, patch and proof rather than borrowing a later Work', async () => {
 const f = await fixture(), other = (await seedCurrentWorkspace('另一作品')).scope
 const expected = await proof(f), mutable = { ...f.scope }, patch = { projectId: f.scope.projectId, description: raw }
 let release!: () => void, ready!: () => void
 const entered = new Promise<void>(resolve => { ready = resolve })
 const held = coordinatePendingEditV1({ key: `power-system:${f.scope.projectId}:default`, persist: () => new Promise<void>(resolve => { release = resolve; ready() }) })
 await entered; const pending = store.getState().savePowerSystem(patch, mutable, expected)
 Object.assign(mutable, other); patch.description = 'later'; expected.expected.valueHash = 'later'
 await store.getState().loadAll(other); release(); await held; await pending
 expect(store.getState().powerSystem).toBeNull()
 expect(await db.powerSystems.get(f.id)).toMatchObject({ description: raw, rules: '原规则', levels: '原等级' })
})
it('rereads a delayed old snapshot after a native save rather than overwriting it', async () => {
 const f = await fixture(), expected = await proof(f), original = scopes.readOwnedRows
 let held = false, ready!: () => void, release!: () => void
 const entered = new Promise<void>(resolve => { ready = resolve })
 vi.spyOn(scopes, 'readOwnedRows').mockImplementation(async <T>(...args: Parameters<typeof original>) => {
  const rows = await original<T>(...args)
  if (args[1] === 'powerSystems' && !held) { held = true; await new Promise<void>(resolve => { release = resolve; ready() }) }
  return rows
 })
 const loading = store.getState().loadAll(f.scope); await entered
 await store.getState().savePowerSystem({ projectId: f.scope.projectId, description: raw }, f.scope, expected)
 release(); await loading; expect(store.getState().powerSystem?.description).toBe(raw)
})

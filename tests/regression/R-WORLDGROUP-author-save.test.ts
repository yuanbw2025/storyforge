import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace, addCurrentWorldFixtureV1, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { useWorldGroupStore } from '../../src/stores/world-group'
import type { WorldGroup } from '../../src/lib/types'
import * as scopeModule from '../../src/lib/workspace/scope'

beforeEach(async () => {
  await db.delete(); await db.open()
  useWorldGroupStore.setState({ groups: [], links: [], activeGroupId: null, loadedScope: null, loading: false })
})
afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const { scope } = await seedCurrentWorkspace('世界作者编辑')
  await useWorldGroupStore.getState().loadAll(scope)
  const id = await useWorldGroupStore.getState().createGroup({ projectId: scope.projectId, name: '旧界', description: '旧描述', type: 'traversal', order: 0 }, scope)
  return { scope, id, group: (await db.worldGroups.get(id))! }
}

it('acknowledges exact author fields, explicit clearing and unchanged owner', async () => {
  const { scope, id, group } = await fixture()
  const saved = await useWorldGroupStore.getState().updateGroup(id, { name: '新界', description: '', entryCondition: '', plannedChapterCount: 0 }, { scope, expected: group })
  expect(saved.worldId).toBe(scope.worldId); expect(saved.projectId).toBe(scope.projectId)
  expect(saved.name).toBe('新界'); expect(saved.description).toBe(''); expect(saved.plannedChapterCount).toBe(0)
  expect(await db.worldGroups.get(id)).toEqual(saved)
  expect(useWorldGroupStore.getState().groups[0]).toEqual(saved)
})
it('rejects a stale author snapshot even when a second writer kept the same timestamp', async () => {
  const { scope, id, group } = await fixture()
  await db.worldGroups.update(id, { description: '另一个页面保存的描述', updatedAt: group.updatedAt })
  await expect(useWorldGroupStore.getState().updateGroup(id, { name: '过时草稿' }, { scope, expected: group })).rejects.toThrow('其他页面修改')
  expect((await db.worldGroups.get(id))?.description).toBe('另一个页面保存的描述')
  expect((await db.worldGroups.get(id))?.name).toBe('旧界')
})
it('rejects a World B group through a frozen World A scope', async () => {
  const { scope } = await fixture()
  const world = await addCurrentWorldFixtureV1({ projectId: scope.projectId, name: 'B' })
  const work = await addCurrentWorkFixtureV1({ projectId: scope.projectId, worldId: world.id!, create: { title: 'B 作品', kind: 'novel', novelProfile: 'long' } })
  const other = { projectId: scope.projectId, worldId: world.id!, workId: work.id! }
  const id = await useWorldGroupStore.getState().createGroup({ projectId: scope.projectId, name: 'B 界', description: '', type: 'parallel', order: 0 }, other)
  await expect(useWorldGroupStore.getState().updateGroup(id, { name: '不能写入 B' }, { scope })).rejects.toThrow('作用域')
  expect((await db.worldGroups.get(id))?.name).toBe('B 界')
  expect(useWorldGroupStore.getState().groups.some(group => group.id === id)).toBe(false)
})
it('never promotes a side world or demotes the primary world', async () => {
  const { scope, id } = await fixture()
  await expect(useWorldGroupStore.getState().updateGroup(id, { type: 'primary' }, { scope })).rejects.toThrow('主世界')
  const primary = await useWorldGroupStore.getState().ensurePrimaryGroup(scope)
  await expect(useWorldGroupStore.getState().updateGroup(primary, { type: 'custom' }, { scope })).rejects.toThrow('主世界')
  expect((await db.worldGroups.get(primary))?.type).toBe('primary')
})
it('rejects ownership and inherited enum keys without changing the row', async () => {
  const { scope, id, group } = await fixture()
  for (const patch of [{ worldId: 900 }, { projectId: 900 }, { type: '__proto__' }, { type: 'constructor' }]) {
    await expect(useWorldGroupStore.getState().updateGroup(id, patch as unknown as Partial<WorldGroup>, { scope })).rejects.toThrow()
    expect(await db.worldGroups.get(id)).toEqual(group)
  }
})
it('a deleted group fails visibly and is never recreated by saving its draft', async () => {
  const { scope, id, group } = await fixture()
  await db.worldGroups.delete(id)
  await expect(useWorldGroupStore.getState().updateGroup(id, { name: '待保存草稿' }, { scope, expected: group })).rejects.toThrow('删除')
  expect(await db.worldGroups.count()).toBe(0)
})
it('a failed group read releases loading without falsely changing its scope', async () => {
  const { scope, group } = await fixture()
  vi.spyOn(db.worldGroups, 'where').mockImplementationOnce(() => { throw new Error('group read failed') })
  await expect(useWorldGroupStore.getState().loadAll(scope)).rejects.toThrow('group read failed')
  expect(useWorldGroupStore.getState().loading).toBe(false)
  expect(useWorldGroupStore.getState().groups).toEqual([group])
})

it('returns the exact committed row, freezes caller values and retains Unicode/whitespace after reopen', async () => {
  const { scope, id, group } = await fixture(), raw = '  # 原文\r\n\r\n🌊 尾空白。　 '
  const patch = { description: raw }, owner = { ...scope }, expected = { ...group }
  const saving = useWorldGroupStore.getState().updateGroup(id, patch, { scope: owner, expected })
  patch.description = '调用后篡改'; owner.worldId = 999; expected.name = '调用后篡改'
  const saved = await saving
  db.close(); await db.open()
  expect(await db.worldGroups.get(id)).toEqual(saved)
  expect(saved).toMatchObject({ description: raw, worldId: scope.worldId, ragDocumentId: group.ragDocumentId })
})
it('rolls back quota, zero rows and a wrong native poststate before an explicit retry', async () => {
  const { scope, id, group } = await fixture()
  const save = () => useWorldGroupStore.getState().updateGroup(id, { description: '作者新稿' }, { scope, expected: group })
  const quota = () => { throw new DOMException('world group quota failure', 'QuotaExceededError') }
  db.worldGroups.hook('updating', quota)
  try { await expect(save()).rejects.toThrow('world group quota failure') } finally { db.worldGroups.hook('updating').unsubscribe(quota) }
  vi.spyOn(db.worldGroups, 'update').mockResolvedValueOnce(0)
  await expect(save()).rejects.toThrow('已删除'); vi.restoreAllMocks()
  const corrupt = () => ({ description: '错误结果' }); db.worldGroups.hook('updating', corrupt)
  try { await expect(save()).rejects.toThrow('未读到相同世界身份与输入原文') } finally { db.worldGroups.hook('updating').unsubscribe(corrupt) }
  expect(await db.worldGroups.get(id)).toEqual(group)
  expect((await save()).description).toBe('作者新稿')
})
it('rereads a delayed precommit group load after the original writer commits', async () => {
  const { scope, id, group } = await fixture(), original = scopeModule.readOwnedRows
  let release!: () => void, entered!: () => void, first = true
  const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
  vi.spyOn(scopeModule, 'readOwnedRows').mockImplementation(async (...args) => {
    const rows = await original(...args)
    if (first && args[1] === 'worldGroups') { first = false; entered(); await gate }
    return rows
  })
  const loading = useWorldGroupStore.getState().loadAll(scope)
  try { await reached; await useWorldGroupStore.getState().updateGroup(id, { description: '已提交的新稿' }, { scope, expected: group }) } finally { release() }
  await loading; expect(useWorldGroupStore.getState().groups.find(row => row.id === id)?.description).toBe('已提交的新稿')
})
